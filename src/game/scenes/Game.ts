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

    constructor() {
        super('Game');
    }

    init(data: { sessionConfig?: GameSessionConfig }) {
        // Accept config from MainMenu, or default to single player
        this.sessionConfig = data.sessionConfig ?? createSinglePlayerConfig();
        this.mode = this.sessionConfig.mode;
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

        // --- Collisions (each player vs obstacles) ---
        for (const player of this.players) {
            this.physics.add.collider(
                player.car.headSprite,
                this.scenery.obstacleHitboxes,
                (_car: any, obstacle: any) => this.handlePlayerCollision(player, obstacle)
            );
        }

        // --- Player-vs-player collision in battle mode ---
        if (this.mode === 'battle' && this.players.length >= 2) {
            this.physics.add.collider(
                this.players[0].car.headSprite,
                this.players[1].car.headSprite
            );
        }

        // Delay first pickup spawn
        this.time.delayedCall(1000, () => { this.pickup.spawn(); });
    }

    // ========== PLAYER FACTORY ==========

    private createPlayer(config: PlayerConfig): PlayerState {
        const spritePrefix = config.spritePrefix ?? 'car-1';
        const car = new CarController(this, this.width, this.height, config.keys, config.id, spritePrefix);

        // Create car physics body (invisible rectangle hitbox)
        car.headSprite = this.add.rectangle(0, 0, car.hitboxWidth, car.hitboxHeight, 0x00ff88, 0) as unknown as Phaser.GameObjects.Arc;
        this.physics.add.existing(car.headSprite);

        // Set the physics body to match the rectangle size
        const body = car.headSprite.body as Phaser.Physics.Arcade.Body;
        body.setSize(car.hitboxWidth, car.hitboxHeight);
        // body.setOffset(-car.hitboxWidth / 12 , -car.hitboxHeight / 12);

        // Create car visuals using player's sprite set
        const initialFrame = `${spritePrefix}_000`;
        car.carShadow = this.scenery.createDynamicShadow(0, 0, initialFrame, 3);
        car.carSprite = this.add.image(0, 0, initialFrame).setDepth(4);

        // Setup physics body
       
        body.setCollideWorldBounds(false);
        body.setBounce(0.3, 0.3);
        body.setMaxVelocity(car.boostMaxSpeed, car.boostMaxSpeed);
        body.setDamping(true);
        body.setDrag(car.drag, car.drag);

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

        // --- Sound (driven by player 1 for now) ---
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
            this.tweens.add({ targets: body.velocity, x: 0, y: 0, duration: 1500, ease: 'Quad.easeOut' });
            this.tweens.add({ targets: player.car, currentSpeed: 0, duration: 1500, ease: 'Quad.easeOut' });
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
        this.scene.start('MainMenu');
    }
}