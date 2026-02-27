/**
 * TouchControls — HTML overlay virtual gamepad for mobile.
 *
 * - Only shown on touch-capable devices (isMobile()).
 * - Attempts to lock screen to landscape on show().
 * - Shows a "rotate device" overlay when in portrait mode on mobile.
 * - Handles multi-touch so multiple buttons can be held simultaneously.
 * - Works alongside keyboard input — OR'd together in CarController.readInput().
 *
 * Layout (landscape):
 *   Left side  : [◀ Steer] [▶ Steer]
 *   Right side : [⚡ Boost] [▲ Gas]
 *                [▼ Rev  ] [■ Brake]
 */

export interface TouchState {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    boost: boolean;
    brake: boolean;
}

const BTN_SIZE = '72px';
const BTN_FONT = '26px';

export class TouchControls {
    private static _instance: TouchControls | null = null;

    readonly state: TouchState = {
        left: false,
        right: false,
        up: false,
        down: false,
        boost: false,
        brake: false,
    };

    private container: HTMLDivElement | null = null;
    private rotateOverlay: HTMLDivElement | null = null;
    private readonly onOrientation = () => this.syncOrientation();

    // ----------------------------------------------------------------
    //  Mobile detection
    // ----------------------------------------------------------------

    static isMobile(): boolean {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    // ----------------------------------------------------------------
    //  Singleton
    // ----------------------------------------------------------------

    static getInstance(): TouchControls {
        if (!TouchControls._instance) {
            TouchControls._instance = new TouchControls();
        }
        return TouchControls._instance;
    }

    // ----------------------------------------------------------------
    //  Public API
    // ----------------------------------------------------------------

    /**
     * Show controls — no-op on non-touch (desktop) devices.
     * Requests landscape lock and wires up orientation monitoring.
     */
    show(): void {
        if (!TouchControls.isMobile()) return;
        if (this.container) return;

        // Request landscape orientation lock (works on Android Chrome; silently
        // fails on iOS — the rotate overlay handles that case instead).
        try {
            (screen.orientation as any)?.lock('landscape').catch(() => { /* iOS/unsupported */ });
        } catch { /* ignore */ }

        this.buildOverlay();
        this.buildRotateOverlay();
        this.syncOrientation();

        window.addEventListener('resize', this.onOrientation);
        screen.orientation?.addEventListener('change', this.onOrientation);
    }

    hide(): void {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        this.hideRotateOverlay();

        window.removeEventListener('resize', this.onOrientation);
        screen.orientation?.removeEventListener('change', this.onOrientation);

        // Reset all state so held buttons don't stay stuck
        for (const key of Object.keys(this.state) as Array<keyof TouchState>) {
            this.state[key] = false;
        }
    }

    destroy(): void {
        this.hide();
        TouchControls._instance = null;
    }

    // ----------------------------------------------------------------
    //  Orientation handling
    // ----------------------------------------------------------------

    private syncOrientation(): void {
        const isPortrait = window.innerHeight > window.innerWidth;
        if (isPortrait) {
            this.showRotateOverlay();
        } else {
            this.hideRotateOverlay();
        }
    }

    private showRotateOverlay(): void {
        if (!this.rotateOverlay) return;
        this.rotateOverlay.style.display = 'flex';
    }

    private hideRotateOverlay(): void {
        if (!this.rotateOverlay) return;
        this.rotateOverlay.style.display = 'none';
    }

    private buildRotateOverlay(): void {
        this.rotateOverlay = document.createElement('div');
        Object.assign(this.rotateOverlay.style, {
            position: 'fixed',
            inset: '0',
            background: 'rgba(0,0,0,0.92)',
            display: 'none',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '2000',
            color: '#ffffff',
            fontFamily: 'sans-serif',
            textAlign: 'center',
            gap: '20px',
        } as Partial<CSSStyleDeclaration>);

        this.rotateOverlay.innerHTML = `
            <div style="font-size:64px;animation:tc-spin 2s ease-in-out infinite">📱</div>
            <div style="font-size:22px;font-weight:bold">Rotate your device</div>
            <div style="font-size:15px;opacity:0.65">This game is best played in landscape mode</div>
            <style>
                @keyframes tc-spin {
                    0%   { transform: rotate(0deg); }
                    40%  { transform: rotate(90deg); }
                    60%  { transform: rotate(90deg); }
                    100% { transform: rotate(90deg); }
                }
            </style>
        `;

        document.body.appendChild(this.rotateOverlay);
    }

    // ----------------------------------------------------------------
    //  Button overlay construction
    // ----------------------------------------------------------------

    private buildOverlay(): void {
        this.container = document.createElement('div');
        Object.assign(this.container.style, {
            position: 'fixed',
            bottom: '0',
            left: '0',
            right: '0',
            height: '200px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            padding: '16px 28px',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: '999',
        } as Partial<CSSStyleDeclaration>);

        this.container.appendChild(this.buildLeftCluster());
        this.container.appendChild(this.buildRightCluster());
        document.body.appendChild(this.container);
    }

    /** Left side: steering left & right */
    private buildLeftCluster(): HTMLDivElement {
        const wrap = this.div({ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', pointerEvents: 'none' });
        const row = this.div({ display: 'flex', gap: '10px' });

        row.appendChild(this.makeBtn('◀', 'Steer', 'left', '#4a9eff'));
        row.appendChild(this.makeBtn('▶', 'Steer', 'right', '#4a9eff'));
        wrap.appendChild(row);
        return wrap;
    }

    /** Right side: gas, reverse, boost, brake */
    private buildRightCluster(): HTMLDivElement {
        const wrap = this.div({ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', pointerEvents: 'none' });

        const topRow = this.div({ display: 'flex', gap: '10px' });
        topRow.appendChild(this.makeBtn('⚡', 'Boost', 'boost', '#f5c518'));
        topRow.appendChild(this.makeBtn('▲', 'Gas', 'up', '#44cc66'));

        const botRow = this.div({ display: 'flex', gap: '10px' });
        botRow.appendChild(this.makeBtn('▼', 'Rev', 'down', '#ffaa33'));
        botRow.appendChild(this.makeBtn('■', 'Brake', 'brake', '#ff5555'));

        wrap.appendChild(topRow);
        wrap.appendChild(botRow);
        return wrap;
    }

    // ----------------------------------------------------------------
    //  Button factory
    // ----------------------------------------------------------------

    private makeBtn(
        icon: string,
        label: string,
        key: keyof TouchState,
        accentColor: string,
    ): HTMLDivElement {
        const btn = this.div({
            width: BTN_SIZE,
            height: BTN_SIZE,
            background: 'rgba(0, 0, 0, 0.45)',
            border: `2px solid ${accentColor}55`,
            borderRadius: '14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: BTN_FONT,
            color: '#ffffff',
            userSelect: 'none',
            pointerEvents: 'all',
            cursor: 'pointer',
            touchAction: 'none',
            backdropFilter: 'blur(6px)',
            transition: 'background 0.07s, border-color 0.07s',
        } as Partial<CSSStyleDeclaration>);

        btn.innerHTML = `<span style="line-height:1">${icon}</span><span style="font-size:9px;opacity:0.65;margin-top:3px;font-family:sans-serif">${label}</span>`;

        const activeTouches = new Set<number>();

        const press = () => {
            this.state[key] = true;
            btn.style.background = `${accentColor}44`;
            btn.style.borderColor = `${accentColor}cc`;
        };

        const release = () => {
            this.state[key] = false;
            btn.style.background = 'rgba(0, 0, 0, 0.45)';
            btn.style.borderColor = `${accentColor}55`;
        };

        // Touch — track each finger separately so multi-touch works correctly
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            for (const t of Array.from(e.changedTouches)) activeTouches.add(t.identifier);
            press();
        }, { passive: false });

        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            for (const t of Array.from(e.changedTouches)) activeTouches.delete(t.identifier);
            if (activeTouches.size === 0) release();
        }, { passive: false });

        btn.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            for (const t of Array.from(e.changedTouches)) activeTouches.delete(t.identifier);
            if (activeTouches.size === 0) release();
        }, { passive: false });

        // Mouse fallback (desktop testing while not hidden)
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); press(); });
        btn.addEventListener('mouseup', release);
        btn.addEventListener('mouseleave', release);

        return btn;
    }

    // ----------------------------------------------------------------
    //  Helpers
    // ----------------------------------------------------------------

    private div(styles: Partial<CSSStyleDeclaration>): HTMLDivElement {
        const el = document.createElement('div');
        Object.assign(el.style, styles);
        return el;
    }
}
