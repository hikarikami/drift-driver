import { Scene } from 'phaser';

export class UIManager {
    private scene: Scene;
    private width: number;
    private height: number;

    scoreText!: Phaser.GameObjects.Text;
    private p2ScoreText?: Phaser.GameObjects.Text;
    timerText!: Phaser.GameObjects.Text;
    gameOverText!: Phaser.GameObjects.Text;
    boostBarBg!: Phaser.GameObjects.Graphics;
    boostBarFill!: Phaser.GameObjects.Graphics;

    private finalScoreText?: Phaser.GameObjects.Text;
    private playAgainBtn?: Phaser.GameObjects.Text;
    private menuBtn?: Phaser.GameObjects.Text;
    private resultElements: Phaser.GameObjects.GameObject[] = [];

    constructor(scene: Scene, width: number, height: number) {
        this.scene = scene;
        this.width = width;
        this.height = height;
    }

    /**
     * Creates all UI elements. Call during scene create().
     */
    create() {
        // P1 Score (top-left)
        this.scoreText = this.scene.add.text(16, 16, 'Score: 0', {
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

        this.boostBarBg = this.scene.add.graphics().setScrollFactor(0).setDepth(10);
        this.boostBarBg.fillStyle(0x000000, 0.5);
        this.boostBarBg.fillRoundedRect(barX, barY, barW, barH, 3);
        this.boostBarBg.lineStyle(1, 0xffffff, 0.4);
        this.boostBarBg.strokeRoundedRect(barX, barY, barW, barH, 3);

        this.boostBarFill = this.scene.add.graphics().setScrollFactor(0).setDepth(10);

        // Countdown timer
        this.timerText = this.scene.add.text(this.width / 2, 20, '60', {
            fontFamily: 'Arial Black',
            fontSize: 48,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10);

        // Game over text (hidden initially)
        this.gameOverText = this.scene.add.text(this.width / 2, this.height / 2 - 60, '', {
            fontFamily: 'Arial Black',
            fontSize: 52,
            color: '#ff3366',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center',
        }).setOrigin(0.5).setVisible(false).setScrollFactor(0).setDepth(10);
    }

    /**
     * Updates the score display. Pass p2Score for battle mode.
     */
    updateScore(p1Score: number, p2Score?: number) {
        if (p2Score !== undefined) {
            // Battle mode — P1 left, P2 right
            this.scoreText.setText(`P1: ${p1Score}`);
            this.scoreText.setColor('#ff6666');

            if (!this.p2ScoreText) {
                this.p2ScoreText = this.scene.add.text(this.width - 16, 16, `P2: ${p2Score}`, {
                    fontFamily: 'Arial Black',
                    fontSize: 24,
                    color: '#6699ff',
                    stroke: '#000000',
                    strokeThickness: 4,
                }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
            } else {
                this.p2ScoreText.setText(`P2: ${p2Score}`);
            }
        } else {
            this.scoreText.setText(`Score: ${p1Score}`);
        }
    }

    /**
     * Updates the timer display
     */
    updateTimer(timeRemaining: number) {
        const displaySec = Math.ceil(timeRemaining);
        this.timerText.setText(`${displaySec}`);
        if (timeRemaining <= 10) {
            this.timerText.setColor('#ff4444');
            this.timerText.setFontSize(56);
        } else {
            this.timerText.setColor('#ffffff');
            this.timerText.setFontSize(48);
        }
    }

    /**
     * Updates the boost bar display (smoothed)
     */
    updateBoostBar(boostBarDisplay: number, boostMax: number) {
        const barX = 16;
        const barY = 48;
        const barW = 120;
        const barH = 10;

        const fillW = barW * Math.max(0, boostBarDisplay / boostMax);

        this.boostBarFill.clear();
        const fuelRatio = boostBarDisplay / boostMax;
        const r = Math.round(255 * (1 - fuelRatio));
        const g = Math.round(136 + 68 * fuelRatio);
        const b = Math.round(255 * fuelRatio);
        const fillColor = (r << 16) | (g << 8) | b;
        this.boostBarFill.fillStyle(fillColor, 0.9);
        if (fillW > 1) {
            this.boostBarFill.fillRoundedRect(barX, barY, fillW, barH, 3);
        }
    }

    /**
     * Shows the +time bonus popup at a given position
     */
    showTimeBonusPopup(x: number, y: number, bonus: number) {
        const popup = this.scene.add.text(x, y, `+${bonus}s`, {
            fontFamily: 'Arial Black',
            fontSize: 28,
            color: '#44ff88',
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center',
        }).setOrigin(0.5).setDepth(15).setAlpha(0).setScale(0.3);

        this.scene.tweens.add({
            targets: popup,
            alpha: 1,
            scale: 1.2,
            y: y - 40,
            duration: 300,
            ease: 'Back.easeOut',
            onComplete: () => {
                this.scene.tweens.add({
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

    /**
     * Shows the single-player game over UI
     */
    showGameOverUI(score: number, onRestart: () => void) {
        this.timerText.setVisible(false);

        this.gameOverText.setText('GAME OVER');
        this.gameOverText.setAlpha(0);
        this.gameOverText.setScale(0.5);
        this.gameOverText.setVisible(true);

        this.scene.tweens.add({
            targets: this.gameOverText,
            alpha: 1,
            scale: 1,
            duration: 500,
            ease: 'Back.easeOut',
        });

        this.finalScoreText = this.scene.add.text(this.width / 2, this.height / 2 + 10, `Final Score: ${score}`, {
            fontFamily: 'Arial Black',
            fontSize: 48,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);

        this.scene.tweens.add({
            targets: this.finalScoreText,
            alpha: 1,
            y: this.height / 2 + 10,
            duration: 400,
            delay: 300,
            ease: 'Quad.easeOut',
        });

        this.playAgainBtn = this.createOverlayButton(
            this.width / 2, this.height / 2 + 100,
            'Play Again', '#33aa55', '#44cc66',
            onRestart, 600
        );
    }

    /**
     * Shows the battle mode results with winner announcement
     */
    showBattleResultUI(p1Score: number, p2Score: number, onRestart: () => void, onMenu: () => void) {
        this.timerText.setVisible(false);

        // Winner text
        let winnerText: string;
        let winnerColor: string;
        if (p1Score > p2Score) {
            winnerText = 'PLAYER 1 WINS!';
            winnerColor = '#ff6666';
        } else if (p2Score > p1Score) {
            winnerText = 'PLAYER 2 WINS!';
            winnerColor = '#6699ff';
        } else {
            winnerText = 'DRAW!';
            winnerColor = '#ffcc44';
        }

        this.gameOverText.setText(winnerText);
        this.gameOverText.setColor(winnerColor);
        this.gameOverText.setAlpha(0);
        this.gameOverText.setScale(0.5);
        this.gameOverText.setVisible(true);

        this.scene.tweens.add({
            targets: this.gameOverText,
            alpha: 1,
            scale: 1,
            duration: 500,
            ease: 'Back.easeOut',
        });

        // Score comparison
        const scoreCompare = this.scene.add.text(
            this.width / 2, this.height / 2 + 5,
            `P1: ${p1Score}  —  P2: ${p2Score}`, {
                fontFamily: 'Arial Black',
                fontSize: 36,
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 5,
                align: 'center',
            }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);

        this.scene.tweens.add({
            targets: scoreCompare,
            alpha: 1,
            duration: 400,
            delay: 300,
            ease: 'Quad.easeOut',
        });
        this.resultElements.push(scoreCompare);

        // Buttons
        this.playAgainBtn = this.createOverlayButton(
            this.width / 2 - 100, this.height / 2 + 85,
            'Rematch', '#cc5533', '#ee7744',
            onRestart, 600
        );

        this.menuBtn = this.createOverlayButton(
            this.width / 2 + 100, this.height / 2 + 85,
            'Menu', '#555555', '#777777',
            onMenu, 700
        );
    }

    private createOverlayButton(
        x: number, y: number,
        label: string, bgColor: string, hoverColor: string,
        onClick: () => void, delay: number
    ): Phaser.GameObjects.Text {
        const btn = this.scene.add.text(x, y, label, {
            fontFamily: 'Arial Black',
            fontSize: 24,
            color: '#ffffff',
            backgroundColor: bgColor,
            padding: { x: 20, y: 10 },
            align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10)
            .setInteractive({ useHandCursor: true }).setAlpha(0);

        this.scene.tweens.add({
            targets: btn,
            alpha: 1,
            duration: 400,
            delay,
            ease: 'Quad.easeOut',
        });

        btn.on('pointerover', () => btn.setStyle({ backgroundColor: hoverColor }));
        btn.on('pointerout', () => btn.setStyle({ backgroundColor: bgColor }));
        btn.on('pointerdown', onClick);

        this.resultElements.push(btn);
        return btn;
    }

    /**
     * Cleans up game over overlay for restart
     */
    cleanupGameOver() {
        this.gameOverText.setVisible(false);
        this.timerText.setVisible(true);
        if (this.finalScoreText) { this.finalScoreText.destroy(); this.finalScoreText = undefined; }
        if (this.playAgainBtn) { this.playAgainBtn.destroy(); this.playAgainBtn = undefined; }
        if (this.menuBtn) { this.menuBtn.destroy(); this.menuBtn = undefined; }
        if (this.p2ScoreText) { this.p2ScoreText.destroy(); this.p2ScoreText = undefined; }
        for (const el of this.resultElements) { el.destroy(); }
        this.resultElements = [];
    }

    /**
     * Shows a disconnect notification for online mode
     */
    showDisconnectMessage() {
        const msg = this.scene.add.text(this.width / 2, this.height / 2, 'OPPONENT DISCONNECTED', {
            fontFamily: 'Arial Black',
            fontSize: 32,
            color: '#ff4444',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setAlpha(0);

        this.scene.tweens.add({
            targets: msg,
            alpha: 1,
            duration: 400,
            ease: 'Quad.easeOut',
        });
    }
}
