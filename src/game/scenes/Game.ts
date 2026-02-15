import { Scene } from 'phaser';
import { SoundManager } from '../SoundManager';

// ========== TRICK SYSTEM TYPES ==========

type TrickDifficulty = 'basic' | 'easy' | 'moderate' | 'hard' | 'tricky' | 'super_tricky' | 'ultra_tricky';

interface TrickDefinition {
    name: string;
    difficulty: TrickDifficulty;
    baseScore: number;
    canChain: boolean;
}

interface CompletedTrick {
    name: string;
    difficulty: TrickDifficulty;
    score: number;
    multiplier: number;
    timestamp: number;
}

export class Game extends Scene {
    // World bounds
    private width!: number;
    private height!: number;
    private decorations: Phaser.Physics.Arcade.Image[] = [];


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
    private readonly boostMaxSpeed = 512; // Increased from 488
    private readonly brakeFactor = 0.75;
    private drag = 100;
    private maxSpeed = 310;
    private readonly minSpeed = 0;
    private readonly maxReverseSpeed = -125; // Increased from -60 for punchier reverse
    private readonly reverseAccel = 5;
    private readonly acceleration = 6.25;
    private readonly decelBase = 2.0;
    private readonly decelMomentumFactor = 0.1;

    // Boost gauge
    private readonly boostMax = 1.25;
    private readonly boostDrainRate = 0.4;
    private readonly boostRefillAmount = 0.35;
    private boostFuel = 1;
    private boostIntensity = 0.2;
    private readonly boostRampUp = 5.0; // Increased from 3.5 for snappier boost
    private readonly boostRampDown = 3.5; // Increased from 2 for quicker boost fade
    private boostBarDisplay = 1.25;
    private boostBarBg!: Phaser.GameObjects.Graphics;
    private boostBarFill!: Phaser.GameObjects.Graphics;
    private boostFlameEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
    private boostSmokeEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
    private brakeSmokeEmitterLeft!: Phaser.GameObjects.Particles.ParticleEmitter;
    private brakeSmokeEmitterRight!: Phaser.GameObjects.Particles.ParticleEmitter;

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
    private readonly rearWheelX = -4;
    private readonly wheelSpreadY = 10;
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

    // Collision
    private lastCollisionTime = 0;
    private readonly collisionCooldown = 500; // ms between collision impacts

    // Countdown timer
    private timeRemaining = 60;
    private timerText!: Phaser.GameObjects.Text;
    private readonly startTime = 60;
    private readonly pickupTimeBonus = 4; // Time bonus when collecting trophy

    // Debug modal
    private debugModalContainer!: Phaser.GameObjects.Container;
    private debugModalOpen = false;
    private debugBtn!: Phaser.GameObjects.Text;
    private debugThrustLabel!: Phaser.GameObjects.Text;
    private debugDragLabel!: Phaser.GameObjects.Text;
    private debugMaxSpdLabel!: Phaser.GameObjects.Text;
    private showTrickThreshold = false; // Toggle for trick threshold visualization
    private trickThresholdGraphics!: Phaser.GameObjects.Graphics; // Graphics for drawing threshold zones
    private showScoreDetails = false; // Toggle for score details display
    private scoreDetailsText!: Phaser.GameObjects.Text; // Display for score state details

    // Game over overlay objects (destroyed on restart)
    private finalScoreText?: Phaser.GameObjects.Text;
    private playAgainBtn?: Phaser.GameObjects.Text;


    //music volume
    private musicVolume = 0.35;

    // Sound
    private soundManager!: SoundManager;
    private currentSpeed = 0;
    private isAccelerating = false;
    private accelStopTimer = 0;
    private readonly engineFadeDelay = 0.165;
    private music!: Phaser.Sound.BaseSound;
    private musicMuted = false;
    private collectSound!: Phaser.Sound.BaseSound;
    private crashSound1!: Phaser.Sound.BaseSound;
    private crashSound2!: Phaser.Sound.BaseSound;
    private crashSound3!: Phaser.Sound.BaseSound;
    private trickSound!: Phaser.Sound.BaseSound; // Direct sound, not managed by SoundManager
    private lastTrickSoundTime = 0; // Track when trick sound was last played to prevent spam

    // Trick System
    private isDrifting = false;
    private trickHistory: CompletedTrick[] = [];
    private currentComboMultiplier = 1;
    private lastTrickTime = 0;
    private readonly trickComboWindow = 2000; // ms - time window to chain tricks
    private readonly nearMissThreshold = 80; // pixels - distance from obstacle edge to trigger near-miss
    private nearMissTracking = new Set<Phaser.Physics.Arcade.Image>(); // Track which obstacles we've scored near-miss for
    private recentlyCollidedObstacles = new Set<Phaser.Physics.Arcade.Image>(); // Track obstacles we've recently hit
    
    // Drift session buffering - NEW STANDARDIZED SYSTEM
    private activeTricks = new Map<string, number>(); // Tricks currently in progress (type -> current value)
    private bufferedTricks: string[] = []; // Completed trick instances during this drift session
    private crashedDuringDrift = false; // Flag if player crashed during current drift session
    
    // Handbrake trick tracking
    private handbrakeStartTime = 0; // When handbrake was first pressed
    private handbrakeMinDuration = 1000; // Minimum 1 second to score
    
    // Nitro trick tracking
    private nitroStartTime = 0; // When nitro was first activated
    private nitroMinDuration = 1000; // Minimum 1 second to score

    // UI
    private scoreText!: Phaser.GameObjects.Text;
    private gameOverText!: Phaser.GameObjects.Text;
    private debugText!: Phaser.GameObjects.Text;
    private trickComboText!: Phaser.GameObjects.Text; // Shows current trick combo at bottom of screen

    constructor() {
        super('Game');
    }

    // Trick definitions with scoring
    private readonly TRICKS: Record<string, TrickDefinition> = {
        NEAR_MISS: {
            name: 'Near Miss',
            difficulty: 'easy',
            baseScore: 50,
            canChain: true
        },
        HANDBRAKEY: {
            name: 'Handbrakey',
            difficulty: 'basic',
            baseScore: 10, // Per second of handbraking
            canChain: true
        },
        NITROX_BABY: {
            name: 'Nitrox Baby!',
            difficulty: 'basic',
            baseScore: 5, // Per second of nitro use
            canChain: true
        },
        CAPPY_CRASH: {
            name: 'Cappy Crash',
            difficulty: 'basic',
            baseScore: 100, // One-off bonus for collecting trophy while boosting
            canChain: true
        },
    };

    // ========== HELPER METHODS ==========

    /**
     * Creates a shadow for static scenery (decorations, cacti)
     * Returns the created shadow image
     */
    private createStaticShadow(
        x: number,
        y: number,
        textureName: string,
        scale: number,
        offsetX: number = -1,
        offsetY: number = 1,
        depth: number = 5
    ): Phaser.GameObjects.Image {
        const shadow = this.add.image(x + offsetX, y + offsetY, textureName);
        shadow.setOrigin(0.5, 1);
        shadow.setBlendMode(Phaser.BlendModes.DARKEN);
        shadow.setScale(scale);
        shadow.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        shadow.setTint(0x000000);
        shadow.setAlpha(0.45);
        shadow.setDepth(depth);
        return shadow;
    }

    /**
     * Creates a shadow for dynamic objects (car, pickup)
     * Returns the created shadow image with specific settings for moving objects
     */
    private createDynamicShadow(
        x: number,
        y: number,
        textureName: string,
        depth: number = 3
    ): Phaser.GameObjects.Image {
        const shadow = this.add.image(x, y, textureName);
        shadow.setOrigin(0.5, 1); // Anchor at bottom
        shadow.setTint(0x000000);
        shadow.setAlpha(0.45);
        shadow.setBlendMode(Phaser.BlendModes.MULTIPLY);
        shadow.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        shadow.setDepth(depth);
        return shadow;
    }

    // ========== TRICK SYSTEM ==========

    /**
     * Main trick execution function - handles scoring, combo multipliers, and UI feedback
     */
    private executeTrick(trickKey: string) {
        const trick = this.TRICKS[trickKey];
        if (!trick) return;

        const now = this.time.now;

        // Use base score directly (no multiplier)
        const finalScore = trick.baseScore;
        
        // Record the trick
        const completedTrick: CompletedTrick = {
            name: trick.name,
            difficulty: trick.difficulty,
            score: finalScore,
            multiplier: 1, // Always 1 now
            timestamp: now
        };
        
        this.trickHistory.push(completedTrick);
        this.score += finalScore;
        this.lastTrickTime = now;

        // Visual and audio feedback now handled by combo display system
    }

