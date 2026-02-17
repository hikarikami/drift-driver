import { Scene } from 'phaser';
import { SoundManager } from '../SoundManager';
import { SceneryManager } from './SceneryManager';
import { CarController, CarInput } from './CarController';
import { ParticleEffects } from './ParticleEffects';
import { PickupManager } from './PickupManager';
import { UIManager } from './UIManager';
import { DebugModal } from './DebugModal';
import {
    GameSessionConfig, GameMode, PlayerConfig,
    createSinglePlayerConfig, PLAYER1_KEYS,
} from './GameConfig';
import {
    getNetworkManager, destroyNetworkManager,
    NetworkManager, InputPacket, StatePacket, CarState,
} from '../NetworkManager';

// ========== Per-player state bundle ==========

interface PlayerState {
    config: PlayerConfig;
    car: CarController;
    particles: ParticleEffects;
    score: number;
    lastCollisionTime: number;
    crashSoundPlays: number;
    crashSoundCooldownUntil: number;
    accelStopTimer: number;
}

export class Game extends Scene {
    // World bounds
    private width!: number;
    private height!: number;

    // Session
    private sessionConfig!: GameSessionConfig;
    private mode: GameMode = 'single';

    // Players (1 or 2)
    private players: PlayerState[] = [];

    // Shared sub-systems
    private scenery!: SceneryManager;
    private pickup!: PickupManager;
    private ui!: UIManager;
    private debug!: DebugModal;

    // Shared state
    private gameOver = false;
    private timeRemaining = 60;
    private readonly startTime = 60;
    private readonly pickupTimeBonus = 4;
    private readonly collisionCooldown = 500;
    private readonly crashSoundMaxPlays = 2;
    private readonly crashSoundCooldown = 1750;

    // Music & Sound
    private musicVolume = 0.35;
    private soundManager!: SoundManager;
    private readonly engineFadeDelay = 0.165;
    private music!: Phaser.Sound.BaseSound;
    private musicMuted = false;
    private collectSound!: Phaser.Sound.BaseSound;
    private crashSound1!: Phaser.Sound.BaseSound;
    private crashSound2!: Phaser.Sound.BaseSound;
    private crashSound3!: Phaser.Sound.BaseSound;

    // Network (online mode only)
    private networkRole: 'host' | 'guest' | 'none' = 'none';
    private net?: NetworkManager;
    private networkSendTimer = 0;
    private readonly networkSendRate = 1 / 60;  // 60 state packets/sec from host
    private lastReceivedState?: StatePacket;

    constructor() {
        super('Game');
    }

    init(data: { sessionConfig?: GameSessionConfig; networkRole?: 'host' | 'guest'; seed?: number }) {
        // Accept config from MainMenu or OnlineLobby
        this.sessionConfig = data.sessionConfig ?? createSinglePlayerConfig();
        this.mode = this.sessionConfig.mode;
        this.networkRole = data.networkRole ?? 'none';
    }

