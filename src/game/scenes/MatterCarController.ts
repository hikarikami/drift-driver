import { Scene } from 'phaser';
import { KeyBindings, InputSource, PLAYER1_KEYS } from './GameConfig';
import { TouchControls } from '../TouchControls';
import { CarInput, ICarController } from './CarController';

/**
 * Matter.js physics car controller.
 *
 * Implements the exact same slip-angle physics model as CarController, but uses
 * a Matter.js rigid body for position/velocity storage and collision response.
 * Thrust, drag, and lateral friction are all integrated manually each frame
 * (frictionAir = 0 on the body) so Matter's own integrator does not interfere.
 *
 * Collision response between cars / obstacles is handled natively by Matter
 * (mass-based momentum exchange via `restitution`), and we layer spin on top.
 */
export class MatterCarController implements ICarController {
    private scene: Scene;

    // Player identity
    playerId: number = 1;
    spritePrefix: string;
    private keys: KeyBindings;
    inputSource: InputSource = 'keyboard';

    private remoteInput: CarInput = {
        turnInput: 0,
        thrustInput: false,
        brakeInput: false,
        reverseInput: false,
        isAccelerating: false,
    };

    // Game objects (headSprite is a Rectangle with a Matter body)
    headSprite!: any;
    carSprite!: Phaser.GameObjects.Image;
    carShadow!: Phaser.GameObjects.Image;

    // Heading (manual — not driven by Matter rotation)
    headAngle: number = 0;
    angularVel = 0;

    // State
    isAccelerating = false;
    boostFuel: number;
    boostIntensity = 0;
    boostBarDisplay: number;
    tireMarkIntensity = 0;
    private brakeIntensity = 0;  // 0→1 ramp so handbrake effects ease in smoothly

    // Slip-angle physics state
    slipAngle = 0;
    gripLevel = 1.0;
    private gripRecoveryTimer = 1.0;
    private driftSign = 0;
    private driftSignCooldown = 0;

    // Cached velocity/speed (updated each frame from Matter body)
    private _velocityX = 0;
    private _velocityY = 0;
    private _speed = 0;

    // === TUNING ===
    forwardThrust = 315;
    drag = 50;
    maxSpeed = 380;

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
    private readonly brakeDragMultiplier = 6.2;   // strong decel — car slows quickly for pivot turns
    private readonly brakeSteerBoost = 5.2;        // strong rotation kick for "turn on a point" feel
    private readonly brakeRampUp   = 8.0;          // ~0.12 s to reach full brake effect
    private readonly brakeRampDown = 14.0;         // releases quickly when key is lifted

    // Reverse
    private readonly reverseThrust = 120;
    private readonly maxReverseSpeed = 105;

    // Steering
    private readonly targetAngularVel = 3.5;
    private readonly minSteerFraction = 0.11;
    private readonly steerSmoothing = 18;
    private readonly returnSmoothing = 22;

    // Grip — slip-angle based lateral friction
    private readonly gripSlipLow = 0.18;      // holds full grip longer (grippier onset)
    private readonly gripSlipHigh = 0.44;     // narrow transition = snappy break into slide
    private readonly gripMin = 0.18;          // slightly higher floor = less extreme slides
    private readonly lateralFriction = 8.5;   // more planted feel
    private readonly driftSpeedLoss = 0.28;   // more speed loss during slides = less float

    // Grip recovery
    private readonly gripRecoveryTime = 3.0;              // snappier recovery after straightening
    private readonly gripRecoverySlipThreshold = 0.16;

    // Drift safety limit — generous angle, gentle correction to avoid snaking
    private readonly maxDriftAngle = 0.32;
    private readonly driftPushback = 0.8;

    // Handbrake — very low grip so the rear slides freely, enabling pivot turns
    private readonly brakeGripMultiplier = 0.10;

    // Counter-steer
    private readonly counterSteerGripBonus = 1.55;  // more reward for catching the slide
    private readonly counterSteerDeadzone = 0.1;

    // Throttle grip penalty
    private readonly throttleGripPenalty = 0.68;  // stronger power-on oversteer

    // Speed-sensitive grip falloff
    private readonly speedGripFalloff = 0.20;

    // Engine braking
    private readonly coastDragMultiplier = 2.4;  // rally-style lift-off decel

    // Angular damping
    private readonly angularDrag = 3.0;

