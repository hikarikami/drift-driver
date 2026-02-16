/**
 * Shared configuration types for game modes and player setup.
 * Designed to support local multiplayer now and PeerJS networking later.
 */

export type GameMode = 'single' | 'battle';

/**
 * Input source tells the car controller where to get its input from.
 * - 'keyboard': local keyboard with specific key bindings
 * - 'remote': input will be provided externally (for future PeerJS)
 */
export type InputSource = 'keyboard' | 'remote';

export interface KeyBindings {
    up: string;
    down: string;
    left: string;
    right: string;
    boost: string;
    brake: string;
}

export interface PlayerConfig {
    id: number;             // 1 or 2
    inputSource: InputSource;
    keys: KeyBindings;
    spritePrefix?: string;  // Car sprite folder name (e.g. 'car-1', 'car-2')
}

export interface GameSessionConfig {
    mode: GameMode;
    players: PlayerConfig[];
}

// ========== PRESETS ==========

export const PLAYER1_KEYS: KeyBindings = {
    up: 'W',
    down: 'S',
    left: 'A',
    right: 'D',
    boost: 'SHIFT',
    brake: 'SPACE',
};

export const PLAYER2_KEYS: KeyBindings = {
    up: 'UP',
    down: 'DOWN',
    left: 'LEFT',
    right: 'RIGHT',
    boost: 'ENTER',
    brake: 'BACKSPACE',
};

export function createSinglePlayerConfig(): GameSessionConfig {
    return {
        mode: 'single',
        players: [
            {
                id: 1,
                inputSource: 'keyboard',
                keys: {
                    up: 'W',
                    down: 'S',
                    left: 'A',
                    right: 'D',
                    boost: 'SHIFT',
                    brake: 'SPACE',
                },
                spritePrefix: 'car-1',
            },
        ],
    };
}

export function createBattleConfig(): GameSessionConfig {
    return {
        mode: 'battle',
        players: [
            {
                id: 1,
                inputSource: 'keyboard',
                keys: PLAYER1_KEYS,
                spritePrefix: 'car-1',
            },
            {
                id: 2,
                inputSource: 'keyboard',
                keys: PLAYER2_KEYS,
                spritePrefix: 'car-2',
            },
        ],
    };
}