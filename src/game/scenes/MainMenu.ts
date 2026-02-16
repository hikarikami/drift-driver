import { Scene } from 'phaser';
import { createSinglePlayerConfig, createBattleConfig, GameSessionConfig, PLAYER1_KEYS, PLAYER2_KEYS, KeyBindings  } from './GameConfig';




export class MainMenu extends Scene {
    private width!: number;
    private height!: number;

    constructor() {
        super('MainMenu');
    }

    create() {
        this.width = this.scale.width;
        this.height = this.scale.height;

        // --- Background ---
        this.buildBackground();

        // --- Title ---
        const titleY = this.height * 0.28;

        const titleShadow = this.add.text(this.width / 2 + 3, titleY + 3, 'DRIFT', {
            fontFamily: 'Arial Black',
            fontSize: 72,
            color: '#000000',
            align: 'center',
        }).setOrigin(0.5).setAlpha(0.3).setDepth(1);

        const title = this.add.text(this.width / 2, titleY, 'DRIFT', {
            fontFamily: 'Arial Black',
            fontSize: 72,
            color: '#ff6633',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center',
        }).setOrigin(0.5).setDepth(2);

        // Subtle pulse on title
        this.tweens.add({
            targets: [title, titleShadow],
            scaleX: 1.03,
            scaleY: 1.03,
            duration: 1500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        // --- Buttons ---
        const buttonY = this.height * 0.52;
        const buttonSpacing = 70;

        this.createButton(
            this.width / 2,
            buttonY,
            'SINGLE PLAYER',
            '#33aa55',
            '#44cc66',
            () => this.startGame(createSinglePlayerConfig())
        );

        this.createButton(
            this.width / 2,
            buttonY + buttonSpacing,
            'BATTLE',
            '#cc5533',
            '#ee7744',
            () => this.startGame(createBattleConfig())
        );

        // --- Controls hint ---
        // --- Controls tables (bottom) ---
        const bottomPadding = 56;          // space above the version text
        const panelHeight = 148;
        const panelY = this.height - bottomPadding - panelHeight;

        const panelWidth = Math.min(720, this.width - 60);
        const panelX = (this.width - panelWidth) / 2;

        // subtle panel for legibility
        this.add.rectangle(
            panelX + panelWidth / 2,
            panelY + panelHeight / 2,
            panelWidth,
            panelHeight,
            0x000000,
            0.45
        ).setDepth(2);

        // layout
        const gap = 40;
        const half = (panelWidth - gap) / 2;
        const leftX = panelX + 20;
        const rightX = panelX + 20 + half + gap;
        const topY = panelY + 14;

        // helper to draw one table
        const renderControlsTable = (
            title: string,
            keys:KeyBindings,
            x: number,
            y: number,
            width: number
        ) => {
            const titleText = this.add.text(x, y, title, {
                fontFamily: 'Arial Black',
                fontSize: 16,
                color: '#ffffff',
            }).setOrigin(0, 0).setDepth(3);

            // column positions
            const rowStartY = y + 26;
            const rowGap = 16;
            const keyColX = x + width - 10; // right aligned keys

            const rows: Array<[string, string]> = [
                ['Accelerate', keys.up],
                ['Brake / Reverse', keys.down],
                ['Steer Left', keys.left],
                ['Steer Right', keys.right],
                ['Boost (Nitro)', keys.boost],
                ['Brake (Handbrake)', keys.brake],
            ];

            rows.forEach(([action, key], i) => {
                const ry = rowStartY + i * rowGap;

                this.add.text(x, ry, action, {
                    fontFamily: 'Arial',
                    fontSize: 13,
                    color: '#d0d0d0',
                }).setOrigin(0, 0).setDepth(3);

                this.add.text(keyColX, ry, key, {
                    fontFamily: 'Arial Black',
                    fontSize: 13,
                    color: '#ffffff',
                }).setOrigin(1, 0).setDepth(3); // right aligned
            });

            return titleText;
        };

        renderControlsTable('Player 1 Controls', PLAYER1_KEYS, leftX, topY, half - 20);
        renderControlsTable('Player 2 Controls', PLAYER2_KEYS, rightX, topY, half - 20);


        // --- Version / credit ---
        this.add.text(this.width / 2, this.height - 20, 'v0.1', {
            fontFamily: 'Arial',
            fontSize: 11,
            color: '#444444',
            align: 'center',
        }).setOrigin(0.5).setDepth(2);
    }

    private buildBackground() {
        // Reuse the isometric tile background for visual consistency
        const tileWidth = 36;
        const tileHeight = 16;

        const cols = Math.ceil(this.width / (tileWidth / 2)) + 4;
        const rows = Math.ceil(this.height / (tileHeight / 2)) + 4;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const tileNum = Phaser.Math.Between(0, 10);
                const tileName = `tile_${String(tileNum).padStart(3, '0')}`;

                const x = (col - row) * tileWidth;
                const y = (col + row) * tileHeight;

                const tile = this.add.image(x + this.width / 2, y - this.height / 2, tileName);
                tile.setOrigin(0.5, 0.5);
                tile.setScale(2);
                tile.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
                tile.setDepth(0);
                tile.setAlpha(0.4); // Dimmed so text is readable
            }
        }

        // Dark overlay for contrast
        const overlay = this.add.rectangle(
            this.width / 2, this.height / 2,
            this.width, this.height,
            0x000000, 0.45
        );
        overlay.setDepth(1);
    }

    private createButton(
        x: number,
        y: number,
        label: string,
        bgColor: string,
        hoverColor: string,
        onClick: () => void
    ) {
        const btn = this.add.text(x, y, label, {
            fontFamily: 'Arial Black',
            fontSize: 26,
            color: '#ffffff',
            backgroundColor: bgColor,
            padding: { x: 32, y: 14 },
            align: 'center',
        }).setOrigin(0.5).setDepth(3)
            .setInteractive({ useHandCursor: true })
            .setAlpha(0)
            .setScale(0.8);

        // Fade in with stagger
        const delay = y > this.height * 0.5 ? 200 : 0;
        this.tweens.add({
            targets: btn,
            alpha: 1,
            scale: 1,
            duration: 400,
            delay: 300 + delay,
            ease: 'Back.easeOut',
        });

        btn.on('pointerover', () => {
            btn.setStyle({ backgroundColor: hoverColor });
            this.tweens.add({
                targets: btn,
                scaleX: 1.05,
                scaleY: 1.05,
                duration: 100,
                ease: 'Quad.easeOut',
            });
        });

        btn.on('pointerout', () => {
            btn.setStyle({ backgroundColor: bgColor });
            this.tweens.add({
                targets: btn,
                scaleX: 1,
                scaleY: 1,
                duration: 100,
                ease: 'Quad.easeOut',
            });
        });

        btn.on('pointerdown', onClick);

        return btn;
    }

    private startGame(config: GameSessionConfig) {
        this.scene.start('Game', { sessionConfig: config });
    }
}