    create() {
        this.width = this.scale.width;
        this.height = this.scale.height;
        this.players = [];
        this.gameOver = false;
        this.timeRemaining = this.startTime;

        // --- Sound & Music ---
        this.setupAudio();

        // --- Scenery ---
        this.scenery = new SceneryManager(this, this.width, this.height);
        this.scenery.buildIsometricBackground();

        // --- Canvas focus ---
        const canvas = this.sys.game.canvas;
        if (canvas && canvas.setAttribute) {
            canvas.setAttribute('tabindex', '1');
            canvas.focus();
        }

        this.physics.world.setBounds(0, 0, this.width, this.height);

        // --- Create players ---
        for (const playerConfig of this.sessionConfig.players) {
            const player = this.createPlayer(playerConfig);
            this.players.push(player);
        }

        // --- Pickup (shared) ---
        this.pickup = new PickupManager(this, this.scenery, this.width, this.height);
        this.pickup.create();

        // --- UI ---
        this.ui = new UIManager(this, this.width, this.height);
        this.ui.create();

        // --- Input ---
        const keyboard = this.input.keyboard;
        keyboard?.on('keydown-R', () => this.tryRestart());
        keyboard?.on('keydown-ESC', () => this.backToMenu());

        this.input.on('pointerdown', () => {
            if (!this.gameOver) {
                this.sys.game.canvas?.focus?.();
            }
        });

        // --- Sound Manager ---
        this.setupSoundManager();

        // --- Debug Modal (uses player 1's car for tuning) ---
        this.debug = new DebugModal(this, this.width, this.height);
        this.debug.create({
            car: this.players[0].car,
            soundManager: this.soundManager,
            music: this.music,
            musicVolume: this.musicVolume,
            musicMuted: this.musicMuted,
            onMusicMuteToggle: (muted) => { this.musicMuted = muted; },
            onEndRun: () => {
                if (!this.gameOver) {
                    this.timeRemaining = 0;
                    this.endGame();
                }
            },
        });

        // --- Collisions (host and local only — guest doesn't run physics) ---
        if (this.networkRole !== 'guest') {
            for (const player of this.players) {
                this.physics.add.collider(
                    player.car.headSprite,
                    this.scenery.obstacleHitboxes,
                    (_car: any, obstacle: any) => this.handlePlayerCollision(player, obstacle)
                );
            }

            // Player-vs-player collision in battle/online mode
            if ((this.mode === 'battle' || this.mode === 'online') && this.players.length >= 2) {
                this.physics.add.collider(
                    this.players[0].car.headSprite,
                    this.players[1].car.headSprite,
                    () => this.handlePlayerVsPlayerCollision()
                );
            }
        }

        // --- Network setup (online mode) ---
        if (this.mode === 'online') {
            this.setupNetwork();

            // Guest: disable physics on all car bodies — positions come from host
            if (this.networkRole === 'guest') {
                for (const player of this.players) {
                    const body = player.car.headSprite.body as Phaser.Physics.Arcade.Body;
                    body.enable = false;
                }
            }
        }

        // Delay first pickup spawn
        this.time.delayedCall(1000, () => { this.pickup.spawn(); });
    }

    // ========== PLAYER FACTORY ==========

    private createPlayer(config: PlayerConfig): PlayerState {
        const spritePrefix = config.spritePrefix ?? 'car-1';
        const car = new CarController(this, this.width, this.height, config.keys, config.id, spritePrefix, config.inputSource);

        // Create car physics body (invisible rectangle hitbox)
        car.headSprite = this.add.rectangle(0, 0, car.hitboxWidth, car.hitboxHeight, 0x00ff88, 0) as unknown as Phaser.GameObjects.Arc;
        this.physics.add.existing(car.headSprite);

        // Set the physics body to match the rectangle size
        const body = car.headSprite.body as Phaser.Physics.Arcade.Body;
        body.setSize(car.hitboxWidth, car.hitboxHeight);

        // Create car visuals using player's sprite set
        const initialFrame = `${spritePrefix}_000`;
        car.carShadow = this.scenery.createDynamicShadow(0, 0, initialFrame, 3);
        car.carSprite = this.add.image(0, 0, initialFrame).setDepth(4);

        // Let CarController configure all physics (drag, bounce, mass, etc.)
        // Online mode uses same physics as battle
        car.setupBody(this.mode === 'single' ? 'single' : 'battle');

        // Find safe spawn position — offset players in battle mode
        let spawnX = this.width / 2;
        let spawnY = this.height / 2;
        if (this.mode === 'battle') {
            const offset = 120;
            spawnX = config.id === 1 ? this.width / 2 - offset : this.width / 2 + offset;
        }
        const spawnPos = this.scenery.findSafePosition(spawnX, spawnY, 100);
        car.headSprite.setPosition(spawnPos.x, spawnPos.y);
        car.headAngle = 0;

        // Create particles for this player
        const particles = new ParticleEffects(this);
        particles.create();

        return {
            config,
            car,
            particles,
            score: 0,
            lastCollisionTime: 0,
            crashSoundPlays: 0,
            crashSoundCooldownUntil: 0,
            accelStopTimer: 0,
        };
    }