    // Tire mark chain-breaking
    private readonly driftSignChangeCooldown = 0.8;

    // Tile marks
    readonly rearWheelX = -4;
    readonly wheelSpreadY = 10;

    // Collision
    readonly collisionMass = 0.7;
    readonly battleBounce = 0.7;
    readonly obstacleBounce = 0.35;

    readonly minSpeed = 0;

    // Matter.js stores velocity in pixels/step (1 step = 1/60 s at 60 Hz).
    // All internal physics uses pixels/second, so we convert at the boundary.
    private readonly MATTER_FPS = 60;

    // ----------------------------------------------------------------
    get currentSpeed(): number { return this._speed; }
    set currentSpeed(_v: number) {}
    get velocityX(): number { return this._velocityX; }
    get velocityY(): number { return this._velocityY; }
    // ----------------------------------------------------------------

    constructor(
        scene: Scene,
        keys: KeyBindings = PLAYER1_KEYS,
        playerId: number = 1,
        spritePrefix: string = 'car-1',
        inputSource: InputSource = 'keyboard',
    ) {
        this.scene = scene;
        this.keys = keys;
        this.playerId = playerId;
        this.spritePrefix = spritePrefix;
        this.inputSource = inputSource;
        this.boostFuel = this.boostMax;
        this.boostBarDisplay = this.boostMax;
    }

    // ================================================================
    //  MATTER HELPERS
    // ================================================================

    private get mBody(): any {
        return this.headSprite?.body;
    }

    private setVelocity(vx: number, vy: number) {
        if (!this.mBody) return;
        // Convert px/s → px/step before handing to Matter
        (this.headSprite as any).setVelocity(vx / this.MATTER_FPS, vy / this.MATTER_FPS);
        this._velocityX = vx;
        this._velocityY = vy;
        this._speed = Math.sqrt(vx * vx + vy * vy);
    }

    private syncFromBody() {
        if (!this.mBody) return;
        // Convert px/step → px/s
        this._velocityX = this.mBody.velocity.x * this.MATTER_FPS;
        this._velocityY = this.mBody.velocity.y * this.MATTER_FPS;
        this._speed = Math.sqrt(this._velocityX * this._velocityX + this._velocityY * this._velocityY);
    }

    // ================================================================
    //  INPUT
    // ================================================================

    readInput(): CarInput {
        if (this.inputSource === 'remote') {
            this.isAccelerating = this.remoteInput.isAccelerating;
            return { ...this.remoteInput };
        }

        const keyboard = this.scene.input.keyboard;
        let turnInput = 0;
        let thrustInput = false;
        let brakeInput = false;
        let reverseInput = false;

        if (keyboard) {
            const left  = keyboard.addKey(this.keys.left,  false, false);
            const right = keyboard.addKey(this.keys.right, false, false);
            const up    = keyboard.addKey(this.keys.up,    false, false);
            const down  = keyboard.addKey(this.keys.down,  false, false);
            const boost = keyboard.addKey(this.keys.boost, false, false);
            const brake = keyboard.addKey(this.keys.brake, false, false);

            if (left.isDown)  turnInput -= 1;
            if (right.isDown) turnInput += 1;
            this.isAccelerating = up.isDown;
            if (down.isDown)  reverseInput = true;
            if (boost.isDown) thrustInput  = true;
            if (brake.isDown) brakeInput   = true;
        }

        const touch = TouchControls.getInstance().state;
        if (touch.left)  turnInput = Math.max(-1, turnInput - 1);
        if (touch.right) turnInput = Math.min(1,  turnInput + 1);
        if (touch.up)    this.isAccelerating = true;
        if (touch.down)  reverseInput = true;
        if (touch.boost) thrustInput  = true;
        if (touch.brake) brakeInput   = true;

        return { turnInput, thrustInput, brakeInput, reverseInput, isAccelerating: this.isAccelerating };
    }

    setRemoteInput(input: CarInput) {
        this.remoteInput = { ...input };
    }

    applyInput(input: CarInput) {
        this.isAccelerating = input.isAccelerating;
    }

    // ================================================================
    //  BODY SETUP
    // ================================================================

