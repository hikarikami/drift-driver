import { Scene } from 'phaser';
import { SoundManager } from '../SoundManager';

export class Game extends Scene {
    // World bounds
    private width!: number;
    private height!: number;

    // Car (physics-driven)
    private headSprite!: Phaser.GameObjects.Arc; // invisible physics body
    private carSprite!: Phaser.GameObjects.Image; // visible car sprite
    private carShadow!: Phaser.GameObjects.Image; // drop shadow under car
    private headAngle!: number;        // facing direction (radians)
    private angularVel = 0;            // current angular velocity
    private readonly headRadius = 10;
    private readonly totalCarFrames = 48;

    // Physics tuning — top-down racer with drift
    private forwardThrust = 325;
    private readonly boostThrust = 600;
    private readonly boostMaxSpd = 465;
    private readonly brakeFactor = 0.75;
    private drag = 60;
    private maxSpd = 280;
    private readonly minSpeed = 10;

    // Boost gauge
    private readonly boostMax = 1.25;        // full gauge = 1.0
    private readonly boostDrainRate = 0.4; // depletes in ~2.5s
    private readonly boostRefillAmount = 0.35; // refill per crate (~3 crates to full)
    private boostFuel = 1;                // current gauge level
    private boostIntensity = 0.2;           // 0..1 smoothed boost blend (for easing)
    private readonly boostRampUp = 3.5;     // how fast boost ramps up (per sec)
    private readonly boostRampDown = 2;   // how fast boost eases off (per sec)
    private boostBarDisplay = 1.25;          // smoothed gauge display value
    private boostBarBg!: Phaser.GameObjects.Graphics;
    private boostBarFill!: Phaser.GameObjects.Graphics;
    private boostFlameEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
    private boostSmokeEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

    // Steering
    private readonly targetAngularVel = 4.0;
    private readonly steerSmoothing = 25;
    private readonly returnSmoothing = 25;
    private readonly maxDriftAngle = 3.5;
    private readonly driftSoftness = 0.1;
    private readonly gripRate = 2.5;

    // Tire mark emitters
    private tireEmitterLeft!: Phaser.GameObjects.Particles.ParticleEmitter;
    private tireEmitterRight!: Phaser.GameObjects.Particles.ParticleEmitter;
    // Rear wheel offsets (local space, relative to car center)
    private readonly rearWheelX = -10; // behind center
    private readonly wheelSpreadY = 7; // half-width between wheels
    private tireMarkIntensity = 0;     // smoothed 0..1 for fade in/out


    // Pickup
    private pickupX!: number;
    private pickupY!: number;
    private readonly pickupCollectDist = 32;
    private pickupSprite!: Phaser.GameObjects.Image;
    private pickupShadow!: Phaser.GameObjects.Image;

    // State
    private score = 0;
    private gameOver = false;

    // Sound
    private soundManager!: SoundManager;

    // UI
    private scoreText!: Phaser.GameObjects.Text;
    private gameOverText!: Phaser.GameObjects.Text;
    private restartHintText!: Phaser.GameObjects.Text;
    private debugText!: Phaser.GameObjects.Text;


    constructor() {
        super('Game');
    }

