import { Scene } from 'phaser';
import { KeyBindings, InputSource, PLAYER1_KEYS } from './GameConfig';

export interface CarInput {
    turnInput: number;
    thrustInput: boolean;
    brakeInput: boolean;
    reverseInput: boolean;
    isAccelerating: boolean;
}

export class CarController {
    private scene: Scene;

    // Player identity
    playerId: number = 1;
    spritePrefix: string;
    private keys: KeyBindings;

    /** Where this car gets input from: 'keyboard' or 'remote' */
    inputSource: InputSource = 'keyboard';

    /** Buffer for remote input (written by NetworkManager, read by readInput) */
    private remoteInput: CarInput = {
        turnInput: 0,
        thrustInput: false,
        brakeInput: false,
        reverseInput: false,
        isAccelerating: false,
    };

    // Car objects (created externally by Game.ts)
    headSprite!: Phaser.GameObjects.Arc;
    carSprite!: Phaser.GameObjects.Image;
    carShadow!: Phaser.GameObjects.Image;

    // === HEADING (manual — not tied to Arcade velocity direction) ===
    headAngle: number = 0;
    angularVel = 0;

    // === STATE ===
    isAccelerating = false;
    boostFuel: number;
    boostIntensity = 0;
    boostBarDisplay: number;
    tireMarkIntensity = 0;

    // === TUNING — exposed so DebugModal can tweak them ===
    forwardThrust = 325;
    drag = 160;
    maxSpeed = 310;

    // Hitbox
    readonly hitboxWidth = 42;
    readonly hitboxHeight = 20;
    readonly headRadius = 10;   // legacy compat
    readonly totalCarFrames = 48;

    // Boost
    private readonly boostThrust = 600;
    readonly boostMaxSpeed = 512;
    readonly boostMax = 1.25;
    private readonly boostDrainRate = 0.4;
    readonly boostRefillAmount = 0.35;
    private readonly boostRampUp = 5.0;
    private readonly boostRampDown = 3.5;

    // Braking
    private readonly brakeDragMultiplier = 5.0;
    private readonly brakeSteerBoost = 1.2;

    // Reverse
    private readonly reverseThrust = 150;
    private readonly maxReverseSpeed = 125;

    // Steering
    private readonly targetAngularVel = 4.0;
    private readonly minSteerFraction = 0.15;
    private readonly steerSmoothing = 35;
    private readonly returnSmoothing = 35;
    private readonly maxDriftAngle = 2.2;
    private readonly driftSoftness = 0.1;

    // Grip
    private readonly gripRate = 4.5;
    private readonly brakeGripRate = 1.4;

    // Tire marks (read by ParticleEffects)
    readonly rearWheelX = -4;
    readonly wheelSpreadY = 10;

    // Collision tuning
    readonly collisionMass = 1;
    readonly battleBounce = 0.8;
    readonly obstacleBounce = 0.4;

    // Minimum speed — kept at 0 for pure Arcade
    readonly minSpeed = 0;

    private width: number;
    private height: number;

    // Backward compat: currentSpeed is now a read-through to body.speed
    get currentSpeed(): number {
        if (!this.headSprite?.body) return 0;
        return (this.headSprite.body as Phaser.Physics.Arcade.Body).speed;
    }
    set currentSpeed(_v: number) {
        // No-op — speed is owned by Arcade. Setter kept so Game.ts
        // endGame tween doesn't crash.
    }

    constructor(scene: Scene, width: number, height: number, keys: KeyBindings = PLAYER1_KEYS, playerId: number = 1, spritePrefix: string = 'car-1', inputSource: InputSource = 'keyboard') {
        this.scene = scene;
        this.width = width;
        this.height = height;
        this.keys = keys;
        this.playerId = playerId;
        this.spritePrefix = spritePrefix;
        this.inputSource = inputSource;
        this.boostFuel = this.boostMax;
        this.boostBarDisplay = this.boostMax;
    }

    // ================================================================
    //  INPUT
    // ================================================================

