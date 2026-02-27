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

    // Slip-angle physics state
    slipAngle = 35;
    gripLevel = 1.0;
    private gripRecoveryTimer = 1.0;
    private driftSign = 0;
    private driftSignCooldown = 0;

    // === TUNING — exposed so DebugModal can tweak them ===
    forwardThrust = 320;
    drag = 45;
    maxSpeed = 373;

    // Hitbox
    readonly hitboxWidth = 42;
    readonly hitboxHeight = 20;
    readonly headRadius = 10;
    readonly totalCarFrames = 48;

    // Boost
    private readonly boostThrust = 620;
    readonly boostMaxSpeed = 580;
    readonly boostMax = 1.25;
    private readonly boostDrainRate = 0.4;
    readonly boostRefillAmount = 0.35;
    private readonly boostRampUp = 5.0;
    private readonly boostRampDown = 3.5;

    // Braking
    private readonly brakeDragMultiplier = 4.5;
    private readonly brakeSteerBoost = 1.0;

    // Reverse
    private readonly reverseThrust = 120;
    private readonly maxReverseSpeed = 105;

    // Steering — heavier, inertia-based
    private readonly targetAngularVel = 3.8;
    private readonly minSteerFraction = 0.12;
    private readonly steerSmoothing = 18;
    private readonly returnSmoothing = 22;

    // Grip — slip-angle based lateral friction
    private readonly gripSlipLow = 0.12;
    private readonly gripSlipHigh = 0.52;
    private readonly gripMin = 0.25;
    private readonly lateralFriction = 8.5;
    private readonly driftSpeedLoss = 0.38;

    // Grip recovery — prevents instant re-grip after sliding
    private readonly gripRecoveryTime = 5.28;
    private readonly gripRecoverySlipThreshold = 0.14;

    // Drift safety limit
    private readonly maxDriftAngle = 0.15;
    private readonly driftPushback = 5.0;

    // Handbrake grip reduction
    private readonly brakeGripMultiplier = 0.11;

    // Counter-steer grip bonus
    private readonly counterSteerGripBonus = 1.3;
    private readonly counterSteerDeadzone = 0.1;

    // Throttle grip interaction (power-on oversteer)
    private readonly throttleGripPenalty = 0.82;

    // Speed-sensitive grip falloff
    private readonly speedGripFalloff = 0.15;

    // Engine braking (coast drag)
    private readonly coastDragMultiplier = 1.5;

    // Angular damping (dt-based, replaces frame-rate-dependent constant)
    private readonly angularDrag = 5.0;

    // Tire mark chain-breaking
    private readonly driftSignChangeCooldown = 0.20;

    // Tire marks (read by ParticleEffects)
    readonly rearWheelX = -4;
    readonly wheelSpreadY = 10;

    // Collision tuning
    readonly collisionMass = 0.7;
    readonly battleBounce = 0.7;
    readonly obstacleBounce = 0.35;

    readonly minSpeed = 0;

    // Backward compat: currentSpeed is now a read-through to body.speed
    get currentSpeed(): number {
        if (!this.headSprite?.body) return 0;
        return (this.headSprite.body as Phaser.Physics.Arcade.Body).speed;
    }
    set currentSpeed(_v: number) {
        // No-op — speed is owned by Arcade. Setter kept so Game.ts
        // endGame tween doesn't crash.
    }

    constructor(scene: Scene, keys: KeyBindings = PLAYER1_KEYS, playerId: number = 1, spritePrefix: string = 'car-1', inputSource: InputSource = 'keyboard') {
        this.scene = scene;
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

    private wrapHeadSprite() {
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        const bounds = this.scene.physics.world.bounds;

        // Wrap based on the hitbox size so the full car leaves
        // before it appears on the opposite side.
        const padX = this.hitboxWidth / 2;
        const padY = this.hitboxHeight / 2;

        const left = bounds.x - padX;
        const right = bounds.right + padX;
        const top = bounds.y - padY;
        const bottom = bounds.bottom + padY;

        let x = this.headSprite.x;
        let y = this.headSprite.y;
        let wrapped = false;

        if (x < left) { x = right; wrapped = true; }
        else if (x > right) { x = left; wrapped = true; }

        if (y < top) { y = bottom; wrapped = true; }
        else if (y > bottom) { y = top; wrapped = true; }

        if (wrapped) {
            this.headSprite.setPosition(x, y);
            body.updateFromGameObject();
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

        // ---- STEERING (heavier inertia-based feel) ----
        const speedRatio = Math.min(speed / this.maxSpeed, 1);
        const steerScale = this.minSteerFraction + (1 - this.minSteerFraction) * speedRatio;
        const targetAV = input.turnInput * this.targetAngularVel * steerScale;

        const smoothRate = input.turnInput !== 0 ? this.steerSmoothing : this.returnSmoothing;
        const lerpFactor = 1 - Math.exp(-smoothRate * dt);
        this.angularVel += (targetAV - this.angularVel) * lerpFactor;

        if (input.brakeInput && input.turnInput !== 0 && speed > 40) {
            this.angularVel += input.turnInput * this.brakeSteerBoost * dt;
        }

        this.headAngle += this.angularVel * dt;
        this.angularVel *= Math.exp(-this.angularDrag * dt);

        // ---- DECOMPOSE VELOCITY into forward & lateral ----
        const facingX = Math.cos(this.headAngle);
        const facingY = Math.sin(this.headAngle);
        const perpX = -facingY;
        const perpY = facingX;

        if (speed > 1) {
            let forwardSpeed = body.velocity.x * facingX + body.velocity.y * facingY;
            let lateralSpeed = body.velocity.x * perpX + body.velocity.y * perpY;

            // ---- SLIP ANGLE ----
            this.slipAngle = Math.atan2(Math.abs(lateralSpeed), Math.abs(forwardSpeed));

            // Drift angle (heading vs velocity) — used by counter-steer and safety limit
            const velAngle = Math.atan2(body.velocity.y, body.velocity.x);
            let driftAngle = this.headAngle - velAngle;
            while (driftAngle > Math.PI) driftAngle -= Math.PI * 2;
            while (driftAngle < -Math.PI) driftAngle += Math.PI * 2;

            // ---- GRIP CURVE (smoothstep) ----
            let gripFromCurve: number;
            if (this.slipAngle <= this.gripSlipLow) {
                gripFromCurve = 1.0;
            } else if (this.slipAngle >= this.gripSlipHigh) {
                gripFromCurve = this.gripMin;
            } else {
                const t = (this.slipAngle - this.gripSlipLow) / (this.gripSlipHigh - this.gripSlipLow);
                const s = t * t * (3 - 2 * t);
                gripFromCurve = 1.0 - (1.0 - this.gripMin) * s;
            }

            // ---- GRIP RECOVERY (prevents instant re-grip after slide) ----
            if (this.slipAngle > this.gripRecoverySlipThreshold) {
                this.gripRecoveryTimer = 0;
            } else {
                this.gripRecoveryTimer = Math.min(
                    this.gripRecoveryTime,
                    this.gripRecoveryTimer + dt
                );
            }
            const recoveryFactor = this.gripRecoveryTimer / this.gripRecoveryTime;
            let effectiveGrip = this.gripMin + (gripFromCurve - this.gripMin) * recoveryFactor;

            // Counter-steer bonus: steering against the drift rebuilds grip
            if (Math.abs(driftAngle) > this.counterSteerDeadzone && driftAngle * input.turnInput < 0) {
                effectiveGrip *= this.counterSteerGripBonus;
            }

            // Throttle reduces grip (power-on oversteer)
            if (this.isAccelerating && speed > 50) {
                effectiveGrip *= this.throttleGripPenalty;
            }

            // High-speed grip falloff
            effectiveGrip *= 1.0 - this.speedGripFalloff * speedRatio;

            if (input.brakeInput) {
                effectiveGrip *= this.brakeGripMultiplier;
            }

            this.gripLevel = effectiveGrip;

            // ---- LATERAL FRICTION (slip-angle sensitive) ----
            const lateralRetain = Math.exp(-effectiveGrip * this.lateralFriction * dt);
            lateralSpeed *= lateralRetain;

            // ---- DRIFT SPEED LOSS (sliding costs forward speed) ----
            if (this.slipAngle > this.gripSlipLow) {
                const slipFraction = Math.min(
                    (this.slipAngle - this.gripSlipLow) / (this.gripSlipHigh - this.gripSlipLow),
                    1
                );
                forwardSpeed *= 1 - this.driftSpeedLoss * slipFraction * dt;
            }

            // ---- DRIFT SAFETY LIMIT ----
            if (Math.abs(driftAngle) > this.maxDriftAngle) {
                const excess = Math.abs(driftAngle) - this.maxDriftAngle;
                const pushback = excess * this.driftPushback * dt;
                this.angularVel += driftAngle > 0 ? -pushback : pushback;
            }

            // ---- RECONSTRUCT VELOCITY ----
            body.velocity.x = facingX * forwardSpeed + perpX * lateralSpeed;
            body.velocity.y = facingY * forwardSpeed + perpY * lateralSpeed;
        } else {
            this.slipAngle = 0;
            this.gripLevel = 1.0;
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
        const bt = this.boostIntensity;
        const thrust = this.forwardThrust + (this.boostThrust - this.forwardThrust) * bt;
        const activeMaxSpeed = this.maxSpeed + (this.boostMaxSpeed - this.maxSpeed) * bt;

        body.setMaxSpeed(activeMaxSpeed);

        if (input.brakeInput) {
            body.setDrag(this.drag * this.brakeDragMultiplier, this.drag * this.brakeDragMultiplier);
            body.setAcceleration(facingX * thrust * 0.15, facingY * thrust * 0.15);
        } else if (this.isAccelerating || wantsBoost) {
            body.setDrag(this.drag, this.drag);
            body.setAcceleration(facingX * thrust, facingY * thrust);
        } else {
            body.setDrag(this.drag * this.coastDragMultiplier, this.drag * this.coastDragMultiplier);
            body.setAcceleration(0, 0);
        }

        // ---- TIRE MARKS ----
        this.updateTireMarks(input, body.speed, dt);

        // ---- SPRITE + WRAP ----
        this.updateCarSprite();
        this.wrapHeadSprite();
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

        // Detect drift direction changes to break tire mark chains (e.g. figure-8s)
        const newSign = driftAngle > 0.08 ? 1 : driftAngle < -0.08 ? -1 : 0;
        if (this.driftSign !== 0 && newSign !== 0 && newSign !== this.driftSign) {
            this.driftSignCooldown = this.driftSignChangeCooldown;
        }
        if (newSign !== 0) this.driftSign = newSign;
        this.driftSignCooldown = Math.max(0, this.driftSignCooldown - dt);

        const tireThreshold = 0.42;
        const tireFull = 0.90;

        let targetTireIntensity = 0;
        if (absDrift > tireThreshold && speed > 80) {
            targetTireIntensity = Math.min((absDrift - tireThreshold) / (tireFull - tireThreshold), 1);
        }
        if (input.brakeInput && speed > 30) {
            targetTireIntensity = Math.max(targetTireIntensity, Math.min(speed / 150, 1));
        }

        // Force gap when drift direction flips (breaks continuous figure-8 marks)
        if (this.driftSignCooldown > 0 && !input.brakeInput) {
            targetTireIntensity = 0;
        }

        const tireRampSpeed = targetTireIntensity > this.tireMarkIntensity ? 2.2 : 8.5;
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

        this.wrapHeadSprite();
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

        this.slipAngle = 0;
        this.gripLevel = 1.0;
        this.gripRecoveryTimer = 1.0;
        this.driftSign = 0;
        this.driftSignCooldown = 0;

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
