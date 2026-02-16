import { Scene } from 'phaser';

/**
 * Cached measurement result per texture key.
 * Computed once via pixel scanning, then reused for every instance of that rock.
 */
interface RockMeasurement {
    baseW: number;       // Width of the base band in SOURCE pixels
    rockHeightRatio: number; // Fraction of canvas height occupied by opaque pixels (0–1)
}

const measurementCache = new Map<string, RockMeasurement>();

export class SceneryManager {
    private scene: Scene;
    private width: number;
    private height: number;

    // Rock visuals (no physics)
    obstacleSprites: Phaser.GameObjects.Image[] = [];

    // Rock colliders (bottom-only hitboxes)
    obstacleHitboxes!: Phaser.Physics.Arcade.StaticGroup;

    // Collider zones for spawn checks
    decorations: Phaser.GameObjects.Zone[] = [];

    constructor(scene: Scene, width: number, height: number) {
        this.scene = scene;
        this.width = width;
        this.height = height;
    }

    // ========== PIXEL-SCANNING HITBOX ==========

    /**
     * Scans the texture to measure:
     *  - baseW: the widest opaque row in the entire image + 4px buffer (for hitbox width)
     *  - rockHeightRatio: what fraction of the canvas height the rock actually occupies (for hitbox height)
     *
     * @param textureKey  Phaser texture key (e.g. 'rock-3')
     */
    private measureRock(textureKey: string): RockMeasurement {
        // Return cached result if we've already scanned this texture
        if (measurementCache.has(textureKey)) {
            return measurementCache.get(textureKey)!;
        }

        const texture = this.scene.textures.get(textureKey);
        const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;

        const canvas = document.createElement('canvas');
        const w = source.width;
        const h = source.height;
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(source as CanvasImageSource, 0, 0);

        const imageData = ctx.getImageData(0, 0, w, h);
        const pixels = imageData.data;

        const isOpaque = (col: number, row: number) => {
            return pixels[(row * w + col) * 4 + 3] > 10;
        };

        let topRow = h;
        let bottomRow = -1;
        let maxRowWidth = 0;
        let widestRowIdx = 0;

        for (let row = 0; row < h; row++) {
            let rowLeft = -1;
            let rowRight = -1;

            for (let col = 0; col < w; col++) {
                if (isOpaque(col, row)) {
                    if (rowLeft < 0) rowLeft = col;
                    rowRight = col;
                }
            }

            if (rowLeft >= 0) {
                // This row has opaque pixels
                if (row < topRow) topRow = row;
                if (row > bottomRow) bottomRow = row;

                const rowWidth = rowRight - rowLeft + 1;
                if (rowWidth > maxRowWidth) {
                    maxRowWidth = rowWidth;
                    widestRowIdx = row;
                }
            }
        }

        if (bottomRow < 0) {
            console.warn(`[SceneryManager] "${textureKey}" is fully transparent, using defaults`);
            const fallback: RockMeasurement = { baseW: w, rockHeightRatio: 1 };
            measurementCache.set(textureKey, fallback);
            return fallback;
        }

        // --- Rock height ratio ---
        const actualRockHeight = bottomRow - topRow + 1;
        const rockHeightRatio = actualRockHeight / h;

        // --- Widest row + 4px buffer ---
        const baseW = maxRowWidth + 4;

        const result: RockMeasurement = { baseW, rockHeightRatio };
        measurementCache.set(textureKey, result);

        console.log(
            `[SceneryManager] Measured "${textureKey}": ` +
            `topRow=${topRow}, bottomRow=${bottomRow}, ` +
            `rockHeight=${actualRockHeight}px (${(rockHeightRatio * 100).toFixed(0)}% of canvas), ` +
            `widestRow=${widestRowIdx} → baseW=${maxRowWidth}+4 = ${baseW}px (src)`
        );

        return result;
    }

    // ========== SHADOW HELPERS ==========

    /**
     * Creates a shadow for static scenery (decorations, cacti)
     */
    createStaticShadow(
        x: number,
        y: number,
        textureName: string,
        scale: number,
        offsetX: number = -1,
        offsetY: number = 1,
        depth: number = 5
    ): Phaser.GameObjects.Image {
        const shadow = this.scene.add.image(x + offsetX, y + offsetY, textureName);
        shadow.setOrigin(0.5, 1);
        shadow.setBlendMode(Phaser.BlendModes.DARKEN);
        shadow.setScale(scale);
        shadow.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        shadow.setTint(0x000000);
        shadow.setAlpha(0.45);
        shadow.setDepth(depth);
        return shadow;
    }

