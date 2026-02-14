import { Scene } from 'phaser';

/**
 * Flexible sound manager for layering game audio.
 *
 * Supports two types of sound layers:
 *
 * 1. **Standard layers** — volume driven by an external intensity value (0–1).
 *    Great for reactive SFX like tire screeches.
 *
 * 2. **Crossfade layers** — two instances of the same sound alternate,
 *    crossfading between them for a seamless ambient loop.
 *    Each instance starts at a random seek position for variety.
 */

// ── Standard layer ──────────────────────────────────────────────

interface LayerConfig {
    key: string;
    loop: boolean;
    maxVolume: number;
    fadeIn: number;
    fadeOut: number;
    /** Start playback this many seconds into the file */
    seekStart: number;
    /** Maximum duration to play (in seconds). Only applies to non-looping sounds. */
    maxDuration?: number;
}

interface Layer {
    config: LayerConfig;
    sound: Phaser.Sound.BaseSound;
    currentVolume: number;
    targetVolume: number;
    playing: boolean;
    /** Tracks playback time for non-looping sounds with maxDuration */
    playbackTime: number;
}

// ── Crossfade layer ─────────────────────────────────────────────

interface CrossfadeConfig {
    key: string;
    maxVolume: number;
    /** How long (seconds) the crossfade overlap lasts */
    crossfadeDuration: number;
    /** At what fraction of playback (0–1) to begin crossfading to next instance */
    crossfadeAt: number;
}

interface CrossfadeInstance {
    sound: Phaser.Sound.WebAudioSound;
    volume: number;
    state: 'fadein' | 'playing' | 'fadeout' | 'idle';
    elapsed: number;
    duration: number;
}

interface CrossfadeLayer {
    config: CrossfadeConfig;
    a: CrossfadeInstance;
    b: CrossfadeInstance;
    active: 'a' | 'b';
    started: boolean;
}

// ── SoundManager ────────────────────────────────────────────────

export class SoundManager {
    private scene: Scene;
    private layers: Map<string, Layer> = new Map();
    private crossfadeLayers: Map<string, CrossfadeLayer> = new Map();

    constructor(scene: Scene) {
        this.scene = scene;
    }

    // ── Standard layer API ──────────────────────────────────────

    addLayer(
        name: string,
        key: string,
        options: {
            loop?: boolean;
            maxVolume?: number;
            fadeIn?: number;
            fadeOut?: number;
            seekStart?: number;
            maxDuration?: number;
        } = {}
    ) {
        const config: LayerConfig = {
            key,
            loop: options.loop ?? true,
            maxVolume: options.maxVolume ?? 1.5,  // Increased from 1.0 for better audio levels
            fadeIn: options.fadeIn ?? 4,
            fadeOut: options.fadeOut ?? 4,
            seekStart: options.seekStart ?? 0,
            maxDuration: options.maxDuration,
        };

        const sound = this.scene.sound.add(key, {
            loop: config.loop,
            volume: 0,
        });

        this.layers.set(name, {
            config,
            sound,
            currentVolume: 0,
            targetVolume: 0,
            playing: false,
            playbackTime: 0,
        });
    }

    setLayerTarget(name: string, intensity: number) {
        const layer = this.layers.get(name);
        if (layer) {
            layer.targetVolume = Math.max(0, Math.min(1, intensity)) * layer.config.maxVolume;
        }
    }

    // ── Crossfade layer API ─────────────────────────────────────

    /**
     * Register a crossfade ambient layer.
     * Two instances of the same sound alternate with overlapping fades.
     */
    addCrossfadeLayer(
        name: string,
        key: string,
        options: {
            maxVolume?: number;
            crossfadeDuration?: number;
            crossfadeAt?: number;
        } = {}
    ) {
        const config: CrossfadeConfig = {
            key,
            maxVolume: options.maxVolume ?? 0.5,  // Increased from 0.3 for better audio levels
            crossfadeDuration: options.crossfadeDuration ?? 2,
            crossfadeAt: options.crossfadeAt ?? 0.75,
        };

        const makeInstance = (): CrossfadeInstance => ({
            sound: this.scene.sound.add(key, { loop: false, volume: 0 }) as Phaser.Sound.WebAudioSound,
            volume: 0,
            state: 'idle',
            elapsed: 0,
            duration: 0,
        });

        this.crossfadeLayers.set(name, {
            config,
            a: makeInstance(),
            b: makeInstance(),
            active: 'a',
            started: false,
        });
    }

    // ── Update ──────────────────────────────────────────────────

    update(dt: number) {
        this.updateStandardLayers(dt);
        this.updateCrossfadeLayers(dt);
    }

