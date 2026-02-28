import { Scene } from 'phaser';
import { SoundManager } from '../SoundManager';
import { SceneryManager } from './SceneryManager';
import { CarController, ICarController } from './CarController';
import { MatterCarController } from './MatterCarController';
import { ParticleEffects } from './ParticleEffects';
import { PickupManager } from './PickupManager';
import { UIManager } from './UIManager';
import { DebugModal } from './DebugModal';
import { PickupArrow } from './PickupArrow';
import { TouchControls } from '../TouchControls';
import {
    GameSessionConfig, GameMode, PlayerConfig,
    createSinglePlayerConfig, PHYSICS_ENGINE, JUMP_SCORE_BONUS,
} from './GameConfig';
import {
    getNetworkManager, destroyNetworkManager,
    NetworkManager, InputPacket, StatePacket, CarState,
} from '../NetworkManager';

// ========== Per-player state bundle ==========

interface PlayerState {
    config: PlayerConfig;
    car: ICarController;
    particles: ParticleEffects;
    score: number;
    airTime: number;             // cumulative seconds spent in the air this run
    lastCollisionTime: number;
    crashSoundPlays: number;
    crashSoundCooldownUntil: number;
    accelStopTimer: number;
    isOnRamp: boolean[];         // per-ramp: was car in this ramp zone last frame?
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
    private arrows: PickupArrow[] = [];

    // Shared state
    private gameOver = false;
    private timeRemaining = 45;
    private readonly startTime = 45;
    private runStartTime = 0;
    private readonly pickupTimeBonus = 3;
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
    private jumpSoundCar!: Phaser.Sound.BaseSound;         // cardoor.mp3    —   0 ms
    private jumpSoundRocks!: Phaser.Sound.BaseSound;       // rocks-smash.mp3 — 100 ms (half vol)
    private jumpSoundDirt!: Phaser.Sound.BaseSound;        // dirt-sound.mp3  — 150 ms
    private jumpSoundCrunch!: Phaser.Sound.BaseSound;      // crunch.mp3      — 250 ms

    // Network (online mode only)
    private networkRole: 'host' | 'guest' | 'none' = 'none';
    private net?: NetworkManager;
    private networkSendTimer = 0;
    private readonly networkSendRate = 1 / 60;  // 60 state packets/sec from host
    private lastReceivedState?: StatePacket;
    private sceneryRebuilt = false;

    // Scenery data for network sync
    private sceneryData?: any;

    constructor() {
        super('Game');
    }

    init(data: { sessionConfig?: GameSessionConfig; networkRole?: 'host' | 'guest'; seed?: number; sceneryData?: any }) {
        // Accept config from MainMenu or OnlineLobby
        this.sessionConfig = data.sessionConfig ?? createSinglePlayerConfig();
        this.mode = this.sessionConfig.mode;
        this.networkRole = data.networkRole ?? 'none';
        this.sceneryData = data.sceneryData;
    }