    /**
     * Creates a shadow for dynamic objects (car, pickup)
     */
    createDynamicShadow(
        x: number,
        y: number,
        textureName: string,
        depth: number = 3
    ): Phaser.GameObjects.Image {
        const shadow = this.scene.add.image(x, y, textureName);
        shadow.setOrigin(0.5, 1);
        shadow.setTint(0x000000);
        shadow.setAlpha(0.45);
        shadow.setBlendMode(Phaser.BlendModes.MULTIPLY);
        shadow.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        shadow.setDepth(depth);
        return shadow;
    }

    // ========== SCENERY SPAWNING ==========

    /**
     * Builds the full isometric background and spawns all scenery
     */
    buildIsometricBackground() {
        const tileWidth = 36 * 1;
        const tileHeight = 16 * 1;

        const cols = Math.ceil(this.width / (tileWidth / 2)) + 4;
        const rows = Math.ceil(this.height / (tileHeight / 2)) + 4;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const tileNum = Phaser.Math.Between(0, 10);
                const tileName = `tile_${String(tileNum).padStart(3, '0')}`;

                const x = (col - row) * (tileWidth);
                const y = (col + row) * (tileHeight);

                const tile = this.scene.add.image(x + this.width / 2, y - this.height / 2, tileName);
                tile.setOrigin(0.5, 0.5);
                tile.setScale(2);
                tile.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
                tile.setDepth(0);
            }
        }

        // Spawn obstacles first (they have collision)
        const obstaclePositions = this.spawnObstacles();

        // Spawn decorative scenery (avoiding obstacles)
        this.spawnDecorativeScenery(obstaclePositions);
    }

    /**
     * Spawns collision obstacles using rock-1 through rock-12 textures.
     * Hitbox width AND height are automatically measured from pixel data.
     */
    private spawnObstacles(existingPositions: { x: number, y: number }[] = []) {
        const config = {
            count: 9,
            minSpacing: 145,
            marginFromEdge: 100,
            rockCount: 12,           // rock-1 through rock-12
            rockPrefix: 'rock-',
            scale: 0.8,

            shadowScale: 0.85,
            shadowOffset: { x: -5, y: 5 },
            shadowAngle: 130,
            depth: 5,
            maxAttempts: 20,

            // Y offset for hitbox positioning (in SOURCE pixels)
            defaultYOffsetPx: -2,

            // Dynamic hitbox height: maps rockHeightRatio → baseH in source pixels
            // Taller rocks (more of the canvas filled) get taller hitboxes
            hitboxHeightTiers: [
                { minRatio: 0.80, baseH: 70 },  // Very tall rock (80%+ of canvas)
                { minRatio: 0.60, baseH: 60 },  // Tall rock (60-80%)
                { minRatio: 0.40, baseH: 45 },  // Medium rock (40-60%)
                { minRatio: 0.0,  baseH: 30 },  // Short rock (<40%)
            ],
        };

        const positions: { x: number, y: number }[] = [...existingPositions];

        if (!this.obstacleHitboxes) {
            this.obstacleHitboxes = this.scene.physics.add.staticGroup();
        }

        for (let i = 0; i < config.count; i++) {
            const pos = this.findValidSpawnPosition(
                positions,
                config.minSpacing,
                config.marginFromEdge,
                config.maxAttempts
            );

            if (!pos) continue;
            positions.push(pos);

            // Pick a random rock texture
            const rockNum = Phaser.Math.Between(1, config.rockCount);
            const textureName = `${config.rockPrefix}${rockNum}`;

            // Shadow
            const shadow = this.createStaticShadow(
                pos.x, pos.y, textureName,
                config.shadowScale,
                config.shadowOffset.x,
                config.shadowOffset.y,
                config.depth
            );
            shadow.angle = config.shadowAngle;

            // Visual rock (no physics)
            const rock = this.scene.add.image(pos.x, pos.y, textureName)
                .setOrigin(0.5, 0.5)
                .setScale(config.scale)
                .setDepth(config.depth);

            rock.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

            // --- Auto-measure hitbox from pixel data ---
            const measurement = this.measureRock(textureName);

            // Pick hitbox height based on how much of the canvas the rock fills
            let baseH = config.hitboxHeightTiers[config.hitboxHeightTiers.length - 1].baseH;
            for (const tier of config.hitboxHeightTiers) {
                if (measurement.rockHeightRatio >= tier.minRatio) {
                    baseH = tier.baseH;
                    break;
                }
            }

            const baseW = measurement.baseW;
            const yAdjust = config.defaultYOffsetPx;

            const srcH = rock.height;           // 128 for all rock PNGs
            const displayH = srcH * config.scale;

            const bodyW = baseW * config.scale;
            const bodyH = baseH * config.scale;

            // Position hitbox at the bottom of the rock sprite
            const hitboxY =
                pos.y + (displayH / 2) - (bodyH / 2) + (yAdjust * config.scale);

            const zone = this.scene.add.zone(pos.x, hitboxY, bodyW, bodyH);
            this.scene.physics.add.existing(zone, true);

            this.obstacleHitboxes.add(zone);
            this.decorations.push(zone);
            this.obstacleSprites.push(rock);
        }

        return positions;
    }

    /**
     * Spawns decorative scenery (cacti, plants, etc.)
     * These are visual only - car drives through them
     */
    private spawnDecorativeScenery(avoidPositions: { x: number, y: number }[] = []) {
        const config = {
            count: 25,
            minSpacingFromObstacles: 15,
            marginFromEdge: 25,
            textureRange: { min: 1, max: 7 },
            texturePrefix: 'tree-',
            scale: 0.6,
            shadowScale: 0.6,
            shadowOffset: { x: -8, y: 15 },
            shadowAngle: 130,
            shadowFlipX: true,
            depth: 1,
            maxAttempts: 20
        };

        for (let i = 0; i < config.count; i++) {
            const pos = this.findValidSpawnPosition(
                avoidPositions,
                config.minSpacingFromObstacles,
                config.marginFromEdge,
                config.maxAttempts
            );

            if (!pos) continue;

            const textureNum = Phaser.Math.Between(config.textureRange.min, config.textureRange.max);
            const textureName = `${config.texturePrefix}${textureNum}`;

            const shadow = this.createStaticShadow(
                pos.x, pos.y, textureName,
                config.shadowScale,
                config.shadowOffset.x,
                config.shadowOffset.y,
                config.depth - 1
            );
            shadow.angle = config.shadowAngle;
            shadow.setFlipX(config.shadowFlipX);

            const decorative = this.scene.add.image(pos.x, pos.y, textureName);
            decorative.setOrigin(0.5, 0.5);
            decorative.setScale(config.scale);
            decorative.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
            decorative.setDepth(config.depth);
        }
    }

    /**
     * Finds a valid spawn position that doesn't overlap with existing positions
     */
    findValidSpawnPosition(
        existingPositions: { x: number, y: number }[],
        minSpacing: number,
        marginFromEdge: number,
        maxAttempts: number
    ): { x: number, y: number } | null {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const x = Phaser.Math.Between(marginFromEdge, this.width - marginFromEdge);
            const y = Phaser.Math.Between(marginFromEdge, this.height - marginFromEdge);

            let valid = true;
            for (const pos of existingPositions) {
                const distance = Phaser.Math.Distance.Between(x, y, pos.x, pos.y);
                if (distance < minSpacing) {
                    valid = false;
                    break;
                }
            }

            if (valid) return { x, y };
        }

        return null;
    }

    /**
     * Finds a safe spawn position away from all obstacles
     */
    findSafePosition(defaultX: number, defaultY: number, minDistance: number, maxAttempts: number = 50): { x: number, y: number } {
        let x = defaultX;
        let y = defaultY;
        let attempts = 0;
        let valid = false;

        while (!valid && attempts < maxAttempts) {
            valid = true;
            for (const obstacle of this.decorations) {
                const dist = Phaser.Math.Distance.Between(x, y, obstacle.x, obstacle.y);
                if (dist < minDistance) {
                    valid = false;
                    x = 100 + Math.random() * (this.width - 200);
                    y = 100 + Math.random() * (this.height - 200);
                    break;
                }
            }
            attempts++;
        }

        return { x, y };
    }
}