    /**
     * Build an isometric tilemap background using the tileset spritesheet.
     * Constructs a Tiled-compatible JSON in memory, caches it,
     * then creates the tilemap via Phaser's isometric renderer.
     * Randomly fills with flat grass/dirt tiles.
     */
    private buildIsometricBackground() {
        // Tileset image: 2048x1664, 16 columns x 13 rows, 128x128 per tile
        const imgTileW = 128;       // tile image width in tileset
        const imgTileH = 128;       // tile image height in tileset
        const tilesetCols = 16;
        const tilesetCount = 208;
        const tilesetImgW = 2048;
        const tilesetImgH = 1664;

        // Isometric diamond footprint (2:1 ratio)
        const mapTileW = 128;       // diamond width
        const mapTileH = 64;        // diamond height

        // Scale factor — slightly larger so you can see the tile details
        const tileScale = .5;

        // Grid size: iso diamond spans (N)*mapTileW/2 wide and (N)*mapTileH/2 tall
        // per axis. (cols+rows) determines the total span.
        // Solve: (cols+rows)*mapTileW/2*scale >= screenW and same for H
        const neededSum = Math.max(
            Math.ceil(this.width / (mapTileW / 2 * tileScale)),
            Math.ceil(this.height / (mapTileH / 2 * tileScale))
        ) + 8; // generous padding
        const cols = neededSum;
        const rows = neededSum;

        // All tiles: flat dirt (GID 16 = id 15, row 0 col 15)
        const flatDirtGid = 12;
        const tileData: number[] = [];
        for (let i = 0; i < cols * rows; i++) {
            tileData.push(flatDirtGid);
        }

        // Construct Tiled-compatible JSON
        const mapJSON = {
            width: cols,
            height: rows,
            tilewidth: mapTileW,
            tileheight: mapTileH,
            orientation: 'isometric',
            renderorder: 'right-down',
            type: 'map',
            version: '1.10',
            infinite: false,
            layers: [{
                data: tileData,
                width: cols,
                height: rows,
                id: 1,
                name: 'ground',
                type: 'tilelayer',
                visible: true,
                opacity: 1,
                x: 0,
                y: 0,
            }],
            tilesets: [{
                firstgid: 1,
                name: 'terrain',
                tilewidth: imgTileW,
                tileheight: imgTileH,
                tilecount: tilesetCount,
                columns: tilesetCols,
                image: 'iso_tileset',
                imagewidth: tilesetImgW,
                imageheight: tilesetImgH,
                margin: 0,
                spacing: 0,
            }],
        };

        // Replace cached tilemap data each time (tile selection is random)
        if (this.cache.tilemap.has('iso_ground')) {
            this.cache.tilemap.remove('iso_ground');
        }
        this.cache.tilemap.add('iso_ground', {
            format: Phaser.Tilemaps.Formats.TILED_JSON,
            data: mapJSON,
        });

        const map = this.make.tilemap({ key: 'iso_ground' });
        const tileset = map.addTilesetImage('terrain', 'iso_tileset');
        if (tileset) {
            const layer = map.createLayer('ground', tileset);
            if (layer) {
                layer.setScale(tileScale);

                // Position the isometric diamond so it fully covers the screen.
                // Tile (c,r) renders at unscaled ((c-r)*W/2, (c+r)*H/2).
                // For NxN grid: left edge at -(N-1)*W/2, top at 0,
                //   center at (0, (N-1)*H/2).
                // Place center of diamond at center of screen:
                const layerX = this.width / 2;
                const layerY = this.height / 2 - (cols - 1) * mapTileH / 2 * tileScale;
                layer.setPosition(layerX, layerY);

                layer.setDepth(0);
                layer.setCullPadding(8, 8);
            }
        }
    }

    create() {
        const music = this.sound.add('theme1');
        music.setVolume(0.12)
        music.play({ loop: true });
        this.width = this.scale.width;
        this.height = this.scale.height;

        // --- Isometric tiled background ---
        this.buildIsometricBackground();

        // Focus canvas so keyboard input works
        const canvas = this.sys.game.canvas;
        if (canvas && canvas.setAttribute) {
            canvas.setAttribute('tabindex', '1');
            canvas.focus();
        }

        this.physics.world.setBounds(0, 0, this.width, this.height);

        // Invisible physics body
        this.headSprite = this.add.circle(0, 0, this.headRadius, 0x00ff88, 0);
        this.physics.add.existing(this.headSprite);

        // Generate a white 4x4 pixel texture for tire marks (we tint it at emit time)
        const tireGfx = this.add.graphics();
        tireGfx.fillStyle(0xffffff, 1);
        tireGfx.fillRect(0, 0, 4, 4);
        tireGfx.generateTexture('tiremark_dot', 4, 4);
        tireGfx.destroy();

        // Tire mark emitters — explode mode (we manually emit particles)
        // Particles stay in place (speed 0), fade out over time
        // Brown tint to match dirt surface, starts at 90% alpha
        const tireConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
            speed: 0,
            lifespan: 5000,
            alpha: { start: 0.54, end: 0 },   // fades over full lifespan
            scaleX: { start: 0.8, end: 0.6 },
            scaleY: { start: 2.5, end: 2 },
            tint: 0x2a1a0a,                    // dark brown to blend with dirt
            emitting: false,
        };