    /**
     * Plays the trick sound effect (first 3 seconds only, with cooldown)
     */
    private playTrickSound() {
        const now = this.time.now;
        if (now - this.lastTrickSoundTime > 300) { // 300ms cooldown
            console.log('[TRICK SOUND] Playing...');
            
            // Play the sound
            const soundInstance = this.trickSound.play({ volume: 0.5 });
            this.lastTrickSoundTime = now;
            
            // Stop after 3 seconds to avoid the loop at the end of the audio file
            this.time.delayedCall(3000, () => {
                if (soundInstance && typeof soundInstance === 'object' && 'stop' in soundInstance) {
                    (soundInstance as Phaser.Sound.BaseSound).stop();
                    console.log('[TRICK SOUND] Stopped after 3 seconds');
                }
            });
        }
    }

    /**
     * Checks for near-miss tricks - NEW STANDARDIZED SYSTEM
     */
    private checkNearMiss() {
        if (!this.isDrifting) {
            // Clean up if not drifting
            if (this.activeTricks.has('NEAR_MISS')) {
                this.activeTricks.delete('NEAR_MISS');
                this.nearMissTracking.clear();
                this.updateTrickComboDisplay();
            }
            return;
        }

        const carBody = this.headSprite.body as Phaser.Physics.Arcade.Body;
        const currentlyNearObstacles = new Set<Phaser.Physics.Arcade.Image>();

        for (const obstacle of this.decorations) {
            // Skip obstacles we've recently collided with
            if (this.recentlyCollidedObstacles.has(obstacle)) {
                continue;
            }
            
            const obstacleBody = obstacle.body as Phaser.Physics.Arcade.Body;
            
            // Calculate the closest distance between the two rectangular bodies
            const carLeft = carBody.x;
            const carRight = carBody.x + carBody.width;
            const carTop = carBody.y;
            const carBottom = carBody.y + carBody.height;
            
            const obsLeft = obstacleBody.x;
            const obsRight = obstacleBody.x + obstacleBody.width;
            const obsTop = obstacleBody.y;
            const obsBottom = obstacleBody.y + obstacleBody.height;
            
            // Calculate horizontal and vertical distances
            let horizontalDistance = 0;
            if (carRight < obsLeft) {
                horizontalDistance = obsLeft - carRight;
            } else if (carLeft > obsRight) {
                horizontalDistance = carLeft - obsRight;
            }
            
            let verticalDistance = 0;
            if (carBottom < obsTop) {
                verticalDistance = obsTop - carBottom;
            } else if (carTop > obsBottom) {
                verticalDistance = carTop - obsBottom;
            }
            
            const actualDistance = Math.sqrt(horizontalDistance * horizontalDistance + verticalDistance * verticalDistance);
            
            // Check if we're currently near this obstacle
            if (actualDistance > 0 && actualDistance <= this.nearMissThreshold) {
                currentlyNearObstacles.add(obstacle);
            }
        }

        const wasNearObstacles = this.nearMissTracking.size > 0;
        const isNearObstacles = currentlyNearObstacles.size > 0;

        // AC1: TRICK STARTED - now near obstacles
        if (!wasNearObstacles && isNearObstacles) {
            this.activeTricks.set('NEAR_MISS', 0);
            this.updateTrickComboDisplay();
        }

        // AC2: TRICK IN PROGRESS - update count
        if (isNearObstacles) {
            this.activeTricks.set('NEAR_MISS', currentlyNearObstacles.size);
            this.updateTrickComboDisplay();
        }

        // AC3: TRICK COMPLETED - moved away from all obstacles
        if (wasNearObstacles && !isNearObstacles) {
            const completedCount = this.nearMissTracking.size;
            this.activeTricks.delete('NEAR_MISS');
            
            // Add completed near misses to buffer
            for (let i = 0; i < completedCount; i++) {
                this.bufferedTricks.push('NEAR_MISS');
            }
            
            this.updateTrickComboDisplay();
        }

        // Update tracking set
        this.nearMissTracking = currentlyNearObstacles;
    }

    /**
     * Checks for handbrake trick - NEW STANDARDIZED SYSTEM
     */
    private checkHandbrake(brakeInput: boolean) {
        const now = this.time.now;
        const wasActive = this.activeTricks.has('HANDBRAKEY');
        
        // Handbrake released - COMPLETE TRICK (check this FIRST, before drift check)
        if (!brakeInput && wasActive) {
            const duration = now - this.handbrakeStartTime;
            this.activeTricks.delete('HANDBRAKEY'); // Remove from active
            
            // Only buffer if held long enough
            if (duration >= this.handbrakeMinDuration) {
                const seconds = Math.floor(duration / 1000);
                // Add completed instances to buffer
                for (let i = 0; i < seconds; i++) {
                    this.bufferedTricks.push('HANDBRAKEY');
                }
                console.log(`[HANDBRAKE] Buffered ${seconds} handbrakey tricks`);
            } else {
                console.log(`[HANDBRAKE] Released too early (${duration}ms < ${this.handbrakeMinDuration}ms)`);
            }
            
            this.updateTrickComboDisplay(); // Update display
            // Don't return - let it clean up if needed
        }
        
        // Only track handbrake during drift
        if (!this.isDrifting) {
            // Clean up if not drifting
            if (this.activeTricks.has('HANDBRAKEY')) {
                this.activeTricks.delete('HANDBRAKEY');
                this.updateTrickComboDisplay();
            }
            return;
        }
        
        // Handbrake just pressed - START TRICK
        if (brakeInput && !wasActive) {
            this.handbrakeStartTime = now;
            this.activeTricks.set('HANDBRAKEY', 0); // Start at 0 seconds
            this.updateTrickComboDisplay(); // AC1: Show trick started
            console.log(`[HANDBRAKE] Started`);
        }
        
        // Handbrake held - UPDATE TRICK
        if (brakeInput && wasActive) {
            const duration = now - this.handbrakeStartTime;
            const seconds = Math.floor(duration / 1000);
            this.activeTricks.set('HANDBRAKEY', seconds); // AC2: Update live value
            this.updateTrickComboDisplay(); // Update display in real-time
        }
    }

    /**
     * Checks for nitro trick - NEW STANDARDIZED SYSTEM
     */
    private checkNitro(boostActive: boolean) {
        const now = this.time.now;
        const wasActive = this.activeTricks.has('NITROX_BABY');
        
        // Nitro deactivated - COMPLETE TRICK
        if (!boostActive && wasActive) {
            const duration = now - this.nitroStartTime;
            this.activeTricks.delete('NITROX_BABY'); // Remove from active
            
            // Only buffer if held long enough
            if (duration >= this.nitroMinDuration) {
                const seconds = Math.floor(duration / 1000);
                // Add completed instances to buffer
                for (let i = 0; i < seconds; i++) {
                    this.bufferedTricks.push('NITROX_BABY');
                }
                console.log(`[NITRO] Buffered ${seconds} nitrox baby tricks`);
                
                // Show score popup immediately for instant feedback
                const hx = this.headSprite.x;
                const hy = this.headSprite.y;
                this.showScorePopup(hx, hy - 40, seconds * this.TRICKS.NITROX_BABY.baseScore);
                
                // Execute tricks immediately (not waiting for drift to end)
                for (let i = 0; i < seconds; i++) {
                    this.executeTrick('NITROX_BABY');
                }
                // Clear from buffer since we just executed them
                const nitroCount = this.bufferedTricks.filter(t => t === 'NITROX_BABY').length;
                this.bufferedTricks = this.bufferedTricks.filter(t => t !== 'NITROX_BABY');
                
                // Play trick sound
                this.playTrickSound();
            } else {
                console.log(`[NITRO] Released too early (${duration}ms < ${this.nitroMinDuration}ms)`);
            }
            
            this.updateTrickComboDisplay(); // Update display
            return;
        }
        
        // Nitro just activated - START TRICK
        if (boostActive && !wasActive) {
            this.nitroStartTime = now;
            this.activeTricks.set('NITROX_BABY', 0); // Start at 0 seconds
            console.log(`[NITRO] Started - activeTricks size: ${this.activeTricks.size}`);
            this.updateTrickComboDisplay(); // AC1: Show trick started
        }
        
        // Nitro held - UPDATE TRICK
        if (boostActive && wasActive) {
            const duration = now - this.nitroStartTime;
            const seconds = Math.floor(duration / 1000);
            this.activeTricks.set('NITROX_BABY', seconds); // AC2: Update live value
            this.updateTrickComboDisplay(); // Update display in real-time
        }
    }