    setupBody(mode: 'single' | 'battle') {
        if (!this.mBody) return;
        const bounce = mode === 'battle' ? this.battleBounce : this.obstacleBounce;
        // Apply restitution and mass via Matter API
        const MatterLib = (Phaser.Physics.Matter as any).Matter;
        MatterLib.Body.set(this.mBody, { restitution: bounce });
        MatterLib.Body.setMass(this.mBody, this.collisionMass);
        // Lock rotation — we control heading manually
        MatterLib.Body.setInertia(this.mBody, Infinity);
    }

    private wrapHeadSprite() {
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;
        const padX = this.hitboxWidth  / 2;
        const padY = this.hitboxHeight / 2;

        let x = this.headSprite.x as number;
        let y = this.headSprite.y as number;
        let wrapped = false;

        if      (x < -padX)    { x = w + padX;  wrapped = true; }
        else if (x > w + padX) { x = -padX;     wrapped = true; }
        if      (y < -padY)    { y = h + padY;  wrapped = true; }
        else if (y > h + padY) { y = -padY;     wrapped = true; }

        if (wrapped) {
            // Use game object setPosition — Phaser syncs to Matter body
            (this.headSprite as any).setPosition(x, y);
        }
    }

    // ================================================================
    //  REVERSE
    // ================================================================

    updateReverse(dt: number, input: CarInput): boolean {
        this.syncFromBody();
        const facingX = Math.cos(this.headAngle);
        const facingY = Math.sin(this.headAngle);
        const fwdSpeed = this._velocityX * facingX + this._velocityY * facingY;

        if (input.reverseInput && fwdSpeed <= 5) {
            // Integrate reverse thrust manually
            let newFwd = fwdSpeed - this.reverseThrust * dt;
            if (Math.abs(newFwd) > this.maxReverseSpeed) {
                newFwd = -this.maxReverseSpeed;
            }
            const perpX = -facingY, perpY = facingX;
            const latSpeed = this._velocityX * perpX + this._velocityY * perpY;
            this.setVelocity(
                facingX * newFwd + perpX * latSpeed,
                facingY * newFwd + perpY * latSpeed,
            );

            if (input.turnInput !== 0) {
                const rate = this.targetAngularVel * 0.25;
                this.angularVel += (input.turnInput * rate - this.angularVel) * 0.05;
            } else {
                this.angularVel *= 0.95;
            }
            this.headAngle += this.angularVel * dt;
            this.updateCarSprite();
            this.wrapHeadSprite();
            return true;
        }

        return false;
    }

    // ================================================================
    //  MAIN FORWARD UPDATE
    // ================================================================