    readInput(): CarInput {
        // Remote players: return the last received network input
        if (this.inputSource === 'remote') {
            this.isAccelerating = this.remoteInput.isAccelerating;
            return { ...this.remoteInput };
        }

        // Local keyboard input
        const keyboard = this.scene.input.keyboard;
        let turnInput = 0;
        let thrustInput = false;
        let brakeInput = false;
        let reverseInput = false;

        if (keyboard) {
            const left = keyboard.addKey(this.keys.left, false, false);
            const right = keyboard.addKey(this.keys.right, false, false);
            const up = keyboard.addKey(this.keys.up, false, false);
            const down = keyboard.addKey(this.keys.down, false, false);
            const boost = keyboard.addKey(this.keys.boost, false, false);
            const brake = keyboard.addKey(this.keys.brake, false, false);

            if (left.isDown) turnInput -= 1;
            if (right.isDown) turnInput += 1;
            this.isAccelerating = up.isDown;
            if (down.isDown) reverseInput = true;
            if (boost.isDown) thrustInput = true;
            if (brake.isDown) brakeInput = true;
        }

        return { turnInput, thrustInput, brakeInput, reverseInput, isAccelerating: this.isAccelerating };
    }

    /**
     * Set remote input (called by NetworkManager when input packet arrives).
     */
    setRemoteInput(input: CarInput) {
        this.remoteInput = { ...input };
    }

    applyInput(input: CarInput) {
        this.isAccelerating = input.isAccelerating;
    }

    // ================================================================
    //  BODY SETUP — called by Game.ts after physics body is created
    // ================================================================

    setupBody(mode: 'single' | 'battle') {
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;

        body.setCollideWorldBounds(false);
        body.setMaxVelocity(this.boostMaxSpeed, this.boostMaxSpeed);

        // Linear drag (px/s²), NOT damping fraction
        body.setDamping(false);
        body.setDrag(this.drag, this.drag);

        body.setMass(this.collisionMass);
        if (mode === 'battle') {
            body.setBounce(this.battleBounce, this.battleBounce);
        } else {
            body.setBounce(this.obstacleBounce, this.obstacleBounce);
        }
    }

    // ================================================================
    //  REVERSE
    // ================================================================

    updateReverse(dt: number, input: CarInput): boolean {
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;

        // Forward speed along heading
        const facingX = Math.cos(this.headAngle);
        const facingY = Math.sin(this.headAngle);
        const forwardSpeed = body.velocity.x * facingX + body.velocity.y * facingY;

        if (input.reverseInput && forwardSpeed <= 5) {
            body.setAcceleration(
                -facingX * this.reverseThrust,
                -facingY * this.reverseThrust
            );

            // Cap reverse speed
            if (body.speed > this.maxReverseSpeed) {
                const scale = this.maxReverseSpeed / body.speed;
                body.velocity.x *= scale;
                body.velocity.y *= scale;
            }

            // Slow steering while reversing
            if (input.turnInput !== 0) {
                const adjustedTurnRate = this.targetAngularVel * 0.25;
                this.angularVel += (input.turnInput * adjustedTurnRate - this.angularVel) * 0.05;
            } else {
                this.angularVel *= 0.95;
            }

            this.headAngle += this.angularVel * dt;
            this.updateCarSprite();
            return true;
        }

        return false;
    }

    // ================================================================
    //  MAIN FORWARD UPDATE
    // ================================================================

