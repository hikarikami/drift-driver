import { Scene } from 'phaser';
import { CarController } from './CarController';

export class ParticleEffects {
    private scene: Scene;

    tireEmitterLeft!: Phaser.GameObjects.Particles.ParticleEmitter;
    tireEmitterRight!: Phaser.GameObjects.Particles.ParticleEmitter;
    boostFlameEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
    boostSmokeEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
    brakeSmokeEmitterLeft!: Phaser.GameObjects.Particles.ParticleEmitter;
    brakeSmokeEmitterRight!: Phaser.GameObjects.Particles.ParticleEmitter;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    /**
     * Creates all particle textures and emitters. Call during scene create().
     */
    create() {
        // --- Tire mark texture ---
        const tireGfx = this.scene.add.graphics();
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

        this.tireEmitterLeft = this.scene.add.particles(0, 0, 'tiremark_dot', { ...tireConfig });
        this.tireEmitterLeft.setDepth(1);

        this.tireEmitterRight = this.scene.add.particles(0, 0, 'tiremark_dot', { ...tireConfig });
        this.tireEmitterRight.setDepth(1);

        // --- Flame texture ---
        const flameGfx = this.scene.add.graphics();
        flameGfx.fillStyle(0xffffff, 1);
        flameGfx.fillCircle(6, 6, 6);
        flameGfx.generateTexture('flame_dot', 12, 12);
        flameGfx.destroy();

        this.boostFlameEmitter = this.scene.add.particles(0, 0, 'flame_dot', {
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

        this.boostSmokeEmitter = this.scene.add.particles(0, 0, 'flame_dot', {
            color: [0x666666, 0x444444, 0x222222],
            colorEase: 'linear',
            lifespan: { min: 400, max: 700 },
            scale: { start: 0.2, end: 0.5, ease: 'sine.out' },
            speed: { min: 15, max: 40 },
            alpha: { start: 0.15, end: 0 },
            blendMode: 'NORMAL',
            emitting: false,
        });
        this.boostSmokeEmitter.setDepth(4);

        // --- Brake smoke ---
        const brakeSmokeConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
            color: [0xcccccc, 0xaaaaaa, 0x888888, 0x666666],
            colorEase: 'linear',
            lifespan: { min: 1600, max: 6000 },
            scale: { start: 0.4, end: 1.6, ease: 'sine.out' },
            speed: { min: 0, max: 3.5 },
            alpha: { start: 0.09, end: .04 },
            gravityY: -12,
            blendMode: 'NORMAL',
            emitting: true,
        };

        this.brakeSmokeEmitterLeft = this.scene.add.particles(0, 0, 'flame_dot', { ...brakeSmokeConfig });
        this.brakeSmokeEmitterLeft.setDepth(3);

        this.brakeSmokeEmitterRight = this.scene.add.particles(0, 0, 'flame_dot', { ...brakeSmokeConfig });
        this.brakeSmokeEmitterRight.setDepth(3);
    }

    /**
     * Per-frame update for all particle effects
     */
    update(car: CarController, brakeInput: boolean) {
        const body = car.headSprite.body as Phaser.Physics.Arcade.Body;
        const hx = car.headSprite.x;
        const hy = car.headSprite.y;
        const speed = body.speed;

        // --- Tire marks ---
        if (car.tireMarkIntensity > 0) {
            const vx = body.velocity.x;
            const vy = body.velocity.y;

            const perpAngle = car.headAngle + Math.PI / 2;
            const spread = car.wheelSpreadY;
            const baseX = hx + Math.cos(car.headAngle) * car.rearWheelX;
            const baseY = hy + Math.sin(car.headAngle) * car.rearWheelX;
            const leftX = baseX + Math.cos(perpAngle) * spread;
            const leftY = baseY + Math.sin(perpAngle) * spread;
            const rightX = baseX - Math.cos(perpAngle) * spread;
            const rightY = baseY - Math.sin(perpAngle) * spread;

            const isoAngle = Math.atan2(vy * 1.5, vx);
            const markAngleDeg = isoAngle * (180 / Math.PI);
            this.tireEmitterLeft.particleRotate = markAngleDeg;
            this.tireEmitterRight.particleRotate = markAngleDeg;

            this.tireEmitterLeft.particleAlpha = car.tireMarkIntensity * 0.54;
            this.tireEmitterRight.particleAlpha = car.tireMarkIntensity * 0.54;

            this.tireEmitterLeft.emitParticleAt(leftX, leftY, 1);
            this.tireEmitterRight.emitParticleAt(rightX, rightY, 1);
        }

       // --- Boost flame/smoke ---
if (car.boostIntensity > 0.01) {
    // Depth: always behind the car
    const carDepth = car.carSprite?.depth ?? 4;
    this.boostFlameEmitter.setDepth(carDepth +1);
    this.boostSmokeEmitter.setDepth(carDepth +1);

    // Angle: always out the back of the car (not based on velocity/drift)
    const exhaustAngleDeg = ((car.headAngle * 180) / Math.PI + 180) % 360;

    // Position: behind the car, rotated with car angle
    const exhaustLocalX = car.rearWheelX - 25;
    const exhaustLocalY = 0;
    const exhaustX = hx + Math.cos(car.headAngle) * exhaustLocalX - Math.sin(car.headAngle) * exhaustLocalY;
    const exhaustY = hy + Math.sin(car.headAngle) * exhaustLocalX + Math.cos(car.headAngle) * exhaustLocalY;

    this.boostFlameEmitter.particleAngle = { min: exhaustAngleDeg - 8, max: exhaustAngleDeg + 8 };
    const flameCount = Math.ceil(car.boostIntensity * 3);
    this.boostFlameEmitter.emitParticleAt(exhaustX, exhaustY, flameCount);

    this.boostSmokeEmitter.particleAngle = { min: exhaustAngleDeg - 25, max: exhaustAngleDeg + 25 };
    const smokeCount = Math.ceil(car.boostIntensity * 5.5);
    this.boostSmokeEmitter.emitParticleAt(exhaustX, exhaustY, smokeCount);
}

        // --- Brake smoke ---
        if (brakeInput && speed > 30) {
            const perpAngle = car.headAngle + Math.PI / 2;
            const spread = car.wheelSpreadY;

            const baseX = hx + Math.cos(car.headAngle) * car.rearWheelX;
            const baseY = hy + Math.sin(car.headAngle) * car.rearWheelX;

            const leftX = baseX + Math.cos(perpAngle) * spread;
            const leftY = baseY + Math.sin(perpAngle) * spread;
            const rightX = baseX - Math.cos(perpAngle) * spread;
            const rightY = baseY - Math.sin(perpAngle) * spread;

            const count = Math.ceil(Math.min(speed / 100, 1) * 2.5);
            this.brakeSmokeEmitterLeft.emitParticleAt(leftX, leftY, count);
            this.brakeSmokeEmitterRight.emitParticleAt(rightX, rightY, count);
        }
    }

    /**
     * Kill all particles (for reset)
     */
    killAll() {
        this.tireEmitterLeft.killAll();
        this.tireEmitterRight.killAll();
        this.boostFlameEmitter.killAll();
        this.boostSmokeEmitter.killAll();
        this.brakeSmokeEmitterLeft.killAll();
        this.brakeSmokeEmitterRight.killAll();
    }

    /**
     * Stop all emitters (for game over)
     */
    stopAll() {
        this.boostFlameEmitter.stop();
        this.boostSmokeEmitter.stop();
        this.brakeSmokeEmitterLeft.stop();
        this.brakeSmokeEmitterRight.stop();
    }
}
