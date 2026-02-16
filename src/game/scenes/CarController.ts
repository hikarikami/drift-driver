import { Scene } from 'phaser';
import { KeyBindings, PLAYER1_KEYS } from './GameConfig';

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

    // Sprite prefix for this player's car (e.g. 'car-1' or 'car-2')
    spritePrefix: string;

    // Key bindings (configurable per player)
    private keys: KeyBindings;

    // Car objects (created externally, passed in)
    headSprite!: Phaser.GameObjects.Arc;
    carSprite!: Phaser.GameObjects.Image;
    carShadow!: Phaser.GameObjects.Image;

    // Car state
    headAngle!: number;
    angularVel = 0;
    currentSpeed = 0;
    isAccelerating = false;
    boostFuel: number;
    boostIntensity = 0.2;
    boostBarDisplay: number;
    tireMarkIntensity = 0;

    // Physics tuning
    forwardThrust = 325;
    drag = 100;
    maxSpeed = 310;
    readonly headRadius = 10; // legacy, kept for compatibility
    readonly hitboxWidth = 42;
    readonly hitboxHeight = 20;
    readonly totalCarFrames = 48;
    private readonly boostThrust = 600;
    readonly boostMaxSpeed = 512;
    private readonly brakeFactor = 0.75;
    readonly minSpeed = 0;
    private readonly maxReverseSpeed = -125;
    private readonly reverseAccel = 5;
    private readonly acceleration = 6.25;
    private readonly decelBase = 2.0;
    private readonly decelMomentumFactor = 0.1;

    // Boost gauge
    readonly boostMax = 1.25;
    private readonly boostDrainRate = 0.4;
    readonly boostRefillAmount = 0.35;
    private readonly boostRampUp = 5.0;
    private readonly boostRampDown = 3.5;

    // Steering
    private readonly targetAngularVel = 4.0;
    private readonly minSteerFraction = 0.15;
    private readonly steerSmoothing = 25;
    private readonly returnSmoothing = 25;
    private readonly maxDriftAngle = 3.5;
    private readonly driftSoftness = 0.1;
    private readonly gripRate = 2.5;

    // Tire mark constants
    readonly rearWheelX = -4;
    readonly wheelSpreadY = 10;

    private width: number;
    private height: number;

    constructor(scene: Scene, width: number, height: number, keys: KeyBindings = PLAYER1_KEYS, playerId: number = 1, spritePrefix: string = 'car-1') {
        this.scene = scene;
        this.width = width;
        this.height = height;
        this.keys = keys;
        this.playerId = playerId;
        this.spritePrefix = spritePrefix;
        this.boostFuel = this.boostMax;
        this.boostBarDisplay = this.boostMax;
    }

    /**
     * Reads keyboard input using this player's key bindings and returns a CarInput struct.
     * For single player, both WASD and arrows work.
     * For battle mode, each player gets their own bindings.
     */
    readInput(): CarInput {
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
            if (up.isDown) this.isAccelerating = true;
            else this.isAccelerating = false;
            if (down.isDown) reverseInput = true;
            if (boost.isDown) thrustInput = true;
            if (brake.isDown) brakeInput = true;
        }

        return { turnInput, thrustInput, brakeInput, reverseInput, isAccelerating: this.isAccelerating };
    }

    /**
     * Allows external code to provide input directly (for future PeerJS remote players).
     */
    applyInput(input: CarInput) {
        this.isAccelerating = input.isAccelerating;
    }

    /**
     * Handles reverse movement. Returns true if car is reversing (skip normal physics).
     */
    updateReverse(dt: number, input: CarInput): boolean {
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;

        // Active reversing
        if (input.reverseInput && this.currentSpeed <= 0) {
            this.currentSpeed = Math.max(this.currentSpeed - this.reverseAccel * dt * 60, this.maxReverseSpeed);

            const facingX = Math.cos(this.headAngle);
            const facingY = Math.sin(this.headAngle);

            body.setVelocity(facingX * this.currentSpeed, facingY * this.currentSpeed);
            body.setAcceleration(0, 0);

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

        // Coasting from reverse back to zero
        if (this.currentSpeed < 0) {
            this.currentSpeed = Math.min(this.currentSpeed + this.reverseAccel * 0.5 * dt * 60, 0);

            const facingX = Math.cos(this.headAngle);
            const facingY = Math.sin(this.headAngle);
            body.setVelocity(facingX * this.currentSpeed, facingY * this.currentSpeed);
            body.setAcceleration(0, 0);

            this.updateCarSprite();
            return true;
        }

        return false;
    }

    /**
     * Main forward physics update: steering, drift, acceleration, boost, braking
     */
    updateForward(dt: number, input: CarInput) {
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        body.setMaxSpeed(this.maxSpeed);

        // --- Smooth steering (speed-dependent) ---
        const speedRatio = Math.min(body.speed / this.maxSpeed, 1);
        const steerScale = this.minSteerFraction + (1 - this.minSteerFraction) * speedRatio;

        const speedFactor = this.currentSpeed / this.maxSpeed;
        const adjustedTurnRate = this.targetAngularVel * (0.6 + 0.4 * speedFactor);

        const targetAV = input.turnInput * adjustedTurnRate * steerScale;
        const smoothRate = input.turnInput !== 0 ? this.steerSmoothing : this.returnSmoothing;
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
        this.angularVel *= 0.95;

        // --- Drift physics ---
        const facingX = Math.cos(this.headAngle);
        const facingY = Math.sin(this.headAngle);

        if (Math.abs(currentSpeed) > 1) {
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
        } else {
            body.velocity.x = facingX * this.currentSpeed;
            body.velocity.y = facingY * this.currentSpeed;
        }

        // --- Acceleration / Deceleration ---
        if (this.isAccelerating) {
            const sr = this.currentSpeed / this.maxSpeed;
            const accelCurve = 1.0 - (sr * sr * 0.7);
            const effectiveAccel = this.acceleration * accelCurve;
            this.currentSpeed = Math.min(this.currentSpeed + effectiveAccel * dt * 60, this.maxSpeed);
        } else {
            if (this.currentSpeed > 0) {
                const momentum = this.currentSpeed * this.decelMomentumFactor;
                const decelRate = Math.max(this.decelBase - momentum, 0.3);
                this.currentSpeed = Math.max(this.currentSpeed - decelRate * dt * 60, 0);
            } else if (this.currentSpeed < 0) {
                this.currentSpeed = Math.min(this.currentSpeed + this.reverseAccel * 2 * dt * 60, 0);
            }
        }

        // --- Thrust / Handbrake ---
        const brakeMinSpeed = this.minSpeed * 0.4;

        if (input.brakeInput) {
            const driftTurnBoost = 2.0;
            if (input.turnInput !== 0) {
                this.angularVel += input.turnInput * driftTurnBoost * dt;
            }

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
            const wantsBoost = input.thrustInput && this.boostFuel > 0;
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

            if (this.isAccelerating || this.currentSpeed > 0) {
                body.setAcceleration(facingX * thrust, facingY * thrust);
            } else {
                body.setAcceleration(0, 0);
            }

            const speed = body.speed;
            if (speed < this.minSpeed && speed > 0) {
                body.velocity.x *= this.minSpeed / speed;
                body.velocity.y *= this.minSpeed / speed;
            } else if (speed === 0) {
                body.velocity.x = facingX * this.minSpeed;
                body.velocity.y = facingY * this.minSpeed;
            } else if (speed > this.currentSpeed && t === 0) {
                body.velocity.x *= this.currentSpeed / speed;
                body.velocity.y *= this.currentSpeed / speed;
            }
        }

        // --- Wrap ---
        this.scene.physics.world.wrap(this.headSprite, 0);

        // --- Tire mark intensity ---
        const hx = this.headSprite.x;
        const hy = this.headSprite.y;
        const speed = body.speed;

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
        if (input.brakeInput && speed > 30) {
            targetTireIntensity = Math.max(targetTireIntensity, Math.min(speed / 150, 1));
        }

        const tireRampSpeed = targetTireIntensity > this.tireMarkIntensity ? 2.4 : 6.5;
        const tireLerp = 1 - Math.exp(-tireRampSpeed * dt);
        this.tireMarkIntensity += (targetTireIntensity - this.tireMarkIntensity) * tireLerp;
        if (targetTireIntensity === 0 && this.tireMarkIntensity < 1) this.tireMarkIntensity = 0;

        // Update car sprite
        this.updateCarSprite();

        // Screen wrap
        if (hx < 0) this.headSprite.setX(this.width);
        if (hx > this.width) this.headSprite.setX(0);
        if (hy < 0) this.headSprite.setY(this.height);
        if (hy > this.height) this.headSprite.setY(0);
    }

    /**
     * Game-over coasting update
     */
    updateGameOver(dt: number) {
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        const coastDamp = 1 - 1.5 * dt;
        body.velocity.x *= Math.max(coastDamp, 0);
        body.velocity.y *= Math.max(coastDamp, 0);
        if (body.speed < 2) { body.setVelocity(0, 0); body.setAcceleration(0, 0); }

        this.scene.physics.world.wrap(this.headSprite, 0);
        this.updateCarSprite();
    }

    /**
     * Updates the car sprite frame and shadow position based on current headAngle
     */
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

    /**
     * Resets car state for a new game
     */
    reset(x: number, y: number) {
        this.headAngle = -Math.PI / 2;
        this.angularVel = 0;
        this.currentSpeed = this.minSpeed;
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
        body.setDrag(0, 0);
    }

    /**
     * Handles collision impact - speed loss and bounce
     */
    handleCollision(obstacle: any) {
        const speedAtImpact = Math.abs(this.currentSpeed);
        this.currentSpeed *= 0.2;

        const carBody = this.headSprite.body as Phaser.Physics.Arcade.Body;

        const dx = this.headSprite.x - obstacle.x;
        const dy = this.headSprite.y - obstacle.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
            const dirX = dx / distance;
            const dirY = dy / distance;

            let bounceForce;
            if (speedAtImpact < 75) {
                bounceForce = 320;
            } else if (speedAtImpact < 175) {
                bounceForce = 280;
            } else if (speedAtImpact < 275) {
                bounceForce = 250;
            } else {
                bounceForce = 230;
            }

            carBody.setVelocity(dirX * bounceForce, dirY * bounceForce);
        }

        return speedAtImpact;
    }
}