    create() {
        this.width = this.scale.width;
        this.height = this.scale.height;
        this.players = [];
        this.gameOver = false;
        this.timeRemaining = this.startTime;
        this.runStartTime = Date.now();

        // --- Sound & Music ---
        this.setupAudio();

        // --- Scenery (use network data if guest, otherwise generate) ---
        this.scenery = new SceneryManager(this, this.width, this.height);
        const generatedScenery = this.scenery.buildIsometricBackground(this.sceneryData);
        // Store for sending to guest if we're host
        if (this.networkRole === 'host') {
            this.sceneryData = generatedScenery;
        }

        // [Matter only] build static obstacle and ramp bodies from SceneryManager geometry.
        // Must be called here (inside the Scene) so this.matter is available.
        if (PHYSICS_ENGINE === 'matter') {
            this.buildMatterObstacles();
            // Ramp hit detection is handled by manual AABB proximity check in
            // updatePlayer, so Matter sensor bodies for ramps are not needed.
        }

        // --- Canvas focus ---
        const canvas = this.sys.game.canvas;
        if (canvas && canvas.setAttribute) {
            canvas.setAttribute('tabindex', '1');
            canvas.focus();
        }

        // [Arcade only] constrain bodies to the world rectangle.
        // Matter uses manual wrapping in each car controller instead.
        if (PHYSICS_ENGINE !== 'matter') {
            this.physics.world.setBounds(0, 0, this.width, this.height);
        }

        // --- Create players ---
        for (const playerConfig of this.sessionConfig.players) {
            const player = this.createPlayer(playerConfig);
            this.players.push(player);
        }

        // --- Pickup (shared) ---
        this.pickup = new PickupManager(this, this.scenery, this.width, this.height);
        this.pickup.create();

        // --- Pickup arrows (one per player, shown after first spawn) ---
        this.arrows = this.players.map(() => new PickupArrow(this));

        // --- UI ---
        this.ui = new UIManager(this, this.width, this.height);
        this.ui.create();

        // --- Input ---
        const keyboard = this.input.keyboard;
        keyboard?.on('keydown-U', () => this.tryRestart());
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
            getHitboxData: () => ({
                obstacles: this.scenery.obstacleHitboxData,
                ramps:     this.scenery.rampHitboxData,
                pickup: (this.pickup.pickupX != null && !isNaN(this.pickup.pickupX))
                    ? { x: this.pickup.pickupX, y: this.pickup.pickupY, radius: this.pickup.pickupCollectDist }
                    : null,
                cars: this.players.map(p => ({
                    x: p.car.headSprite.x,
                    y: p.car.headSprite.y,
                    w: p.car.hitboxWidth,
                    h: p.car.hitboxHeight,
                    angle: p.car.headAngle,
                })),
            }),
        });

        // --- Collisions (host and local only — guest doesn't run physics) ---
        if (this.networkRole !== 'guest') {
            // [Matter only] collision detection via event listener; bodies are
            // identified by their label strings set during createPlayer()
            if (PHYSICS_ENGINE === 'matter') {
                // Matter: listen to collision events
                this.matter.world.on('collisionstart', (event: any) => {
                    if (this.gameOver) return;
                    for (const pair of event.pairs) {
                        const { bodyA, bodyB } = pair;
                        for (const player of this.players) {
                            const carLabel = `car_${player.config.id}`;
                            if (bodyA.label === carLabel || bodyB.label === carLabel) {
                                const other = bodyA.label === carLabel ? bodyB : bodyA;
                                if (other.label === 'obstacle') {
                                    this.handlePlayerCollision(player, null);
                                }
                            }
                        }
                        // PvP in battle/online
                        if ((this.mode === 'battle' || this.mode === 'online') && this.players.length >= 2) {
                            const labelA = bodyA.label as string;
                            const labelB = bodyB.label as string;
                            if (
                                (labelA === 'car_1' && labelB === 'car_2') ||
                                (labelA === 'car_2' && labelB === 'car_1')
                            ) {
                                this.handlePlayerVsPlayerCollision();
                            }
                        }
                    }
                });
            } else {
                // [Arcade only] collision detection via Arcade colliders registered
                // against the static Zone group built in SceneryManager
                for (const player of this.players) {
                    this.physics.add.collider(
                        player.car.headSprite as any,
                        this.scenery.obstacleHitboxes,
                        (_car: any, obstacle: any) => this.handlePlayerCollision(player, obstacle)
                    );
                    // Ramp hits are detected by manual AABB proximity in updatePlayer.
                }

                if ((this.mode === 'battle' || this.mode === 'online') && this.players.length >= 2) {
                    this.physics.add.collider(
                        this.players[0].car.headSprite as any,
                        this.players[1].car.headSprite as any,
                        () => this.handlePlayerVsPlayerCollision()
                    );
                }
            }
        }

        // --- Network setup (online mode) ---
        if (this.mode === 'online') {
            this.setupNetwork();

            // Guest: disable physics on all car bodies — positions come from host
            if (this.networkRole === 'guest') {
                for (const player of this.players) {
                    player.car.setPhysicsEnabled(false);
                }
            }
        }

        // Delay first pickup spawn
        this.time.delayedCall(1000, () => { this.pickup.spawn(); });

        // "Go!" popup near the player's car at game start
        this.showGoPopup();

        // Virtual touch controls (layered on top of the canvas)
        TouchControls.getInstance().show();

        // Clean up the overlay whenever this scene stops
        this.events.once('shutdown', () => TouchControls.getInstance().hide());
        this.events.once('destroy', () => TouchControls.getInstance().hide());
    }

    private showGoPopup() {
        const car = this.players[0].car;
        const x = car.headSprite.x;
        const y = car.headSprite.y - 60;

        const label = this.add.text(x, y, 'Collect the Capybara! GO!', {
            fontFamily: 'BoldPixels',
            fontSize: 26,
            color: '#ffee44',
            stroke: '#000000',
            strokeThickness: 5,
        }).setOrigin(0.5).setDepth(40).setAlpha(0).setScale(0.3);

        // Bounce in
        this.tweens.add({
            targets: label,
            alpha: 1,
            scale: 1.15,
            y: y - 30,
            duration: 320,
            ease: 'Back.easeOut',
            onComplete: () => {
                // Hold briefly, then fade out and rise
                this.tweens.add({
                    targets: label,
                    alpha: 0,
                    scale: 0.7,
                    y: y - 75,
                    duration: 450,
                    ease: 'Quad.easeIn',
                    delay: 900,
                    onComplete: () => { label.destroy(); },
                });
            },
        });
    }

    // ========== MATTER OBSTACLE BUILDER ==========
    // [Matter only] reads SceneryManager.obstacleHitboxData and registers
    // each hitbox as a static Matter body labelled 'obstacle'.
    // Called after buildIsometricBackground() so geometry is ready.

    private buildMatterObstacles() {
        for (const hb of this.scenery.obstacleHitboxData) {
            const body = this.matter.add.rectangle(hb.x, hb.y, hb.w, hb.h, {
                isStatic: true,
                label: 'obstacle',
                friction: 0.3,
                restitution: 0.35,
                frictionAir: 0,
            } as any);
            this.scenery.matterObstacles.push(body);
        }
    }

    private buildMatterRamps() {
        for (let i = 0; i < this.scenery.rampHitboxData.length; i++) {
            const hb = this.scenery.rampHitboxData[i];
            const body = this.matter.add.rectangle(hb.x, hb.y, hb.w, hb.h, {
                isStatic: true,
                isSensor: true,     // pass-through: no physical collision response
                label: `ramp_${i}`,
                frictionAir: 0,
            } as any);
            this.scenery.matterRamps.push(body);
        }
    }

    // ========== PLAYER FACTORY ==========

    private createPlayer(config: PlayerConfig): PlayerState {
        const spritePrefix = config.spritePrefix ?? 'car-1';

        let car: ICarController;

        // [Matter only] create a Rectangle game object, wrap it with a Matter body,
        // and hand it to MatterCarController as its headSprite
        if (PHYSICS_ENGINE === 'matter') {
            // ---- Matter physics car ----
            const mCar = new MatterCarController(this, config.keys, config.id, spritePrefix, config.inputSource);

            const rect = this.add.rectangle(0, 0, mCar.hitboxWidth, mCar.hitboxHeight, 0x00ff88, 0);
            this.matter.add.gameObject(rect, {
                frictionAir: 0,
                friction: 0,
                frictionStatic: 0,
                restitution: mCar.obstacleBounce,
                inertia: Infinity,
                inverseInertia: 0,
                label: `car_${config.id}`,
                mass: mCar.collisionMass,
            } as any);
            mCar.headSprite = rect as any;
            car = mCar;
        } else {
            // [Arcade only] create a Rectangle game object and attach an Arcade physics body to it
            // ---- Arcade physics car ----
            const aCar = new CarController(this, config.keys, config.id, spritePrefix, config.inputSource);

            aCar.headSprite = this.add.rectangle(0, 0, aCar.hitboxWidth, aCar.hitboxHeight, 0x00ff88, 0) as unknown as Phaser.GameObjects.Arc;
            this.physics.add.existing(aCar.headSprite);

            const body = aCar.headSprite.body as Phaser.Physics.Arcade.Body;
            body.setSize(aCar.hitboxWidth, aCar.hitboxHeight);
            car = aCar;
        }

        // Create car visuals using player's sprite set
        const initialFrame = `${spritePrefix}_000`;
        car.carShadow = this.scenery.createDynamicShadow(0, 0, initialFrame, 3);
        car.carSprite = this.add.image(0, 0, initialFrame).setDepth(4);

        // Configure body properties (mode-specific bounce/mass)
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
            airTime: 0,
            lastCollisionTime: 0,
            crashSoundPlays: 0,
            crashSoundCooldownUntil: 0,
            accelStopTimer: 0,
            isOnRamp: [],
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
        this.jumpSoundCar    = this.sound.add('jump-cardoor');
        this.jumpSoundRocks  = this.sound.add('jump-rocks-smash');
        this.jumpSoundDirt   = this.sound.add('jump-dirt');
        this.jumpSoundCrunch = this.sound.add('jump-crunch');

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

            // Send scenery data to guest so they render identical obstacles
            this.net.send({ type: 'scenery', sceneryData: this.sceneryData });

            this.net.on('disconnected', () => {
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

            // Guest receives scenery data — rebuild scenery with host's layout
            this.net.on('scenery', (packet: any) => {
                    if (packet.sceneryData && !this.sceneryRebuilt) {
                    this.sceneryRebuilt = true;
                    this.scenery.clearAll();
                    this.scenery.buildIsometricBackground(packet.sceneryData);
                    // [Matter only] re-register static obstacle bodies after scenery rebuild
                    if (PHYSICS_ENGINE === 'matter') {
                        this.buildMatterObstacles();
                    }
                }
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

        const carStates: CarState[] = this.players.map(p => ({
            x: p.car.headSprite.x,
            y: p.car.headSprite.y,
            vx: p.car.velocityX,
            vy: p.car.velocityY,
            angle: p.car.headAngle,
            angularVel: p.car.angularVel,
            boostFuel: p.car.boostFuel,
            boostIntensity: p.car.boostIntensity,
            tireMarkIntensity: p.car.tireMarkIntensity,
        }));

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
    // Interpolation window: longer than one frame so motion is smooth between packets.
    // Independent of send rate — if packets arrive faster they simply start a new
    // interpolation from the current visual position rather than completing fully.
    private readonly networkInterpDuration = 1 / 30; // 33 ms ≈ 2 frames at 60 fps

    /** Guest: apply received state from host to all game objects */
    private applyReceivedState() {
        if (!this.lastReceivedState) return;
        const state = this.lastReceivedState;

        // Store the CURRENT interpolated position (not the old target) as the new
        // starting point. This prevents the car from snapping back when a new packet
        // arrives before the previous interpolation has fully completed.
        if (this.interpTargets.length > 0 && this.interpPrevious.length > 0) {
            const t = this.interpProgress;
            this.interpPrevious = this.interpTargets.map((target, i) => {
                const prev = this.interpPrevious[i];
                if (!prev) return { ...target };
                let angleDiff = target.angle - prev.angle;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                return { ...prev, x: prev.x + (target.x - prev.x) * t, y: prev.y + (target.y - prev.y) * t, angle: prev.angle + angleDiff * t };
            });
        } else {
            this.interpPrevious = state.cars.map((cs: CarState) => ({ ...cs }));
        }

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

        // Advance interpolation over the full interp window (not just one frame)
        this.interpProgress = Math.min(1, this.interpProgress + dt / this.networkInterpDuration);
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
        if (this.gameOver) return;
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

    // ========== RAMP HIT ==========
    // Called by updatePlayer exactly once per ramp-entry (isOnRamp tracking guarantees
    // this fires only on the frame the car transitions from outside → inside the zone).

    private handleRampHit(player: PlayerState, rampIndex: number) {
        if (this.gameOver) return;

        player.car.startJump();
        player.score += JUMP_SCORE_BONUS;
        if (!(this.jumpSoundCar as any).isPlaying) {
            this.jumpSoundCar.play({ volume: 0.7 });
        }
        this.time.delayedCall(100, () => {
            if (!(this.jumpSoundRocks as any).isPlaying) {
                this.jumpSoundRocks.play({ volume: 0.80 });
            }
        });
        this.time.delayedCall(150, () => {
            if (!(this.jumpSoundDirt as any).isPlaying) {
                this.jumpSoundDirt.play({ volume: 0.6 });
            }
        });
        this.time.delayedCall(350, () => {
            if (!(this.jumpSoundCrunch as any).isPlaying) {
                this.jumpSoundCrunch.play({ volume: 0.65 });
            }
        });

        const hb = this.scenery.rampHitboxData[rampIndex];
        const popX = hb ? hb.x : player.car.headSprite.x;
        const popY = hb ? hb.y : player.car.headSprite.y;
        this.ui.showJumpBonusPopup(popX, popY, JUMP_SCORE_BONUS);
        this.time.delayedCall(300, () => {
            this.ui.showAirTimePopup(popX, popY + 22);
        });
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
            for (let i = 0; i < this.players.length; i++) {
                const player = this.players[i];
                player.car.updateCarSprite();
                const input = player.car.readInput();
                player.particles.update(player.car, input.brakeInput);

                const pickupReady = this.pickup.pickupX != null && !isNaN(this.pickup.pickupX);
                if (this.arrows[i] && pickupReady) {
                    this.arrows[i].update(
                        player.car.headSprite.x, player.car.headSprite.y,
                        player.car.headAngle,
                        this.pickup.pickupX, this.pickup.pickupY,
                        true,
                    );
                }
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
        this.debug.updateDebugText(this.players[0].car.currentSpeed);

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

        // Track airtime before update (isInAir may change inside the update)
        const wasInAir = car.isInAir;

        // Suppress handbrake while airborne — no grip on the ground to brake against
        if (car.isInAir) input.brakeInput = false;

        // --- Physics (reverse takes priority; returns true when car is reversing) ---
        const isReversing = car.updateReverse(dt, input);
        if (!isReversing) {
            car.updateForward(dt, input);
        }

        if (wasInAir) player.airTime += dt;

        // --- Ramp proximity detection (manual AABB, runs regardless of direction) ---
        // Using enter/exit state (isOnRamp) guarantees handleRampHit fires exactly once
        // per crossing, avoiding the every-frame firing of Matter sensor / Arcade overlap.
        {
            const cx = car.headSprite.x as number;
            const cy = car.headSprite.y as number;
            for (let ri = 0; ri < this.scenery.rampHitboxData.length; ri++) {
                const hb = this.scenery.rampHitboxData[ri];
                const inZone = Math.abs(cx - hb.x) < hb.w / 2 + 6 &&
                               Math.abs(cy - hb.y) < hb.h / 2 + 6;
                if (inZone && !player.isOnRamp[ri]) {
                    this.handleRampHit(player, ri);
                }
                player.isOnRamp[ri] = inZone;
            }
        }

        if (isReversing) return;

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

        // --- Pickup arrow indicator ---
        const idx = this.players.indexOf(player);
        const pickupReady = this.pickup.pickupX != null && !isNaN(this.pickup.pickupX);
        if (this.arrows[idx] && pickupReady) {
            this.arrows[idx].update(hx, hy, car.headAngle, this.pickup.pickupX, this.pickup.pickupY, true);
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
        if (car.isInAir) input.brakeInput = false;

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
        this.ui.fadeDimOverlay();

        for (const player of this.players) {
            player.car.initGameOver();
            player.particles.stopAll();
        }

        for (const arrow of this.arrows) {
            arrow.hide();
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

        const runDuration = (Date.now() - this.runStartTime) / 1000;

        this.time.delayedCall(2000, () => {
            if (this.mode === 'single') {
                const p1 = this.players[0];
                const playerName = p1.config.playerName ?? 'Player 1';
                this.ui.showGameOverUI(
                    p1.score,
                    runDuration,
                    p1.airTime,
                    playerName,
                    () => this.tryRestart(),
                    () => this.backToMenu()
                );
            } else {
                const p1 = this.players[0].score;
                const p2 = this.players[1]?.score ?? 0;
                this.ui.showBattleResultUI(p1, p2, () => this.tryRestart(), () => this.backToMenu());
            }
        });
    }

    private tryRestart() {
        // Cancel any in-flight async game-over UI before the scene is torn down.
        // Without this, showGameOverUI's leaderboard await can resume on the new
        // game scene and inject stale overlay objects into the running game.
        this.ui.cleanupGameOver();
        this.scene.restart({ sessionConfig: this.sessionConfig });
    }

    private backToMenu() {
        this.ui.cleanupGameOver();
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
