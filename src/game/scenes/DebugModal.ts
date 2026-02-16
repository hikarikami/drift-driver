import { Scene } from 'phaser';
import { SoundManager } from '../SoundManager';
import { CarController } from './CarController';

export interface DebugConfig {
    car: CarController;
    soundManager: SoundManager;
    music: Phaser.Sound.BaseSound;
    musicVolume: number;
    musicMuted: boolean;
    onMusicMuteToggle: (muted: boolean) => void;
    onEndRun: () => void;
}

export class DebugModal {
    private scene: Scene;
    private width: number;
    private height: number;

    private container!: Phaser.GameObjects.Container;
    private isOpen = false;
    private debugBtn!: Phaser.GameObjects.Text;
    private thrustLabel!: Phaser.GameObjects.Text;
    private dragLabel!: Phaser.GameObjects.Text;
    private maxSpdLabel!: Phaser.GameObjects.Text;
    debugText!: Phaser.GameObjects.Text;

    private car!: CarController;

    constructor(scene: Scene, width: number, height: number) {
        this.scene = scene;
        this.width = width;
        this.height = height;
    }

    /**
     * Creates the debug button and modal. Call during scene create().
     */
    create(config: DebugConfig) {
        this.car = config.car;

        // Debug Tools button (top-right)
        this.debugBtn = this.scene.add.text(this.width / 2, 68, 'Debug Tools', {
            fontFamily: 'Arial',
            fontSize: 16,
            color: '#ffffff',
            backgroundColor: '#555555',
            padding: { x: 10, y: 6 },
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(30)
            .setInteractive({ useHandCursor: true });
        this.debugBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.toggle();
        });

        this.buildModal(config);
    }

    private buildModal(config: DebugConfig) {
        const modalW = 280;
        const modalH = 430;
        const mx = (this.width - modalW) / 2;
        const my = (this.height - modalH) / 2;

        this.container = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(50).setVisible(false);

        const backdrop = this.scene.add.rectangle(this.width / 2, this.height / 2, this.width, this.height, 0x000000, 0.5);
        backdrop.setInteractive();
        backdrop.on('pointerdown', (pointer: Phaser.Input.Pointer) => { pointer.event.stopPropagation(); });
        this.container.add(backdrop);

        const panel = this.scene.add.graphics();
        panel.fillStyle(0x222222, 0.95);
        panel.fillRoundedRect(mx, my, modalW, modalH, 10);
        panel.lineStyle(2, 0x666666, 1);
        panel.strokeRoundedRect(mx, my, modalW, modalH, 10);
        this.container.add(panel);

        const title = this.scene.add.text(this.width / 2, my + 18, 'Debug Tools', {
            fontFamily: 'Arial Black', fontSize: 20, color: '#ffffff', align: 'center',
        }).setOrigin(0.5, 0);
        this.container.add(title);

        const closeBtn = this.scene.add.text(mx + modalW - 14, my + 10, 'X', {
            fontFamily: 'Arial Black', fontSize: 18, color: '#ff4444',
            padding: { x: 6, y: 2 },
        }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
        closeBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.toggle();
        });
        this.container.add(closeBtn);

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
            const lbl = this.scene.add.text(this.width / 2, cy, label, {
                fontFamily: 'Arial', fontSize: 15, color: '#cccccc',
            }).setOrigin(0.5, 0);
            this.container.add(lbl);

            const minus = this.scene.add.text(leftCol, cy, '\u2212', { ...btnStyle, padding: { x: 12, y: 4 } })
                .setInteractive({ useHandCursor: true });
            minus.on('pointerdown', (pointer: Phaser.Input.Pointer) => { pointer.event.stopPropagation(); onMinus(); });
            this.container.add(minus);

            const plus = this.scene.add.text(rightCol, cy, '+', { ...btnStyle, padding: { x: 12, y: 4 } })
                .setOrigin(1, 0).setInteractive({ useHandCursor: true });
            plus.on('pointerdown', (pointer: Phaser.Input.Pointer) => { pointer.event.stopPropagation(); onPlus(); });
            this.container.add(plus);

