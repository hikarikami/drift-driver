import { Scene } from 'phaser';
import { createSinglePlayerConfig, createBattleConfig, GameSessionConfig, PLAYER1_KEYS, PLAYER2_KEYS, KeyBindings  } from './GameConfig';




export class MainMenu extends Scene {
    private width!: number;
    private height!: number;
    private playerNameDom!: Phaser.GameObjects.DOMElement;

    constructor() {
        super('MainMenu');
    }

    create() {
        this.width = this.scale.width;
        this.height = this.scale.height;

        // --- Background ---
        this.buildBackground();

        // --- Title ---
        const titleY = this.height * 0.22;

        const titleShadow = this.add.text(this.width / 2 + 3, titleY + 3, 'DRIFT', {
            fontFamily: 'BoldPixels',
            fontSize: 72,
            color: '#000000',
            align: 'center',
        }).setOrigin(0.5).setAlpha(0.3).setDepth(1);

        const title = this.add.text(this.width / 2, titleY, 'CAPPY DRIFTER', {
            fontFamily: 'BoldPixels',
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

        // --- Player Name Input ---
        this.buildPlayerNameInput(this.height * 0.30);

        // --- Buttons ---
        const buttonY = this.height * 0.46;
        const buttonSpacing = 72;

        this.createButton(
            this.width / 2,
            buttonY,
            'SINGLE PLAYER',
            '#33aa55',
            '#44cc66',
            () => {
                const config = createSinglePlayerConfig();
                config.players[0].playerName = this.getPlayerName();
                this.startGame(config);
            }
        );

        this.createButton(
            this.width / 2,
            buttonY + buttonSpacing,
            'BATTLE',
            '#cc5533',
            '#ee7744',
            () => {
                const config = createBattleConfig();
                config.players[0].playerName = this.getPlayerName();
                this.startGame(config);
            }
        );

        this.createButton(
            this.width / 2,
            buttonY + buttonSpacing * 2,
            'ONLINE',
            '#3366cc',
            '#4488ee',
            () => this.scene.start('OnlineLobby', { role: 'host' })
        );

        // --- Auto-join if URL has ?join=PEERID ---
        const urlParams = new URLSearchParams(window.location.search);
        const joinId = urlParams.get('join');
        if (joinId) {
            // Clear the URL param so refreshing doesn't re-join
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
            // Go straight to lobby as guest
            this.scene.start('OnlineLobby', { role: 'join', hostId: joinId });
            return;
        }

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
        // Helper to get a friendly display name for a key binding
        const keyName = (k: string | number): string => {
            if (typeof k === 'number') {
                const map: Record<number, string> = { 188: ',', 190: '.', 191: '/', 186: ';', 222: "'", 219: '[', 221: ']' };
                return map[k] ?? `Key${k}`;
            }
            return k;
        };

        const renderControlsTable = (
            title: string,
            keys:KeyBindings,
            x: number,
            y: number,
            width: number
        ) => {
            const titleText = this.add.text(x, y, title, {
                fontFamily: 'BoldPixels',
                fontSize: 16,
                color: '#ffffff',
            }).setOrigin(0, 0).setDepth(3);

            // column positions
            const rowStartY = y + 26;
            const rowGap = 16;
            const keyColX = x + width - 10; // right aligned keys

            const rows: Array<[string, string]> = [
                ['Accelerate', keyName(keys.up)],
                ['Brake / Reverse', keyName(keys.down)],
                ['Steer Left', keyName(keys.left)],
                ['Steer Right', keyName(keys.right)],
                ['Boost (Nitro)', keyName(keys.boost)],
                ['Brake (Handbrake)', keyName(keys.brake)],
            ];

            rows.forEach(([action, key], i) => {
                const ry = rowStartY + i * rowGap;

                this.add.text(x, ry, action, {
                    fontFamily: 'BoldPixels',
                    fontSize: 13,
                    color: '#d0d0d0',
                }).setOrigin(0, 0).setDepth(3);

                this.add.text(keyColX, ry, key, {
                    fontFamily: 'BoldPixels',
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
            fontFamily: 'BoldPixels',
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
            fontFamily: 'BoldPixels',
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

    private buildPlayerNameInput(y: number) {
        const label = this.add.text(this.width / 2, y - 28, 'PLAYER NAME', {
            fontFamily: 'BoldPixels',
            fontSize: 16,
            color: '#aaaaaa',
            align: 'center',
            letterSpacing: 3,
        }).setOrigin(0.5).setDepth(3);

        label.setAlpha(0);
        this.tweens.add({ targets: label, alpha: 1, duration: 500, delay: 200 });

        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.value = 'Player 1';
        inputEl.maxLength = 16;
        inputEl.spellcheck = false;
        inputEl.autocomplete = 'off';
        inputEl.style.cssText = [
            'background: rgba(0,0,0,0.65)',
            'border: 2px solid #ff6633',
            'border-radius: 6px',
            'color: #ffffff',
            'font-family: Arial Black, sans-serif',
            'font-size: 22px',
            'padding: 8px 18px',
            'text-align: center',
            'outline: none',
            'width: 260px',
            'box-sizing: border-box',
            'transition: border-color 0.15s',
        ].join(';');

        inputEl.addEventListener('focus', () => {
            inputEl.style.borderColor = '#ffaa55';
        });
        inputEl.addEventListener('blur', () => {
            inputEl.style.borderColor = '#ff6633';
        });
        inputEl.addEventListener('keydown', (e) => e.stopPropagation());
        inputEl.addEventListener('keyup', (e) => e.stopPropagation());

        this.playerNameDom = this.add.dom(this.width / 2, y + 10, inputEl).setDepth(3).setAlpha(0);
        this.tweens.add({ targets: this.playerNameDom, alpha: 1, duration: 500, delay: 200 });
    }

    private getPlayerName(): string {
        if (!this.playerNameDom) return 'Player 1';
        const el = this.playerNameDom.node as HTMLInputElement;
        return el.value.trim() || 'Player 1';
    }

    // Clean up DOM element when leaving the scene
    shutdown() {
        if (this.playerNameDom) {
            this.playerNameDom.destroy();
        }
    }

    private startGame(config: GameSessionConfig) {
        this.scene.start('Game', { sessionConfig: config });
    }
}