    /**
     * Updates the trick combo display - NEW STANDARDIZED SYSTEM
     * Shows BOTH active (in-progress) and buffered (completed) tricks
     */
    private updateTrickComboDisplay() {
        const hasActiveTricks = this.activeTricks.size > 0;
        const hasBufferedTricks = this.bufferedTricks.length > 0;
        
        // AC1/AC2: Hide if no tricks at all
        if (!hasActiveTricks && !hasBufferedTricks) {
            this.trickComboText.setVisible(false);
            return;
        }

        const trickNames: string[] = [];
        let totalScore = 0;

        // Add buffered (completed) tricks first
        for (const trickKey of this.bufferedTricks) {
            const trick = this.TRICKS[trickKey];
            if (!trick) continue;
            
            trickNames.push(trick.name);
            totalScore += trick.baseScore; // Just base score, no multiplier
        }

        // Add active (in-progress) tricks - with live values
        for (const [trickKey, value] of this.activeTricks) {
            const trick = this.TRICKS[trickKey];
            if (!trick) continue;

            // For duration-based tricks (Handbrakey, Nitrox Baby), show seconds
            // For count-based tricks (Near Miss), show count
            // For instant tricks (Cappy Crash), show once
            if (trickKey === 'HANDBRAKEY' || trickKey === 'NITROX_BABY') {
                // Show each second as a separate instance
                for (let i = 0; i < value; i++) {
                    trickNames.push(trick.name);
                    totalScore += trick.baseScore; // Just base score
                }
                // Add "..." to show it's still going
                if (value > 0) {
                    trickNames[trickNames.length - 1] += '...';
                }
            } else if (trickKey === 'NEAR_MISS') {
                // Show as "Near Miss (active)" or similar
                trickNames.push(`${trick.name}...`);
                // Don't count score until completed
            } else if (trickKey === 'CAPPY_CRASH') {
                // Show as "Cappy Crash!" - instant trick
                trickNames.push(trick.name + '!');
                totalScore += trick.baseScore;
            }
        }

        // Build display string
        const comboString = trickNames.join(' + ');
        this.trickComboText.setText(`${comboString}\n${totalScore} pts`);
        this.trickComboText.setVisible(true);
    }

    /**
     * Updates drift state based on tire mark intensity
     */
    private updateDriftState() {
        // Player is drifting when tire marks are visible
        const wasDrifting = this.isDrifting;
        this.isDrifting = this.tireMarkIntensity > 0.2; // Lowered from 0.3 for easier drift detection

        // When drift starts, clear the crash flag and show empty combo
        if (!wasDrifting && this.isDrifting) {
            this.crashedDuringDrift = false;
            this.trickComboText.setVisible(false);
        }

        // Drift state change detection only - finalization happens later
        if (wasDrifting && !this.isDrifting) {
            // Small delay before resetting combo
            this.time.delayedCall(this.trickComboWindow, () => {
                if (!this.isDrifting) {
                    this.currentComboMultiplier = 1;
                }
            });
        }
    }

    /**
     * Finalizes trick session - called AFTER all trick updates
     * This ensures active tricks have been moved to buffered
     */
    private finalizeTrickSession() {
        // Only finalize if not currently drifting and we have buffered tricks
        if (this.isDrifting) return;
        if (this.bufferedTricks.length === 0) return;
        
        // Check if there are still active tricks in progress
        const hasActiveTricks = this.activeTricks.size > 0;
        
        // AC3: Only finalize if NO active tricks remain
        if (hasActiveTricks) return; // Still tricks in progress, wait
        
        // Finalize the trick session
        if (!this.crashedDuringDrift) {
            // SUCCESS - Award tricks and show celebration
            let totalScore = 0;
            for (const trickKey of this.bufferedTricks) {
                this.executeTrick(trickKey);
                const trick = this.TRICKS[trickKey];
                if (trick) {
                    totalScore += trick.baseScore;
                }
            }
            
            // Show score popup above car
            if (totalScore > 0) {
                const hx = this.headSprite.x;
                const hy = this.headSprite.y;
                this.showScorePopup(hx, hy - 40, totalScore);
            }
            
            // Play success sound
            this.playTrickSound();
            
            // Animate "TRICK SCORED!" upward - stay visible for 1.5s first
            this.trickComboText.setColor('#44ff44'); // Green for success
            this.tweens.add({
                targets: this.trickComboText,
                y: this.height - 200,
                alpha: 0,
                duration: 1000,
                delay: 1500, // Stay visible for 1.5 seconds before animating away
                ease: 'Quad.easeOut',
                onComplete: () => {
                    this.trickComboText.setAlpha(1);
                    this.trickComboText.setY(this.height - 100);
                    this.trickComboText.setVisible(false);
                    this.trickComboText.setColor('#ffdd00'); // Reset to yellow
                }
            });
        } else {
            // AC4: FAILED - Show failure animation - stay visible for 1.5s first
            this.trickComboText.setColor('#ff4444'); // Red for failure
            this.tweens.add({
                targets: this.trickComboText,
                y: this.height + 50,
                alpha: 0,
                duration: 500,
                delay: 1500, // Stay visible for 1.5 seconds before animating away
                ease: 'Quad.easeIn',
                onComplete: () => {
                    this.trickComboText.setAlpha(1);
                    this.trickComboText.setY(this.height - 100);
                    this.trickComboText.setVisible(false);
                    this.trickComboText.setColor('#ffdd00'); // Reset to yellow
                }
            });
        }
        
        // Clear the buffer for next drift session
        this.bufferedTricks = [];
        this.crashedDuringDrift = false;
        this.activeTricks.clear(); // Clear any lingering active tricks
    }

    /**
     * Updates the score details debug display
     */
    private updateScoreDetailsDisplay() {
        // Determine trick status
        let status = 'NOT STARTED';
        let statusColor = '#888888';
        
        const hasActiveTricks = this.activeTricks.size > 0;
        const hasBufferedTricks = this.bufferedTricks.length > 0;
        
        if (this.crashedDuringDrift) {
            status = 'FAILED';
            statusColor = '#ff4444';
        } else if (hasActiveTricks || hasBufferedTricks) {
            status = 'IN PROGRESS';
            statusColor = '#ffdd00';
        } else if (this.trickHistory.length > 0 && this.time.now - this.lastTrickTime < 3000) {
            // Recently completed a trick
            status = 'SUCCESS';
            statusColor = '#44ff44';
        }
        
        // Build details string
        const lines = [
            `STATUS: ${status}`,
            ``,
            `Drifting: ${this.isDrifting ? 'YES' : 'NO'}`,
            `Crashed: ${this.crashedDuringDrift ? 'YES' : 'NO'}`,
            `Active Tricks: ${this.activeTricks.size}`,
            `Buffered Tricks: ${this.bufferedTricks.length}`,
            `Combo Multiplier: ${this.currentComboMultiplier.toFixed(1)}x`,
            ``,
            `Finalize Blocked:`,
            `  Still Drifting: ${this.isDrifting ? 'YES' : 'NO'}`,
            `  No Buffered: ${this.bufferedTricks.length === 0 ? 'YES' : 'NO'}`,
            `  Has Active: ${this.activeTricks.size > 0 ? 'YES' : 'NO'}`,
            ``,
            `Total Tricks: ${this.trickHistory.length}`,
            `Total Score: ${this.score}`,
        ];
        
        // Add active trick details
        if (hasActiveTricks) {
            lines.push(``);
            lines.push(`ACTIVE:`);
            for (const [trickKey, value] of this.activeTricks) {
                const trick = this.TRICKS[trickKey];
                if (trick) {
                    lines.push(`  ${trick.name}: ${value}`);
                }
            }
        }
        
        // Add buffered trick details
        if (hasBufferedTricks) {
            lines.push(``);
            lines.push(`BUFFERED:`);
            const trickCounts = new Map<string, number>();
            for (const trickKey of this.bufferedTricks) {
                trickCounts.set(trickKey, (trickCounts.get(trickKey) || 0) + 1);
            }
            for (const [trickKey, count] of trickCounts) {
                const trick = this.TRICKS[trickKey];
                if (trick) {
                    lines.push(`  ${trick.name} x${count}`);
                }
            }
        }
        
        this.scoreDetailsText.setText(lines.join('\n'));
        this.scoreDetailsText.setColor(statusColor);
    }

    // ========== SCENERY SPAWNING ==========

