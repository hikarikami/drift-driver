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
    /** Silent gap between segment repeats (seconds). Requires maxDuration. */
    gapDuration?: number;
    /** How long (seconds) before segment end to begin fading out */
    segmentFadeOut?: number;
}

interface Layer {
    config: LayerConfig;
    sound: Phaser.Sound.BaseSound;
    currentVolume: number;
    targetVolume: number;
    playing: boolean;
    /** Tracks playback time for non-looping sounds with maxDuration */
    playbackTime: number;
    inGap: boolean;
    gapTime: number;
    /** Track when sound was last started to prevent rapid replays */
    lastPlayTime: number;
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
    targetScale: number;
    currentScale: number;
}

// ── SoundManager ────────────────────────────────────────────────

export class SoundManager {
    private scene: Scene;
    private layers: Map<string, Layer> = new Map();
    private crossfadeLayers: Map<string, CrossfadeLayer> = new Map();
    private _muted = false;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    get muted() {
        return this._muted;
    }

    set muted(value: boolean) {
        this._muted = value;
        if (value) {
            for (const layer of this.layers.values()) {
                if (layer.playing) {
                    (layer.sound as Phaser.Sound.WebAudioSound).setVolume(0);
                }
            }
            for (const cf of this.crossfadeLayers.values()) {
                cf.a.sound.setVolume(0);
                cf.b.sound.setVolume(0);
            }
        }
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
            gapDuration?: number;
            segmentFadeOut?: number;
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
            gapDuration: options.gapDuration,
            segmentFadeOut: options.segmentFadeOut ?? 0.25,
        };

        const sound = this.scene.sound.add(key, {
            loop: config.loop,
            volume: 0,
        });
        
        console.log(`[SOUND] Added layer "${name}" (${key}, loop: ${config.loop})`);