    // ========== AUDIO SETUP ==========

    private setupAudio() {
        if (this.music) {
            if (this.music.isPlaying) { this.music.stop(); }
            this.music.destroy();
        }

        this.music = this.sound.add('theme2', { loop: true });
        this.collectSound = this.sound.add('collect-1');
        this.crashSound1 = this.sound.add('crash-1');
        this.crashSound2 = this.sound.add('crash-2');
        this.crashSound3 = this.sound.add('crash-3');

        this.music.play({ volume: this.musicVolume });
    }

    private setupSoundManager() {
        if (this.soundManager) {
            this.soundManager.destroy();
        }

        this.soundManager = new SoundManager(this);
        this.soundManager.addLayer('screech', 'screech_sfx', {
            loop: true, maxVolume: 1, fadeIn: 4, fadeOut: 7.5, seekStart: 1.85,
        });
        this.soundManager.addCrossfadeLayer('engine', 'engine_sfx', {
            maxVolume: 0.25, crossfadeDuration: 2.5, crossfadeAt: 0.75,
        });
        this.soundManager.addLayer('stopping', 'stopping_sfx', {
            loop: false, maxVolume: 0.28, fadeIn: 4, fadeOut: 12, seekStart: 0, maxDuration: 3.5, segmentFadeOut: 1.0,
        });
        this.soundManager.addLayer('nitro', 'nitro_sfx', {
            loop: true, maxVolume: 0.7, fadeIn: 6, fadeOut: 12, seekStart: 0,
        });
    }

    // ========== NETWORK (online mode) ==========

    private setupNetwork() {
        this.net = getNetworkManager();

        if (this.networkRole === 'host') {
            // Host receives input packets from guest
            this.net.on('input', (packet: InputPacket) => {
                // Find the remote player (player 2 for host)
                const remotePlayer = this.players.find(p => p.config.inputSource === 'remote');
                if (remotePlayer) {
                    remotePlayer.car.setRemoteInput({
                        turnInput: packet.turnInput,
                        thrustInput: packet.thrustInput,
                        brakeInput: packet.brakeInput,
                        reverseInput: packet.reverseInput,
                        isAccelerating: packet.isAccelerating,
                    });
                }
            });

            this.net.on('disconnected', () => {
                // Pause or show disconnect message
                if (!this.gameOver) {
                    this.ui.showDisconnectMessage?.();
                }
            });
        }

        if (this.networkRole === 'guest') {
            // Guest receives state packets from host
            this.net.on('state', (packet: StatePacket) => {
                this.lastReceivedState = packet;
            });

            this.net.on('disconnected', () => {
                if (!this.gameOver) {
                    this.ui.showDisconnectMessage?.();
                }
            });
        }
    }

    /** Host: serialize and send game state to guest */
    private sendStateToGuest() {
        if (!this.net || this.networkRole !== 'host') return;

        const carStates: CarState[] = this.players.map(p => {
            const body = p.car.headSprite.body as Phaser.Physics.Arcade.Body;
            return {
                x: p.car.headSprite.x,
                y: p.car.headSprite.y,
                vx: body.velocity.x,
                vy: body.velocity.y,
                angle: p.car.headAngle,
                angularVel: p.car.angularVel,
                boostFuel: p.car.boostFuel,
                boostIntensity: p.car.boostIntensity,
                tireMarkIntensity: p.car.tireMarkIntensity,
            };
        });

        const packet: StatePacket = {
            type: 'state',
            cars: carStates,
            scores: this.players.map(p => p.score),
            timeRemaining: this.timeRemaining,
            pickupX: this.pickup.pickupX,
            pickupY: this.pickup.pickupY,
            gameOver: this.gameOver,
        };

        this.net.sendState(packet);
    }