    updateForward(dt: number, input: CarInput) {
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        const speed = body.speed;

        // ---- STEERING ----
        const speedRatio = Math.min(speed / this.maxSpeed, 1);
        const steerScale = this.minSteerFraction + (1 - this.minSteerFraction) * speedRatio;
        const speedFactor = Math.min(speed / this.maxSpeed, 1);
        const adjustedTurnRate = this.targetAngularVel * (0.6 + 0.4 * speedFactor);

        const targetAV = input.turnInput * adjustedTurnRate * steerScale;
        const smoothRate = input.turnInput !== 0 ? this.steerSmoothing : this.returnSmoothing;
        const lerpFactor = 1 - Math.exp(-smoothRate * dt);
        this.angularVel += (targetAV - this.angularVel) * lerpFactor;

        // Drift angle limiting
        if (speed > 1) {
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

        // Handbrake drift boost
        if (input.brakeInput && input.turnInput !== 0) {
            this.angularVel += input.turnInput * this.brakeSteerBoost * dt;
        }

        this.headAngle += this.angularVel * dt;
        this.angularVel *= 0.95;

        // ---- GRIP: blend velocity toward heading ----
        const facingX = Math.cos(this.headAngle);
        const facingY = Math.sin(this.headAngle);

        if (speed > 1) {
            const grip = input.brakeInput ? this.brakeGripRate : this.gripRate;
            const velDirX = body.velocity.x / speed;
            const velDirY = body.velocity.y / speed;
            const blend = 1 - Math.exp(-grip * dt);
            const newDirX = velDirX + (facingX - velDirX) * blend;
            const newDirY = velDirY + (facingY - velDirY) * blend;
            const dirLen = Math.sqrt(newDirX * newDirX + newDirY * newDirY);
            if (dirLen > 0.001) {
                body.velocity.x = (newDirX / dirLen) * speed;
                body.velocity.y = (newDirY / dirLen) * speed;
            }
        }

        // ---- BOOST ----
        const wantsBoost = input.thrustInput && this.boostFuel > 0 && !input.brakeInput;
        if (wantsBoost) {
            this.boostIntensity = Math.min(1, this.boostIntensity + this.boostRampUp * dt);
            this.boostFuel = Math.max(0, this.boostFuel - this.boostDrainRate * dt);
        } else {
            this.boostIntensity = Math.max(0, this.boostIntensity - this.boostRampDown * dt);
        }

        // ---- THRUST / DRAG / BRAKE ----
        const t = this.boostIntensity;
        const thrust = this.forwardThrust + (this.boostThrust - this.forwardThrust) * t;
        const activeMaxSpeed = this.maxSpeed + (this.boostMaxSpeed - this.maxSpeed) * t;

        body.setMaxSpeed(activeMaxSpeed);

        if (input.brakeInput) {
            // Handbrake: high drag, tiny forward thrust to maintain slide
            body.setDrag(this.drag * this.brakeDragMultiplier, this.drag * this.brakeDragMultiplier);
            body.setAcceleration(facingX * thrust * 0.15, facingY * thrust * 0.15);
        } else if (this.isAccelerating || wantsBoost) {
            // Driving forward
            body.setDrag(this.drag, this.drag);
            body.setAcceleration(facingX * thrust, facingY * thrust);
        } else {
            // Coasting — Arcade drag decelerates naturally
            body.setDrag(this.drag, this.drag);
            body.setAcceleration(0, 0);
        }

        // ---- TIRE MARKS ----
        this.updateTireMarks(input, speed, dt);

        // ---- SPRITE + WRAP ----
        this.updateCarSprite();

        const hx = this.headSprite.x;
        const hy = this.headSprite.y;
        if (hx < 0) this.headSprite.setX(this.width);
        if (hx > this.width) this.headSprite.setX(0);
        if (hy < 0) this.headSprite.setY(this.height);
        if (hy > this.height) this.headSprite.setY(0);

        this.scene.physics.world.wrap(this.headSprite, 0);
    }

    // ================================================================
    //  TIRE MARKS
    // ================================================================

    private updateTireMarks(input: CarInput, speed: number, dt: number) {
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;

        const velAngle = Math.atan2(body.velocity.y, body.velocity.x);
        let driftAngle = this.headAngle - velAngle;
        while (driftAngle > Math.PI) driftAngle -= Math.PI * 2;
        while (driftAngle < -Math.PI) driftAngle += Math.PI * 2;
        const absDrift = Math.abs(driftAngle);

        const tireThreshold = 0.5;
        const tireFull = 1.0;

        let targetTireIntensity = 0;
        if (absDrift > tireThreshold && speed > 90) {
            targetTireIntensity = Math.min((absDrift - tireThreshold) / (tireFull - tireThreshold), 1);
        }
        if (input.brakeInput && speed > 30) {
            targetTireIntensity = Math.max(targetTireIntensity, Math.min(speed / 150, 1));
        }

        const tireRampSpeed = targetTireIntensity > this.tireMarkIntensity ? 2.4 : 6.5;
        const tireLerp = 1 - Math.exp(-tireRampSpeed * dt);
        this.tireMarkIntensity += (targetTireIntensity - this.tireMarkIntensity) * tireLerp;
        if (targetTireIntensity === 0 && this.tireMarkIntensity < 0.01) this.tireMarkIntensity = 0;
    }

    // ================================================================
    //  GAME OVER
    // ================================================================

    updateGameOver(_dt: number) {
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        body.setAcceleration(0, 0);
        body.setDrag(400, 400);

        if (body.speed < 2) {
            body.setVelocity(0, 0);
        }

        this.scene.physics.world.wrap(this.headSprite, 0);
        this.updateCarSprite();
    }

    // ================================================================
    //  SPRITE
    // ================================================================

    updateCarSprite() {
        const hx = this.headSprite.x;
        const hy = this.headSprite.y;
        let angleDeg = (this.headAngle * 180 / Math.PI) % 360;
        if (angleDeg < 0) angleDeg += 360;
        const frameIndex = Math.round(angleDeg / (360 / this.totalCarFrames)) % this.totalCarFrames;
        const frameKey = `${this.spritePrefix}_${String(frameIndex).padStart(3, '0')}`;
        this.carSprite.setTexture(frameKey);
        this.carSprite.setPosition(hx, hy);
        this.carShadow.setTexture(frameKey);
        this.carShadow.setScale(0.95, 1);
        this.carShadow.setPosition(hx + 4, hy + 58);
    }

    // ================================================================
    //  RESET
    // ================================================================

    reset(x: number, y: number) {
        this.headAngle = -Math.PI / 2;
        this.angularVel = 0;
        this.boostFuel = this.boostMax;
        this.boostIntensity = 0;
        this.boostBarDisplay = this.boostMax;
        this.tireMarkIntensity = 0;
        this.isAccelerating = false;

        this.headSprite.setPosition(x, y);
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        body.reset(x, y);
        body.setVelocity(0, 0);
        body.setMaxSpeed(this.maxSpeed);
        body.setDrag(this.drag, this.drag);
    }

    // ================================================================
    //  COLLISION: car vs obstacle
    //  Arcade bounce handles the physics natively.
    //  We just add spin for game feel and return speed for sound.
    // ================================================================

    handleCollision(_obstacle: any): number {
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        const speedAtImpact = body.speed;

        // Spin on impact
        const spin = Math.min(speedAtImpact / 300, 1) * 1.5;
        this.angularVel += (Math.random() > 0.5 ? 1 : -1) * spin;

        return speedAtImpact;
    }

    // ================================================================
    //  COLLISION: car vs car (battle mode)
    //  Arcade bounce + mass handles the core velocity exchange.
    //  We layer on an extra directional impulse so the aggressor
    //  (faster + more head-on) knocks the victim harder.
    // ================================================================

    handlePlayerCollision(otherCar: CarController): number {
        const myBody = this.headSprite.body as Phaser.Physics.Arcade.Body;
        const otherBody = otherCar.headSprite.body as Phaser.Physics.Arcade.Body;

        const mySpeed = myBody.speed;
        const otherSpeed = otherBody.speed;

        // Collision normal
        const dx = this.headSprite.x - otherCar.headSprite.x;
        const dy = this.headSprite.y - otherCar.headSprite.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;

        // Attack angle
        const myFacingX = Math.cos(this.headAngle);
        const myFacingY = Math.sin(this.headAngle);
        const otherFacingX = Math.cos(otherCar.headAngle);
        const otherFacingY = Math.sin(otherCar.headAngle);

        const myAttack = Math.max(0, -(myFacingX * nx + myFacingY * ny));
        const otherAttack = Math.max(0, (otherFacingX * nx + otherFacingY * ny));

        // Aggressor determination
        const myPower = mySpeed * (0.3 + 0.7 * myAttack);
        const otherPower = otherSpeed * (0.3 + 0.7 * otherAttack);

        // Extra impulse ON TOP of Arcade's native bounce
        const extraImpulse = 120;
        const speedBonus = (mySpeed + otherSpeed) * 0.25;
        const totalExtra = extraImpulse + speedBonus;

        if (myPower >= otherPower) {
            // I'm the aggressor — victim gets extra push
            otherBody.velocity.x += -nx * totalExtra;
            otherBody.velocity.y += -ny * totalExtra;
            myBody.velocity.x += nx * totalExtra * 0.3;
            myBody.velocity.y += ny * totalExtra * 0.3;
        } else {
            myBody.velocity.x += nx * totalExtra;
            myBody.velocity.y += ny * totalExtra;
            otherBody.velocity.x += -nx * totalExtra * 0.3;
            otherBody.velocity.y += -ny * totalExtra * 0.3;
        }

        // Spin both cars
        const baseSpin = 0.6;
        const extraSpin = 0.8;
        const totalPower = (myPower + otherPower) || 1;
        const myVictimRatio = otherPower / totalPower;
        const otherVictimRatio = myPower / totalPower;

        const mySpinDir = (nx * myFacingY - ny * myFacingX) > 0 ? 1 : -1;
        const otherSpinDir = (-nx * otherFacingY + ny * otherFacingX) > 0 ? 1 : -1;

        this.angularVel += mySpinDir * (baseSpin + extraSpin * myVictimRatio);
        otherCar.angularVel += otherSpinDir * (baseSpin + extraSpin * otherVictimRatio);

        return Math.max(mySpeed, otherSpeed);
    }
}