    updateForward(dt: number, input: CarInput) {
        this.syncFromBody();
        const speed = this._speed;

        // ---- BRAKE INTENSITY RAMP ----
        // Smoothly ramp 0→1 when brake is held so all effects ease in
        if (input.brakeInput) {
            this.brakeIntensity = Math.min(1, this.brakeIntensity + this.brakeRampUp * dt);
        } else {
            this.brakeIntensity = Math.max(0, this.brakeIntensity - this.brakeRampDown * dt);
        }

        // ---- STEERING ----
        const speedRatio  = Math.min(speed / this.maxSpeed, 1);
        const steerScale  = this.minSteerFraction + (1 - this.minSteerFraction) * speedRatio;
        const targetAV    = input.turnInput * this.targetAngularVel * steerScale;
        const smoothRate  = input.turnInput !== 0 ? this.steerSmoothing : this.returnSmoothing;
        const lerpFactor  = 1 - Math.exp(-smoothRate * dt);
        this.angularVel  += (targetAV - this.angularVel) * lerpFactor;

        // Brake-steer rotation kick — scaled by brakeIntensity so it eases in
        if (input.brakeInput && input.turnInput !== 0 && speed > 25) {
            this.angularVel += input.turnInput * this.brakeSteerBoost * this.brakeIntensity * dt;
        }

        this.headAngle  += this.angularVel * dt;
        this.angularVel *= Math.exp(-this.angularDrag * dt);

        // ---- DECOMPOSE VELOCITY ----
        const facingX = Math.cos(this.headAngle);
        const facingY = Math.sin(this.headAngle);
        const perpX   = -facingY;
        const perpY   =  facingX;

        let newVx = this._velocityX;
        let newVy = this._velocityY;

        if (speed > 1) {
            let forwardSpeed = this._velocityX * facingX + this._velocityY * facingY;
            let lateralSpeed = this._velocityX * perpX   + this._velocityY * perpY;

            // ---- SLIP ANGLE ----
            this.slipAngle = Math.atan2(Math.abs(lateralSpeed), Math.abs(forwardSpeed));

            const velAngle = Math.atan2(this._velocityY, this._velocityX);
            let driftAngle = this.headAngle - velAngle;
            while (driftAngle >  Math.PI) driftAngle -= Math.PI * 2;
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

            // ---- GRIP RECOVERY ----
            if (this.slipAngle > this.gripRecoverySlipThreshold) {
                this.gripRecoveryTimer = 0;
            } else {
                this.gripRecoveryTimer = Math.min(this.gripRecoveryTime, this.gripRecoveryTimer + dt);
            }
            const recoveryFactor = this.gripRecoveryTimer / this.gripRecoveryTime;
            let effectiveGrip = this.gripMin + (gripFromCurve - this.gripMin) * recoveryFactor;

            // Counter-steer bonus
            if (Math.abs(driftAngle) > this.counterSteerDeadzone && driftAngle * input.turnInput < 0) {
                effectiveGrip *= this.counterSteerGripBonus;
            }
            // Throttle reduces grip
            if (this.isAccelerating && speed > 50) {
                effectiveGrip *= this.throttleGripPenalty;
            }
            // Speed-sensitive falloff
            effectiveGrip *= 1.0 - this.speedGripFalloff * speedRatio;

            if (input.brakeInput) {
                // Lerp grip from 1.0 → brakeGripMultiplier as brakeIntensity rises
                const brakeMult = 1.0 - (1.0 - this.brakeGripMultiplier) * this.brakeIntensity;
                effectiveGrip *= brakeMult;
            }

            this.gripLevel = effectiveGrip;

            // ---- LATERAL FRICTION ----
            const lateralRetain = Math.exp(-effectiveGrip * this.lateralFriction * dt);
            lateralSpeed *= lateralRetain;

            // ---- DRIFT SPEED LOSS ----
            if (this.slipAngle > this.gripSlipLow) {
                const slipFraction = Math.min(
                    (this.slipAngle - this.gripSlipLow) / (this.gripSlipHigh - this.gripSlipLow), 1,
                );
                forwardSpeed *= 1 - this.driftSpeedLoss * slipFraction * dt;
            }

            // ---- DRIFT SAFETY LIMIT ----
            // Skipped during handbrake — pushback fighting brakeSteerBoost causes snaking
            if (!input.brakeInput && Math.abs(driftAngle) > this.maxDriftAngle) {
                const excess   = Math.abs(driftAngle) - this.maxDriftAngle;
                const pushback = excess * this.driftPushback * dt;
                this.angularVel += driftAngle > 0 ? -pushback : pushback;
            }

            // ---- BOOST ----
            const wantsBoost = input.thrustInput && this.boostFuel > 0 && !input.brakeInput;
            if (wantsBoost) {
                this.boostIntensity = Math.min(1, this.boostIntensity + this.boostRampUp   * dt);
                this.boostFuel      = Math.max(0, this.boostFuel      - this.boostDrainRate * dt);
            } else {
                this.boostIntensity = Math.max(0, this.boostIntensity - this.boostRampDown * dt);
            }

            const bt           = this.boostIntensity;
            const thrust       = this.forwardThrust + (this.boostThrust       - this.forwardThrust) * bt;
            const activeMaxSpd = this.maxSpeed      + (this.boostMaxSpeed     - this.maxSpeed)      * bt;

            // ---- THRUST / DRAG (manually integrated for Matter) ----
            if (input.brakeInput) {
                // Drag also ramps up with brakeIntensity for a smooth bite
                const effectiveDragMult = 1.0 + (this.brakeDragMultiplier - 1.0) * this.brakeIntensity;
                const brakeDrag = this.drag * effectiveDragMult;
                forwardSpeed  = forwardSpeed > 0
                    ? Math.max(0, forwardSpeed - brakeDrag * dt)
                    : Math.min(0, forwardSpeed + brakeDrag * dt);
            } else if (this.isAccelerating || wantsBoost) {
                forwardSpeed += thrust * dt;
                forwardSpeed  = forwardSpeed > 0
                    ? Math.max(0, forwardSpeed - this.drag * dt)
                    : Math.min(0, forwardSpeed + this.drag * dt);
            } else {
                const coastDrag = this.drag * this.coastDragMultiplier;
                forwardSpeed = forwardSpeed > 0
                    ? Math.max(0, forwardSpeed - coastDrag * dt)
                    : Math.min(0, forwardSpeed + coastDrag * dt);
            }

            // Cap forward speed
            forwardSpeed = Math.max(-this.maxReverseSpeed, Math.min(activeMaxSpd, forwardSpeed));

            newVx = facingX * forwardSpeed + perpX * lateralSpeed;
            newVy = facingY * forwardSpeed + perpY * lateralSpeed;
        } else {
            // Low / zero speed — tick boost and apply startup thrust
            const wantsBoost = input.thrustInput && this.boostFuel > 0 && !input.brakeInput;
            if (wantsBoost) {
                this.boostIntensity = Math.min(1, this.boostIntensity + this.boostRampUp   * dt);
                this.boostFuel      = Math.max(0, this.boostFuel      - this.boostDrainRate * dt);
            } else {
                this.boostIntensity = Math.max(0, this.boostIntensity - this.boostRampDown * dt);
            }
            this.slipAngle = 0;
            this.gripLevel = 1.0;

            if (this.isAccelerating || wantsBoost) {
                const bt     = this.boostIntensity;
                const thrust = this.forwardThrust + (this.boostThrust - this.forwardThrust) * bt;
                const fwd    = thrust * dt;
                newVx = Math.cos(this.headAngle) * fwd;
                newVy = Math.sin(this.headAngle) * fwd;
            }
        }

        this.setVelocity(newVx, newVy);

        // ---- TIRE MARKS ----
        this.updateTireMarks(input, this._speed, dt);

        // ---- SPRITE + WRAP ----
        this.updateCarSprite();
        this.wrapHeadSprite();
    }

