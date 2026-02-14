import { Scene } from 'phaser';
import { SoundManager } from '../SoundManager';

export class Game extends Scene {
    // World bounds
    private width!: number;
    private height!: number;

    // Car (physics-driven)
    private headSprite!: Phaser.GameObjects.Arc;
    private carSprite!: Phaser.GameObjects.Image;
    private carShadow!: Phaser.GameObjects.Image;
    private headAngle!: number;
    private angularVel = 0;
    private readonly headRadius = 10;
    private readonly totalCarFrames = 48;

    // Physics tuning — top-down racer with drift
    private forwardThrust = 325;
    private readonly boostThrust = 600;
    private readonly boostMaxSpeed = 465;
    private readonly brakeFactor = 0.75;
    private drag = 60;
    private maxSpeed = 280;
    private readonly minSpeed = 10;
    private readonly acceleration = 5;
    private readonly decelBase = 2.0;
    private readonly decelMomentumFactor = 0.003;

    // Boost gauge
    private readonly boostMax = 1.25;
    private readonly boostDrainRate = 0.4;
    private readonly boostRefillAmount = 0.35;
    private boostFuel = 1;
    private boostIntensity = 0.2;
    private readonly boostRampUp = 3.5;
    private readonly boostRampDown = 2;
    private boostBarDisplay = 1.25;
    private boostBarBg!: Phaser.GameObjects.Graphics;
    private boostBarFill!: Phaser.GameObjects.Graphics;
    private boostFlameEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
    private boostSmokeEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

    // Steering
    private readonly targetAngularVel = 4.0;
    private readonly minSteerFraction = 0.15;
    private readonly steerSmoothing = 25;
    private readonly returnSmoothing = 25;
    private readonly maxDriftAngle = 3.5;
    private readonly driftSoftness = 0.1;
    private readonly gripRate = 2.5;

    // Tire mark emitters
    private tireEmitterLeft!: Phaser.GameObjects.Particles.ParticleEmitter;
    private tireEmitterRight!: Phaser.GameObjects.Particles.ParticleEmitter;
    private readonly rearWheelX = -10;
    private readonly wheelSpreadY = 7;
    private tireMarkIntensity = 0;

    // Pickup
    private pickupX!: number;
    private pickupY!: number;
    private readonly pickupCollectDist = 32;
    private pickupSprite!: Phaser.GameObjects.Image;
    private pickupShadow!: Phaser.GameObjects.Image;

    // State
    private score = 0;
    private gameOver = false;

    // Countdown timer
    private timeRemaining = 60;
    private timerText!: Phaser.GameObjects.Text;
    private readonly startTime = 60;
    private readonly pickupTimeBonus = 3;

    // Debug modal
    private debugModalContainer!: Phaser.GameObjects.Container;
    private debugModalOpen = false;
    private debugBtn!: Phaser.GameObjects.Text;
    private debugThrustLabel!: Phaser.GameObjects.Text;
    private debugDragLabel!: Phaser.GameObjects.Text;
    private debugMaxSpdLabel!: Phaser.GameObjects.Text;

    // Game over overlay objects (destroyed on restart)
    private finalScoreText?: Phaser.GameObjects.Text;
    private playAgainBtn?: Phaser.GameObjects.Text;

    // Sound
    private soundManager!: SoundManager;
    private currentSpeed = 0;
    private isAccelerating = false;
    private accelStopTimer = 0;
    private readonly engineFadeDelay = 0.3;
    private readonly stoppingFadeDelay = 0.56;
    private music!: Phaser.Sound.BaseSound;
    private musicMuted = false;

    // UI
    private scoreText!: Phaser.GameObjects.Text;
    private gameOverText!: Phaser.GameObjects.Text;
    private restartHintText!: Phaser.GameObjects.Text;
    private debugText!: Phaser.GameObjects.Text;

    constructor() {
        super('Game');
    }