        this.layers.set(name, {
            config,
            sound,
            currentVolume: 0,
            targetVolume: 0,
            playing: false,
            playbackTime: 0,
            inGap: false,
            gapTime: 0,
            lastPlayTime: 0,
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

        console.log(`[SOUND] Added crossfade layer "${name}" (${key})`);

        this.crossfadeLayers.set(name, {
            config,
            a: makeInstance(),
            b: makeInstance(),
            active: 'a',
            started: false,
            targetScale: 1,
            currentScale: 1,
        });
    }

    setCrossfadeLayerScale(name: string, scale: number) {
        const layer = this.crossfadeLayers.get(name);
        if (layer) {
            layer.targetScale = Math.max(0, Math.min(1, scale));
        }
    }

    // ── Update ──────────────────────────────────────────────────

    update(dt: number) {
        this.updateStandardLayers(dt);
        this.updateCrossfadeLayers(dt);
    }

    private updateStandardLayers(dt: number) {
        for (const layer of this.layers.values()) {
            // --- Gap phase: silent pause between segment repeats ---
            if (layer.inGap) {
                layer.gapTime += dt;
                if (layer.targetVolume <= 0.01) {
                    layer.inGap = false;
                    layer.gapTime = 0;
                    layer.currentVolume = 0;
                    continue;
                }
                if (layer.gapTime >= (layer.config.gapDuration ?? 0)) {
                    layer.inGap = false;
                    layer.gapTime = 0;
                }
                continue;
            }

            const diff = layer.targetVolume - layer.currentVolume;

            if (Math.abs(diff) < 0.005) {
                layer.currentVolume = layer.targetVolume;
            } else {
                const rate = diff > 0 ? layer.config.fadeIn : layer.config.fadeOut;
                const lerp = 1 - Math.exp(-rate * dt);
                layer.currentVolume += diff * lerp;
            }

            if (layer.currentVolume > 0.01 && !layer.playing) {
                // Safeguard: Don't replay if we just played this sound very recently
                const now = Date.now();
                const timeSinceLastPlay = now - layer.lastPlayTime;
                const isCurrentlyPlaying = layer.sound.isPlaying;
                
                // Only play if:
                // 1. Sound is not currently playing
                // 2. At least 50ms has passed since last play (prevents machine-gun effect)
                if (!isCurrentlyPlaying && timeSinceLastPlay > 50) {
                    layer.sound.play({ volume: layer.currentVolume, seek: layer.config.seekStart });
                    layer.playing = true;
                    layer.playbackTime = 0;
                    layer.lastPlayTime = now;
                }
            }

            if (layer.playing) {
                let outputVolume = layer.currentVolume;

                if (!layer.config.loop && layer.config.maxDuration !== undefined) {
                    layer.playbackTime += dt;

                    // Segment fade-out: ramp volume down near the end of the segment
                    const fadeOutLen = layer.config.segmentFadeOut ?? 0.25;
                    const fadeOutStart = layer.config.maxDuration - fadeOutLen;
                    if (layer.playbackTime >= fadeOutStart) {
                        const fadeProgress = Math.min(1, (layer.playbackTime - fadeOutStart) / fadeOutLen);
                        outputVolume *= 1 - fadeProgress;
                    }

                    if (layer.playbackTime >= layer.config.maxDuration) {
                        layer.sound.stop();
                        layer.playing = false;
                        layer.playbackTime = 0;

                        if (layer.config.gapDuration !== undefined && layer.targetVolume > 0.01) {
                            layer.inGap = true;
                            layer.gapTime = 0;
                            layer.currentVolume = 0;
                        } else if (layer.targetVolume > 0.01) {
                            // Safeguard: Only restart if not already playing and enough time passed
                            const now = Date.now();
                            const timeSinceLastPlay = now - layer.lastPlayTime;
                            if (!layer.sound.isPlaying && timeSinceLastPlay > 50) {
                                layer.sound.play({ volume: layer.currentVolume, seek: layer.config.seekStart });
                                layer.playing = true;
                                layer.lastPlayTime = now;
                            }
                        } else {
                            layer.currentVolume = 0;
                            layer.targetVolume = 0;
                        }
                        continue;
                    }
                }

                (layer.sound as Phaser.Sound.WebAudioSound).setVolume(this._muted ? 0 : outputVolume);
            }

            if (layer.currentVolume <= 0.01 && layer.playing) {
                if (layer.sound.isPlaying) {
                    layer.sound.stop();
                }
                layer.playing = false;
                layer.currentVolume = 0;
                layer.playbackTime = 0;
            }
        }
    }

    private updateCrossfadeLayers(dt: number) {
        for (const cf of this.crossfadeLayers.values()) {
            const { config } = cf;

            const scaleDiff = cf.targetScale - cf.currentScale;
            if (Math.abs(scaleDiff) < 0.005) {
                cf.currentScale = cf.targetScale;
            } else {
                if (scaleDiff > 0) {
                    const scaleRate = 1 - Math.exp(-12 * dt);
                    cf.currentScale += scaleDiff * scaleRate;
                } else {
                    cf.currentScale = Math.max(cf.targetScale, cf.currentScale - (1 / 1.5) * dt);
                }
            }

            // Start the first instance on first update
            if (!cf.started) {
                this.startCrossfadeInstance(cf.a, config);
                cf.active = 'a';
                cf.started = true;
            }

            // Update both instances
            this.tickCrossfadeInstance(cf.a, config, dt, cf.currentScale);
            this.tickCrossfadeInstance(cf.b, config, dt, cf.currentScale);

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

    private tickCrossfadeInstance(inst: CrossfadeInstance, config: CrossfadeConfig, dt: number, scale = 1) {
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

        inst.sound.setVolume(this._muted ? 0 : inst.volume * scale);
    }

    // ── Cleanup ─────────────────────────────────────────────────

    stopAll() {
        console.log('[SOUND] SoundManager.stopAll() called');
        for (const layer of this.layers.values()) {
            layer.sound.stop();
            layer.playing = false;
            layer.currentVolume = 0;
            layer.targetVolume = 0;
            layer.playbackTime = 0;
            layer.inGap = false;
            layer.gapTime = 0;
            layer.lastPlayTime = 0;
        }
        for (const cf of this.crossfadeLayers.values()) {
            cf.a.sound.stop();
            cf.b.sound.stop();
            cf.a.state = 'idle';
            cf.b.state = 'idle';
            cf.a.volume = 0;
            cf.b.volume = 0;
            cf.started = false;
            cf.targetScale = 1;
            cf.currentScale = 1;
        }
    }

    destroy() {
        console.log('[SOUND] SoundManager.destroy() called - cleaning up', this.layers.size, 'layers and', this.crossfadeLayers.size, 'crossfade layers');
        for (const layer of this.layers.values()) {
            layer.sound.destroy();
        }
        this.layers.clear();
        for (const cf of this.crossfadeLayers.values()) {
            cf.a.sound.destroy();
            cf.b.sound.destroy();
        }
        this.crossfadeLayers.clear();
        console.log('[SOUND] SoundManager destroyed');
    }
}