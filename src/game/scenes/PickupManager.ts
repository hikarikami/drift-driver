import { Scene } from 'phaser';
import { SceneryManager } from './SceneryManager';

export class PickupManager {
    private scene: Scene;
    private scenery: SceneryManager;
    private width: number;
    private height: number;

    pickupX!: number;
    pickupY!: number;
    readonly pickupCollectDist = 32;
    pickupSprite!: Phaser.GameObjects.Image;
    pickupShadow!: Phaser.GameObjects.Image;

    constructor(scene: Scene, scenery: SceneryManager, width: number, height: number) {
        this.scene = scene;
        this.scenery = scenery;
        this.width = width;
        this.height = height;
    }

    /**
     * Creates the pickup sprite and shadow. Call during scene create().
     */
    create() {
        this.pickupShadow = this.scenery.createDynamicShadow(0, 0, 'trophy', 3);
        this.pickupShadow.setDisplaySize(37, 55);

        this.pickupSprite = this.scene.add.image(0, 0, 'trophy').setDepth(4);
        this.pickupSprite.setDisplaySize(37, 55);
    }

    /**
     * Spawns the pickup at a random valid position with drop animation
     */
    spawn() {
        const margin = 40;
        const minDistanceFromObstacles = 100;
        let attempts = 0;
        let validPosition = false;

        while (!validPosition && attempts < 50) {
            this.pickupX = margin + Math.random() * (this.width - 2 * margin);
            this.pickupY = margin + Math.random() * (this.height - 2 * margin);

            validPosition = true;
            for (const obstacle of this.scenery.decorations) {
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

        const dropHeight = 40;
        const dropDuration = 450;
        const bounceDuration = 130;
        const bounceHeight = 4;

        if (this.pickupSprite) {
            this.scene.tweens.killTweensOf(this.pickupSprite);
            this.pickupSprite.setPosition(this.pickupX, this.pickupY - dropHeight);
            this.pickupSprite.setAlpha(0);

            this.scene.tweens.add({
                targets: this.pickupSprite,
                y: this.pickupY,
                alpha: 1,
                duration: dropDuration,
                ease: 'Quad.easeIn',
                onComplete: () => {
                    this.scene.tweens.add({
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
            this.scene.tweens.killTweensOf(this.pickupShadow);
            this.pickupShadow.setPosition(this.pickupX - 4, this.pickupY + 7);
            this.pickupShadow.angle = 130;
            this.pickupShadow.setAlpha(0);
            this.pickupShadow.setFlipX(true);
            this.scene.tweens.add({
                targets: this.pickupShadow,
                alpha: 0.55,
                duration: dropDuration,
                ease: 'Linear',
            });
        }
    }

    /**
     * Checks if the car is close enough to collect the pickup.
     * Returns true if collected.
     */
    checkCollection(carX: number, carY: number): boolean {
        const pdx = carX - this.pickupX;
        const pdy = carY - this.pickupY;
        return Math.sqrt(pdx * pdx + pdy * pdy) < this.pickupCollectDist;
    }
}