    private buildIsometricBackground() {
        const imgTileW = 128;
        const imgTileH = 128;
        const tilesetCols = 16;
        const tilesetCount = 208;
        const tilesetImgW = 2048;
        const tilesetImgH = 1664;
        const mapTileW = 128;
        const mapTileH = 64;
        const tileScale = .5;

        const neededSum = Math.max(
            Math.ceil(this.width / (mapTileW / 2 * tileScale)),
            Math.ceil(this.height / (mapTileH / 2 * tileScale))
        ) + 8;
        const cols = neededSum;
        const rows = neededSum;

        const flatDirtGid = 12;
        const tileData: number[] = [];
        for (let i = 0; i < cols * rows; i++) {
            tileData.push(flatDirtGid);
        }

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
                const layerX = this.width / 2;
                const layerY = this.height / 2 - (cols - 1) * mapTileH / 2 * tileScale;
                layer.setPosition(layerX, layerY);
                layer.setDepth(0);
                layer.setCullPadding(8, 8);
            }
        }
    }

    create() {
        this.music = this.sound.add('theme1');
        this.music.play({ loop: true, volume: 0.12 });
        this.width = this.scale.width;
        this.height = this.scale.height;

        this.buildIsometricBackground();

        const canvas = this.sys.game.canvas;
        if (canvas && canvas.setAttribute) {
            canvas.setAttribute('tabindex', '1');
            canvas.focus();
        }

        this.physics.world.setBounds(0, 0, this.width, this.height);

        this.headSprite = this.add.circle(0, 0, this.headRadius, 0x00ff88, 0);
        this.physics.add.existing(this.headSprite);

        const tireGfx = this.add.graphics();
        tireGfx.fillStyle(0xffffff, 1);
        tireGfx.fillRect(0, 0, 4, 4);
        tireGfx.generateTexture('tiremark_dot', 4, 4);
        tireGfx.destroy();

        const tireConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
            speed: 0,
            lifespan: 5000,
            alpha: { start: 0.54, end: 0 },
            scaleX: { start: 0.8, end: 0.6 },
            scaleY: { start: 2.5, end: 2 },
            tint: 0x2a1a0a,
            emitting: false,
        };

        this.tireEmitterLeft = this.add.particles(0, 0, 'tiremark_dot', { ...tireConfig });
        this.tireEmitterLeft.setDepth(1);

        this.tireEmitterRight = this.add.particles(0, 0, 'tiremark_dot', { ...tireConfig });
        this.tireEmitterRight.setDepth(1);

        const flameGfx = this.add.graphics();
        flameGfx.fillStyle(0xffffff, 1);
        flameGfx.fillCircle(6, 6, 6);
        flameGfx.generateTexture('flame_dot', 12, 12);
        flameGfx.destroy();

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

        this.carShadow = this.add.image(0, 0, 'car_000').setDepth(3);
        this.carShadow.setTint(0x000000);
        this.carShadow.setAlpha(0.3);

        this.carSprite = this.add.image(0, 0, 'car_000').setDepth(5);

        this.pickupShadow = this.add.image(0, 0, 'crate').setDepth(2);
        this.pickupShadow.setDisplaySize(28, 28);
        this.pickupShadow.setTint(0x000000);
        this.pickupShadow.setAlpha(0.3);

        this.pickupSprite = this.add.image(0, 0, 'crate').setDepth(3);
        this.pickupSprite.setDisplaySize(28, 28);

        // UI — Score
        this.scoreText = this.add.text(16, 16, 'Score: 0', {
            fontFamily: 'Arial',
            fontSize: 24,
            color: '#ffffff',
        }).setScrollFactor(0).setDepth(10);

        // Boost gauge bar
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

        // Countdown timer display — large, top-centre
        this.timerText = this.add.text(this.width / 2, 20, '60', {
            fontFamily: 'Arial Black',
            fontSize: 48,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10);

        this.gameOverText = this.add.text(this.width / 2, this.height / 2 - 60, '', {
            fontFamily: 'Arial Black',
            fontSize: 64,
            color: '#ff3366',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center',
        }).setOrigin(0.5).setVisible(false).setScrollFactor(0).setDepth(10);

        this.restartHintText = this.add.text(this.width / 2, this.height / 2 + 30, '', {
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

        // --- Debug Tools button (top-right) ---
        this.debugBtn = this.add.text(this.width - 16, 16, 'Debug Tools', {
            fontFamily: 'Arial',
            fontSize: 16,
            color: '#ffffff',
            backgroundColor: '#555555',
            padding: { x: 10, y: 6 },
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(30)
          .setInteractive({ useHandCursor: true });
        this.debugBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.toggleDebugModal();
        });

        this.buildDebugModal();



        // --- Sound setup ---
        this.soundManager = new SoundManager(this);
        this.soundManager.addLayer('screech', 'screech_sfx', {
            loop: true,
            maxVolume: 1,
            fadeIn: 4,
            fadeOut: 7.5,
            seekStart: 1.85,
        });

        this.soundManager.addCrossfadeLayer('engine', 'engine_sfx', {
            maxVolume: 0.25,
            crossfadeDuration: 2.5,
            crossfadeAt: 0.75,
        });

        this.soundManager.addLayer('stopping', 'stopping_sfx', {
            loop: false,
            maxVolume: 0.28,
            fadeIn: 4,
            fadeOut: 12,
            seekStart: 0,
            maxDuration: 3.5,
            segmentFadeOut: 1.0,
        });

        this.resetGame();
    }

    private buildDebugModal() {
        const modalW = 280;
        const modalH = 370;
        const mx = (this.width - modalW) / 2;
        const my = (this.height - modalH) / 2;

        this.debugModalContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(50).setVisible(false);

        const backdrop = this.add.rectangle(this.width / 2, this.height / 2, this.width, this.height, 0x000000, 0.5);
        backdrop.setInteractive();
        backdrop.on('pointerdown', (pointer: Phaser.Input.Pointer) => { pointer.event.stopPropagation(); });
        this.debugModalContainer.add(backdrop);

        const panel = this.add.graphics();
        panel.fillStyle(0x222222, 0.95);
        panel.fillRoundedRect(mx, my, modalW, modalH, 10);
        panel.lineStyle(2, 0x666666, 1);
        panel.strokeRoundedRect(mx, my, modalW, modalH, 10);
        this.debugModalContainer.add(panel);

        const title = this.add.text(this.width / 2, my + 18, 'Debug Tools', {
            fontFamily: 'Arial Black', fontSize: 20, color: '#ffffff', align: 'center',
        }).setOrigin(0.5, 0);
        this.debugModalContainer.add(title);

        const closeBtn = this.add.text(mx + modalW - 14, my + 10, 'X', {
            fontFamily: 'Arial Black', fontSize: 18, color: '#ff4444',
            padding: { x: 6, y: 2 },
        }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
        closeBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.toggleDebugModal();
        });
        this.debugModalContainer.add(closeBtn);

        const btnStyle = {
            fontFamily: 'Arial',
            fontSize: 15,
            color: '#ffffff',
            backgroundColor: '#444444',
            padding: { x: 8, y: 4 },
        };

        let cy = my + 55;
        const rowH = 34;
        const leftCol = mx + 14;
        const rightCol = mx + modalW - 14;

        const makeRow = (label: string, onMinus: () => void, onPlus: () => void) => {
            const lbl = this.add.text(this.width / 2, cy, label, {
                fontFamily: 'Arial', fontSize: 15, color: '#cccccc',
            }).setOrigin(0.5, 0);
            this.debugModalContainer.add(lbl);

            const minus = this.add.text(leftCol, cy, '\u2212', { ...btnStyle, padding: { x: 12, y: 4 } })
                .setInteractive({ useHandCursor: true });
            minus.on('pointerdown', (pointer: Phaser.Input.Pointer) => { pointer.event.stopPropagation(); onMinus(); });
            this.debugModalContainer.add(minus);

            const plus = this.add.text(rightCol, cy, '+', { ...btnStyle, padding: { x: 12, y: 4 } })
                .setOrigin(1, 0).setInteractive({ useHandCursor: true });
            plus.on('pointerdown', (pointer: Phaser.Input.Pointer) => { pointer.event.stopPropagation(); onPlus(); });
            this.debugModalContainer.add(plus);

            cy += rowH;
            return lbl;
        };

        this.debugThrustLabel = makeRow(`Thrust: ${this.forwardThrust}`,
            () => { this.forwardThrust = Math.max(this.forwardThrust - 40, 80); this.refreshDebugLabels(); },
            () => { this.forwardThrust = Math.min(this.forwardThrust + 40, 800); this.refreshDebugLabels(); },
        );
        this.debugDragLabel = makeRow(`Drag: ${this.drag}`,
            () => { this.drag = Math.max(this.drag - 20, 0); this.refreshDebugLabels(); },
            () => { this.drag = Math.min(this.drag + 20, 400); this.refreshDebugLabels(); },
        );
        this.debugMaxSpdLabel = makeRow(`Max Spd: ${this.maxSpeed}`,
            () => { this.maxSpeed = Math.max(this.maxSpeed - 30, 80); this.refreshDebugLabels(); },
            () => { this.maxSpeed = Math.min(this.maxSpeed + 30, 600); this.refreshDebugLabels(); },
        );

        cy += 8;

        const musicBtn = this.add.text(this.width / 2, cy, '\u266B Music: ON', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        musicBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.musicMuted = !this.musicMuted;
            if (this.musicMuted) {
                (this.music as Phaser.Sound.WebAudioSound).setVolume(0);
                musicBtn.setText('\u266B Music: OFF');
            } else {
                (this.music as Phaser.Sound.WebAudioSound).setVolume(0.12);
                musicBtn.setText('\u266B Music: ON');
            }
        });
        this.debugModalContainer.add(musicBtn);
        cy += rowH + 4;

        const sfxBtn = this.add.text(this.width / 2, cy, '\u{1F50A} SFX: ON', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        sfxBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.soundManager.muted = !this.soundManager.muted;
            if (this.soundManager.muted) {
                sfxBtn.setText('\u{1F507} SFX: OFF');
            } else {
                sfxBtn.setText('\u{1F50A} SFX: ON');
            }
        });
        this.debugModalContainer.add(sfxBtn);

        cy += rowH + 4;

        this.debugText = this.add.text(this.width / 2, cy, '', {
            fontFamily: 'Arial',
            fontSize: 14,
            color: '#888888',
        }).setOrigin(0.5, 0);
        this.debugModalContainer.add(this.debugText);
    }

    private refreshDebugLabels() {
        this.debugThrustLabel.setText(`Thrust: ${this.forwardThrust}`);
        this.debugDragLabel.setText(`Drag: ${this.drag}`);
        this.debugMaxSpdLabel.setText(`Max Spd: ${this.maxSpeed}`);
    }

    private toggleDebugModal() {
        this.debugModalOpen = !this.debugModalOpen;
        this.debugModalContainer.setVisible(this.debugModalOpen);
    }

    private resetGame() {
        this.headAngle = -Math.PI / 2;
        this.angularVel = 0;
        this.score = 0;
        this.gameOver = false;
        this.timeRemaining = this.startTime;
        this.boostFuel = this.boostMax;
        this.boostIntensity = 0;
        this.boostBarDisplay = this.boostMax;
        this.tireMarkIntensity = 0;
        if (this.soundManager) this.soundManager.stopAll();

        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        this.headSprite.setPosition(this.width / 2, this.height / 2);
        body.reset(this.width / 2, this.height / 2);
        body.setVelocity(0, 0);
        body.setMaxSpeed(this.maxSpeed);
        body.setDrag(0, 0);
        this.currentSpeed = this.minSpeed;

        this.tireEmitterLeft.killAll();
        this.tireEmitterRight.killAll();
        this.boostFlameEmitter.killAll();
        this.boostSmokeEmitter.killAll();

        this.spawnPickup();
        this.gameOverText.setVisible(false);
        this.restartHintText.setVisible(false);
        if (this.timerText) this.timerText.setVisible(true);
        if (this.finalScoreText) { this.finalScoreText.destroy(); this.finalScoreText = undefined; }
        if (this.playAgainBtn) { this.playAgainBtn.destroy(); this.playAgainBtn = undefined; }
    }

    private spawnPickup() {
        const margin = 40;
        this.pickupX = margin + Math.random() * (this.width - 2 * margin);
        this.pickupY = margin + Math.random() * (this.height - 2 * margin);

        const dropHeight = 30;
        const dropDuration = 240;
        const bounceDuration = 120;
        const bounceHeight = 4;

        if (this.pickupSprite) {
            this.tweens.killTweensOf(this.pickupSprite);
            this.pickupSprite.setPosition(this.pickupX, this.pickupY - dropHeight);
            this.pickupSprite.setAlpha(0);

            this.tweens.add({
                targets: this.pickupSprite,
                y: this.pickupY,
                alpha: 1,
                duration: dropDuration,
                ease: 'Quad.easeIn',
                onComplete: () => {
                    this.tweens.add({
                        targets: this.pickupSprite,
                        y: this.pickupY - bounceHeight,
                        duration: bounceDuration,
                        ease: 'Sine.easeOut',
                        yoyo: true,
                    });
                },
            });
        }
        if (this.pickupShadow) {
            this.tweens.killTweensOf(this.pickupShadow);
            this.pickupShadow.setPosition(this.pickupX + 0.5, this.pickupY + 1.5);
            this.pickupShadow.setAlpha(0);

            this.tweens.add({
                targets: this.pickupShadow,
                alpha: 0.3,
                duration: dropDuration,
                ease: 'Linear',
            });
        }
    }

    private tryRestart() {
        this.resetGame();
    }

    update(_time: number, delta: number) {
        if (this.gameOver) return;

        const dt = delta / 1000;

        // --- Countdown timer ---
        this.timeRemaining -= dt;
        if (this.timeRemaining <= 0) {
            this.timeRemaining = 0;
            this.endGame();
            return;
        }
        const displaySec = Math.ceil(this.timeRemaining);
        this.timerText.setText(`${displaySec}`);
        if (this.timeRemaining <= 10) {
            this.timerText.setColor('#ff4444');
            this.timerText.setFontSize(56);
        } else {
            this.timerText.setColor('#ffffff');
            this.timerText.setFontSize(48);
        }

        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        body.setMaxSpeed(this.maxSpeed);

        // --- Input ---
        const keyboard = this.input.keyboard;
        let turnInput = 0;
        let thrustInput = false;
        let brakeInput = false;
        if (keyboard) {
            const left = keyboard.addKey('LEFT', false, false);
            const right = keyboard.addKey('RIGHT', false, false);
            const up = keyboard.addKey('UP', false, false);
            const a = keyboard.addKey('A', false, false);
            const d = keyboard.addKey('D', false, false);
            const w = keyboard.addKey('W', false, false);
            const shift = keyboard.addKey('SHIFT', false, false);
            const space = keyboard.addKey('SPACE', false, false);
            if (left.isDown || a.isDown) turnInput -= 1;
            if (right.isDown || d.isDown) turnInput += 1;
            if (up.isDown || w.isDown) this.isAccelerating = true;
            else this.isAccelerating = false;
            if (shift.isDown) thrustInput = true;
            if (space.isDown) brakeInput = true;
        }

        // --- Smooth steering (speed-dependent) ---
        const speedRatio = Math.min(body.speed / this.maxSpeed, 1);
        const steerScale = this.minSteerFraction + (1 - this.minSteerFraction) * speedRatio;
        const targetAV = turnInput * this.targetAngularVel * steerScale;
        const smoothRate = turnInput !== 0 ? this.steerSmoothing : this.returnSmoothing;
        const lerpFactor = 1 - Math.exp(-smoothRate * dt);
        this.angularVel += (targetAV - this.angularVel) * lerpFactor;

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

        // --- Acceleration / Deceleration ---
        if (this.isAccelerating) {
            this.currentSpeed = Math.min(this.currentSpeed + this.acceleration * dt * 60, this.maxSpeed);
        } else {
            const momentum = this.currentSpeed * this.decelMomentumFactor;
            const decelRate = Math.max(this.decelBase - momentum, 0.3);
            this.currentSpeed = Math.max(this.currentSpeed - decelRate * dt * 60, this.minSpeed);
        }

        // --- Thrust / Handbrake ---
        const brakeMinSpeed = this.minSpeed * 0.4;

        if (brakeInput) {
            body.setAcceleration(facingX * this.forwardThrust * 0.2, facingY * this.forwardThrust * 0.2);
            const brakeDamp = 1 - this.brakeFactor * dt * 2.5;
            body.velocity.x *= brakeDamp;
            body.velocity.y *= brakeDamp;

            const curSpd = body.speed;
            if (curSpd > 0 && curSpd < brakeMinSpeed) {
                body.velocity.x *= brakeMinSpeed / curSpd;
                body.velocity.y *= brakeMinSpeed / curSpd;
            }
        } else {
            const wantsBoost = thrustInput && this.boostFuel > 0;
            if (wantsBoost) {
                this.boostIntensity = Math.min(1, this.boostIntensity + this.boostRampUp * dt);
                this.boostFuel = Math.max(0, this.boostFuel - this.boostDrainRate * dt);
            } else {
                this.boostIntensity = Math.max(0, this.boostIntensity - this.boostRampDown * dt);
            }

            const t = this.boostIntensity;
            const thrust = this.forwardThrust + (this.boostThrust - this.forwardThrust) * t;
            const activeMaxSpeed = this.currentSpeed + (this.boostMaxSpeed - this.currentSpeed) * t;

            body.setMaxSpeed(activeMaxSpeed);
            body.setAcceleration(facingX * thrust, facingY * thrust);

            const speed = body.speed;
            if (speed < this.minSpeed && speed > 0) {
                body.velocity.x *= this.minSpeed / speed;
                body.velocity.y *= this.minSpeed / speed;
            } else if (speed === 0) {
                body.setVelocity(facingX * this.minSpeed, facingY * this.minSpeed);
            } else if (speed > this.currentSpeed && t === 0) {
                body.velocity.x *= this.currentSpeed / speed;
                body.velocity.y *= this.currentSpeed / speed;
            }
        }

        // --- Wrap ---
        this.physics.world.wrap(this.headSprite, 0);

        const hx = this.headSprite.x;
        const hy = this.headSprite.y;
        const speed = body.speed;

        // --- Tire marks ---
        const velAngleMark = Math.atan2(body.velocity.y, body.velocity.x);
        let driftAngle = this.headAngle - velAngleMark;
        while (driftAngle > Math.PI) driftAngle -= Math.PI * 2;
        while (driftAngle < -Math.PI) driftAngle += Math.PI * 2;
        const absDrift = Math.abs(driftAngle);
        const tireThreshold = 0.5;
        const tireFull = 1.0;

        let targetTireIntensity = 0;
        if (absDrift > tireThreshold && speed > 90) {
            targetTireIntensity = Math.min((absDrift - tireThreshold) / (tireFull - tireThreshold), 1);
        }

        const tireRampSpeed = targetTireIntensity > this.tireMarkIntensity ? 2.4 : 6.5;
        const tireLerp = 1 - Math.exp(-tireRampSpeed * dt);
        this.tireMarkIntensity += (targetTireIntensity - this.tireMarkIntensity) * tireLerp;
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

            const isoAngle = Math.atan2(vy * 1.5, vx);
            const markAngleDeg = isoAngle * (180 / Math.PI);
            this.tireEmitterLeft.particleRotate = markAngleDeg;
            this.tireEmitterRight.particleRotate = markAngleDeg;

            this.tireEmitterLeft.particleAlpha = this.tireMarkIntensity * 0.54;
            this.tireEmitterRight.particleAlpha = this.tireMarkIntensity * 0.54;

            this.tireEmitterLeft.emitParticleAt(leftX, leftY, 1);
            this.tireEmitterRight.emitParticleAt(rightX, rightY, 1);
        }

        // --- Boost flame + smoke ---
        if (this.boostIntensity > 0.05) {
            const exhaustDist = 14;
            const rearX = hx - Math.cos(this.headAngle) * exhaustDist;
            const rearY = hy - Math.sin(this.headAngle) * exhaustDist;

            const exhaustAngleDeg = ((this.headAngle + Math.PI) * 180 / Math.PI);

            this.boostFlameEmitter.particleAngle = { min: exhaustAngleDeg - 15, max: exhaustAngleDeg + 15 };
            const flameCount = Math.ceil(this.boostIntensity * 3);
            this.boostFlameEmitter.emitParticleAt(rearX, rearY, flameCount);

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
            this.timeRemaining = Math.min(this.timeRemaining + this.pickupTimeBonus, 99);
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

        this.carShadow.setTexture(frameKey);
        this.carShadow.setPosition(hx + 1.5, hy + 2.5);

        this.scoreText.setText(`Score: ${this.score}`);
        if (this.debugText) {
            this.debugText.setText(
                `Spd: ${Math.round(speed)}  Thrust: ${this.forwardThrust}`
            );
        }

        // --- Update boost gauge bar (smoothed) ---
        const barX = 16;
        const barY = 48;
        const barW = 120;
        const barH = 10;

        const barLerp = 1 - Math.exp(-6 * dt);
        this.boostBarDisplay += (this.boostFuel - this.boostBarDisplay) * barLerp;
        const fillW = barW * Math.max(0, this.boostBarDisplay / this.boostMax);

        this.boostBarFill.clear();
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

        if (this.isAccelerating) {
            this.accelStopTimer = 0;
            this.soundManager.setCrossfadeLayerScale('engine', 1);
        } else {
            this.accelStopTimer += dt;
            if (this.accelStopTimer >= this.engineFadeDelay) {
                this.soundManager.setCrossfadeLayerScale('engine', brakeInput ? 0.3 : 0);
            }
        }

        const stoppingTarget = (!this.isAccelerating && this.accelStopTimer >= this.stoppingFadeDelay) ? 1 : 0;
        this.soundManager.setLayerTarget('stopping', stoppingTarget);
        this.soundManager.update(dt);
    }

    private endGame() {
        this.gameOver = true;

        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        body.setVelocity(0, 0);
        body.setAcceleration(0, 0);

        this.soundManager.stopAll();
        this.boostFlameEmitter.stop();
        this.boostSmokeEmitter.stop();

        this.timerText.setVisible(false);

        this.gameOverText.setText('GAME OVER');
        this.gameOverText.setVisible(true);

        this.finalScoreText = this.add.text(this.width / 2, this.height / 2, `Final Score: ${this.score}`, {
            fontFamily: 'Arial',
            fontSize: 32,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10);

        this.playAgainBtn = this.add.text(this.width / 2, this.height / 2 + 60, 'Play Again', {
            fontFamily: 'Arial Black',
            fontSize: 28,
            color: '#ffffff',
            backgroundColor: '#33aa55',
            padding: { x: 24, y: 12 },
            align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10)
          .setInteractive({ useHandCursor: true });

        this.playAgainBtn.on('pointerover', () => this.playAgainBtn?.setStyle({ backgroundColor: '#44cc66' }));
        this.playAgainBtn.on('pointerout', () => this.playAgainBtn?.setStyle({ backgroundColor: '#33aa55' }));
        this.playAgainBtn.on('pointerdown', () => {
            this.tryRestart();
        });

        this.restartHintText.setText('or press R to restart');
        this.restartHintText.setY(this.height / 2 + 110);
        this.restartHintText.setVisible(true);
    }
}
