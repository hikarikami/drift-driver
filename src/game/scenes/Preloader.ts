import { Scene } from 'phaser';

export class Preloader extends Scene
{
    constructor ()
    {
        super('Preloader');
    }

    init ()
    {
        //  We loaded this image in our Boot Scene, so we can display it here
        this.add.image(512, 384, 'background');

        //  A simple progress bar. This is the outline of the bar.
        this.add.rectangle(512, 384, 468, 32).setStrokeStyle(1, 0xffffff);

        //  This is the progress bar itself. It will increase in size from the left based on the % of progress.
        const bar = this.add.rectangle(512-230, 384, 4, 28, 0xffffff);

        //  Use the 'progress' event emitted by the LoaderPlugin to update the loading bar
        this.load.on('progress', (progress: number) => {

            //  Update the progress bar (our bar is 464px wide, so 100% = 464px)
            bar.width = 4 + (460 * progress);

        });
    }

    preload ()
    {
        //  Load the assets for the game
        this.load.setPath('assets');

        this.load.image('logo', 'logo.png');
        this.load.image('crate', 'score/crate.png');
        this.load.image('iso_tileset', 'scenery/tilemap/tileset.png');

        // Sounds
        this.load.audio('screech_sfx', 'sounds/screech.mp3');
        this.load.audio('engine_sfx', 'sounds/general.mp3');
        this.load.audio('stopping_sfx', 'sounds/stopping.mp3');
        this.load.audio('nitro_sfx', 'sounds/nitro.mp3');
        this.load.audio('collect-1', 'sounds/collect-1.mp3');
        this.load.audio('theme1', 'music/music-1.mp3');
        this.load.audio('theme2', 'music/music-2.mp3');

        // Load 48 car rotation frames (000 = facing right, clockwise)
        for (let i = 0; i < 48; i++) {
            const num = String(i).padStart(3, '0');
            this.load.image(`car_${num}`, `car/Red_CIVIC_CLEAN_All_${num}.png`);
        }
    }

    create ()
    {
        //  When all the assets have loaded, it's often worth creating global objects here that the rest of the game can use.
        //  For example, you can define global animations here, so we can use them in other scenes.

        //  Move to the MainMenu. You could also swap this for a Scene Transition, such as a camera fade.
        this.scene.start('MainMenu');
    }
}
