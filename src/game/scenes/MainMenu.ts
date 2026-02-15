import { Scene, GameObjects } from 'phaser';

export class MainMenu extends Scene
{
    background: GameObjects.Image;
    trophy: GameObjects.Image;
    title: GameObjects.Text;
    subtitle: GameObjects.Text;
    controlsTitle: GameObjects.Text;
    controlsText: GameObjects.Text;
    startPrompt: GameObjects.Text;

    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        const centerX = 960; // 1920 / 2
        const centerY = 540; // 1080 / 2

        // Background (tiled desert sand)
        this.background = this.add.image(centerX, centerY, 'background');
        this.background.setDisplaySize(1920, 1080);

        // Trophy at top center
        this.trophy = this.add.image(centerX, 180, 'collect-1');
        this.trophy.setDisplaySize(120, 120 * (this.trophy.height / this.trophy.width)); // Maintain aspect ratio

        // Main title
        this.title = this.add.text(centerX, 340, 'Drift Game Demo', {
            fontFamily: 'Arial Black', 
            fontSize: 72, 
            color: '#ffdd00',
            stroke: '#000000', 
            strokeThickness: 10,
            align: 'center'
        }).setOrigin(0.5);

        // Subtitle
        this.subtitle = this.add.text(centerX, 420, 'Ryans AI Slop game', {
            fontFamily: 'Arial', 
            fontSize: 32, 
            color: '#ffffff',
            stroke: '#000000', 
            strokeThickness: 6,
            align: 'center'
        }).setOrigin(0.5);

        // Controls section
        this.controlsTitle = this.add.text(centerX, 540, 'CONTROLS', {
            fontFamily: 'Arial Black', 
            fontSize: 36, 
            color: '#44ff44',
            stroke: '#000000', 
            strokeThickness: 6,
            align: 'center'
        }).setOrigin(0.5);

        this.controlsText = this.add.text(centerX, 650, 
            'WASD or Arrow Keys - Drive\n' +
            'SHIFT - Nitro Boost\n' +
            'SPACE - Handbrake / Drift\n' +
            'R - Restart (when game over)', 
            {
                fontFamily: 'Courier', 
                fontSize: 28, 
                color: '#ffffff',
                backgroundColor: '#00000088',
                padding: { x: 20, y: 15 },
                align: 'center',
                lineSpacing: 8
            }
        ).setOrigin(0.5);

        // Start prompt (pulsing)
        this.startPrompt = this.add.text(centerX, 880, 'Click anywhere to start', {
            fontFamily: 'Arial Black', 
            fontSize: 40, 
            color: '#ffffff',
            stroke: '#000000', 
            strokeThickness: 6,
            align: 'center'
        }).setOrigin(0.5);

        // Pulsing animation for start prompt
        this.tweens.add({
            targets: this.startPrompt,
            alpha: 0.3,
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        this.input.once('pointerdown', () => {
            this.scene.start('Game');
        });
    }
}