    /**
     * Spawns collision obstacles (rocks, debris, etc.)
     * These block the car and cause crashes
     */
    private spawnObstacles(existingPositions: { x: number, y: number }[] = []) {
        // Configuration
        const config = {
            count: 9,                    // Number of obstacles to spawn
            minSpacing: 145,             // Minimum distance between obstacles
            marginFromEdge: 100,         // Keep away from screen edges
            textureRange: { min: 53, max: 60 }, // Tile range for random selection
            texturePrefix: 'tile_',
            scale: 2.75,                 // Visual size
            shadowScale: 3,
            shadowOffset: { x: -5, y: 5 },
            shadowAngle: 130,
            depth: 5,
            maxAttempts: 20
        };

        const positions: { x: number, y: number }[] = [...existingPositions];

        for (let i = 0; i < config.count; i++) {
            const pos = this.findValidSpawnPosition(
                positions,
                config.minSpacing,
                config.marginFromEdge,
                config.maxAttempts
            );

            if (!pos) continue; // Skip if no valid position found
            positions.push(pos);

            // Random obstacle texture
            const textureNum = Phaser.Math.Between(config.textureRange.min, config.textureRange.max);
            const textureName = `${config.texturePrefix}${String(textureNum).padStart(3, '0')}`;

            // Create shadow
            const shadow = this.createStaticShadow(
                pos.x, pos.y, textureName,
                config.shadowScale,
                config.shadowOffset.x,
                config.shadowOffset.y,
                config.depth
            );
            shadow.angle = config.shadowAngle;

            // Create obstacle with physics
            const obstacle = this.physics.add.image(pos.x, pos.y, textureName);
            obstacle.setOrigin(0.5, 0.5);
            obstacle.setScale(config.scale);
            obstacle.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
            obstacle.setDepth(config.depth);
            obstacle.setImmovable(true);
            obstacle.body.allowGravity = false;

            this.decorations.push(obstacle);
        }

        return positions; // Return for use by decorative scenery
    }

    /**
     * Spawns decorative scenery (cacti, plants, etc.)
     * These are visual only - car drives through them
     */
    private spawnDecorativeScenery(avoidPositions: { x: number, y: number }[] = []) {
        // Configuration
        const config = {
            count: 25,                    // Number of decorative items
            minSpacingFromObstacles: 15, // Stay away from collision obstacles
            marginFromEdge: 25,
            textureRange: { min: 1, max: 7 }, // tree-1 through tree-7
            texturePrefix: 'tree-',
            scale: 0.6,                 // Much smaller than obstacles
            shadowScale: 0.6,
            shadowOffset: { x: -8, y: 15 },
            shadowAngle: 130,
            shadowFlipX: true,
            depth: 1,                    // Same depth as obstacles for proper layering
            maxAttempts: 20
        };

        for (let i = 0; i < config.count; i++) {
            const pos = this.findValidSpawnPosition(
                avoidPositions,
                config.minSpacingFromObstacles,
                config.marginFromEdge,
                config.maxAttempts
            );

            if (!pos) continue;

            // Random decorative texture
            const textureNum = Phaser.Math.Between(config.textureRange.min, config.textureRange.max);
            const textureName = `${config.texturePrefix}${textureNum}`;

            // Create shadow
            const shadow = this.createStaticShadow(
                pos.x, pos.y, textureName,
                config.shadowScale,
                config.shadowOffset.x,
                config.shadowOffset.y,
                config.depth - 1 // Slightly behind the sprite
            );
            shadow.angle = config.shadowAngle;
            shadow.setFlipX(config.shadowFlipX);

            // Create decorative item (no physics!)
            const decorative = this.add.image(pos.x, pos.y, textureName);
            decorative.setOrigin(0.5, 0.5);
            decorative.setScale(config.scale);
            decorative.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
            decorative.setDepth(config.depth);
        }
    }

    /**
     * Finds a valid spawn position that doesn't overlap with existing positions
     * Returns null if no valid position found after maxAttempts
     */
    private findValidSpawnPosition(
        existingPositions: { x: number, y: number }[],
        minSpacing: number,
        marginFromEdge: number,
        maxAttempts: number
    ): { x: number, y: number } | null {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const x = Phaser.Math.Between(marginFromEdge, this.width - marginFromEdge);
            const y = Phaser.Math.Between(marginFromEdge, this.height - marginFromEdge);

            // Check if position is far enough from all existing positions
            let valid = true;
            for (const pos of existingPositions) {
                const distance = Phaser.Math.Distance.Between(x, y, pos.x, pos.y);
                if (distance < minSpacing) {
                    valid = false;
                    break;
                }
            }

            if (valid) return { x, y };
        }

