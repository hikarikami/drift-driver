import { Scene } from 'phaser';
import {
    getNetworkManager,
    destroyNetworkManager,
    NetworkManager,
    LobbyPacket,
} from '../NetworkManager';
import { createOnlineHostConfig, createOnlineGuestConfig } from './GameConfig';

/**
 * OnlineLobby scene — handles the host/join flow before starting an online game.
 *
 * Entry data:
 *   { role: 'host' }          → create a room and show the join link
 *   { role: 'join', hostId }  → connect to an existing host
 */
export class OnlineLobby extends Scene {
    private width!: number;
    private height!: number;
    private net!: NetworkManager;
    private role!: 'host' | 'join';
    private hostId?: string;
    private statusText!: Phaser.GameObjects.Text;
    private linkText?: Phaser.GameObjects.Text;
    private backBtn!: Phaser.GameObjects.Text;
    private startBtn?: Phaser.GameObjects.Text;
    private guestReady = false;

    constructor() {
        super('OnlineLobby');
    }

    init(data: { role: 'host' | 'join'; hostId?: string }) {
        this.role = data.role;
        this.hostId = data.hostId;
        this.guestReady = false;
    }

    create() {
        this.width = this.scale.width;
        this.height = this.scale.height;

        // Background
        this.buildBackground();

        // Title
        this.add.text(this.width / 2, this.height * 0.18, 'ONLINE BATTLE', {
            fontFamily: 'Arial Black',
            fontSize: 48,
            color: '#4488ff',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
        }).setOrigin(0.5).setDepth(2);

        // Status text
        this.statusText = this.add.text(this.width / 2, this.height * 0.38, 'Initializing...', {
            fontFamily: 'Arial',
            fontSize: 22,
            color: '#cccccc',
            align: 'center',
        }).setOrigin(0.5).setDepth(2);

        // Back button
        this.backBtn = this.add.text(this.width / 2, this.height * 0.78, 'BACK', {
            fontFamily: 'Arial Black',
            fontSize: 22,
            color: '#ffffff',
            backgroundColor: '#555555',
            padding: { x: 28, y: 12 },
            align: 'center',
        }).setOrigin(0.5).setDepth(3)
            .setInteractive({ useHandCursor: true });

        this.backBtn.on('pointerover', () => this.backBtn.setStyle({ backgroundColor: '#777777' }));
        this.backBtn.on('pointerout', () => this.backBtn.setStyle({ backgroundColor: '#555555' }));
        this.backBtn.on('pointerdown', () => this.goBack());

        // Clean up any previous connection
        destroyNetworkManager();
        this.net = getNetworkManager();

        if (this.role === 'host') {
            this.setupHost();
        } else {
            this.setupJoin();
        }
    }

    // ================================================================
    //  HOST FLOW
    // ================================================================

    private async setupHost() {
        this.statusText.setText('Creating room...');

        try {
            const peerId = await this.net.host();

            // Build the join URL
            const url = new URL(window.location.href);
            url.searchParams.set('join', peerId);
            const joinUrl = url.toString();

            this.statusText.setText('Waiting for opponent...');

            // Show the join link
            this.linkText = this.add.text(this.width / 2, this.height * 0.48, peerId, {
                fontFamily: 'Arial Black',
                fontSize: 28,
                color: '#66ddff',
                stroke: '#000000',
                strokeThickness: 3,
                align: 'center',
            }).setOrigin(0.5).setDepth(2)
                .setInteractive({ useHandCursor: true });

            // Click to copy
            this.linkText.on('pointerdown', () => {
                navigator.clipboard?.writeText(joinUrl).then(() => {
                    this.statusText.setText('Link copied! Waiting for opponent...');
                }).catch(() => {
                    // Fallback: select the text
                    this.statusText.setText('Copy this link and send to your friend:');
                });
            });

            // Instruction
            this.add.text(this.width / 2, this.height * 0.55, 'Click the code above to copy the invite link', {
                fontFamily: 'Arial',
                fontSize: 15,
                color: '#888888',
                align: 'center',
            }).setOrigin(0.5).setDepth(2);

            // Listen for guest connection
            this.net.on('connected', () => {
                this.statusText.setText('Opponent connected!');
                this.guestReady = true;
                this.showStartButton();
            });

            this.net.on('disconnected', () => {
                this.statusText.setText('Opponent disconnected. Waiting...');
                this.guestReady = false;
                if (this.startBtn) {
                    this.startBtn.destroy();
                    this.startBtn = undefined;
                }
            });

        } catch (err) {
            this.statusText.setText('Failed to create room. Try again.');
            console.error(err);
        }
    }

    private showStartButton() {
        if (this.startBtn) return;

        this.startBtn = this.add.text(this.width / 2, this.height * 0.65, 'START GAME', {
            fontFamily: 'Arial Black',
            fontSize: 28,
            color: '#ffffff',
            backgroundColor: '#33aa55',
            padding: { x: 32, y: 14 },
            align: 'center',
        }).setOrigin(0.5).setDepth(3)
            .setInteractive({ useHandCursor: true })
            .setAlpha(0).setScale(0.8);

        this.tweens.add({
            targets: this.startBtn,
            alpha: 1,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut',
        });

        this.startBtn.on('pointerover', () => this.startBtn?.setStyle({ backgroundColor: '#44cc66' }));
        this.startBtn.on('pointerout', () => this.startBtn?.setStyle({ backgroundColor: '#33aa55' }));
        this.startBtn.on('pointerdown', () => this.startOnlineGame());
    }

    private startOnlineGame() {
        if (!this.guestReady) return;

        // Generate a shared seed for deterministic scenery placement
        const seed = Math.floor(Math.random() * 999999);

        // Tell guest to start
        this.net.send({ type: 'start', seed });

        // Start host game
        this.scene.start('Game', {
            sessionConfig: createOnlineHostConfig(),
            networkRole: 'host',
            seed,
        });
    }

    // ================================================================
    //  JOIN FLOW
    // ================================================================

    private async setupJoin() {
        if (!this.hostId) {
            this.statusText.setText('No room code provided.');
            return;
        }

        this.statusText.setText(`Connecting to ${this.hostId}...`);

        try {
            await this.net.join(this.hostId);

            this.statusText.setText('Connected! Waiting for host to start...');

            // Show a pulsing "waiting" indicator
            this.tweens.add({
                targets: this.statusText,
                alpha: 0.5,
                duration: 800,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });

            // Listen for start signal
            this.net.on('start', (packet: any) => {
                this.scene.start('Game', {
                    sessionConfig: createOnlineGuestConfig(),
                    networkRole: 'guest',
                    seed: packet.seed,
                });
            });

            this.net.on('disconnected', () => {
                this.statusText.setText('Host disconnected.');
                this.tweens.killTweensOf(this.statusText);
                this.statusText.setAlpha(1);
            });

        } catch (err) {
            this.statusText.setText('Failed to connect. Check the code and try again.');
            console.error(err);
        }
    }

    // ================================================================
    //  SHARED
    // ================================================================

    private goBack() {
        destroyNetworkManager();
        this.scene.start('MainMenu');
    }

    private buildBackground() {
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
                tile.setOrigin(0.5, 0.5).setScale(2).setDepth(0).setAlpha(0.4);
                tile.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
            }
        }

        this.add.rectangle(
            this.width / 2, this.height / 2,
            this.width, this.height,
            0x000000, 0.45
        ).setDepth(1);
    }
}