            cy += rowH;
            return lbl;
        };

        this.thrustLabel = makeRow(`Thrust: ${this.car.forwardThrust}`,
            () => { this.car.forwardThrust = Math.max(this.car.forwardThrust - 40, 80); this.refreshLabels(); },
            () => { this.car.forwardThrust = Math.min(this.car.forwardThrust + 40, 800); this.refreshLabels(); },
        );
        this.dragLabel = makeRow(`Drag: ${this.car.drag}`,
            () => { this.car.drag = Math.max(this.car.drag - 20, 0); this.refreshLabels(); },
            () => { this.car.drag = Math.min(this.car.drag + 20, 400); this.refreshLabels(); },
        );
        this.maxSpdLabel = makeRow(`Max Spd: ${this.car.maxSpeed}`,
            () => { this.car.maxSpeed = Math.max(this.car.maxSpeed - 30, 80); this.refreshLabels(); },
            () => { this.car.maxSpeed = Math.min(this.car.maxSpeed + 30, 600); this.refreshLabels(); },
        );

        cy += 8;

        // Music toggle
        const musicBtn = this.scene.add.text(this.width / 2, cy, '\u266B Music: ON', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        musicBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            const newMuted = !config.musicMuted;
            config.musicMuted = newMuted;
            config.onMusicMuteToggle(newMuted);
            if (config.music) {
                if (newMuted) {
                    (config.music as Phaser.Sound.WebAudioSound).setVolume(0);
                    musicBtn.setText('\u266B Music: OFF');
                } else {
                    (config.music as Phaser.Sound.WebAudioSound).setVolume(config.musicVolume);
                    musicBtn.setText('\u266B Music: ON');
                }
            }
        });
        this.container.add(musicBtn);
        cy += rowH + 4;

        // SFX toggle
        const sfxBtn = this.scene.add.text(this.width / 2, cy, '\u{1F50A} SFX: ON', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        sfxBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            config.soundManager.muted = !config.soundManager.muted;
            if (config.soundManager.muted) {
                sfxBtn.setText('\u{1F507} SFX: OFF');
            } else {
                sfxBtn.setText('\u{1F50A} SFX: ON');
            }
        });
        this.container.add(sfxBtn);
        cy += rowH + 4;

        // Screen bounce toggle
        const boundsBtn = this.scene.add.text(this.width / 2, cy, 'Screen Bounce: ON', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        boundsBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            const body = this.car.headSprite.body as Phaser.Physics.Arcade.Body;
            const currentState = body.collideWorldBounds;
            body.setCollideWorldBounds(!currentState);
            boundsBtn.setText(!currentState ? 'Screen Bounce: ON' : 'Screen Bounce: OFF');
        });
        this.container.add(boundsBtn);
        cy += rowH + 4;

        // Hitbox toggle
        const hitboxBtn = this.scene.add.text(this.width / 2, cy, 'Show Hitboxes: OFF', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        hitboxBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            if (this.scene.physics.world.debugGraphic) {
                this.scene.physics.world.debugGraphic.clear();
                this.scene.physics.world.debugGraphic.destroy();
                this.scene.physics.world.debugGraphic = null as any;
                hitboxBtn.setText('Show Hitboxes: OFF');
            } else {
                this.scene.physics.world.createDebugGraphic();
                hitboxBtn.setText('Show Hitboxes: ON');
            }
        });
        this.container.add(hitboxBtn);
        cy += rowH + 4;

        // Collision toggle
        const collisionBtn = this.scene.add.text(this.width / 2, cy, 'Collisions: ON', {
            ...btnStyle, padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        collisionBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            const colliders = this.scene.physics.world.colliders.getActive();
            if (colliders.length > 0 && colliders[0].active) {
                colliders.forEach((collider: any) => { collider.active = false; });
                collisionBtn.setText('Collisions: OFF');
            } else {
                colliders.forEach((collider: any) => { collider.active = true; });
                collisionBtn.setText('Collisions: ON');
            }
        });
        this.container.add(collisionBtn);
        cy += rowH + 4;

        // End run
        const endRunBtn = this.scene.add.text(this.width / 2, cy, 'End Run', {
            ...btnStyle, backgroundColor: '#aa3333', padding: { x: 16, y: 6 },
        }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
        endRunBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.toggle();
            config.onEndRun();
        });
        this.container.add(endRunBtn);
        cy += rowH + 4;

        // Debug text
        this.debugText = this.scene.add.text(this.width / 2, cy, '', {
            fontFamily: 'Arial',
            fontSize: 14,
            color: '#888888',
        }).setOrigin(0.5, 0);
        this.container.add(this.debugText);
    }

    private refreshLabels() {
        this.thrustLabel.setText(`Thrust: ${this.car.forwardThrust}`);
        this.dragLabel.setText(`Drag: ${this.car.drag}`);
        this.maxSpdLabel.setText(`Max Spd: ${this.car.maxSpeed}`);
    }

    toggle() {
        this.isOpen = !this.isOpen;
        this.container.setVisible(this.isOpen);
    }

    /**
     * Updates the debug text with current speed info
     */
    updateDebugText(speed: number) {
        if (this.debugText) {
            this.debugText.setText(
                `Spd: ${Math.round(speed)}  Thrust: ${this.car.forwardThrust}`
            );
        }
    }
}