    /** Guest: send local input to host */
    private sendInputToHost() {
        if (!this.net || this.networkRole !== 'guest') return;

        // Find the local player (player 2 for guest)
        const localPlayer = this.players.find(p => p.config.inputSource === 'keyboard');
        if (!localPlayer) return;

        const input = localPlayer.car.readInput();
        const packet: InputPacket = {
            type: 'input',
            turnInput: input.turnInput,
            thrustInput: input.thrustInput,
            brakeInput: input.brakeInput,
            reverseInput: input.reverseInput,
            isAccelerating: input.isAccelerating,
        };

        this.net.sendInput(packet);
    }

    // Track interpolation targets for smooth rendering on guest
    private interpTargets: CarState[] = [];
    private interpPrevious: CarState[] = [];
    private interpProgress = 0;

    /** Guest: apply received state from host to all game objects */
    private applyReceivedState() {
        if (!this.lastReceivedState) return;
        const state = this.lastReceivedState;

        // Store previous targets as starting point for interpolation
        this.interpPrevious = this.interpTargets.length > 0
            ? [...this.interpTargets]
            : state.cars.map((cs: CarState) => ({ ...cs }));

        // New targets from host
        this.interpTargets = state.cars.map((cs: CarState) => ({ ...cs }));
        this.interpProgress = 0;

        // Sync non-interpolated state immediately
        for (let i = 0; i < state.cars.length && i < this.players.length; i++) {
            const cs = state.cars[i];
            const car = this.players[i].car;

            car.boostFuel = cs.boostFuel;
            car.boostIntensity = cs.boostIntensity;
            car.tireMarkIntensity = cs.tireMarkIntensity;

            this.players[i].score = state.scores[i] ?? 0;
        }

        this.timeRemaining = state.timeRemaining;

        // Sync pickup position
        if (this.pickup) {
            this.pickup.pickupX = state.pickupX;
            this.pickup.pickupY = state.pickupY;
            if (this.pickup.pickupSprite) {
                this.pickup.pickupSprite.setPosition(state.pickupX, state.pickupY);
            }
            if (this.pickup.pickupShadow) {
                this.pickup.pickupShadow.setPosition(state.pickupX - 4, state.pickupY + 7);
            }
        }

        if (state.gameOver && !this.gameOver) {
            this.endGame();
        }

        this.lastReceivedState = undefined;
    }

    /** Guest: smoothly interpolate car positions between state packets */
    private interpolateGuestCars(dt: number) {
        if (this.interpTargets.length === 0) return;

        // Advance interpolation (complete in ~1 send interval)
        this.interpProgress = Math.min(1, this.interpProgress + dt / this.networkSendRate);
        const t = this.interpProgress;

        for (let i = 0; i < this.interpTargets.length && i < this.players.length; i++) {
            const prev = this.interpPrevious[i];
            const target = this.interpTargets[i];
            if (!prev || !target) continue;

            const car = this.players[i].car;

            // Smooth interpolation between last and current state
            car.headSprite.x = prev.x + (target.x - prev.x) * t;
            car.headSprite.y = prev.y + (target.y - prev.y) * t;

            // Angle interpolation (handle wraparound)
            let angleDiff = target.angle - prev.angle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            car.headAngle = prev.angle + angleDiff * t;

            car.angularVel = target.angularVel;
        }
    }

    // ========== COLLISION ==========

    private handlePlayerCollision(player: PlayerState, obstacle: any) {
        const now = this.time.now;
        if (now - player.lastCollisionTime < this.collisionCooldown) return;
        player.lastCollisionTime = now;

        const speedAtImpact = player.car.handleCollision(obstacle);

        // Rate-limited crash sound
        if (now >= player.crashSoundCooldownUntil) {
            if (speedAtImpact < 200) {
                this.crashSound1.play({ volume: 0.5 });
            } else if (speedAtImpact < 300) {
                this.crashSound2.play({ volume: 0.6 });
            } else {
                this.crashSound3.play({ volume: 0.7 });
            }

            player.crashSoundPlays++;
            if (player.crashSoundPlays >= this.crashSoundMaxPlays) {
                player.crashSoundCooldownUntil = now + this.crashSoundCooldown;
                player.crashSoundPlays = 0;
            }
        }
    }

    // ========== PLAYER-VS-PLAYER COLLISION ==========