        this.tireEmitterLeft = this.add.particles(0, 0, 'tiremark_dot', { ...tireConfig });
        this.tireEmitterLeft.setDepth(1);

        this.tireEmitterRight = this.add.particles(0, 0, 'tiremark_dot', { ...tireConfig });
        this.tireEmitterRight.setDepth(1);

        // Generate a soft circle texture for boost flame particles
        const flameGfx = this.add.graphics();
        flameGfx.fillStyle(0xffffff, 1);
        flameGfx.fillCircle(6, 6, 6);
        flameGfx.generateTexture('flame_dot', 12, 12);
        flameGfx.destroy();

        // Boost flame emitter — fire out the back of the car
        this.boostFlameEmitter = this.add.particles(0, 0, 'flame_dot', {
            color: [0xfacc22, 0xf89800, 0xf83600, 0x9f0404],
            colorEase: 'quad.out',
            lifespan: { min: 200, max: 400 },
            scale: { start: 0.35, end: 0, ease: 'sine.out' },
            speed: { min: 30, max: 80 },
            alpha: { start: 0.8, end: 0 },
            blendMode: 'ADD',
            emitting: false,
        });
        this.boostFlameEmitter.setDepth(4);

        // Boost smoke emitter — subtle wispy trail behind the flame
        this.boostSmokeEmitter = this.add.particles(0, 0, 'flame_dot', {
            color: [0x666666, 0x444444, 0x222222],
            colorEase: 'linear',
            lifespan: { min: 400, max: 700 },
            scale: { start: 0.2, end: 0.5, ease: 'sine.out' },
            speed: { min: 15, max: 40 },
            alpha: { start: 0.15, end: 0 },
            blendMode: 'NORMAL',
            emitting: false,
        });
        this.boostSmokeEmitter.setDepth(3);

        // Drop shadow — same sprite tinted black, semi-transparent, offset for isometric perspective
        this.carShadow = this.add.image(0, 0, 'car_000').setDepth(3);
        this.carShadow.setTint(0x000000);
        this.carShadow.setAlpha(0.3);

        // Visible car sprite
        this.carSprite = this.add.image(0, 0, 'car_000').setDepth(5);

        // Pickup shadow
        this.pickupShadow = this.add.image(0, 0, 'crate').setDepth(2);
        this.pickupShadow.setDisplaySize(28, 28);
        this.pickupShadow.setTint(0x000000);
        this.pickupShadow.setAlpha(0.3);

        // Pickup sprite (crate) — scale to ~28px wide so it's smaller than the car
        this.pickupSprite = this.add.image(0, 0, 'crate').setDepth(3);
        this.pickupSprite.setDisplaySize(28, 28);

        // UI
        this.scoreText = this.add.text(16, 16, 'Score: 0', {
            fontFamily: 'Arial',
            fontSize: 24,
            color: '#ffffff',
        }).setScrollFactor(0).setDepth(10);

        // Boost gauge bar — positioned below score text
        const barX = 16;
        const barY = 48;
        const barW = 120;
        const barH = 10;

        this.boostBarBg = this.add.graphics().setScrollFactor(0).setDepth(10);
        this.boostBarBg.fillStyle(0x000000, 0.5);
        this.boostBarBg.fillRoundedRect(barX, barY, barW, barH, 3);
        this.boostBarBg.lineStyle(1, 0xffffff, 0.4);
        this.boostBarBg.strokeRoundedRect(barX, barY, barW, barH, 3);

        this.boostBarFill = this.add.graphics().setScrollFactor(0).setDepth(10);

        this.gameOverText = this.add.text(this.width / 2, this.height / 2 - 40, '', {
            fontFamily: 'Arial Black',
            fontSize: 64,
            color: '#ff3366',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center',
        }).setOrigin(0.5).setVisible(false).setScrollFactor(0).setDepth(10);

        this.restartHintText = this.add.text(this.width / 2, this.height / 2 + 30, 'Press R or Click to Restart', {
            fontFamily: 'Arial',
            fontSize: 24,
            color: '#aaaaaa',
            align: 'center',
        }).setOrigin(0.5).setVisible(false).setScrollFactor(0).setDepth(10);