    // ================================================================
    //  TIRE MARKS (identical logic to CarController)
    // ================================================================

    private updateTireMarks(input: CarInput, speed: number, dt: number) {
        const velAngle = Math.atan2(this._velocityY, this._velocityX);
        let driftAngle = this.headAngle - velAngle;
        while (driftAngle >  Math.PI) driftAngle -= Math.PI * 2;
        while (driftAngle < -Math.PI) driftAngle += Math.PI * 2;
        const absDrift = Math.abs(driftAngle);

        const newSign = driftAngle > 0.08 ? 1 : driftAngle < -0.08 ? -1 : 0;
        if (this.driftSign !== 0 && newSign !== 0 && newSign !== this.driftSign) {
            this.driftSignCooldown = this.driftSignChangeCooldown;
        }
        if (newSign !== 0) this.driftSign = newSign;
        this.driftSignCooldown = Math.max(0, this.driftSignCooldown - dt);

        const tireThreshold = 0.42;
        const tireFull      = 0.90;

        let targetTireIntensity = 0;
        if (absDrift > tireThreshold && speed > 80) {
            targetTireIntensity = Math.min((absDrift - tireThreshold) / (tireFull - tireThreshold), 1);
        }
        if (input.brakeInput && speed > 30) {
            targetTireIntensity = Math.max(targetTireIntensity, Math.min(speed / 150, 1));
        }
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

    initGameOver() {
        if (this.mBody) {
            this.mBody.frictionAir = 0.06;
        }
    }

    updateGameOver(dt: number) {
        this.syncFromBody();
        if (this._speed < 2) {
            this.setVelocity(0, 0);
        }
        this.wrapHeadSprite();
        this.updateCarSprite();
        void dt;
    }

    // ================================================================
    //  SPRITE
    // ================================================================

    updateCarSprite() {
        const hx = this.headSprite.x as number;
        const hy = this.headSprite.y as number;
        let angleDeg = (this.headAngle * 180 / Math.PI) % 360;
        if (angleDeg < 0) angleDeg += 360;
        const frameIndex = Math.round(angleDeg / (360 / this.totalCarFrames)) % this.totalCarFrames;
        const frameKey   = `${this.spritePrefix}_${String(frameIndex).padStart(3, '0')}`;
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
        this.headAngle     = -Math.PI / 2;
        this.angularVel    = 0;
        this.boostFuel     = this.boostMax;
        this.boostIntensity = 0;
        this.boostBarDisplay = this.boostMax;
        this.tireMarkIntensity = 0;
        this.isAccelerating  = false;
        this.brakeIntensity  = 0;
        this.slipAngle       = 0;
        this.gripLevel       = 1.0;
        this.gripRecoveryTimer = 1.0;
        this.driftSign       = 0;
        this.driftSignCooldown = 0;

        (this.headSprite as any).setPosition(x, y);
        this.setVelocity(0, 0);

        // Restore air friction in case initGameOver modified it
        if (this.mBody) {
            this.mBody.frictionAir = 0;
        }
    }

    // ================================================================
    //  PHYSICS TOGGLE (guest freeze in online mode)
    // ================================================================

    setPhysicsEnabled(enabled: boolean) {
        if (!this.mBody) return;
        const MatterLib = (Phaser.Physics.Matter as any).Matter;
        if (!enabled) {
            this.setVelocity(0, 0);
            MatterLib.Body.setStatic(this.mBody, true);
        } else {
            MatterLib.Body.setStatic(this.mBody, false);
        }
    }

    // ================================================================
    //  COLLISION: car vs obstacle
    //  Matter handles velocity exchange natively (restitution).
    //  We just add spin for feel.
    // ================================================================

    handleCollision(_obstacle: any): number {
        this.syncFromBody();
        const speedAtImpact = this._speed;
        const spin = Math.min(speedAtImpact / 300, 1) * 1.5;
        this.angularVel += (Math.random() > 0.5 ? 1 : -1) * spin;
        return speedAtImpact;
    }

    // ================================================================
    //  COLLISION: car vs car
    //  Matter handles the core velocity exchange.
    //  We add aggressor-weighted impulse and spin on top.
    // ================================================================

    handlePlayerCollision(otherCar: ICarController): number {
        this.syncFromBody();
        const mySpeed    = this._speed;
        const otherSpeed = otherCar.currentSpeed;

        const dx   = (this.headSprite.x as number) - (otherCar.headSprite.x as number);
        const dy   = (this.headSprite.y as number) - (otherCar.headSprite.y as number);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist, ny = dy / dist;

        const myFacingX = Math.cos(this.headAngle), myFacingY = Math.sin(this.headAngle);
        const otherFacingX = Math.cos(otherCar.headAngle), otherFacingY = Math.sin(otherCar.headAngle);

        const myAttack    = Math.max(0, -(myFacingX * nx    + myFacingY * ny));
        const otherAttack = Math.max(0,  (otherFacingX * nx + otherFacingY * ny));

        const myPower    = mySpeed    * (0.3 + 0.7 * myAttack);
        const otherPower = otherSpeed * (0.3 + 0.7 * otherAttack);

        // Extra impulse on top of Matter's native response
        const extraImpulse = 80;
        const speedBonus   = (mySpeed + otherSpeed) * 0.18;
        const totalExtra   = extraImpulse + speedBonus;

        if (myPower >= otherPower) {
            // px/s values — use our wrapper which converts to px/step
            this.setVelocity(
                this._velocityX + nx * totalExtra * 0.3,
                this._velocityY + ny * totalExtra * 0.3,
            );
            const oVx = otherCar.velocityX - nx * totalExtra;
            const oVy = otherCar.velocityY - ny * totalExtra;
            (otherCar.headSprite as any).setVelocity(oVx / this.MATTER_FPS, oVy / this.MATTER_FPS);
        } else {
            this.setVelocity(
                this._velocityX + nx * totalExtra,
                this._velocityY + ny * totalExtra,
            );
            const oVx = otherCar.velocityX - nx * totalExtra * 0.3;
            const oVy = otherCar.velocityY - ny * totalExtra * 0.3;
            (otherCar.headSprite as any).setVelocity(oVx / this.MATTER_FPS, oVy / this.MATTER_FPS);
        }

        // Spin
        const baseSpin    = 0.6, extraSpin = 0.8;
        const totalPower  = (myPower + otherPower) || 1;
        const myVicRatio  = otherPower / totalPower;
        const oVicRatio   = myPower    / totalPower;
        const mySpinDir   = (nx * myFacingY    - ny * myFacingX)    > 0 ? 1 : -1;
        const oSpinDir    = (-nx * otherFacingY + ny * otherFacingX) > 0 ? 1 : -1;

        this.angularVel     += mySpinDir * (baseSpin + extraSpin * myVicRatio);
        otherCar.angularVel += oSpinDir  * (baseSpin + extraSpin * oVicRatio);

        return Math.max(mySpeed, otherSpeed);
    }
}