    private updateStandardLayers(dt: number) {
        for (const layer of this.layers.values()) {
            const diff = layer.targetVolume - layer.currentVolume;

            if (Math.abs(diff) < 0.005) {
                layer.currentVolume = layer.targetVolume;
            } else {
                const rate = diff > 0 ? layer.config.fadeIn : layer.config.fadeOut;
                const lerp = 1 - Math.exp(-rate * dt);
                layer.currentVolume += diff * lerp;
            }

            if (layer.currentVolume > 0.01 && !layer.playing) {
                layer.sound.play({ volume: layer.currentVolume, seek: layer.config.seekStart });
                layer.playing = true;
                layer.playbackTime = 0;
            }

            if (layer.playing) {
                (layer.sound as Phaser.Sound.WebAudioSound).setVolume(layer.currentVolume);
                
                // Track playback time for non-looping sounds with maxDuration
                if (!layer.config.loop && layer.config.maxDuration !== undefined) {
                    layer.playbackTime += dt;
                    
                    // Stop the sound after maxDuration
                    if (layer.playbackTime >= layer.config.maxDuration) {
                        layer.sound.stop();
                        layer.playing = false;
                        layer.currentVolume = 0;
                        layer.targetVolume = 0;
                        layer.playbackTime = 0;
                    }
                }
            }

            if (layer.currentVolume <= 0.01 && layer.playing) {
                layer.sound.stop();
                layer.playing = false;
                layer.currentVolume = 0;
                layer.playbackTime = 0;
            }
        }
    }

    private updateCrossfadeLayers(dt: number) {
        for (const cf of this.crossfadeLayers.values()) {
            const { config } = cf;

            // Start the first instance on first update
            if (!cf.started) {
                this.startCrossfadeInstance(cf.a, config);
                cf.active = 'a';
                cf.started = true;
            }

            // Update both instances
            this.tickCrossfadeInstance(cf.a, config, dt);
            this.tickCrossfadeInstance(cf.b, config, dt);

            const active = cf.active === 'a' ? cf.a : cf.b;
            const inactive = cf.active === 'a' ? cf.b : cf.a;

            // Refresh duration from the playing sound (may be 0 until decoded)
            if (active.duration <= 0 && active.sound.isPlaying) {
                const realDur = (active.sound as Phaser.Sound.WebAudioSound).duration;
                if (realDur > 0) {
                    const seek = (active.sound as Phaser.Sound.WebAudioSound).seek || 0;
                    active.duration = realDur - seek;
                }
            }

            // Trigger crossfade: either at the crossfade point, or if active ended naturally
            const needsCrossfade =
                (active.state !== 'idle' && active.state !== 'fadeout' && active.duration > 0 &&
                    active.elapsed / active.duration >= config.crossfadeAt) ||
                (active.state !== 'idle' && active.state !== 'fadeout' && !active.sound.isPlaying);

            if (needsCrossfade && inactive.state === 'idle') {
                this.startCrossfadeInstance(inactive, config);
                active.state = 'fadeout';
                cf.active = cf.active === 'a' ? 'b' : 'a';
            }

            // If active sound ended and it was already fading out, just go idle
            if (active.state === 'fadeout' && !active.sound.isPlaying) {
                active.volume = 0;
                active.state = 'idle';
            }
        }
    }

    private startCrossfadeInstance(inst: CrossfadeInstance, _config: CrossfadeConfig) {
        // Get duration — may be 0 before decode, we'll refresh in update
        const sndDuration = (inst.sound as Phaser.Sound.WebAudioSound).duration || 0;

        // Random seek: start at a random point in the first 60% of the file
        const maxSeek = sndDuration > 0 ? sndDuration * 0.6 : 0;
        const seek = maxSeek > 0 ? Math.random() * maxSeek : 0;

        inst.sound.play({ volume: 0, seek });
        inst.volume = 0;
        inst.state = 'fadein';
        inst.elapsed = 0;
        inst.duration = sndDuration > 0 ? sndDuration - seek : 0;
    }

    private tickCrossfadeInstance(inst: CrossfadeInstance, config: CrossfadeConfig, dt: number) {
        if (inst.state === 'idle') return;

        inst.elapsed += dt;

        const fadeTime = config.crossfadeDuration;

        if (inst.state === 'fadein') {
            inst.volume = Math.min(config.maxVolume, inst.volume + (config.maxVolume / fadeTime) * dt);
            if (inst.volume >= config.maxVolume) {
                inst.volume = config.maxVolume;
                inst.state = 'playing';
            }
        } else if (inst.state === 'fadeout') {
            inst.volume = Math.max(0, inst.volume - (config.maxVolume / fadeTime) * dt);
            if (inst.volume <= 0) {
                inst.volume = 0;
                inst.sound.stop();
                inst.state = 'idle';
                return;
            }
        }

        inst.sound.setVolume(inst.volume);
    }

    // ── Cleanup ─────────────────────────────────────────────────

    stopAll() {
        for (const layer of this.layers.values()) {
            layer.sound.stop();
            layer.playing = false;
            layer.currentVolume = 0;
            layer.targetVolume = 0;
            layer.playbackTime = 0;
        }
        for (const cf of this.crossfadeLayers.values()) {
            cf.a.sound.stop();
            cf.b.sound.stop();
            cf.a.state = 'idle';
            cf.b.state = 'idle';
            cf.a.volume = 0;
            cf.b.volume = 0;
            cf.started = false;
        }
    }

    destroy() {
        for (const layer of this.layers.values()) {
            layer.sound.destroy();
        }
        this.layers.clear();
        for (const cf of this.crossfadeLayers.values()) {
            cf.a.sound.destroy();
            cf.b.sound.destroy();
        }
        this.crossfadeLayers.clear();
    }
}