        return null; // No valid position found
    }

    // ========== SCENE BUILDING ==========

    private buildIsometricBackground() {
        const tileWidth = 36 * 1;  // Width of the isometric tile diamond
        const tileHeight = 16 * 1; // Height of the isometric tile diamond

        // Calculate how many tiles we need
        const cols = Math.ceil(this.width / (tileWidth / 2)) + 4;
        const rows = Math.ceil(this.height / (tileHeight / 2)) + 4;

        // Create isometric grid - BASE LAYER
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // Random tile from 0-10
                const tileNum = Phaser.Math.Between(0, 10);
                const tileName = `tile_${String(tileNum).padStart(3, '0')}`;

                // Isometric position calculation
                const x = (col - row) * (tileWidth);
                const y = (col + row) * (tileHeight);

                const tile = this.add.image(x + this.width / 2, y - this.height / 2, tileName);
                tile.setOrigin(0.5, 0.5);
                tile.setScale(2);
                tile.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
                tile.setDepth(0);
            }
        }

        // SCENERY GENERATION
        // Spawn obstacles first (they have collision)
        const obstaclePositions = this.spawnObstacles();

        // Spawn decorative scenery (avoiding obstacles)
        this.spawnDecorativeScenery(obstaclePositions);
    }

    create() {
        //set sound and theme
        // Stop and destroy any existing music before creating new instance
        if (this.music) {
            console.log('[MUSIC] Destroying existing music instance');
            if (this.music.isPlaying) {
                this.music.stop();
            }
            this.music.destroy();
        }
        
        console.log('[MUSIC] Creating new music instance');
        this.music = this.sound.add('theme2', { loop: true });
        this.collectSound = this.sound.add('collect-1');
        this.crashSound1 = this.sound.add('crash-1');
        this.crashSound2 = this.sound.add('crash-2');
        this.crashSound3 = this.sound.add('crash-3');
        this.trickSound = this.sound.add('trick');
        
        // Play music
        console.log('[MUSIC] Playing music');
        this.music.play({ volume: this.musicVolume });
        
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

        // Handbrake smoke emitters — one per rear tyre, rising lingering smoke
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

        this.brakeSmokeEmitterLeft = this.add.particles(0, 0, 'flame_dot', { ...brakeSmokeConfig });
        this.brakeSmokeEmitterLeft.setDepth(3);

        this.brakeSmokeEmitterRight = this.add.particles(0, 0, 'flame_dot', { ...brakeSmokeConfig });
        this.brakeSmokeEmitterRight.setDepth(3);

        // Create car shadow using helper
        this.carShadow = this.createDynamicShadow(0, 0, 'car_000', 3);

        this.carSprite = this.add.image(0, 0, 'car_000').setDepth(4);

        // Create pickup shadow using helper
        this.pickupShadow = this.createDynamicShadow(0, 0, 'trophy', 3);
        this.pickupShadow.setDisplaySize(37, 55);

        this.pickupSprite = this.add.image(0, 0, 'trophy').setDepth(4);
        this.pickupSprite.setDisplaySize(37, 55); // Total ~15% bigger than original 32x47

        // UI — Score
        this.scoreText = this.add.text(16, 16, 'Score: 0', {
            fontFamily: 'Arial Black',
            fontSize: 24,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4,
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

        // Trick threshold visualization graphics (for debug)
        this.trickThresholdGraphics = this.add.graphics().setDepth(6); // Above obstacles but below car

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
            fontSize: 52,
            color: '#ff3366',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center',
        }).setOrigin(0.5).setVisible(false).setScrollFactor(0).setDepth(10);

        // Trick combo display at bottom center (Tony Hawk style)
        this.trickComboText = this.add.text(this.width / 2, this.height - 100, '', {
            fontFamily: 'Arial Black',
            fontSize: 20,
            color: '#ffdd00',
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center',
        }).setOrigin(0.5).setVisible(false).setScrollFactor(0).setDepth(15);

        // Score details debug display (top right)
        this.scoreDetailsText = this.add.text(this.width - 10, 70, '', {
            fontFamily: 'Courier',
            fontSize: 14,
            color: '#00ff00',
            backgroundColor: '#000000aa',
            padding: { x: 8, y: 6 },
            align: 'left',
        }).setOrigin(1, 0).setVisible(false).setScrollFactor(0).setDepth(20);

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
        // CRITICAL: Destroy old SoundManager to prevent overlapping audio instances
        if (this.soundManager) {
            console.log('[SOUND] Destroying old SoundManager');
            this.soundManager.destroy();
        }
        
        console.log('[SOUND] Creating new SoundManager');
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

        this.soundManager.addLayer('nitro', 'nitro_sfx', {
            loop: true,
            maxVolume: 0.7,
            fadeIn: 6,
            fadeOut: 12,
            seekStart: 0,
        });

        // Initialize car position and physics
        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        body.setCollideWorldBounds(false); // Re-enabled: car bounces off walls
        body.setBounce(0.3, 0.3); // Increased bounce to prevent sticking
        body.setMaxVelocity(this.boostMaxSpeed, this.boostMaxSpeed);
        body.setDamping(true);
        body.setDrag(this.drag, this.drag);

        // Add collision callback for crunchy crash feedback
        this.physics.add.collider(this.headSprite, this.decorations, (car: any, obstacle: any) => {
            // Only apply slowdown once per cooldown period
            const now = this.time.now;
            if (now - this.lastCollisionTime < this.collisionCooldown) {
                return; // Still in cooldown, ignore this collision
            }
            this.lastCollisionTime = now;
            
            // Mark this obstacle as recently collided (prevents near-miss on collision)
            const obstacleSprite = obstacle as Phaser.Physics.Arcade.Image;
            this.recentlyCollidedObstacles.add(obstacleSprite);
            this.nearMissTracking.delete(obstacleSprite); // Clear any near miss tracking
            
            // AC4: FAIL CONDITION - crashed during trick session
            if (this.isDrifting) {
                this.crashedDuringDrift = true;
                // Clear ALL tricks - both active and buffered
                this.bufferedTricks = [];
                this.activeTricks.clear();
                // Update combo display to show failure
                this.updateTrickComboDisplay();
            }
            
            // Clear the collision flag after 1 second
            this.time.delayedCall(1000, () => {
                this.recentlyCollidedObstacles.delete(obstacleSprite);
            });

            // Capture speed before impact for sound selection
            const speedAtImpact = Math.abs(this.currentSpeed);

            // DRAMATIC speed loss for crunchy crash feel
            this.currentSpeed *= 0.2; // Lose 80% of speed

            // Calculate bounce direction (away from obstacle)
            const carBody = this.headSprite.body as Phaser.Physics.Arcade.Body;

            const dx = this.headSprite.x - obstacleSprite.x;
            const dy = this.headSprite.y - obstacleSprite.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 0) {
                // Normalize direction
                const dirX = dx / distance;
                const dirY = dy / distance;

                // Variable bounce force based on speed - higher bounce at low speeds
                let bounceForce;
                if (speedAtImpact < 75) {
                    bounceForce = 320; // Strong bounce at very low speeds
                } else if (speedAtImpact < 175) {
                    bounceForce = 280; // Good bounce at low-medium speeds
                } else if (speedAtImpact < 275) {
                    bounceForce = 250; // Standard bounce at medium speeds
                } else {
                    bounceForce = 230; // Slightly reduced bounce at high speeds
                }

                carBody.setVelocity(dirX * bounceForce, dirY * bounceForce);
            }

            // Play crash sound based on impact speed
            // Low speed (0-100): crash-1
            // Medium speed (100-200): crash-2
            // High speed (200+): crash-3
            if (speedAtImpact < 200) {
                this.crashSound1.play({ volume: 0.5 });
            } else if (speedAtImpact < 300) {
                this.crashSound2.play({ volume: 0.6 });
            } else {
                this.crashSound3.play({ volume: 0.7 });
            }
        });

        // Find safe spawn position away from obstacles
        let carX = this.width / 2;
        let carY = this.height / 2;
        const minDistanceFromObstacles = 100;
        let attempts = 0;
        let validPosition = false;

        while (!validPosition && attempts < 50) {
            validPosition = true;
            for (const obstacle of this.decorations) {
                const dist = Phaser.Math.Distance.Between(carX, carY, obstacle.x, obstacle.y);
                if (dist < minDistanceFromObstacles) {
                    validPosition = false;
                    // Try a new random position
                    carX = 100 + Math.random() * (this.width - 200);
                    carY = 100 + Math.random() * (this.height - 200);
                    break;
                }
            }
            attempts++;
        }

        this.headSprite.setPosition(carX, carY);
        this.headAngle = 0;

        // Delay first pickup spawn
        this.time.delayedCall(1000, () => {
            this.spawnPickup();
        });
    }

    private buildDebugModal() {
        const modalW = 280;
        const modalH = 570; // Increased from 530 to fit score details button
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
            if (this.music) {
                if (this.musicMuted) {
                    (this.music as Phaser.Sound.WebAudioSound).setVolume(0);
                    musicBtn.setText('\u266B Music: OFF');
                } else {
                    (this.music as Phaser.Sound.WebAudioSound).setVolume(this.musicVolume);
                    musicBtn.setText('\u266B Music: ON');
                }
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

        const boundsBtn = this.add.text(this.width / 2, cy, 'Screen Bounce: ON', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        boundsBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
            const currentState = body.collideWorldBounds;
            body.setCollideWorldBounds(!currentState);
            if (!currentState) {
                boundsBtn.setText('Screen Bounce: ON');
            } else {
                boundsBtn.setText('Screen Bounce: OFF');
            }
        });
        this.debugModalContainer.add(boundsBtn);

        cy += rowH + 4;

        const hitboxBtn = this.add.text(this.width / 2, cy, 'Show Hitboxes: OFF', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        hitboxBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            if (this.physics.world.debugGraphic) {
                // Disable debug graphics
                this.physics.world.debugGraphic.clear();
                this.physics.world.debugGraphic.destroy();
                this.physics.world.debugGraphic = null as any;
                hitboxBtn.setText('Show Hitboxes: OFF');
            } else {
                // Enable debug graphics
                this.physics.world.createDebugGraphic();
                hitboxBtn.setText('Show Hitboxes: ON');
            }
        });
        this.debugModalContainer.add(hitboxBtn);

        cy += rowH + 4;

        const thresholdBtn = this.add.text(this.width / 2, cy, 'Trick Threshold: OFF', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        thresholdBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.showTrickThreshold = !this.showTrickThreshold;
            if (this.showTrickThreshold) {
                thresholdBtn.setText('Trick Threshold: ON');
            } else {
                thresholdBtn.setText('Trick Threshold: OFF');
                this.trickThresholdGraphics.clear(); // Clear when disabled
            }
        });
        this.debugModalContainer.add(thresholdBtn);

        cy += rowH + 4;

        const scoreDetailsBtn = this.add.text(this.width / 2, cy, 'Score Details: OFF', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        scoreDetailsBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.showScoreDetails = !this.showScoreDetails;
            if (this.showScoreDetails) {
                scoreDetailsBtn.setText('Score Details: ON');
                this.scoreDetailsText.setVisible(true);
            } else {
                scoreDetailsBtn.setText('Score Details: OFF');
                this.scoreDetailsText.setVisible(false);
            }
        });
        this.debugModalContainer.add(scoreDetailsBtn);

        cy += rowH + 4;

        const collisionBtn = this.add.text(this.width / 2, cy, 'Collisions: ON', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        collisionBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            const colliders = this.physics.world.colliders.getActive();
            if (colliders.length > 0 && colliders[0].active) {
                // Disable all collisions
                colliders.forEach((collider: any) => {
                    collider.active = false;
                });
                collisionBtn.setText('Collisions: OFF');
            } else {
                // Enable all collisions
                colliders.forEach((collider: any) => {
                    collider.active = true;
                });
                collisionBtn.setText('Collisions: ON');
            }
        });
        this.debugModalContainer.add(collisionBtn);

        cy += rowH + 4;

        const endRunBtn = this.add.text(this.width / 2, cy, 'End Run', {
            ...btnStyle, backgroundColor: '#aa3333', padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        endRunBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            if (!this.gameOver) {
                this.toggleDebugModal();
                this.timeRemaining = 0;
                this.endGame();
            }
        });
        this.debugModalContainer.add(endRunBtn);

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

        // Reset trick system
        this.trickHistory = [];
        this.currentComboMultiplier = 1;
        this.lastTrickTime = 0;
        this.isDrifting = false;
        this.nearMissTracking.clear();
        this.recentlyCollidedObstacles.clear();
        this.activeTricks.clear();
        this.bufferedTricks = [];
        this.crashedDuringDrift = false;
        this.handbrakeStartTime = 0;
        this.nitroStartTime = 0;

        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;

        // Find safe spawn position away from obstacles
        let carX = this.width / 2;
        let carY = this.height / 2;
        const minDistanceFromObstacles = 100;
        let attempts = 0;
        let validPosition = false;

        while (!validPosition && attempts < 50) {
            validPosition = true;
            for (const obstacle of this.decorations) {
                const dist = Phaser.Math.Distance.Between(carX, carY, obstacle.x, obstacle.y);
                if (dist < minDistanceFromObstacles) {
                    validPosition = false;
                    // Try a new random position
                    carX = 100 + Math.random() * (this.width - 200);
                    carY = 100 + Math.random() * (this.height - 200);
                    break;
                }
            }
            attempts++;
        }

        this.headSprite.setPosition(carX, carY);
        body.reset(carX, carY);
        body.setVelocity(0, 0);
        body.setMaxSpeed(this.maxSpeed);
        body.setDrag(0, 0);
        this.currentSpeed = this.minSpeed;

        this.tireEmitterLeft.killAll();
        this.tireEmitterRight.killAll();
        this.boostFlameEmitter.killAll();
        this.boostSmokeEmitter.killAll();
        this.brakeSmokeEmitterLeft.killAll();
        this.brakeSmokeEmitterRight.killAll();

        // Delay pickup spawn until car lands
        this.time.delayedCall(1000, () => {
            this.spawnPickup();
        });

        this.gameOverText.setVisible(false);
        if (this.timerText) this.timerText.setVisible(true);
        if (this.finalScoreText) { this.finalScoreText.destroy(); this.finalScoreText = undefined; }
        if (this.playAgainBtn) { this.playAgainBtn.destroy(); this.playAgainBtn = undefined; }

        // Restore music volume after game-over fade
        if (this.music && !this.musicMuted) {
            this.tweens.killTweensOf(this.music);
            (this.music as Phaser.Sound.WebAudioSound).setVolume(this.musicVolume);
        }
    }

    private spawnPickup() {
        const margin = 40;
        const minDistanceFromObstacles = 100; // Trophy won't spawn within this distance of obstacles
        let attempts = 0;
        let validPosition = false;

        // Try to find a valid position away from obstacles
        while (!validPosition && attempts < 50) {
            this.pickupX = margin + Math.random() * (this.width - 2 * margin);
            this.pickupY = margin + Math.random() * (this.height - 2 * margin);

            // Check distance from all obstacles
            validPosition = true;
            for (const obstacle of this.decorations) {
                const dist = Phaser.Math.Distance.Between(
                    this.pickupX,
                    this.pickupY,
                    obstacle.x,
                    obstacle.y
                );

                if (dist < minDistanceFromObstacles) {
                    validPosition = false;
                    break;
                }
            }

            attempts++;
        }

        // If we couldn't find a valid position after 50 tries, just use the last position
        // (Better than infinite loop)

        const dropHeight = 40;
        const dropDuration = 450;
        const bounceDuration = 130;
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
            this.pickupShadow.setPosition(this.pickupX - 4, this.pickupY + 7); // Same offset as car
            this.pickupShadow.angle = 130; // Same angle as car/decorations
            this.pickupShadow.setAlpha(0);
            this.pickupShadow.setFlipX(true)
            this.tweens.add({
                targets: this.pickupShadow,
                alpha: 0.55, // Match the alpha we set in creation
                duration: dropDuration,
                ease: 'Linear',
            });
        }
    }

    private tryRestart() {
        // Full page reload to completely clean up all state
        console.log('[GAME] Full reload initiated');
        window.location.reload();
    }

    update(_time: number, delta: number) {
        const dt = delta / 1000;

        // --- Game-over coasting: car rolls to a stop, sprite keeps updating ---
        if (this.gameOver) {
            const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
            const coastDamp = 1 - 1.5 * dt;
            body.velocity.x *= Math.max(coastDamp, 0);
            body.velocity.y *= Math.max(coastDamp, 0);
            if (body.speed < 2) { body.setVelocity(0, 0); body.setAcceleration(0, 0); }

            this.physics.world.wrap(this.headSprite, 0);
            const hx = this.headSprite.x;
            const hy = this.headSprite.y;
            let angleDeg = (this.headAngle * 180 / Math.PI) % 360;
            if (angleDeg < 0) angleDeg += 360;
            const frameIndex = Math.round(angleDeg / (360 / this.totalCarFrames)) % this.totalCarFrames;
            const frameKey = `car_${String(frameIndex).padStart(3, '0')}`;
            this.carSprite.setTexture(frameKey);
            this.carSprite.setPosition(hx, hy);
            this.carShadow.setTexture(frameKey);
            this.carShadow.setScale(0.95, 1);
            this.carShadow.setPosition(hx + 4, hy + 58); // Match normal gameplay shadow
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
        let reverseInput = false;
        if (keyboard) {
            const left = keyboard.addKey('LEFT', false, false);
            const right = keyboard.addKey('RIGHT', false, false);
            const up = keyboard.addKey('UP', false, false);
            const down = keyboard.addKey('DOWN', false, false);
            const a = keyboard.addKey('A', false, false);
            const d = keyboard.addKey('D', false, false);
            const w = keyboard.addKey('W', false, false);
            const s = keyboard.addKey('S', false, false);
            const shift = keyboard.addKey('SHIFT', false, false);
            const space = keyboard.addKey('SPACE', false, false);
            if (left.isDown || a.isDown) turnInput -= 1;
            if (right.isDown || d.isDown) turnInput += 1;
            if (up.isDown || w.isDown) this.isAccelerating = true;
            else this.isAccelerating = false;
            if (down.isDown || s.isDown) reverseInput = true;
            if (shift.isDown) thrustInput = true;
            if (space.isDown) brakeInput = true;
        }

        // --- REVERSE - Only works when completely stopped ---
        if (reverseInput && this.currentSpeed <= 0) {
            // Stopped - allow reversing
            this.currentSpeed = Math.max(this.currentSpeed - this.reverseAccel * dt * 60, this.maxReverseSpeed);

            const facingX = Math.cos(this.headAngle);
            const facingY = Math.sin(this.headAngle);

            // Directly set velocity to reverse
            body.setVelocity(facingX * this.currentSpeed, facingY * this.currentSpeed);
            body.setAcceleration(0, 0);

            // Allow steering while reversing - but much slower/wider turns
            if (turnInput !== 0) {
                const speedFactor = Math.abs(this.currentSpeed) / this.maxSpeed;
                // Drastically reduce turn rate for wide turning circle
                const adjustedTurnRate = this.targetAngularVel * 0.25; // Much slower than forward
                // Very slow turning response
                this.angularVel += (turnInput * adjustedTurnRate - this.angularVel) * 0.05;
            } else {
                this.angularVel *= 0.95; // Damping
            }

            this.headAngle += this.angularVel * dt;

            // Update visual position
            const hx = this.headSprite.x;
            const hy = this.headSprite.y;

            let angleDeg = (this.headAngle * 180 / Math.PI) % 360;
            if (angleDeg < 0) angleDeg += 360;
            const frameIndex = Math.round(angleDeg / (360 / this.totalCarFrames)) % this.totalCarFrames;
            const frameKey = `car_${String(frameIndex).padStart(3, '0')}`;
            this.carSprite.setTexture(frameKey);
            this.carSprite.setPosition(hx, hy);
            this.carShadow.setTexture(frameKey);
            this.carShadow.setScale(0.95, 1);
            this.carShadow.setPosition(hx + 4, hy + 58);

            this.soundManager.update(dt);
            return; // Only skip physics when actually reversing
        }

        // Coast to stop if just released reverse - VERY slow deceleration
        if (this.currentSpeed < 0) {
            // Much slower coast - only 0.5x the reverse accel rate
            this.currentSpeed = Math.min(this.currentSpeed + this.reverseAccel * 0.5 * dt * 60, 0);

            const facingX = Math.cos(this.headAngle);
            const facingY = Math.sin(this.headAngle);
            body.setVelocity(facingX * this.currentSpeed, facingY * this.currentSpeed);
            body.setAcceleration(0, 0);

            // Update visuals during coast
            const hx = this.headSprite.x;
            const hy = this.headSprite.y;

            let angleDeg = (this.headAngle * 180 / Math.PI) % 360;
            if (angleDeg < 0) angleDeg += 360;
            const frameIndex = Math.round(angleDeg / (360 / this.totalCarFrames)) % this.totalCarFrames;
            const frameKey = `car_${String(frameIndex).padStart(3, '0')}`;
            this.carSprite.setTexture(frameKey);
            this.carSprite.setPosition(hx, hy);
            this.carShadow.setTexture(frameKey);
            this.carShadow.setScale(0.95, 1);
            this.carShadow.setPosition(hx + 4, hy + 58);

            this.soundManager.update(dt);
            return; // Skip normal physics during coast
        }

        // --- Smooth steering (speed-dependent) ---
        const speedRatio = Math.min(body.speed / this.maxSpeed, 1);
        const steerScale = this.minSteerFraction + (1 - this.minSteerFraction) * speedRatio;

        // Speed-based steering adjustment - slower at low speeds, faster at high speeds
        const speedFactor = this.currentSpeed / this.maxSpeed;
        const adjustedTurnRate = this.targetAngularVel * (0.6 + 0.4 * speedFactor);

        const targetAV = turnInput * adjustedTurnRate * steerScale;
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

        // Slight rotation damping to prevent excessive spinning
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
            // At very low speeds (including reverse start), directly set velocity
            body.velocity.x = facingX * this.currentSpeed;
            body.velocity.y = facingY * this.currentSpeed;
        }

        // --- Acceleration / Deceleration ---
        if (this.isAccelerating) {
            // Non-linear acceleration - smooth ramp up with gradual tapering
            const speedRatio = this.currentSpeed / this.maxSpeed;
            // Smoother curve - acceleration falls off more gradually
            const accelCurve = 1.0 - (speedRatio * speedRatio * 0.7); // Increased from 0.6 to 0.7 for slightly longer ramp
            const effectiveAccel = this.acceleration * accelCurve;
            this.currentSpeed = Math.min(this.currentSpeed + effectiveAccel * dt * 60, this.maxSpeed);
        } else {
            // No input - coast to zero
            if (this.currentSpeed > 0) {
                // Moving forward - slow down
                const momentum = this.currentSpeed * this.decelMomentumFactor;
                const decelRate = Math.max(this.decelBase - momentum, 0.3);
                this.currentSpeed = Math.max(this.currentSpeed - decelRate * dt * 60, 0);
            } else if (this.currentSpeed < 0) {
                // Moving backward - slow down toward zero
                this.currentSpeed = Math.min(this.currentSpeed + this.reverseAccel * 2 * dt * 60, 0);
            }
        }

        // --- Thrust / Handbrake ---
        const brakeMinSpeed = this.minSpeed * 0.4;

        if (brakeInput) {
            // Enhanced drift turning during handbrake
            const driftTurnBoost = 2.0;
            if (turnInput !== 0) {
                this.angularVel += turnInput * driftTurnBoost * dt;
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

            // Only apply forward thrust if actually accelerating (not reversing)
            if (this.isAccelerating || this.currentSpeed > 0) {
                body.setAcceleration(facingX * thrust, facingY * thrust);
            } else {
                body.setAcceleration(0, 0); // No thrust when reversing or stopped
            }

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
        if (brakeInput && speed > 30) {
            targetTireIntensity = Math.max(targetTireIntensity, Math.min(speed / 150, 1));
        }

        const tireRampSpeed = targetTireIntensity > this.tireMarkIntensity ? 2.4 : 6.5;
        const tireLerp = 1 - Math.exp(-tireRampSpeed * dt);
        this.tireMarkIntensity += (targetTireIntensity - this.tireMarkIntensity) * tireLerp;
        if (targetTireIntensity === 0 && this.tireMarkIntensity < 1) this.tireMarkIntensity = 0;

        if (this.tireMarkIntensity > 0) {
            const vx = body.velocity.x;
            const vy = body.velocity.y;
            
            // Use car's heading angle for positioning (not velocity angle)
            // This ensures marks appear in correct position even at low/zero velocity
            const perpAngle = this.headAngle + Math.PI / 2;
            const spread = this.wheelSpreadY;
            const behindDist = Math.abs(this.rearWheelX);
            const baseX = hx + Math.cos(this.headAngle) * this.rearWheelX;
            const baseY = hy + Math.sin(this.headAngle) * this.rearWheelX;
            const leftX = baseX + Math.cos(perpAngle) * spread;
            const leftY = baseY + Math.sin(perpAngle) * spread;
            const rightX = baseX - Math.cos(perpAngle) * spread;
            const rightY = baseY - Math.sin(perpAngle) * spread;

            // Use velocity angle for mark rotation (visual direction)
            const isoAngle = Math.atan2(vy * 1.5, vx);
            const markAngleDeg = isoAngle * (180 / Math.PI);
            this.tireEmitterLeft.particleRotate = markAngleDeg;
            this.tireEmitterRight.particleRotate = markAngleDeg;

            this.tireEmitterLeft.particleAlpha = this.tireMarkIntensity * 0.54;
            this.tireEmitterRight.particleAlpha = this.tireMarkIntensity * 0.54;

            this.tireEmitterLeft.emitParticleAt(leftX, leftY, 1);
            this.tireEmitterRight.emitParticleAt(rightX, rightY, 1);
        }

        // --- Boost flame/smoke (single exhaust) ---
        if (this.boostIntensity > 0.01) {
            const vx = body.velocity.x;
            const vy = body.velocity.y;
            const velAngle = Math.atan2(vy, vx);
            const exhaustAngleDeg = (velAngle * 180 / Math.PI + 180) % 360;

            // Rotate the exhaust offset based on car's visual angle
            const exhaustLocalX = this.rearWheelX - 15;  // Behind the car
            const exhaustLocalY = 0;  // Centered
            const exhaustX = hx + Math.cos(this.headAngle) * exhaustLocalX - Math.sin(this.headAngle) * exhaustLocalY;
            const exhaustY = hy + Math.sin(this.headAngle) * exhaustLocalX + Math.cos(this.headAngle) * exhaustLocalY;

            this.boostFlameEmitter.particleAngle = { min: exhaustAngleDeg - 8, max: exhaustAngleDeg + 8 };
            const flameCount = Math.ceil(this.boostIntensity * 3);
            this.boostFlameEmitter.emitParticleAt(exhaustX, exhaustY, flameCount);

            const smokeX = exhaustX;
            const smokeY = exhaustY;
            this.boostSmokeEmitter.particleAngle = { min: exhaustAngleDeg - 25, max: exhaustAngleDeg + 25 };
            const smokeCount = Math.ceil(this.boostIntensity * 5.5);
            this.boostSmokeEmitter.emitParticleAt(smokeX, smokeY, smokeCount);
        }

        // --- Handbrake smoke (two rear tyres) ---
        if (brakeInput && speed > 30) {
            const vx = body.velocity.x;
            const vy = body.velocity.y;
            const velAngle = Math.atan2(vy, vx);

            // Rotate wheel positions based on car's visual angle
            const perpAngle = this.headAngle + Math.PI / 2;
            const behindDist = Math.abs(this.rearWheelX);
            const spread = this.wheelSpreadY;

            const baseX = hx + Math.cos(this.headAngle) * this.rearWheelX;
            const baseY = hy + Math.sin(this.headAngle) * this.rearWheelX;

            const leftX = baseX + Math.cos(perpAngle) * spread;
            const leftY = baseY + Math.sin(perpAngle) * spread;
            const rightX = baseX - Math.cos(perpAngle) * spread;
            const rightY = baseY - Math.sin(perpAngle) * spread;

            const count = Math.ceil(Math.min(speed / 100, 1) * 2.5);
            this.brakeSmokeEmitterLeft.emitParticleAt(leftX, leftY, count);
            this.brakeSmokeEmitterRight.emitParticleAt(rightX, rightY, count);
        }

        // --- Pickup ---
        const pdx = hx - this.pickupX;
        const pdy = hy - this.pickupY;
        if (Math.sqrt(pdx * pdx + pdy * pdy) < this.pickupCollectDist) {
            this.score += 350; // Trophy collection points
            this.timeRemaining = Math.min(this.timeRemaining + this.pickupTimeBonus, 99);
            this.boostFuel = Math.min(this.boostMax, this.boostFuel + this.boostRefillAmount);
            
            // Cappy Crash trick - collecting trophy while boosting
            if (this.boostIntensity > 0.01) {
                // Add to active tricks first to show in combo
                this.activeTricks.set('CAPPY_CRASH', 1);
                this.updateTrickComboDisplay(); // Show "Cappy Crash..." in display
                
                // Execute immediately after a brief moment to show the trick
                this.time.delayedCall(100, () => {
                    this.activeTricks.delete('CAPPY_CRASH');
                    this.executeTrick('CAPPY_CRASH');
                    
                    // Show score popup
                    const hx = this.headSprite.x;
                    const hy = this.headSprite.y;
                    this.showScorePopup(hx, hy - 40, this.TRICKS.CAPPY_CRASH.baseScore);
                    
                    // Play trick sound
                    this.playTrickSound();
                    
                    this.updateTrickComboDisplay();
                    console.log('[CAPPY CRASH] Trophy collected while boosting! +100 pts');
                });
            }
            
            this.showTimeBonusPopup(this.pickupX, this.pickupY);
            this.spawnPickup();
            this.collectSound.play({ volume: .9 });
        }

        // --- Update car sprite frame ---
        let angleDeg = (this.headAngle * 180 / Math.PI) % 360;
        if (angleDeg < 0) angleDeg += 360;
        const frameIndex = Math.round(angleDeg / (360 / this.totalCarFrames)) % this.totalCarFrames;
        const frameKey = `car_${String(frameIndex).padStart(3, '0')}`;
        this.carSprite.setTexture(frameKey);
        this.carSprite.setPosition(hx, hy);

        this.carShadow.setTexture(frameKey);
        if (hx < 0) this.headSprite.setX(this.width);
        if (hx > this.width) this.headSprite.setX(0);
        if (hy < 0) this.headSprite.setY(this.height);
        if (hy > this.height) this.headSprite.setY(0);
        this.carShadow.setScale(0.95, 1); // Slightly squashed like decorations
        this.carShadow.setPosition(hx + 4, hy + 58); // Offset to bottom-right

        // Update score text with combo multiplier
        const comboText = this.currentComboMultiplier > 1 ? ` (x${this.currentComboMultiplier.toFixed(1)})` : '';
        this.scoreText.setText(`Score: ${this.score}${comboText}`);
        
        if (this.debugText) {
            const driftIndicator = this.isDrifting ? ' [DRIFT]' : '';
            this.debugText.setText(
                `Spd: ${Math.round(speed)}  Thrust: ${this.forwardThrust}${driftIndicator}`
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

        const nitroTarget = (thrustInput && this.boostFuel > 0 && !brakeInput) ? 1 : 0;
        this.soundManager.setLayerTarget('nitro', nitroTarget);

        if (this.isAccelerating) {
            this.accelStopTimer = 0;
            this.soundManager.setCrossfadeLayerScale('engine', 1);
        } else {
            this.accelStopTimer += dt;
            if (this.accelStopTimer >= this.engineFadeDelay) {
                this.soundManager.setCrossfadeLayerScale('engine', brakeInput ? 0.3 : 0);
            }
        }

        const stoppingTarget = brakeInput ? 1 : 0;
        this.soundManager.setLayerTarget('stopping', stoppingTarget);
        
        // --- Trick System ---
        this.updateDriftState();
        this.checkNearMiss();
        this.checkHandbrake(brakeInput); // Track handbrake trick
        this.checkNitro(this.boostIntensity > 0.01); // Track nitro trick
        
        // Finalize trick session AFTER all trick updates have run
        // This ensures active tricks have been moved to buffered
        this.finalizeTrickSession();
        
        // Update score details debug display if enabled
        if (this.showScoreDetails) {
            this.updateScoreDetailsDisplay();
        }
        
        // Draw trick threshold zones if debug enabled
        if (this.showTrickThreshold) {
            this.trickThresholdGraphics.clear();
            this.trickThresholdGraphics.lineStyle(2, 0x00ff00, 0.6); // Green semi-transparent outline
            this.trickThresholdGraphics.fillStyle(0x00ff00, 0.1); // Very transparent green fill
            
            for (const obstacle of this.decorations) {
                const obstacleBody = obstacle.body as Phaser.Physics.Arcade.Body;
                
                // Draw a rectangle showing the threshold zone around the obstacle
                const zoneX = obstacleBody.x - this.nearMissThreshold;
                const zoneY = obstacleBody.y - this.nearMissThreshold;
                const zoneW = obstacleBody.width + (this.nearMissThreshold * 2);
                const zoneH = obstacleBody.height + (this.nearMissThreshold * 2);
                
                this.trickThresholdGraphics.strokeRect(zoneX, zoneY, zoneW, zoneH);
                this.trickThresholdGraphics.fillRect(zoneX, zoneY, zoneW, zoneH);
            }
        } else {
            this.trickThresholdGraphics.clear();
        }
        
        this.soundManager.update(dt);
    }

    private showTimeBonusPopup(x: number, y: number) {
        const popup = this.add.text(x, y, `+${this.pickupTimeBonus}s`, {
            fontFamily: 'Arial Black',
            fontSize: 28,
            color: '#44ff88',
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center',
        }).setOrigin(0.5).setDepth(15).setAlpha(0).setScale(0.3);

        this.tweens.add({
            targets: popup,
            alpha: 1,
            scale: 1.2,
            y: y - 40,
            duration: 300,
            ease: 'Back.easeOut',
            onComplete: () => {
                this.tweens.add({
                    targets: popup,
                    alpha: 0,
                    scale: 0.6,
                    y: y - 70,
                    duration: 400,
                    ease: 'Quad.easeIn',
                    onComplete: () => popup.destroy(),
                });
            },
        });
    }

    private showScorePopup(x: number, y: number, score: number) {
        const popup = this.add.text(x, y, `+${score}`, {
            fontFamily: 'Arial Black',
            fontSize: 32,
            color: '#ffdd00', // Yellow like combo text
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center',
        }).setOrigin(0.5).setDepth(15).setAlpha(0).setScale(0.3);

        this.tweens.add({
            targets: popup,
            alpha: 1,
            scale: 1.3,
            y: y - 50,
            duration: 350,
            ease: 'Back.easeOut',
            onComplete: () => {
                this.tweens.add({
                    targets: popup,
                    alpha: 0,
                    scale: 0.7,
                    y: y - 90,
                    duration: 450,
                    ease: 'Quad.easeIn',
                    onComplete: () => popup.destroy(),
                });
            },
        });
    }

    private endGame() {
        this.gameOver = true;

        const body = this.headSprite.body as Phaser.Physics.Arcade.Body;
        body.setAcceleration(0, 0);

        // Smoothly bring car to a stop over longer time
        this.tweens.add({
            targets: body.velocity,
            x: 0,
            y: 0,
            duration: 1500, // Increased from 800ms for more gradual stop
            ease: 'Quad.easeOut',
        });

        // Also slow down currentSpeed
        this.tweens.add({
            targets: this,
            currentSpeed: 0,
            duration: 1500, // Match velocity tween
            ease: 'Quad.easeOut',
        });

        this.boostFlameEmitter.stop();
        this.boostSmokeEmitter.stop();
        this.brakeSmokeEmitterLeft.stop();
        this.brakeSmokeEmitterRight.stop();

        // Fade music to ~10% of original
        if (this.music && !this.musicMuted) {
            this.tweens.add({
                targets: this.music,
                volume: 0.012,
                duration: 1500,
                ease: 'Quad.easeOut',
            });
        }

        // Fade SFX layers out gently
        this.soundManager.setLayerTarget('screech', 0);
        this.soundManager.setCrossfadeLayerScale('engine', 0);
        this.soundManager.setLayerTarget('stopping', 0);
        this.soundManager.setLayerTarget('nitro', 0);

        this.timerText.setVisible(false);

        // Longer delay for game-over UI so player can process what happened
        this.time.delayedCall(2000, () => { // Increased from 1000ms
            this.showGameOverUI();
        });
    }

    private showGameOverUI() {
        this.gameOverText.setText('GAME OVER');
        this.gameOverText.setAlpha(0);
        this.gameOverText.setScale(0.5);
        this.gameOverText.setVisible(true);

        this.tweens.add({
            targets: this.gameOverText,
            alpha: 1,
            scale: 1,
            duration: 500,
            ease: 'Back.easeOut',
        });

        this.finalScoreText = this.add.text(this.width / 2, this.height / 2 + 10, `Final Score: ${this.score}`, {
            fontFamily: 'Arial Black',
            fontSize: 48,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);

        this.tweens.add({
            targets: this.finalScoreText,
            alpha: 1,
            y: this.height / 2 + 10,
            duration: 400,
            delay: 300,
            ease: 'Quad.easeOut',
        });

        // Show trick summary if any tricks were performed
        if (this.trickHistory.length > 0) {
            const trickCount = this.trickHistory.length;
            const trickScore = this.trickHistory.reduce((sum, t) => sum + t.score, 0);
            const trickSummary = this.add.text(
                this.width / 2, 
                this.height / 2 + 65, 
                `${trickCount} Tricks: ${trickScore} pts`,
                {
                    fontFamily: 'Arial',
                    fontSize: 18,
                    color: '#ffdd00',
                    stroke: '#000000',
                    strokeThickness: 3,
                }
            ).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);

            this.tweens.add({
                targets: trickSummary,
                alpha: 1,
                duration: 400,
                delay: 500,
                ease: 'Quad.easeOut',
            });
        }

        this.playAgainBtn = this.add.text(this.width / 2, this.height / 2 + 100, 'Play Again', {
            fontFamily: 'Arial Black',
            fontSize: 28,
            color: '#ffffff',
            backgroundColor: '#33aa55',
            padding: { x: 24, y: 12 },
            align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10)
            .setInteractive({ useHandCursor: true }).setAlpha(0);

        this.tweens.add({
            targets: this.playAgainBtn,
            alpha: 1,
            duration: 400,
            delay: 600,
            ease: 'Quad.easeOut',
        });

        this.playAgainBtn.on('pointerover', () => this.playAgainBtn?.setStyle({ backgroundColor: '#44cc66' }));
        this.playAgainBtn.on('pointerout', () => this.playAgainBtn?.setStyle({ backgroundColor: '#33aa55' }));
        this.playAgainBtn.on('pointerdown', () => {
            this.tryRestart();
        });
    }
}