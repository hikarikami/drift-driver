import Phaser from 'phaser';

// ──────────────────────────────────────────────────────────────────────────────
// PickupArrow
// A small flat pixel-art equilateral triangle that orbits the car at a fixed
// radius, always pointing toward the active pickup.  When the pickup re-spawns
// the triangle smoothly rotates around the car to the new direction.
// ──────────────────────────────────────────────────────────────────────────────

const TEXTURE_KEY = '__pickup_tri3__';

const ART_PX   = 2;   // screen pixels per art-pixel
const ART_COLS = 8;   // length axis  (tip at col 7)
const ART_ROWS = 9;   // height axis  (centre = row 4)

const MARGIN = 2;
const TEX_W  = ART_COLS * ART_PX + MARGIN * 2;  // 36
const TEX_H  = ART_ROWS * ART_PX + MARGIN * 2;  // 40
const ART_X  = MARGIN;
const ART_Y  = MARGIN;

// Equilateral triangle pointing RIGHT.
// Right-edge col per row: 0, 2, 4, 5, 7, 5, 4, 2, 0
// Ratio width:height = 8:9 ≈ √3/2 ≈ 0.866  → equilateral proportions.
const ART_MAP: readonly (readonly number[])[] = [
    [1,0,0,0,0,0,0,0],  // row 0
    [1,1,1,0,0,0,0,0],  // row 1
    [1,1,1,1,1,0,0,0],  // row 2
    [1,1,1,1,1,1,0,0],  // row 3
    [1,1,1,1,1,1,1,1],  // row 4  ← TIP
    [1,1,1,1,1,1,0,0],  // row 5
    [1,1,1,1,1,0,0,0],  // row 6
    [1,1,1,0,0,0,0,0],  // row 7
    [1,0,0,0,0,0,0,0],  // row 8
] as const;

const C_FILL    = 0xFFDD22;  // bright yellow — stands out against the teal tiles
const C_OUTLINE = 0x000000;

// Sprite pivots at the visual centre of the art face
const ORIGIN_X = (ART_X + (ART_COLS * ART_PX) / 2) / TEX_W;
const ORIGIN_Y = (ART_Y + (ART_ROWS * ART_PX) / 2) / TEX_H;

/** Distance from car centre to triangle centre (pixels). */
const ORBIT_R = 54;

/** Rendered scale. ART_PX=4 at 0.65 ≈ 2.6 screen-px per art-pixel. */
const BASE_SCALE = 0.65;

/**
 * How fast the triangle orbits to a new angle (exponential decay constant).
 * Higher = snappier; lower = more floaty.  ~1 s to reach 99 % of target.
 */
const ORBIT_LERP = 5;

// ─────────────────────────────────────────────────────────────────────────────

export class PickupArrow {
    private sprite: Phaser.GameObjects.Image;

    private currentAngle = 0;
    private initialized  = false;
    private lastTime     = 0;

    constructor(private readonly scene: Phaser.Scene) {
        ensureTexture(scene);

        this.sprite = scene.add.image(0, 0, TEXTURE_KEY)
            .setOrigin(ORIGIN_X, ORIGIN_Y)
            .setDepth(9)
            .setVisible(false);
    }

    /**
     * @param carX      Car centre X (world space).
     * @param carY      Car centre Y (world space).
     * @param _carAngle Unused — orbit direction is driven by the trophy angle.
     * @param trophyX   Pickup X (world space).
     * @param trophyY   Pickup Y (world space).
     * @param visible   Whether to show the indicator.
     */
    update(
        carX: number,
        carY: number,
        _carAngle: number,
        trophyX: number,
        trophyY: number,
        visible: boolean,
    ): void {
        if (!visible) {
            this.sprite.setVisible(false);
            return;
        }

        const now = this.scene.time.now;
        const dt  = this.lastTime > 0 ? Math.min((now - this.lastTime) / 1000, 0.1) : 0;
        this.lastTime = now;

        const targetAngle = Math.atan2(trophyY - carY, trophyX - carX);

        // Snap on first show so it doesn't spin in from angle 0
        if (!this.initialized) {
            this.currentAngle = targetAngle;
            this.initialized  = true;
        }

        // Smoothly orbit toward the target angle via exponential decay
        let diff = targetAngle - this.currentAngle;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.currentAngle += diff * (1 - Math.exp(-ORBIT_LERP * dt));

        const x = carX + Math.cos(this.currentAngle) * ORBIT_R;
        const y = carY + Math.sin(this.currentAngle) * ORBIT_R;

        this.sprite
            .setVisible(true)
            .setPosition(x, y)
            .setScale(BASE_SCALE)
            .setRotation(this.currentAngle);
    }

    hide(): void {
        this.sprite.setVisible(false);
        this.initialized = false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Texture factory
// ─────────────────────────────────────────────────────────────────────────────

function ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;

    const g = scene.add.graphics();

    // Pass 1 — black outline (each art-pixel inflated by 1 screen-px all around)
    g.fillStyle(C_OUTLINE, 1);
    for (let r = 0; r < ART_ROWS; r++) {
        for (let c = 0; c < ART_COLS; c++) {
            if (ART_MAP[r][c]) {
                g.fillRect(ART_X + c * ART_PX - 1, ART_Y + r * ART_PX - 1, ART_PX + 2, ART_PX + 2);
            }
        }
    }

    // Pass 2 — flat fill
    g.fillStyle(C_FILL, 1);
    for (let r = 0; r < ART_ROWS; r++) {
        for (let c = 0; c < ART_COLS; c++) {
            if (ART_MAP[r][c]) {
                g.fillRect(ART_X + c * ART_PX, ART_Y + r * ART_PX, ART_PX, ART_PX);
            }
        }
    }

    g.generateTexture(TEXTURE_KEY, TEX_W, TEX_H);
    g.destroy();
}
