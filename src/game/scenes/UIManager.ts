import { Scene } from 'phaser';
import { HighScoreManager } from '../HighScoreManager';
import { LeaderboardService, LeaderboardEntry, PlayerContext } from '../LeaderboardService';

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

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
    private boostBarGlow!: Phaser.GameObjects.Graphics;

    private finalScoreText?: Phaser.GameObjects.Text;
    private playAgainBtn?: Phaser.GameObjects.Text;
    private menuBtn?: Phaser.GameObjects.Text;
    private resultElements: Phaser.GameObjects.GameObject[] = [];
    private dimOverlay?: Phaser.GameObjects.Graphics;
    private _gameOverActive = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _wheelHandler?: (...args: any[]) => void;

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
        this.scoreText = this.scene.add.text(16, 14, 'Score: 0', {
            fontFamily: 'BoldPixels',
            fontSize: 30,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4,
        }).setScrollFactor(0).setDepth(10);

        // Boost gauge bar
        const barX = 16;
        const barY = 54;
        const barW = 160;
        const barH = 18;

        // Glow layer (behind the bar, depth 9 so it sits under the bg border)
        this.boostBarGlow = this.scene.add.graphics().setScrollFactor(0).setDepth(9);

        this.boostBarBg = this.scene.add.graphics().setScrollFactor(0).setDepth(10);
        this.boostBarBg.fillStyle(0x000000, 0.55);
        this.boostBarBg.fillRoundedRect(barX, barY, barW, barH, 5);
        this.boostBarBg.lineStyle(1, 0xffffff, 0.25);
        this.boostBarBg.strokeRoundedRect(barX, barY, barW, barH, 5);

        this.boostBarFill = this.scene.add.graphics().setScrollFactor(0).setDepth(10);

        // "⚡ NITRO" label overlaid on top of the bar
        this.scene.add.text(barX + 8, barY + barH / 2, '⚡ NITRO', {
            fontFamily: 'BoldPixels',
            fontSize: 11,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2,
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);

        // Countdown timer
        this.timerText = this.scene.add.text(this.width / 2, 20, '64', {
            fontFamily: 'BoldPixels',
            fontSize: 72,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10);

        // Game over text (hidden initially)
        this.gameOverText = this.scene.add.text(this.width / 2, this.height / 2 - 60, '', {
            fontFamily: 'BoldPixels',
            fontSize: 90,
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
                    fontFamily: 'BoldPixels',
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
            this.timerText.setFontSize(82);
        } else {
            this.timerText.setColor('#ffffff');
            this.timerText.setFontSize(72);
        }
    }

    /**
     * Updates the boost bar display (smoothed)
     */
    updateBoostBar(boostBarDisplay: number, boostMax: number) {
        const barX = 16;
        const barY = 54;
        const barW = 160;
        const barH = 18;

        const fuelRatio = Math.max(0, boostBarDisplay / boostMax);
        const fillW = barW * fuelRatio;

        // Fill colour: blue when full, orange-red when low
        const r = Math.round(255 * (1 - fuelRatio));
        const g = Math.round(136 + 68 * fuelRatio);
        const b = Math.round(255 * fuelRatio);
        const fillColor = (r << 16) | (g << 8) | b;

        // Outer glow — fades in above 35% charge
        this.boostBarGlow.clear();
        if (fuelRatio > 0.35) {
            const glowAlpha = ((fuelRatio - 0.35) / 0.65) * 0.28;
            this.boostBarGlow.fillStyle(fillColor, glowAlpha);
            this.boostBarGlow.fillRoundedRect(barX - 5, barY - 5, barW + 10, barH + 10, 9);
        }

        // Main fill
        this.boostBarFill.clear();
        if (fillW > 1) {
            this.boostBarFill.fillStyle(fillColor, 0.92);
            this.boostBarFill.fillRoundedRect(barX, barY, fillW, barH, 5);

            // Top-edge shine stripe
            this.boostBarFill.fillStyle(0xffffff, 0.22);
            this.boostBarFill.fillRoundedRect(
                barX + 2, barY + 2,
                Math.max(0, fillW - 4), 4,
                { tl: 3, tr: 3, bl: 0, br: 0 },
            );
        }
    }

    /**
     * Shows the +time bonus popup at a given position
     */
    showTimeBonusPopup(x: number, y: number, bonus: number) {
        const popup = this.scene.add.text(x, y, `+${bonus}s`, {
            fontFamily: 'BoldPixels',
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

    fadeDimOverlay() {
        this.dimOverlay = this.scene.add.graphics()
            .setScrollFactor(0)
            .setDepth(8)
            .setAlpha(0);
        this.dimOverlay.fillStyle(0x000000, 1);
        this.dimOverlay.fillRect(0, 0, this.width, this.height);
        this.scene.tweens.add({
            targets: this.dimOverlay,
            alpha: 0.45,
            duration: 1800,
            ease: 'Sine.easeOut',
        });
        this.resultElements.push(this.dimOverlay);
    }

    /**
     * Shows the single-player game over UI with global leaderboard.
     * Saves locally as a fallback, then attempts an async online submission + fetch.
     */
    async showGameOverUI(
        score: number,
        duration: number,
        playerName: string,
        onRestart: () => void,
        onMenu: () => void
    ) {
        this._gameOverActive = true;
        this.timerText.setVisible(false);

        // Always persist locally first (offline fallback)
        const localRank  = HighScoreManager.saveScore(playerName, score, duration);
        const localScores = HighScoreManager.getTopScores();

        // ── Layout anchors ──────────────────────────────────────────────────
        const cx = this.width / 2;
        const titleY   = this.height * 0.09;
        const nameY    = this.height * 0.15;
        const scoreY   = this.height * 0.21;
        const badgeY   = this.height * 0.26;
        const tableTop = this.height * 0.31;
        const btnY     = this.height * 0.88;

        // Pre-compute top-5 card bottom so context card can sit right below it
        const TOP5_PANEL_H  = 14 * 2 + 5 * 46 + 10; // 268 px
        const top5CardTop   = tableTop + 24;
        const top5CardBot   = top5CardTop + TOP5_PANEL_H;
        const ctxHeaderY    = top5CardBot + 20;

        // ── GAME OVER title ──────────────────────────────────────────────────
        this.gameOverText.setY(titleY);
        this.gameOverText.setText('GAME OVER');
        this.gameOverText.setAlpha(0).setScale(0.5).setVisible(true);
        this.scene.tweens.add({
            targets: this.gameOverText,
            alpha: 1, scale: 1, duration: 500, ease: 'Back.easeOut',
        });

        // ── Player name ──────────────────────────────────────────────────────
        const nameLabel = this.scene.add.text(cx, nameY, playerName, {
            fontFamily: 'BoldPixels',
            fontSize: 24,
            color: '#ffcc66',
            stroke: '#000000',
            strokeThickness: 3,
            align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);
        this.scene.tweens.add({ targets: nameLabel, alpha: 1, duration: 400, delay: 150 });
        this.resultElements.push(nameLabel);

        // ── Score + time ─────────────────────────────────────────────────────
        this.finalScoreText = this.scene.add.text(
            cx, scoreY,
            `Score: ${score.toLocaleString()}   •   Run Time: ${formatTime(duration)}`,
            {
                fontFamily: 'BoldPixels',
                fontSize: 36,
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 5,
                align: 'center',
            }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);
        this.scene.tweens.add({ targets: this.finalScoreText, alpha: 1, duration: 400, delay: 250 });

        // ── Loading placeholder in the table area ────────────────────────────
        const loadingText = this.scene.add.text(cx, tableTop + 80, 'Loading leaderboard...', {
            fontFamily: 'BoldPixels',
            fontSize: 22,
            color: '#777777',
            stroke: '#000000',
            strokeThickness: 3,
            align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);
        this.scene.tweens.add({ targets: loadingText, alpha: 1, duration: 300, delay: 400 });
        this.resultElements.push(loadingText);

        // ── Buttons (shown immediately, no need to wait for leaderboard) ─────
        this.playAgainBtn = this.createOverlayButton(
            cx - 130, btnY, 'Play Again', '#33aa55', '#44cc66', onRestart, 700
        );
        this.menuBtn = this.createOverlayButton(
            cx + 130, btnY, 'Main Menu', '#555555', '#777777', onMenu, 800
        );

        // Helper to cleanly destroy the loading text (called exactly once)
        let loadDismissed = false;
        const dismissLoading = () => {
            if (loadDismissed) return;
            loadDismissed = true;
            const idx = this.resultElements.indexOf(loadingText);
            if (idx >= 0) this.resultElements.splice(idx, 1);
            loadingText.destroy();
        };

        // ── Online leaderboard ───────────────────────────────────────────────
        try {
            await LeaderboardService.submitScore(playerName, score, duration);
            if (!this._gameOverActive) return;

            const [topScores, playerContext] = await Promise.all([
                LeaderboardService.getTopScores(10),
                LeaderboardService.getPlayerContext(playerName, score, duration),
            ]);
            if (!this._gameOverActive) return;

            dismissLoading();
            this.buildScoreTable(cx, tableTop, topScores, playerContext.rank, score, true, playerName);
            this.showRankBadge(cx, badgeY, playerContext.rank);

            if (playerContext.rank > 10) {
                this.buildPlayerContextCard(cx, ctxHeaderY, playerContext);
            }
        } catch (err) {
            console.warn('[Leaderboard] Online unavailable, using local scores:', err);
            if (!this._gameOverActive) return;

            dismissLoading();

            // Small "(offline)" label above the table header
            const offlineNote = this.scene.add.text(cx, tableTop - 4, '(offline)', {
                fontFamily: 'BoldPixels',
                fontSize: 14,
                color: '#555555',
                stroke: '#000000',
                strokeThickness: 2,
                align: 'center',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(10);
            this.resultElements.push(offlineNote);

            this.buildScoreTable(cx, tableTop + 18, localScores, localRank, score, false, playerName);
            this.showRankBadge(cx, badgeY, localRank);
        }
    }

    private showRankBadge(cx: number, y: number, rank: number | null) {
        if (rank === null) return;

        if (rank === 1) {
            const badge = this.scene.add.text(cx, y, '★  NEW HIGH SCORE!  ★', {
                fontFamily: 'BoldPixels',
                fontSize: 26,
                color: '#ffdd44',
                stroke: '#000000',
                strokeThickness: 4,
                align: 'center',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0).setScale(0.6);
            this.scene.tweens.add({ targets: badge, alpha: 1, scale: 1, duration: 500, ease: 'Back.easeOut' });
            this.resultElements.push(badge);
        } else {
            const label = rank <= 10 ? `#${rank} All-Time` : `Global Rank  #${rank}`;
            const badge = this.scene.add.text(cx, y, label, {
                fontFamily: 'BoldPixels',
                fontSize: 22,
                color: '#aaddff',
                stroke: '#000000',
                strokeThickness: 4,
                align: 'center',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);
            this.scene.tweens.add({ targets: badge, alpha: 1, duration: 400 });
            this.resultElements.push(badge);
        }
    }

    private buildScoreTable(
        cx: number,
        topY: number,
        entries: LeaderboardEntry[],
        thisRunRank: number | null,
        thisRunScore: number,
        isOnline: boolean,
        thisRunPlayerName: string
    ) {
        const ROW_H        = 46;
        const VISIBLE_ROWS = 5;
        const PAD_X        = 36;
        const PAD_Y        = 14;
        const panelW       = 560;
        const panelH       = PAD_Y * 2 + VISIBLE_ROWS * ROW_H + 10;
        const panelX       = cx - panelW / 2;
        const totalEntries = entries.length;
        const maxScroll    = Math.max(0, totalEntries - VISIBLE_ROWS);

        const rankColors = [
            '#ffd700', '#c0c0c0', '#cd7f32', '#aaaaaa', '#888888',
            '#777777', '#666666', '#666666', '#555555', '#555555',
        ];
        const rankLabels = [
            '1st', '2nd', '3rd', '4th', '5th',
            '6th', '7th', '8th', '9th', '10th',
        ];

        const headerLabel = isOnline ? 'GLOBAL TOP 10' : 'TOP 10 SCORES';

        // Section header
        const header = this.scene.add.text(cx, topY, headerLabel, {
            fontFamily: 'BoldPixels',
            fontSize: 18,
            color: '#fafafa',
            align: 'center',
            letterSpacing: 4,
            stroke: '#000000',
            strokeThickness: 4,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);
        this.scene.tweens.add({ targets: header, alpha: 1, duration: 300, delay: 550 });
        this.resultElements.push(header);

        const cardTop = topY + 24;

        // Dark card background — always sized for 5 visible rows
        const card = this.scene.add.graphics().setScrollFactor(0).setDepth(9).setAlpha(0);
        card.fillStyle(0x000000, 0.55);
        card.fillRoundedRect(panelX, cardTop, panelW, panelH, 10);
        card.lineStyle(1, 0x444444, 0.8);
        card.strokeRoundedRect(panelX, cardTop, panelW, panelH, 10);
        this.scene.tweens.add({ targets: card, alpha: 1, duration: 300, delay: 600 });
        this.resultElements.push(card);

        // ── Build 5 reusable row slots ────────────────────────────────────────
        type RowSlot = {
            highlight: Phaser.GameObjects.Graphics;
            rankTxt:   Phaser.GameObjects.Text;
            starTxt:   Phaser.GameObjects.Text;
            nameTxt:   Phaser.GameObjects.Text;
            scoreTxt:  Phaser.GameObjects.Text;
            timeTxt:   Phaser.GameObjects.Text;
            rowY:      number;
        };

        const slots: RowSlot[] = [];

        for (let slot = 0; slot < VISIBLE_ROWS; slot++) {
            const rowY  = cardTop + PAD_Y + slot * ROW_H + ROW_H / 2;
            const delay = 650 + slot * 60;

            const highlight = this.scene.add.graphics().setScrollFactor(0).setDepth(9).setAlpha(0);
            this.resultElements.push(highlight);

            const rankTxt = this.scene.add.text(panelX + PAD_X, rowY, '', {
                fontFamily: 'BoldPixels', fontSize: 21, color: '#aaaaaa',
            }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
            this.scene.tweens.add({ targets: rankTxt, alpha: 1, duration: 300, delay });
            this.resultElements.push(rankTxt);

            const starTxt = this.scene.add.text(panelX + PAD_X + 46, rowY, '', {
                fontFamily: 'BoldPixels', fontSize: 21, color: '#ffdd44',
            }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
            this.scene.tweens.add({ targets: starTxt, alpha: 1, duration: 300, delay });
            this.resultElements.push(starTxt);

            const nameTxt = this.scene.add.text(panelX + PAD_X + 70, rowY, '', {
                fontFamily: 'BoldPixels', fontSize: 18, color: '#999999',
            }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
            this.scene.tweens.add({ targets: nameTxt, alpha: 1, duration: 300, delay });
            this.resultElements.push(nameTxt);

            const scoreTxt = this.scene.add.text(panelX + panelW - PAD_X - 100, rowY, '', {
                fontFamily: 'BoldPixels', fontSize: 20, color: '#cccccc',
            }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
            this.scene.tweens.add({ targets: scoreTxt, alpha: 1, duration: 300, delay });
            this.resultElements.push(scoreTxt);

            const timeTxt = this.scene.add.text(panelX + panelW - PAD_X, rowY, '', {
                fontFamily: 'BoldPixels', fontSize: 16, color: '#777777',
            }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
            this.scene.tweens.add({ targets: timeTxt, alpha: 1, duration: 300, delay });
            this.resultElements.push(timeTxt);

            slots.push({ highlight, rankTxt, starTxt, nameTxt, scoreTxt, timeTxt, rowY });
        }

        // ── Scroll arrows ─────────────────────────────────────────────────────
        const arrowX    = panelX + panelW + 28;
        const arrowUpY  = cardTop + panelH / 2 - 22;
        const arrowDnY  = cardTop + panelH / 2 + 22;

        const upBtn = this.scene.add.text(arrowX, arrowUpY, '▲', {
            fontFamily: 'BoldPixels', fontSize: 22, color: '#444444',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(12).setAlpha(0)
          .setInteractive({ useHandCursor: true });
        this.resultElements.push(upBtn);

        const downBtn = this.scene.add.text(arrowX, arrowDnY, '▼', {
            fontFamily: 'BoldPixels', fontSize: 22, color: '#ffffff',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(12).setAlpha(0)
          .setInteractive({ useHandCursor: true });
        this.resultElements.push(downBtn);

        // ── Page indicator ────────────────────────────────────────────────────
        const pageIndicator = this.scene.add.text(cx, cardTop + panelH + 6, '', {
            fontFamily: 'BoldPixels', fontSize: 13, color: '#555555', align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);
        this.resultElements.push(pageIndicator);

        // ── Slot renderer ─────────────────────────────────────────────────────
        let scrollOffset = 0;

        const updateArrows = () => {
            upBtn.setColor(scrollOffset === 0 ? '#444444' : '#ffffff');
            downBtn.setColor(scrollOffset >= maxScroll ? '#444444' : '#ffffff');
        };

        const renderSlots = (offset: number) => {
            scrollOffset = offset;

            for (let slot = 0; slot < VISIBLE_ROWS; slot++) {
                const i     = offset + slot;
                const entry = entries[i];
                const { highlight, rankTxt, starTxt, nameTxt, scoreTxt, timeTxt, rowY } = slots[slot];
                const isThisRun = thisRunRank !== null
                    && (i + 1) === thisRunRank
                    && entry?.score === thisRunScore
                    && entry?.playerName === thisRunPlayerName;

                rankTxt.setText(rankLabels[i] ?? `${i + 1}th`);
                rankTxt.setColor(rankColors[i] ?? '#555555');

                highlight.clear();
                if (isThisRun) {
                    highlight.fillStyle(0xffffff, 0.07);
                    highlight.fillRoundedRect(panelX + 4, rowY - ROW_H / 2 + 2, panelW - 8, ROW_H - 4, 6);
                }

                if (!entry) {
                    starTxt.setText('');
                    nameTxt.setText('—').setColor('#444444');
                    scoreTxt.setText('');
                    timeTxt.setText('');
                } else {
                    starTxt.setText(isThisRun ? '*' : '');
                    nameTxt.setText(entry.playerName).setColor(isThisRun ? '#ffcc66' : '#999999');
                    scoreTxt.setText(entry.score.toLocaleString()).setColor(isThisRun ? '#ffffff' : '#cccccc');
                    timeTxt.setText(formatTime(entry.duration)).setColor(isThisRun ? '#aaddff' : '#777777');
                }
            }

            updateArrows();

            if (maxScroll > 0) {
                const from = scrollOffset + 1;
                const to   = Math.min(scrollOffset + VISIBLE_ROWS, totalEntries);
                pageIndicator.setText(`${from}–${to} / ${totalEntries}`);
            }
        };

        // Initial render
        renderSlots(0);

        // Show scroll controls only when there are more than 5 entries
        if (maxScroll > 0) {
            this.scene.tweens.add({
                targets: [upBtn, downBtn, pageIndicator],
                alpha: 1, duration: 300, delay: 850,
            });

            upBtn.on('pointerdown', () => { if (scrollOffset > 0) renderSlots(scrollOffset - 1); });
            downBtn.on('pointerdown', () => { if (scrollOffset < maxScroll) renderSlots(scrollOffset + 1); });

            upBtn.on('pointerover', () => { if (scrollOffset > 0) upBtn.setColor('#ffcc66'); });
            upBtn.on('pointerout',  () => updateArrows());
            downBtn.on('pointerover', () => { if (scrollOffset < maxScroll) downBtn.setColor('#ffcc66'); });
            downBtn.on('pointerout',  () => updateArrows());

            this._wheelHandler = (_p: any, _g: any, _dx: any, dy: any) => {
                if (dy > 0 && scrollOffset < maxScroll) renderSlots(scrollOffset + 1);
                else if (dy < 0 && scrollOffset > 0)   renderSlots(scrollOffset - 1);
            };
            this.scene.input.on('wheel', this._wheelHandler);
        }
    }

    /**
     * Draws the "Your Position" card below the top-5 table.
     * Shows the nearest entry above, the player's own entry, and the nearest entry below.
     */
    private buildPlayerContextCard(cx: number, topY: number, context: PlayerContext) {
        const ROW_H  = 46;
        const PAD_X  = 36;
        const PAD_Y  = 14;
        const panelW = 560;
        const panelH = PAD_Y * 2 + 3 * ROW_H + 10;
        const panelX = cx - panelW / 2;

        const header = this.scene.add.text(cx, topY, 'YOUR POSITION', {
            fontFamily: 'BoldPixels',
            fontSize: 18,
            color: '#fafafa',
            align: 'center',
            letterSpacing: 4,
            stroke: '#000000',
            strokeThickness: 4,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setAlpha(0);
        this.scene.tweens.add({ targets: header, alpha: 1, duration: 300, delay: 800 });
        this.resultElements.push(header);

        const cardTop = topY + 24;

        const card = this.scene.add.graphics().setScrollFactor(0).setDepth(9).setAlpha(0);
        card.fillStyle(0x000000, 0.55);
        card.fillRoundedRect(panelX, cardTop, panelW, panelH, 10);
        card.lineStyle(1, 0x444444, 0.8);
        card.strokeRoundedRect(panelX, cardTop, panelW, panelH, 10);
        this.scene.tweens.add({ targets: card, alpha: 1, duration: 300, delay: 850 });
        this.resultElements.push(card);

        const rows: { entry: LeaderboardEntry | null; rank: number; isPlayer: boolean }[] = [
            { entry: context.above,   rank: context.rank - 1, isPlayer: false },
            { entry: context.myEntry, rank: context.rank,     isPlayer: true  },
            { entry: context.below,   rank: context.rank + 1, isPlayer: false },
        ];

        rows.forEach(({ entry, rank, isPlayer }, i) => {
            const rowY = cardTop + PAD_Y + i * ROW_H + ROW_H / 2;
            const delay = 900 + i * 60;

            if (isPlayer) {
                const highlight = this.scene.add.graphics().setScrollFactor(0).setDepth(9).setAlpha(0);
                highlight.fillStyle(0xffffff, 0.07);
                highlight.fillRoundedRect(panelX + 4, rowY - ROW_H / 2 + 2, panelW - 8, ROW_H - 4, 6);
                this.scene.tweens.add({ targets: highlight, alpha: 1, duration: 300, delay });
                this.resultElements.push(highlight);

                const arrow = this.scene.add.text(panelX + PAD_X - 6, rowY, '►', {
                    fontFamily: 'BoldPixels', fontSize: 16, color: '#ffcc66',
                }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
                this.scene.tweens.add({ targets: arrow, alpha: 1, duration: 300, delay });
                this.resultElements.push(arrow);
            }

            // Rank number
            const rankLabel = this.scene.add.text(
                panelX + PAD_X, rowY,
                `#${rank}`,
                { fontFamily: 'BoldPixels', fontSize: 21, color: isPlayer ? '#ffcc66' : '#888888' }
            ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
            this.scene.tweens.add({ targets: rankLabel, alpha: 1, duration: 300, delay });
            this.resultElements.push(rankLabel);

            if (!entry) {
                const dash = this.scene.add.text(
                    panelX + PAD_X + 60, rowY, '—',
                    { fontFamily: 'BoldPixels', fontSize: 18, color: '#444444' }
                ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
                this.scene.tweens.add({ targets: dash, alpha: 1, duration: 300, delay });
                this.resultElements.push(dash);
                return;
            }

            const nameText = this.scene.add.text(
                panelX + PAD_X + 70, rowY,
                entry.playerName,
                { fontFamily: 'BoldPixels', fontSize: 18, color: isPlayer ? '#ffcc66' : '#999999' }
            ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
            this.scene.tweens.add({ targets: nameText, alpha: 1, duration: 300, delay });
            this.resultElements.push(nameText);

            const scoreText = this.scene.add.text(
                panelX + panelW - PAD_X - 100, rowY,
                entry.score.toLocaleString(),
                { fontFamily: 'BoldPixels', fontSize: 20, color: isPlayer ? '#ffffff' : '#cccccc' }
            ).setOrigin(1, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
            this.scene.tweens.add({ targets: scoreText, alpha: 1, duration: 300, delay });
            this.resultElements.push(scoreText);

            const timeText = this.scene.add.text(
                panelX + panelW - PAD_X, rowY,
                formatTime(entry.duration),
                { fontFamily: 'BoldPixels', fontSize: 16, color: isPlayer ? '#aaddff' : '#777777' }
            ).setOrigin(1, 0.5).setScrollFactor(0).setDepth(11).setAlpha(0);
            this.scene.tweens.add({ targets: timeText, alpha: 1, duration: 300, delay });
            this.resultElements.push(timeText);
        });
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
                fontFamily: 'BoldPixels',
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
            'Main Menu', '#555555', '#777777',
            onMenu, 700
        );
    }

    private createOverlayButton(
        x: number, y: number,
        label: string, bgColor: string, hoverColor: string,
        onClick: () => void, delay: number
    ): Phaser.GameObjects.Text {
        const btn = this.scene.add.text(x, y, label, {
            fontFamily: 'BoldPixels',
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
        this._gameOverActive = false;
        this.gameOverText.setVisible(false);
        this.timerText.setVisible(true);
        if (this._wheelHandler) {
            this.scene.input.off('wheel', this._wheelHandler as (...args: any[]) => void);
            this._wheelHandler = undefined;
        }
        if (this.finalScoreText) { this.finalScoreText.destroy(); this.finalScoreText = undefined; }
        if (this.playAgainBtn) { this.playAgainBtn.destroy(); this.playAgainBtn = undefined; }
        if (this.menuBtn) { this.menuBtn.destroy(); this.menuBtn = undefined; }
        if (this.p2ScoreText) { this.p2ScoreText.destroy(); this.p2ScoreText = undefined; }
        for (const el of this.resultElements) { el.destroy(); }
        this.resultElements = [];
        this.dimOverlay = undefined;
    }

    /**
     * Shows a disconnect notification for online mode
     */
    showDisconnectMessage() {
        const msg = this.scene.add.text(this.width / 2, this.height / 2, 'OPPONENT DISCONNECTED', {
            fontFamily: 'BoldPixels',
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