        const keyboard = this.input.keyboard;
        keyboard?.on('keydown-R', () => this.tryRestart());

        this.input.on('pointerdown', () => {
            if (!this.gameOver) {
                this.sys.game.canvas?.focus?.();
            }
        });

        // --- Debug controls ---
        const btnStyle = {
            fontFamily: 'Arial',
            fontSize: 16,
            color: '#ffffff',
            backgroundColor: '#333333',
            padding: { x: 8, y: 4 },
        };
        const btnX = this.width - 16;
        let btnY = 16;

        const makeBtn = (label: string, cb: () => void) => {
            const btn = this.add.text(btnX, btnY, label, btnStyle)
                .setOrigin(1, 0).setScrollFactor(0).setDepth(20)
                .setInteractive({ useHandCursor: true });
            btn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                pointer.event.stopPropagation();
                cb();
            });
            btnY += 30;
            return btn;
        };

        makeBtn('Thrust +', () => { this.forwardThrust = Math.min(this.forwardThrust + 40, 800); });
        makeBtn('Thrust -', () => { this.forwardThrust = Math.max(this.forwardThrust - 40, 80); });
        makeBtn('Drag +', () => { this.drag = Math.min(this.drag + 20, 400); });
        makeBtn('Drag -', () => { this.drag = Math.max(this.drag - 20, 0); });
        makeBtn('Max Spd +', () => { this.maxSpd = Math.min(this.maxSpd + 30, 600); });
        makeBtn('Max Spd -', () => { this.maxSpd = Math.max(this.maxSpd - 30, 80); });

        this.debugText = this.add.text(btnX, btnY, '', {
            fontFamily: 'Arial',
            fontSize: 14,
            color: '#888888',
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(20);

        // --- Sound setup ---
        this.soundManager = new SoundManager(this);
        this.soundManager.addLayer('screech', 'screech_sfx', {
            loop: true,
            maxVolume: 1,
            fadeIn: 4,      // ramp up fairly quick
            fadeOut: 7.5,     // fade out a bit faster for snappy cutoff
            seekStart: 1.85, // skip silence at the start of the mp3
        });

        // Engine ambience — crossfades between two instances for seamless variety
        this.soundManager.addCrossfadeLayer('engine', 'engine_sfx', {
            maxVolume: 0.25,
            crossfadeDuration: 2.5,  // overlap fade lasts 2.5s
            crossfadeAt: 0.75,       // start crossfade at 75% through
        });

        this.soundManager.addLayer('stopping', 'stopping_sfx', {
            loop: true,
            maxVolume: 0.35,
            fadeIn: 6,
            fadeOut: 8,
            seekStart: 0,
        });

        this.resetGame();
    }

    private resetGame() {
        this.headAngle = -Math.PI / 2;
        this.angularVel = 0;
        this.score = 0;
        this.gameOver = false;
        this.boostFuel = this.boostMax;
        this.boostIntensity = 0;
        this.boostBarDisplay = this.boostMax;
        this.tireMarkIntensity = 0;
        if (this.soundManager) this.soundManager.stopAll();

        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        this.headSprite.setPosition(this.width / 2, this.height / 2);
        body.reset(this.width / 2, this.height / 2);
        body.setVelocity(0, 0);
        body.setMaxSpeed(this.maxSpd);
        body.setDrag(0, 0);

        // Clear existing tire marks
        this.tireEmitterLeft.killAll();
        this.tireEmitterRight.killAll();
        this.boostFlameEmitter.killAll();
        this.boostSmokeEmitter.killAll();

        this.spawnPickup();
        this.gameOverText.setVisible(false);
        this.restartHintText.setVisible(false);
    }

    private spawnPickup() {
        const margin = 40;
        this.pickupX = margin + Math.random() * (this.width - 2 * margin);
        this.pickupY = margin + Math.random() * (this.height - 2 * margin);
        if (this.pickupSprite) {
            this.pickupSprite.setPosition(this.pickupX, this.pickupY);
        }
        if (this.pickupShadow) {
            this.pickupShadow.setPosition(this.pickupX + 0.5, this.pickupY + 1.5);
        }
    }

    private tryRestart() {
        this.resetGame();
    }

    update(_time: number, delta: number) {
        const dt = delta / 1000;

        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        body.setMaxSpeed(this.maxSpd);

        // --- Input ---
        const keyboard = this.input.keyboard;
        let turnInput = 0;
        let thrustInput = false;
        let brakeInput = false;
        if (keyboard) {
            const left = keyboard.addKey('LEFT', false, false);
            const right = keyboard.addKey('RIGHT', false, false);
            const up = keyboard.addKey('SHIFT', false, false);
            const a = keyboard.addKey('A', false, false);
            const d = keyboard.addKey('D', false, false);
            const w = keyboard.addKey('SHIFT', false, false);
            const space = keyboard.addKey('SPACE', false, false);
            if (left.isDown || a.isDown) turnInput -= 1;
            if (right.isDown || d.isDown) turnInput += 1;
            if (up.isDown || w.isDown) thrustInput = true;
            if (space.isDown) brakeInput = true;
        }

        // --- Smooth steering ---
        const targetAV = turnInput * this.targetAngularVel;
        const smoothRate = turnInput !== 0 ? this.steerSmoothing : this.returnSmoothing;
        const lerpFactor = 1 - Math.exp(-smoothRate * dt);
        this.angularVel += (targetAV - this.angularVel) * lerpFactor;

        // Soft drift limit
        const currentSpeed = body.speed;
        if (currentSpeed > 1) {
            const velAngle = Math.atan2(body.velocity.y, body.velocity.x);
            let drift = this.headAngle - velAngle;
            while (drift > Math.PI) drift -= Math.PI * 2;
            while (drift < -Math.PI) drift += Math.PI * 2;

            const softStart = this.maxDriftAngle - this.driftSoftness;
            const absDrift = Math.abs(drift);
            if (absDrift > softStart) {
                const resistance = Math.min((absDrift - softStart) / this.driftSoftness, 1);
                const pushback = resistance * resistance * 8 * dt;
                if (drift > 0) {
                    this.angularVel -= pushback;
                    this.angularVel = Math.max(this.angularVel, -this.targetAngularVel);
                } else {
                    this.angularVel += pushback;
                    this.angularVel = Math.min(this.angularVel, this.targetAngularVel);
                }
            }
        }

        this.headAngle += this.angularVel * dt;

        // --- Drift physics ---
        const facingX = Math.cos(this.headAngle);
        const facingY = Math.sin(this.headAngle);

        if (currentSpeed > 1) {
            const velDirX = body.velocity.x / currentSpeed;
            const velDirY = body.velocity.y / currentSpeed;
            const blend = 1 - Math.exp(-this.gripRate * dt);
            const newDirX = velDirX + (facingX - velDirX) * blend;
            const newDirY = velDirY + (facingY - velDirY) * blend;
            const dirLen = Math.sqrt(newDirX * newDirX + newDirY * newDirY);
            if (dirLen > 0.001) {
                body.velocity.x = (newDirX / dirLen) * currentSpeed;
                body.velocity.y = (newDirY / dirLen) * currentSpeed;
            }
        }

        // --- Thrust / Handbrake ---
        // Floor speed while braking — never fully stop
        const brakeMinSpeed = this.minSpeed * 0.4;

        if (brakeInput) {
            // Handbrake: reduce thrust, gently dampen speed, ease in over time
            body.setAcceleration(facingX * this.forwardThrust * 0.2, facingY * this.forwardThrust * 0.2);
            const brakeDamp = 1 - this.brakeFactor * dt * 2.5;
            body.velocity.x *= brakeDamp;
            body.velocity.y *= brakeDamp;

            // Don't let the car fully stop — clamp to a low floor
            const curSpd = body.speed;
            if (curSpd > 0 && curSpd < brakeMinSpeed) {
                body.velocity.x *= brakeMinSpeed / curSpd;
                body.velocity.y *= brakeMinSpeed / curSpd;
            }
        } else {
            // --- Smooth boost intensity ---
            const wantsBoost = thrustInput && this.boostFuel > 0;
            if (wantsBoost) {
                // Ramp up boost intensity
                this.boostIntensity = Math.min(1, this.boostIntensity + this.boostRampUp * dt);
                this.boostFuel = Math.max(0, this.boostFuel - this.boostDrainRate * dt);
            } else {
                // Ease off boost intensity
                this.boostIntensity = Math.max(0, this.boostIntensity - this.boostRampDown * dt);
            }

            // Blend thrust and max speed based on smooth intensity
            const t = this.boostIntensity;
            const thrust = this.forwardThrust + (this.boostThrust - this.forwardThrust) * t;
            const currentMaxSpd = this.maxSpd + (this.boostMaxSpd - this.maxSpd) * t;

            body.setMaxSpeed(currentMaxSpd);
            body.setAcceleration(facingX * thrust, facingY * thrust);

            // Enforce minimum speed only when NOT braking
            const speed = body.speed;
            if (speed < this.minSpeed && speed > 0) {
                body.velocity.x *= this.minSpeed / speed;
                body.velocity.y *= this.minSpeed / speed;
            } else if (speed === 0) {
                body.setVelocity(facingX * this.minSpeed, facingY * this.minSpeed);
            }
        }

        // --- Wrap ---
        this.physics.world.wrap(this.headSprite, 0);

        const hx = this.headSprite.x;
        const hy = this.headSprite.y;
        const speed = body.speed;

        // --- Tire marks ---
        // Based on drift angle — only when the slide is extreme.
        // Smoothed intensity for gradual fade-in and fade-out.
        const velAngleMark = Math.atan2(body.velocity.y, body.velocity.x);
        let driftAngle = this.headAngle - velAngleMark;
        while (driftAngle > Math.PI) driftAngle -= Math.PI * 2;
        while (driftAngle < -Math.PI) driftAngle += Math.PI * 2;
        const absDrift = Math.abs(driftAngle);
        const tireThreshold = 0.5;       // ~29 degrees before any marks appear
        const tireFull = 1.0;            // full intensity at ~57 degrees

        // Target intensity: 0 below threshold, ramps to 1 at tireFull
        let targetTireIntensity = 0;
        if (absDrift > tireThreshold && speed > 90) {
            targetTireIntensity = Math.min((absDrift - tireThreshold) / (tireFull - tireThreshold), 1);
        }

        // Smooth toward target — gradual ramp up, snappy fade out
        const tireRampSpeed = targetTireIntensity > this.tireMarkIntensity ? 2.4 : 6.5;
        const tireLerp = 1 - Math.exp(-tireRampSpeed * dt);
        this.tireMarkIntensity += (targetTireIntensity - this.tireMarkIntensity) * tireLerp;
        // Hard cutoff when fading out
        if (targetTireIntensity === 0 && this.tireMarkIntensity < 1) this.tireMarkIntensity = 0;

        if (this.tireMarkIntensity > 0) {
            const vx = body.velocity.x;
            const vy = body.velocity.y;
            const velAngle = Math.atan2(vy, vx);
            const perpAngle = velAngle + Math.PI / 2;
            const spread = this.wheelSpreadY;
            const behindDist = Math.abs(this.rearWheelX);
            const baseX = hx - Math.cos(velAngle) * behindDist;
            const baseY = hy - Math.sin(velAngle) * behindDist;
            const leftX = baseX + Math.cos(perpAngle) * spread;
            const leftY = baseY + Math.sin(perpAngle) * spread;
            const rightX = baseX - Math.cos(perpAngle) * spread;
            const rightY = baseY - Math.sin(perpAngle) * spread;

            // Isometric skew on mark rotation
            const isoAngle = Math.atan2(vy * 1.5, vx);
            const markAngleDeg = isoAngle * (180 / Math.PI);
            this.tireEmitterLeft.particleRotate = markAngleDeg;
            this.tireEmitterRight.particleRotate = markAngleDeg;

            // Scale alpha with smoothed intensity
            this.tireEmitterLeft.particleAlpha = this.tireMarkIntensity * 0.54;
            this.tireEmitterRight.particleAlpha = this.tireMarkIntensity * 0.54;

            this.tireEmitterLeft.emitParticleAt(leftX, leftY, 1);
            this.tireEmitterRight.emitParticleAt(rightX, rightY, 1);
        }

        // --- Boost flame + smoke ---
        if (this.boostIntensity > 0.05) {
            // Rear exhaust position — behind the car center along heading
            const exhaustDist = 14;
            const rearX = hx - Math.cos(this.headAngle) * exhaustDist;
            const rearY = hy - Math.sin(this.headAngle) * exhaustDist;

            // Particles shoot out opposite to heading direction
            const exhaustAngleDeg = ((this.headAngle + Math.PI) * 180 / Math.PI);

            // Fire — tight cone
            this.boostFlameEmitter.particleAngle = { min: exhaustAngleDeg - 15, max: exhaustAngleDeg + 15 };
            const flameCount = Math.ceil(this.boostIntensity * 3);
            this.boostFlameEmitter.emitParticleAt(rearX, rearY, flameCount);

            // Smoke — wider, softer, slightly behind the flame
            const smokeDist = 6;
            const smokeX = hx - Math.cos(this.headAngle) * smokeDist;
            const smokeY = hy - Math.sin(this.headAngle) * smokeDist;
            this.boostSmokeEmitter.particleAngle = { min: exhaustAngleDeg - 25, max: exhaustAngleDeg + 25 };
            const smokeCount = Math.ceil(this.boostIntensity * 5.5);
            this.boostSmokeEmitter.emitParticleAt(smokeX, smokeY, smokeCount);
        }

        // --- Pickup ---
        const pdx = hx - this.pickupX;
        const pdy = hy - this.pickupY;
        if (Math.sqrt(pdx * pdx + pdy * pdy) < this.pickupCollectDist) {
            this.score += 10;
            this.boostFuel = Math.min(this.boostMax, this.boostFuel + this.boostRefillAmount);
            this.spawnPickup();
        }

        // --- Update car sprite frame ---
        let angleDeg = (this.headAngle * 180 / Math.PI) % 360;
        if (angleDeg < 0) angleDeg += 360;
        const frameIndex = Math.round(angleDeg / (360 / this.totalCarFrames)) % this.totalCarFrames;
        const frameKey = `car_${String(frameIndex).padStart(3, '0')}`;
        this.carSprite.setTexture(frameKey);
        this.carSprite.setPosition(hx, hy);

        // Shadow: same frame, offset down-right for isometric light
        this.carShadow.setTexture(frameKey);
        this.carShadow.setPosition(hx + 1.5, hy + 2.5);

        // Score & debug
        this.scoreText.setText(`Score: ${this.score}`);
        this.debugText.setText(
            `Spd: ${Math.round(speed)}  Thrust: ${this.forwardThrust}`
        );

        // --- Update boost gauge bar (smoothed) ---
        const barX = 16;
        const barY = 48;
        const barW = 120;
        const barH = 10;

        // Smooth the display value toward the actual fuel level
        const barLerp = 1 - Math.exp(-6 * dt);
        this.boostBarDisplay += (this.boostFuel - this.boostBarDisplay) * barLerp;
        const fillW = barW * Math.max(0, this.boostBarDisplay / this.boostMax);

        this.boostBarFill.clear();
        // Color blends from orange (low) to cyan (high)
        const fuelRatio = this.boostBarDisplay / this.boostMax;
        const r = Math.round(255 * (1 - fuelRatio));
        const g = Math.round(136 + 68 * fuelRatio);
        const b = Math.round(255 * fuelRatio);
        const fillColor = (r << 16) | (g << 8) | b;
        this.boostBarFill.fillStyle(fillColor, 0.9);
        if (fillW > 1) {
            this.boostBarFill.fillRoundedRect(barX, barY, fillW, barH, 3);
        }

        // --- Sound layers ---
        const brakeScreech = brakeInput ? 0.15 : 0;
        this.soundManager.setLayerTarget('screech', Math.max(this.tireMarkIntensity, brakeScreech));
        this.soundManager.setLayerTarget('stopping', brakeInput ? 1 : 0);
        this.soundManager.setCrossfadeLayerScale('engine', brakeInput ? 0.3 : 1);
        this.soundManager.update(dt);
    }
}
