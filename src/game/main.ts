import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { Game as MainGame } from './scenes/Game';
import { MainMenu } from './scenes/MainMenu';
import { OnlineLobby } from './scenes/OnlineLobby';
import { AUTO, Game } from 'phaser';
import { Preloader } from './scenes/Preloader';
import { PHYSICS_ENGINE } from './scenes/GameConfig';

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: 1600,  
    height: 1200, 
    parent: 'game-container',
    backgroundColor: '#1a1208',
    antialias: false,
    roundPixels: true,
    scale: {
        mode: Phaser.Scale.FIT,  // This makes it responsive!
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    dom: {
        createContainer: true,
    },
    physics: {
        // Toggle is set in GameConfig.ts — only the active engine's plugin is
        // loaded by Phaser, so scene.physics (Arcade) or scene.matter (Matter)
        // will be undefined if the respective engine is not selected.
        default: PHYSICS_ENGINE,

        // [Arcade only] — scene.physics, Phaser.Physics.Arcade.*
        arcade: {
            debug: false,
        },

        // [Matter only] — scene.matter, Phaser.Physics.Matter.*
        // gravity disabled; we apply thrust/drag manually each frame
        matter: {
            debug: false,
            gravity: { x: 0, y: 0 },
            setBounds: false,
            autoUpdate: true,
        },
    },
    scene: [
        Boot,
        Preloader,
        MainMenu,
        OnlineLobby,
        MainGame,
        GameOver
    ]
};

const StartGame = (parent: string) => {

    return new Game({ ...config, parent });

}

export default StartGame;
