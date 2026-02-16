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
        this.load.image('trophy', 'score/trophy.png');

        //load dirt tiles
        for (let i = 0; i <= 10; i++) {
            const num = String(i).padStart(3, '0');
            this.load.image(`tile_${num}`, `scenery/tilemap/dirt/tile_${num}.png`);
        }

        //load rock obstacles
        for (let i = 1; i <= 12; i++) {
            this.load.image(`rock-${i}`, `scenery/rocks/rock-${i}.png`);
        }

        // Load decoration tiles from row 5 (tiles 64-79, assuming 16 tiles per row)
        // Adjust the range based on which decorations you want
        for (let i = 50; i <= 60; i++) {
            const num = String(i).padStart(3, '0');
            this.load.image(`tile_${num}`, `scenery/tilemap/dirt/tile_${num}.png`);
        }

        // Load cactus/tree decorations
        for (let i = 1; i <= 7; i++) {
            this.load.image(`tree-${i}`, `scenery/cactus/tree-${i}.png`);
        }

        // Sounds
        this.load.audio('screech_sfx', 'sounds/screech.mp3');
        this.load.audio('engine_sfx', 'sounds/general.mp3');
        this.load.audio('stopping_sfx', 'sounds/stopping.mp3');
        this.load.audio('nitro_sfx', 'sounds/nitro.mp3');
        this.load.audio('collect-1', 'sounds/collect-1.mp3');
        this.load.audio('crash-1', 'sounds/car-crash-1.mp3');
        this.load.audio('crash-2', 'sounds/car-crash-2.mp3');
        this.load.audio('crash-3', 'sounds/car-crash-3.mp3');
        this.load.audio('trick', 'sounds/trick-1.mp3'); // Placeholder - add a quick "ding" or "whip" sound
        this.load.audio('theme1', 'music/music-1.mp3');
        this.load.audio('theme2', 'music/music-2.mp3');

        // Load 48 car rotation frames (000 = facing right, clockwise)
        for (let i = 0; i < 48; i++) {
            const frame = String(i).padStart(3, '0');
            this.load.image(`car-1_${frame}`, `car-1/Red_CIVIC_CLEAN_All_${frame}.png`);
            this.load.image(`car-2_${frame}`, `car-2/Blue_CIVIC_CLEAN_All_${frame}.png`);
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