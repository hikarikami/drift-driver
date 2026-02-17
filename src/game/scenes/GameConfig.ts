/**
 * Shared configuration types for game modes and player setup.
 * Supports: single player, local battle, and online battle (PeerJS).
 */

export type GameMode = 'single' | 'battle' | 'online';

/**
 * Input source tells the car controller where to get its input from.
 * - 'keyboard': local keyboard with specific key bindings
 * - 'remote': input will be provided externally via network
 */
export type InputSource = 'keyboard' | 'remote';

export interface KeyBindings {
    up: string | number;
    down: string | number;
    left: string | number;
    right: string | number;
    boost: string | number;
    brake: string | number;
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

// ========== KEY PRESETS ==========

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
    boost: 190,       // Period key (.)
    brake: 188,       // Comma key (,)
};

// Dummy keys for remote player (never read from keyboard)
const REMOTE_KEYS: KeyBindings = {
    up: 'NUMPAD_0',
    down: 'NUMPAD_0',
    left: 'NUMPAD_0',
    right: 'NUMPAD_0',
    boost: 'NUMPAD_0',
    brake: 'NUMPAD_0',
};

// ========== CONFIG FACTORIES ==========

export function createSinglePlayerConfig(): GameSessionConfig {
    return {
        mode: 'single',
        players: [
            {
                id: 1,
                inputSource: 'keyboard',
                keys: PLAYER1_KEYS,
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

/**
 * Online host: Player 1 is local keyboard, Player 2 is remote (input from network).
 */
export function createOnlineHostConfig(): GameSessionConfig {
    return {
        mode: 'online',
        players: [
            {
                id: 1,
                inputSource: 'keyboard',
                keys: PLAYER1_KEYS,
                spritePrefix: 'car-1',
            },
            {
                id: 2,
                inputSource: 'remote',
                keys: REMOTE_KEYS,
                spritePrefix: 'car-2',
            },
        ],
    };
}

/**
 * Online guest: Player 1 is remote (state from network), Player 2 is local keyboard.
 * Note: the guest uses PLAYER1_KEYS (WASD) for their own car, since they're the only
 * local player. The "remote" player 1 is the host's car rendered from state packets.
 */
export function createOnlineGuestConfig(): GameSessionConfig {
    return {
        mode: 'online',
        players: [
            {
                id: 1,
                inputSource: 'remote',
                keys: REMOTE_KEYS,
                spritePrefix: 'car-1',
            },
            {
                id: 2,
                inputSource: 'keyboard',
                keys: PLAYER1_KEYS,    // Guest uses WASD
                spritePrefix: 'car-2',
            },
        ],
    };
}