    private pvpLastCollisionTime = 0;
    private pvpCrashSoundPlays = 0;
    private pvpCrashSoundCooldownUntil = 0;

    private handlePlayerVsPlayerCollision() {
        const now = this.time.now;
        // Shorter cooldown than obstacles — car battles should feel rapid
        if (now - this.pvpLastCollisionTime < 300) return;
        this.pvpLastCollisionTime = now;

        const p1 = this.players[0];
        const p2 = this.players[1];

        // Use the new car-vs-car collision handler which returns max speed at impact
        const speedAtImpact = p1.car.handlePlayerCollision(p2.car);

        // Always play a crash sound — even low-speed bumps should be audible
        const effectiveSoundSpeed = Math.max(speedAtImpact, 150);

        // Play crash sound based on impact speed (same logic as obstacle hits)
        if (now >= this.pvpCrashSoundCooldownUntil) {
            if (effectiveSoundSpeed < 200) {
                this.crashSound1.play({ volume: 0.5 });
            } else if (effectiveSoundSpeed < 300) {
                this.crashSound2.play({ volume: 0.6 });
            } else {
                this.crashSound3.play({ volume: 0.7 });
            }

            this.pvpCrashSoundPlays++;
            if (this.pvpCrashSoundPlays >= this.crashSoundMaxPlays) {
                this.pvpCrashSoundCooldownUntil = now + this.crashSoundCooldown;
                this.pvpCrashSoundPlays = 0;
            }
        }
    }

    // ========== UPDATE LOOP ==========

    update(_time: number, delta: number) {
        const dt = delta / 1000;

        // --- Game-over coasting ---
        if (this.gameOver) {
            for (const player of this.players) {
                player.car.updateGameOver(dt);
            }
            this.soundManager.update(dt);
            return;
        }

        // === GUEST: apply state from host, interpolate, send input, render ===
        if (this.networkRole === 'guest') {
            this.applyReceivedState();
            this.interpolateGuestCars(dt);
            this.sendInputToHost();

            // Update sprites and particles from interpolated positions
            for (const player of this.players) {
                player.car.updateCarSprite();
                const input = player.car.readInput();
                player.particles.update(player.car, input.brakeInput);
            }
            this.ui.updateTimer(this.timeRemaining);
            this.ui.updateScore(this.players[0].score, this.players[1]?.score);

            // Boost bar for local player
            const localPlayer = this.players.find(p => p.config.inputSource === 'keyboard');
            if (localPlayer) {
                const barLerp = 1 - Math.exp(-6 * dt);
                localPlayer.car.boostBarDisplay += (localPlayer.car.boostFuel - localPlayer.car.boostBarDisplay) * barLerp;
                this.ui.updateBoostBar(localPlayer.car.boostBarDisplay, localPlayer.car.boostMax);
            }

            this.soundManager.update(dt);
            return;
        }

        // === HOST or LOCAL: run full game simulation ===

        // --- Countdown timer ---
        this.timeRemaining -= dt;
        if (this.timeRemaining <= 0) {
            this.timeRemaining = 0;
            this.endGame();
            return;
        }
        this.ui.updateTimer(this.timeRemaining);

        // --- Update each player ---
        for (const player of this.players) {
            this.updatePlayer(player, dt);
        }

        // --- Sound (driven by local player 1) ---
        this.updateSound(this.players[0], dt);

        // --- Score display ---
        if (this.mode === 'single') {
            this.ui.updateScore(this.players[0].score);
        } else {
            this.ui.updateScore(this.players[0].score, this.players[1]?.score);
        }

        // --- Debug ---
        const speed = (this.players[0].car.headSprite.body as Phaser.Physics.Arcade.Body).speed;
        this.debug.updateDebugText(speed);

        // --- Network: host sends state to guest ---
        if (this.networkRole === 'host') {
            this.networkSendTimer += dt;
            if (this.networkSendTimer >= this.networkSendRate) {
                this.networkSendTimer = 0;
                this.sendStateToGuest();
            }
        }

        this.soundManager.update(dt);
    }

