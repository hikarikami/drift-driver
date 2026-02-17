/**
 * NetworkManager — thin wrapper around PeerJS for 2-player online battles.
 *
 * Architecture:
 *   HOST runs the authoritative game. Both cars, physics, pickups, scoring.
 *   GUEST sends input packets ~60/s, receives state snapshots ~30/s.
 *
 * Message format: { type: string, ...payload }
 */

import Peer, { DataConnection } from 'peerjs';

// ========== MESSAGE TYPES ==========

export interface InputPacket {
    type: 'input';
    turnInput: number;
    thrustInput: boolean;
    brakeInput: boolean;
    reverseInput: boolean;
    isAccelerating: boolean;
}

export interface CarState {
    x: number;
    y: number;
    vx: number;
    vy: number;
    angle: number;
    angularVel: number;
    boostFuel: number;
    boostIntensity: number;
    tireMarkIntensity: number;
}

export interface StatePacket {
    type: 'state';
    cars: CarState[];          // [host car, guest car]
    scores: number[];          // [host score, guest score]
    timeRemaining: number;
    pickupX: number;
    pickupY: number;
    gameOver: boolean;
}

export interface StartPacket {
    type: 'start';
    seed: number;              // shared RNG seed (legacy, kept for compat)
    sceneryData: any;          // SceneryData from host's SceneryManager
}

export interface LobbyPacket {
    type: 'lobby';
    status: 'ready' | 'start';
}

export interface SceneryPacket {
    type: 'scenery';
    sceneryData: any;
}

export type NetMessage = InputPacket | StatePacket | StartPacket | LobbyPacket | SceneryPacket;

// ========== EVENTS ==========

export type NetworkEvent =
    | 'connected'
    | 'disconnected'
    | 'input'
    | 'state'
    | 'start'
    | 'lobby'
    | 'scenery'
    | 'error';

type EventCallback = (data?: any) => void;

// ========== MANAGER ==========

export class NetworkManager {
    private peer: Peer | null = null;
    private connection: DataConnection | null = null;
    private listeners: Map<NetworkEvent, EventCallback[]> = new Map();

    /** Our PeerJS ID (available after open) */
    peerId: string = '';

    /** Are we the host? */
    isHost = false;

    /** Is the connection currently open? */
    get isConnected(): boolean {
        return this.connection?.open ?? false;
    }

    // ================================================================
    //  EVENT SYSTEM
    // ================================================================

    on(event: NetworkEvent, cb: EventCallback) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event)!.push(cb);
    }

    off(event: NetworkEvent, cb: EventCallback) {
        const list = this.listeners.get(event);
        if (list) {
            const idx = list.indexOf(cb);
            if (idx >= 0) list.splice(idx, 1);
        }
    }

    private emit(event: NetworkEvent, data?: any) {
        const list = this.listeners.get(event);
        if (list) list.forEach(cb => cb(data));
    }

    // ================================================================
    //  HOST: create a peer and wait for a guest to connect
    // ================================================================

    async host(): Promise<string> {
        this.isHost = true;

        return new Promise((resolve, reject) => {
            // Let PeerJS assign a random ID
            this.peer = new Peer();

            this.peer.on('open', (id: string) => {
                this.peerId = id;
                console.log('[Net] Hosting as', id);
                resolve(id);
            });

            this.peer.on('connection', (conn: DataConnection) => {
                console.log('[Net] Guest connected:', conn.peer);
                this.setupConnection(conn);
            });

            this.peer.on('error', (err: any) => {
                console.error('[Net] Host error:', err);
                this.emit('error', err);
                reject(err);
            });
        });
    }

    // ================================================================
    //  GUEST: connect to a host's peer ID
    // ================================================================

    async join(hostId: string): Promise<void> {
        this.isHost = false;

        return new Promise((resolve, reject) => {
            this.peer = new Peer();

            this.peer.on('open', () => {
                this.peerId = this.peer!.id;
                console.log('[Net] Joining', hostId, 'as', this.peerId);

                const conn = this.peer!.connect(hostId, { reliable: true });

                conn.on('open', () => {
                    this.setupConnection(conn);
                    resolve();
                });

                conn.on('error', (err: any) => {
                    console.error('[Net] Join connection error:', err);
                    this.emit('error', err);
                    reject(err);
                });
            });

            this.peer.on('error', (err: any) => {
                console.error('[Net] Join peer error:', err);
                this.emit('error', err);
                reject(err);
            });
        });
    }

    // ================================================================
    //  SHARED CONNECTION SETUP
    // ================================================================

    private setupConnection(conn: DataConnection) {
        this.connection = conn;

        conn.on('data', (data: unknown) => {
            const msg = data as NetMessage;
            switch (msg.type) {
                case 'input':   this.emit('input', msg); break;
                case 'state':   this.emit('state', msg); break;
                case 'start':   this.emit('start', msg); break;
                case 'lobby':   this.emit('lobby', msg); break;
                case 'scenery': this.emit('scenery', msg); break;
                default:        console.warn('[Net] Unknown message type:', msg);
            }
        });

        conn.on('close', () => {
            console.log('[Net] Connection closed');
            this.emit('disconnected');
        });

        conn.on('error', (err: any) => {
            console.error('[Net] Connection error:', err);
            this.emit('error', err);
        });

        this.emit('connected');
    }

    // ================================================================
    //  SEND
    // ================================================================

    send(msg: NetMessage) {
        if (this.connection?.open) {
            this.connection.send(msg);
        }
    }

    /** Host: broadcast state snapshot to guest */
    sendState(packet: StatePacket) {
        this.send(packet);
    }

    /** Guest: send input to host */
    sendInput(packet: InputPacket) {
        this.send(packet);
    }

    // ================================================================
    //  CLEANUP
    // ================================================================

    destroy() {
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.listeners.clear();
        this.peerId = '';
    }
}

// ========== SINGLETON ==========
// Shared across scenes (lobby → game → back to menu)

let _instance: NetworkManager | null = null;

export function getNetworkManager(): NetworkManager {
    if (!_instance) _instance = new NetworkManager();
    return _instance;
}

export function destroyNetworkManager() {
    if (_instance) {
        _instance.destroy();
        _instance = null;
    }
}