    private updatePlayer(player: PlayerState, dt: number) {
        const car = player.car;

        // --- Input ---
        const input = car.readInput();

        // --- Reverse ---
        if (car.updateReverse(dt, input)) return;

        // --- Forward physics ---
        car.updateForward(dt, input);

        // --- Particles ---
        player.particles.update(car, input.brakeInput);

        // --- Pickup collection ---
        const hx = car.headSprite.x;
        const hy = car.headSprite.y;
        if (this.pickup.checkCollection(hx, hy)) {
            player.score += 350;
            this.timeRemaining = Math.min(this.timeRemaining + this.pickupTimeBonus, 99);
            car.boostFuel = Math.min(car.boostMax, car.boostFuel + car.boostRefillAmount);

            this.ui.showTimeBonusPopup(this.pickup.pickupX, this.pickup.pickupY, this.pickupTimeBonus);
            this.pickup.spawn();
            this.collectSound.play({ volume: .9 });
        }

        // --- Boost bar (smoothed) — only show for player 1 for now ---
        if (player.config.id === 1) {
            const barLerp = 1 - Math.exp(-6 * dt);
            car.boostBarDisplay += (car.boostFuel - car.boostBarDisplay) * barLerp;
            this.ui.updateBoostBar(car.boostBarDisplay, car.boostMax);
        }
    }

    private updateSound(player: PlayerState, dt: number) {
        const car = player.car;
        const input = car.readInput(); // Re-read for sound — cheap since keys are cached

        const brakeScreech = input.brakeInput ? 0.15 : 0;
        this.soundManager.setLayerTarget('screech', Math.max(car.tireMarkIntensity, brakeScreech));

        const nitroTarget = (input.thrustInput && car.boostFuel > 0 && !input.brakeInput) ? 1 : 0;
        this.soundManager.setLayerTarget('nitro', nitroTarget);

        if (car.isAccelerating) {
            player.accelStopTimer = 0;
            this.soundManager.setCrossfadeLayerScale('engine', 1);
        } else {
            player.accelStopTimer += dt;
            if (player.accelStopTimer >= this.engineFadeDelay) {
                this.soundManager.setCrossfadeLayerScale('engine', input.brakeInput ? 0.3 : 0);
            }
        }

        this.soundManager.setLayerTarget('stopping', input.brakeInput ? 1 : 0);
    }

    // ========== GAME FLOW ==========

    private endGame() {
        this.gameOver = true;

        for (const player of this.players) {
            const body = player.car.headSprite.body as Phaser.Physics.Arcade.Body;
            body.setAcceleration(0, 0);
            body.setDrag(400, 400);  // High drag to coast to stop
            player.particles.stopAll();
        }

        // Fade music
        if (this.music && !this.musicMuted) {
            this.tweens.add({ targets: this.music, volume: 0.012, duration: 1500, ease: 'Quad.easeOut' });
        }

        // Fade SFX
        this.soundManager.setLayerTarget('screech', 0);
        this.soundManager.setCrossfadeLayerScale('engine', 0);
        this.soundManager.setLayerTarget('stopping', 0);
        this.soundManager.setLayerTarget('nitro', 0);

        this.time.delayedCall(2000, () => {
            if (this.mode === 'single') {
                this.ui.showGameOverUI(this.players[0].score, () => this.tryRestart());
            } else {
                const p1 = this.players[0].score;
                const p2 = this.players[1]?.score ?? 0;
                this.ui.showBattleResultUI(p1, p2, () => this.tryRestart(), () => this.backToMenu());
            }
        });
    }

    private tryRestart() {
        // Restart same mode
        this.scene.restart({ sessionConfig: this.sessionConfig });
    }

    private backToMenu() {
        // Stop all audio before switching scenes
        if (this.music?.isPlaying) this.music.stop();
        if (this.soundManager) this.soundManager.stopAll();
        // Clean up network
        if (this.networkRole !== 'none') {
            destroyNetworkManager();
        }
        this.scene.start('MainMenu');
    }
}