import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    projectToLocal,
    drawCatmullRom,
    rotateToHeadingUp,
    lookaheadPoints,
    computeViewScale,
    ZOOM_RANGES_METERS,
} from '@/trail-renderer';
import type { Breadcrumb } from '@/types';
import type { Point } from '@/trail-renderer';

function makeBreadcrumb(lat: number, lng: number, accuracy = 5, timestamp = 0): Breadcrumb {
    return { lat, lng, accuracy, timestamp };
}

// Mock requestAnimationFrame to fire synchronously so render() tests work without async waits.
beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('projectToLocal – equirectangular projection', () => {
    const origin = makeBreadcrumb(51.5, -0.1);

    it('projects origin to (0, 0)', () => {
        const result = projectToLocal(origin, origin);
        expect(result.x).toBeCloseTo(0, 5);
        expect(result.y).toBeCloseTo(0, 5);
    });

    it('projects a point north of origin to negative y (canvas: north = up)', () => {
        // Moving north increases lat → should give negative y (up on canvas)
        const north = makeBreadcrumb(51.501, -0.1);
        const result = projectToLocal(north, origin);
        expect(result.x).toBeCloseTo(0, 0);
        expect(result.y).toBeLessThan(0);
    });

    it('projects a point south of origin to positive y', () => {
        const south = makeBreadcrumb(51.499, -0.1);
        const result = projectToLocal(south, origin);
        expect(result.x).toBeCloseTo(0, 0);
        expect(result.y).toBeGreaterThan(0);
    });

    it('projects a point east of origin to positive x', () => {
        const east = makeBreadcrumb(51.5, -0.09);
        const result = projectToLocal(east, origin);
        expect(result.x).toBeGreaterThan(0);
        expect(result.y).toBeCloseTo(0, 0);
    });

    it('projects a point west of origin to negative x', () => {
        const west = makeBreadcrumb(51.5, -0.11);
        const result = projectToLocal(west, origin);
        expect(result.x).toBeLessThan(0);
        expect(result.y).toBeCloseTo(0, 0);
    });

    it('gives approximately correct distance for ~111m north', () => {
        // 0.001 degrees of latitude ≈ 111.3 metres
        const north = makeBreadcrumb(51.501, -0.1);
        const result = projectToLocal(north, origin);
        // y should be about -111 meters (negative = up)
        expect(Math.abs(result.y)).toBeGreaterThan(100);
        expect(Math.abs(result.y)).toBeLessThan(120);
    });

    it('scales x by cos(lat) to account for longitude compression at higher latitudes', () => {
        // At lat=51.5°, one degree of longitude is less than 111km
        // cos(51.5°) ≈ 0.624
        const eastOneDegree = makeBreadcrumb(51.5, -0.1 + 1);
        const result = projectToLocal(eastOneDegree, origin);
        // Should be approx 111319.5 * cos(51.5°) ≈ 69424 meters
        expect(result.x).toBeGreaterThan(60000);
        expect(result.x).toBeLessThan(80000);
    });

    it('NE point has positive x and negative y', () => {
        const ne = makeBreadcrumb(51.501, -0.09);
        const result = projectToLocal(ne, origin);
        expect(result.x).toBeGreaterThan(0);
        expect(result.y).toBeLessThan(0);
    });
});

/** Build a minimal CanvasRenderingContext2D mock that records calls. */
function makeCtxMock() {
    return {
        lineTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        moveTo: vi.fn(),
        beginPath: vi.fn(),
        stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
}

describe('drawCatmullRom', () => {
    it('does nothing for empty array', () => {
        const ctx = makeCtxMock();
        drawCatmullRom(ctx, []);
        expect((ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
        expect((ctx.bezierCurveTo as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('does nothing for a single point', () => {
        const ctx = makeCtxMock();
        drawCatmullRom(ctx, [{ x: 10, y: 20 }]);
        expect((ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
        expect((ctx.bezierCurveTo as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('uses lineTo for exactly two points', () => {
        const ctx = makeCtxMock();
        const pts: Point[] = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ];
        drawCatmullRom(ctx, pts);
        expect((ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
        expect((ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([100, 0]);
        expect((ctx.bezierCurveTo as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('uses bezierCurveTo for three or more points', () => {
        const ctx = makeCtxMock();
        const pts: Point[] = [
            { x: 0, y: 0 },
            { x: 50, y: 50 },
            { x: 100, y: 0 },
        ];
        drawCatmullRom(ctx, pts);
        // 3 points → 2 segments after clamping (p = [p0,p0,p1,p2,p2], loops i=1..2)
        expect((ctx.bezierCurveTo as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
            0
        );
        expect((ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('produces one bezierCurveTo call per interior segment', () => {
        const ctx = makeCtxMock();
        // n points → n-1 segments after clamping
        const pts: Point[] = [
            { x: 0, y: 0 },
            { x: 25, y: 30 },
            { x: 75, y: 10 },
            { x: 100, y: 50 },
        ];
        drawCatmullRom(ctx, pts);
        // 4 points → clamped array length 6 → loop runs 3 times (i=1,2,3)
        expect((ctx.bezierCurveTo as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    });

    it('last bezierCurveTo destination equals the last point', () => {
        const ctx = makeCtxMock();
        const pts: Point[] = [
            { x: 0, y: 0 },
            { x: 50, y: 80 },
            { x: 100, y: 20 },
        ];
        drawCatmullRom(ctx, pts);
        const calls = (ctx.bezierCurveTo as ReturnType<typeof vi.fn>).mock.calls;
        const lastCall = calls[calls.length - 1];
        // bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) — last two args are destination
        expect(lastCall[4]).toBeCloseTo(pts[pts.length - 1].x, 5);
        expect(lastCall[5]).toBeCloseTo(pts[pts.length - 1].y, 5);
    });

    it('first bezierCurveTo destination is the second input point (clamped start)', () => {
        const ctx = makeCtxMock();
        const pts: Point[] = [
            { x: 10, y: 5 },
            { x: 60, y: 40 },
            { x: 110, y: 5 },
        ];
        drawCatmullRom(ctx, pts);
        const calls = (ctx.bezierCurveTo as ReturnType<typeof vi.fn>).mock.calls;
        // First segment ends at pts[1]
        expect(calls[0][4]).toBeCloseTo(pts[1].x, 5);
        expect(calls[0][5]).toBeCloseTo(pts[1].y, 5);
    });

    it('control points lie between neighbouring points (no wild overshoots for collinear points)', () => {
        // Collinear points: spline should produce near-linear Bezier control points
        const ctx = makeCtxMock();
        const pts: Point[] = [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 100, y: 0 },
        ];
        drawCatmullRom(ctx, pts);
        const calls = (ctx.bezierCurveTo as ReturnType<typeof vi.fn>).mock.calls;
        // For collinear points the y coords of control points should be ≈ 0
        for (const call of calls) {
            expect(Math.abs(call[1])).toBeLessThan(1); // cp1y ≈ 0
            expect(Math.abs(call[3])).toBeLessThan(1); // cp2y ≈ 0
        }
    });
});

describe('createTrailRenderer – render()', () => {
    it('does not throw when canvas context is null', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        vi.spyOn(canvas, 'getContext').mockReturnValue(null);

        const renderer = createTrailRenderer({ canvas });
        expect(() =>
            renderer.render({ trail: [], currentIndex: 0, currentPosition: null })
        ).not.toThrow();
    });

    it('does not throw with empty trail', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        const renderer = createTrailRenderer({ canvas });
        expect(() =>
            renderer.render({ trail: [], currentIndex: 0, currentPosition: null })
        ).not.toThrow();
    });

    it('does not throw with a valid trail', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        const renderer = createTrailRenderer({ canvas });

        const trail = [
            makeBreadcrumb(51.5, -0.1),
            makeBreadcrumb(51.501, -0.1),
            makeBreadcrumb(51.502, -0.1),
        ];

        expect(() =>
            renderer.render({
                trail,
                currentIndex: 1,
                currentPosition: makeBreadcrumb(51.5005, -0.1),
            })
        ).not.toThrow();
    });

    it('does not throw when currentIndex equals trail length (arrived state)', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        const renderer = createTrailRenderer({ canvas });

        const trail = [makeBreadcrumb(51.5, -0.1), makeBreadcrumb(51.501, -0.1)];
        expect(() =>
            renderer.render({ trail, currentIndex: 2, currentPosition: null })
        ).not.toThrow();
    });
});

describe('createTrailRenderer – heading-up rotation', () => {
    /** Build a ctx mock that records save/restore/rotate/translate calls. */
    function makeFullCtxMock() {
        return {
            save: vi.fn(),
            restore: vi.fn(),
            rotate: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            bezierCurveTo: vi.fn(),
            arc: vi.fn(),
            stroke: vi.fn(),
            fill: vi.fn(),
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 1,
            lineCap: '',
            lineJoin: '',
        } as unknown as CanvasRenderingContext2D;
    }

    const trail = [
        makeBreadcrumb(51.5, -0.1),
        makeBreadcrumb(51.501, -0.1),
        makeBreadcrumb(51.502, -0.1),
    ];

    it('calls save() and restore() when rendering a non-empty trail', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null });

        expect((ctx.save as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
        expect((ctx.restore as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });

    it('rotates by -compassHeading in radians when heading is 90°', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null, compassHeading: 90 });

        const rotateCalls = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls;
        expect(rotateCalls.length).toBeGreaterThan(0);
        // -90° in radians = -Math.PI/2
        expect(rotateCalls[0][0]).toBeCloseTo(-Math.PI / 2, 5);
    });

    it('rotates by 0 when compassHeading is 0 (north-up)', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null, compassHeading: 0 });

        const rotateCalls = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls;
        expect(rotateCalls.length).toBeGreaterThan(0);
        expect(rotateCalls[0][0]).toBeCloseTo(0, 5);
    });

    it('rotates by 0 when compassHeading is omitted (defaults to north-up)', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null });

        const rotateCalls = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls;
        expect(rotateCalls.length).toBeGreaterThan(0);
        expect(rotateCalls[0][0]).toBeCloseTo(0, 5);
    });

    it('rotates by 0 when compassHeading is null (defaults to north-up)', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null, compassHeading: null });

        const rotateCalls = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls;
        expect(rotateCalls.length).toBeGreaterThan(0);
        expect(rotateCalls[0][0]).toBeCloseTo(0, 5);
    });

    it('rotates by -π when heading is 180° (south-up becomes north-up after rotation)', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null, compassHeading: 180 });

        const rotateCalls = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls;
        expect(rotateCalls.length).toBeGreaterThan(0);
        expect(rotateCalls[0][0]).toBeCloseTo(-Math.PI, 5);
    });

    it('puts the user at a fixed anchor: horizontally centred, below the middle', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 500 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: trail[0], compassHeading: 45 });

        const translateCalls = (ctx.translate as ReturnType<typeof vi.fn>).mock.calls;
        expect(translateCalls[0][0]).toBeCloseTo(200, 0);
        expect(translateCalls[0][1]).toBeCloseTo(500 * 0.72, 0);
    });

    it('keeps the user at the anchor as they move: the dot is always drawn at (0, 0)', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 500 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        for (const position of [trail[0], trail[1], trail[2]]) {
            (ctx.arc as ReturnType<typeof vi.fn>).mockClear();
            renderer.render({
                trail,
                currentIndex: 1,
                currentPosition: position,
                compassHeading: 0,
            });
            const dot = (ctx.arc as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: number[]) => c[2] === 9
            );
            expect(dot?.[0]).toBe(0);
            expect(dot?.[1]).toBe(0);
        }
    });

    it('does not call rotate for an empty trail (no rotation applied)', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail: [], currentIndex: 0, currentPosition: null, compassHeading: 90 });

        // Empty trail returns before save/rotate
        expect((ctx.rotate as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });
});

describe('createTrailRenderer – position dot and target waypoint', () => {
    function makeFullCtxMock() {
        return {
            save: vi.fn(),
            restore: vi.fn(),
            rotate: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            bezierCurveTo: vi.fn(),
            arc: vi.fn(),
            stroke: vi.fn(),
            fill: vi.fn(),
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 1,
            lineCap: '',
            lineJoin: '',
        } as unknown as CanvasRenderingContext2D;
    }

    const trail = [
        makeBreadcrumb(51.5, -0.1),
        makeBreadcrumb(51.501, -0.1),
        makeBreadcrumb(51.502, -0.1),
    ];

    it('draws an arc for the current position dot when currentPosition is provided', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        const currentPosition = makeBreadcrumb(51.5005, -0.1);
        renderer.render({ trail, currentIndex: 1, currentPosition });

        // arc() should be called at least once (for the position dot)
        expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });

    it('does not draw position dot when currentPosition is null', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        // No currentPosition — only target waypoint arc should be drawn
        renderer.render({ trail, currentIndex: 1, currentPosition: null });

        // arc() should be called exactly once (for the target waypoint only)
        expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('draws an arc for the next-target waypoint when currentIndex is within trail', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null });

        // The target waypoint arc should be drawn (full circle: 0 to 2π)
        const arcCalls = (ctx.arc as ReturnType<typeof vi.fn>).mock.calls;
        expect(arcCalls.length).toBeGreaterThan(0);
        // Full circle: endAngle should be 2π
        const lastArc = arcCalls[arcCalls.length - 1];
        expect(lastArc[3]).toBeCloseTo(0, 5);
        expect(lastArc[4]).toBeCloseTo(Math.PI * 2, 5);
    });

    it('does not draw target waypoint arc when currentIndex equals trail length (arrived)', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        // currentIndex beyond trail — no remaining waypoints to highlight
        renderer.render({ trail, currentIndex: trail.length, currentPosition: null });

        // No arcs: no position dot (null) and no target waypoint (arrived)
        expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('draws two arcs when both currentPosition and target waypoint are present', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        const currentPosition = makeBreadcrumb(51.5005, -0.1);
        renderer.render({ trail, currentIndex: 1, currentPosition });

        // Two arc() calls: one for position dot, one for target waypoint
        expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    });

    it('position dot arc is drawn with a larger radius than the target waypoint arc', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        const currentPosition = makeBreadcrumb(51.5005, -0.1);
        renderer.render({ trail, currentIndex: 1, currentPosition });

        const arcCalls = (ctx.arc as ReturnType<typeof vi.fn>).mock.calls;
        // arc(x, y, radius, startAngle, endAngle)
        // The target waypoint is drawn first and the position dot last, on top of it
        expect(arcCalls).toHaveLength(2);
        const waypointRadius = arcCalls[0][2];
        const positionRadius = arcCalls[1][2];
        expect(positionRadius).toBeGreaterThan(waypointRadius);
    });
});

describe('createTrailRenderer – off-route dot color', () => {
    function makeFullCtxMock() {
        return {
            save: vi.fn(),
            restore: vi.fn(),
            rotate: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            bezierCurveTo: vi.fn(),
            arc: vi.fn(),
            stroke: vi.fn(),
            fill: vi.fn(),
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 1,
            lineCap: '',
            lineJoin: '',
        } as unknown as CanvasRenderingContext2D;
    }

    const trail = [
        makeBreadcrumb(51.5, -0.1),
        makeBreadcrumb(51.501, -0.1),
        makeBreadcrumb(51.502, -0.1),
    ];
    const currentPosition = makeBreadcrumb(51.5005, -0.1);

    it('uses blue fill for position dot when isOffRoute is false', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition, isOffRoute: false });

        // fillStyle is set before arc() — capture the value set before the first arc (position dot)
        // We check that the position dot color is NOT red
        expect(ctx.fillStyle).not.toBe('#dc2626');
    });

    it('uses red fill for position dot when isOffRoute is true', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });

        // Track fillStyle assignments in order
        const fillStyles: string[] = [];
        const ctx = makeFullCtxMock();

        // Intercept fillStyle set operations
        let _fillStyle = '';
        Object.defineProperty(ctx, 'fillStyle', {
            get: () => _fillStyle,
            set: (v: string) => {
                _fillStyle = v;
                fillStyles.push(v);
            },
            configurable: true,
        });

        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition, isOffRoute: true });

        // The position dot fill should be the red off-route color
        expect(fillStyles).toContain('#dc2626');
    });

    it('uses blue fill for position dot when isOffRoute is omitted', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });

        const fillStyles: string[] = [];
        const ctx = makeFullCtxMock();
        let _fillStyle = '';
        Object.defineProperty(ctx, 'fillStyle', {
            get: () => _fillStyle,
            set: (v: string) => {
                _fillStyle = v;
                fillStyles.push(v);
            },
            configurable: true,
        });

        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition });

        // Should use blue (on-route) color, not red
        expect(fillStyles).toContain('#1d4ed8');
        expect(fillStyles).not.toContain('#dc2626');
    });
});

describe('createTrailRenderer – landmark markers', () => {
    function makeFullCtxMock() {
        return {
            save: vi.fn(),
            restore: vi.fn(),
            rotate: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            bezierCurveTo: vi.fn(),
            arc: vi.fn(),
            stroke: vi.fn(),
            fill: vi.fn(),
            closePath: vi.fn(),
            fillText: vi.fn(),
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 1,
            lineCap: '',
            lineJoin: '',
            font: '',
            textAlign: '',
        } as unknown as CanvasRenderingContext2D;
    }

    it('draws diamond markers for breadcrumbs with labels', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        const trail = [
            makeBreadcrumb(51.5, -0.1),
            { ...makeBreadcrumb(51.501, -0.1), label: 'Gate' },
            makeBreadcrumb(51.502, -0.1),
        ];

        renderer.render({ trail, currentIndex: 0, currentPosition: null });

        // closePath is called for diamond shapes — should be called for labeled breadcrumbs
        expect((ctx.closePath as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
        // fillText should be called with the label
        expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
        const textCalls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
        expect(textCalls.some((c: string[]) => c[0] === 'Gate')).toBe(true);
    });

    it('does not draw diamonds when no breadcrumbs have labels', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        const trail = [
            makeBreadcrumb(51.5, -0.1),
            makeBreadcrumb(51.501, -0.1),
            makeBreadcrumb(51.502, -0.1),
        ];

        renderer.render({ trail, currentIndex: 0, currentPosition: null });

        expect((ctx.closePath as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
        expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('uses purple color for landmark markers', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });

        const fillStyles: string[] = [];
        const ctx = makeFullCtxMock();
        let _fillStyle = '';
        Object.defineProperty(ctx, 'fillStyle', {
            get: () => _fillStyle,
            set: (v: string) => {
                _fillStyle = v;
                fillStyles.push(v);
            },
            configurable: true,
        });
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        const trail = [
            { ...makeBreadcrumb(51.5, -0.1), label: 'Bench' },
            makeBreadcrumb(51.501, -0.1),
        ];

        renderer.render({ trail, currentIndex: 0, currentPosition: null });

        expect(fillStyles).toContain('#8b5cf6');
    });
});

describe('createTrailRenderer – devicePixelRatio and RAF throttling', () => {
    function makeFullCtxMock() {
        return {
            save: vi.fn(),
            restore: vi.fn(),
            rotate: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            bezierCurveTo: vi.fn(),
            arc: vi.fn(),
            stroke: vi.fn(),
            fill: vi.fn(),
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 1,
            lineCap: '',
            lineJoin: '',
        } as unknown as CanvasRenderingContext2D;
    }

    const trail = [
        makeBreadcrumb(51.5, -0.1),
        makeBreadcrumb(51.501, -0.1),
        makeBreadcrumb(51.502, -0.1),
    ];

    it('sets canvas.width and canvas.height to cssSize * devicePixelRatio on first render', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        vi.stubGlobal('devicePixelRatio', 2);

        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 300 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 200 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null });

        // Physical size should be 2× the CSS size
        expect(canvas.width).toBe(600);
        expect(canvas.height).toBe(400);
    });

    it('calls ctx.scale(dpr, dpr) when canvas is first sized', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        vi.stubGlobal('devicePixelRatio', 2);

        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 300 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 200 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null });

        const scaleCalls = (ctx.scale as ReturnType<typeof vi.fn>).mock.calls;
        // scale(2, 2) must have been called
        expect(scaleCalls.some((c: number[]) => c[0] === 2 && c[1] === 2)).toBe(true);
    });

    it('does not call ctx.scale again on a second render with same canvas size', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        vi.stubGlobal('devicePixelRatio', 2);

        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 300 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 200 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null });

        const afterFirstRender = (ctx.scale as ReturnType<typeof vi.fn>).mock.calls.length;

        // Second render — canvas size unchanged
        renderer.render({ trail, currentIndex: 1, currentPosition: null });

        const afterSecondRender = (ctx.scale as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(afterSecondRender).toBe(afterFirstRender);
    });

    it('re-applies ctx.scale after canvas is resized', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');

        const canvas = document.createElement('canvas');
        // Start with a small CSS size that differs from the jsdom default (300x150)
        let cssW = 200;
        let cssH = 100;
        Object.defineProperty(canvas, 'clientWidth', { get: () => cssW, configurable: true });
        Object.defineProperty(canvas, 'clientHeight', { get: () => cssH, configurable: true });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        // Use a fresh renderer whose lastPhysicalWidth starts at 0
        const renderer = createTrailRenderer({ canvas });

        // First render: canvas.width(300 default) !== physW (200*dpr) → resize → scale called
        renderer.render({ trail, currentIndex: 1, currentPosition: null });
        const scaleCallsAfterFirst = (ctx.scale as ReturnType<typeof vi.fn>).mock.calls.length;

        // Now canvas.width = cssW * dpr (first render set it). Change CSS size to simulate resize.
        // We need physW to differ from current canvas.width, so change cssW significantly.
        cssW = 150;
        cssH = 80;
        // The new physW will differ from the old physW, triggering resize → scale re-applied
        renderer.render({ trail, currentIndex: 1, currentPosition: null });

        const scaleCallsAfterResize = (ctx.scale as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(scaleCallsAfterResize).toBeGreaterThan(scaleCallsAfterFirst);
    });

    it('RAF throttle: only the latest state is drawn when render() is called multiple times before a frame fires', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');

        // Override the global RAF mock for this test: capture callbacks without firing immediately
        const pendingCallbacks: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            pendingCallbacks.push(cb);
            return pendingCallbacks.length;
        });

        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });

        // Call render() three times before any frame fires
        renderer.render({ trail, currentIndex: 0, currentPosition: null });
        renderer.render({ trail, currentIndex: 1, currentPosition: null });
        renderer.render({ trail, currentIndex: 2, currentPosition: null });

        // Only one rAF callback should have been requested (coalesced)
        expect(pendingCallbacks).toHaveLength(1);

        // clearRect should not have been called yet (no frame fired)
        expect((ctx.clearRect as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

        // Fire the pending frame
        pendingCallbacks[0](0);

        // Now exactly one draw should have happened
        expect((ctx.clearRect as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('RAF throttle: a second render() after frame fires schedules a new rAF', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');

        const calls: number[] = [];
        let rafCounter = 0;
        const pending: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            rafCounter++;
            calls.push(rafCounter);
            pending.push(cb);
            return rafCounter;
        });

        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });

        // First render — schedules rAF #1
        renderer.render({ trail, currentIndex: 0, currentPosition: null });
        expect(calls).toHaveLength(1);

        // Fire the frame
        pending[0](0);

        // Second render after frame — should schedule rAF #2
        renderer.render({ trail, currentIndex: 1, currentPosition: null });
        expect(calls).toHaveLength(2);
    });
});

describe('rotateToHeadingUp', () => {
    it('leaves points alone when heading north', () => {
        const p = rotateToHeadingUp({ x: 3, y: -4 }, 0);
        expect(p.x).toBeCloseTo(3, 6);
        expect(p.y).toBeCloseTo(-4, 6);
    });

    it('puts a point straight ahead (up) when the user faces it', () => {
        // Facing east: a point due east (x > 0) should end up straight ahead (negative y)
        const p = rotateToHeadingUp({ x: 10, y: 0 }, 90);
        expect(p.x).toBeCloseTo(0, 6);
        expect(p.y).toBeCloseTo(-10, 6);
    });

    it('puts a point behind the user below them', () => {
        // Facing north: a point due south (y > 0) is behind
        const p = rotateToHeadingUp({ x: 0, y: 10 }, 0);
        expect(p.y).toBeGreaterThan(0);
    });

    it('puts a point to the right of the user on the right of the view', () => {
        // Facing north: a point due east is on the right
        expect(rotateToHeadingUp({ x: 10, y: 0 }, 0).x).toBeGreaterThan(0);
        // Facing south: a point due east is on the left
        expect(rotateToHeadingUp({ x: 10, y: 0 }, 180).x).toBeLessThan(0);
    });

    it('preserves distance', () => {
        const p = rotateToHeadingUp({ x: 3, y: 4 }, 137);
        expect(Math.hypot(p.x, p.y)).toBeCloseTo(5, 6);
    });
});

describe('lookaheadPoints', () => {
    // A straight path going north every 50 m from the user: y = -50, -100, ...
    const path: Point[] = Array.from({ length: 12 }, (_, i) => ({ x: 0, y: -50 * (i + 1) }));

    it('returns nothing once the trail is finished', () => {
        expect(lookaheadPoints(path, path.length)).toEqual([]);
    });

    it('starts at the target crumb and stops once the lookahead is covered', () => {
        const result = lookaheadPoints(path, 0, 150);
        expect(result[0]).toEqual(path[0]);
        // 50 + 50 + 50 = 150 m: reaches the limit with the third crumb
        expect(result).toHaveLength(3);
    });

    it('includes the crumb that crosses the limit, not just those before it', () => {
        expect(lookaheadPoints(path, 0, 120)).toHaveLength(3);
    });

    it('returns everything left when the route is shorter than the lookahead', () => {
        expect(lookaheadPoints(path, 10, 1000)).toHaveLength(2);
    });

    it('only looks at the remaining path, not what has been walked', () => {
        const result = lookaheadPoints(path, 5, 60);
        expect(result[0]).toEqual(path[5]);
    });
});

describe('computeViewScale', () => {
    const view = { width: 400, height: 500 };

    it('fits the path ahead in auto mode', () => {
        // 100 m straight ahead
        const scale = computeViewScale({ ...view, points: [{ x: 0, y: -100 }] });
        // 100 m must map to no more than the space above the user (72% of the height less margin)
        expect(100 * scale).toBeLessThanOrEqual(500 * 0.72);
        expect(100 * scale).toBeGreaterThan(500 * 0.72 * 0.8);
    });

    it('zooms out for a longer path and in for a short one', () => {
        const near = computeViewScale({ ...view, points: [{ x: 0, y: -50 }] });
        const far = computeViewScale({ ...view, points: [{ x: 0, y: -250 }] });
        expect(far).toBeLessThan(near);
    });

    it('never zooms in past a minimum range, so the last few metres do not blow up', () => {
        const tiny = computeViewScale({ ...view, points: [{ x: 0, y: -2 }] });
        const forty = computeViewScale({ ...view, points: [{ x: 0, y: -40 }] });
        expect(tiny).toBeCloseTo(forty, 6);
    });

    it('keeps sideways points on screen as well', () => {
        const scale = computeViewScale({ ...view, points: [{ x: 300, y: -20 }] });
        expect(300 * scale).toBeLessThanOrEqual(400 / 2);
    });

    it('uses the manual range when given, ignoring the path', () => {
        const scale = computeViewScale({
            ...view,
            points: [{ x: 0, y: -500 }],
            zoomRangeMeters: 80,
        });
        expect(80 * scale).toBeCloseTo(500 * 0.72 - 24, 3);
    });

    it('treats a null manual range as auto', () => {
        const auto = computeViewScale({ ...view, points: [{ x: 0, y: -100 }] });
        expect(
            computeViewScale({ ...view, points: [{ x: 0, y: -100 }], zoomRangeMeters: null })
        ).toBe(auto);
    });

    it('is bounded for degenerate input', () => {
        const scale = computeViewScale({ points: [], width: 0, height: 0 });
        expect(Number.isFinite(scale)).toBe(true);
        expect(scale).toBeGreaterThan(0);
    });

    it('offers increasing manual zoom ranges', () => {
        expect(ZOOM_RANGES_METERS.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < ZOOM_RANGES_METERS.length; i++) {
            expect(ZOOM_RANGES_METERS[i]).toBeGreaterThan(ZOOM_RANGES_METERS[i - 1]);
        }
    });
});

describe('createTrailRenderer – guide, gaps and labels', () => {
    function makeCtx() {
        return {
            save: vi.fn(),
            restore: vi.fn(),
            rotate: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            closePath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            bezierCurveTo: vi.fn(),
            arc: vi.fn(),
            stroke: vi.fn(),
            fill: vi.fn(),
            fillText: vi.fn(),
            setLineDash: vi.fn(),
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 1,
            lineCap: '',
            lineJoin: '',
            font: '',
            textAlign: '',
            shadowColor: '',
            shadowBlur: 0,
        } as unknown as CanvasRenderingContext2D;
    }

    async function draw(
        state: Partial<import('@/trail-renderer').TrailRenderState>
    ): Promise<CanvasRenderingContext2D> {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 500 });
        const ctx = makeCtx();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
        createTrailRenderer({ canvas }).render({
            trail: [
                makeBreadcrumb(51.5, -0.1),
                makeBreadcrumb(51.501, -0.1),
                makeBreadcrumb(51.502, -0.1),
            ],
            currentIndex: 1,
            currentPosition: makeBreadcrumb(51.5005, -0.1),
            ...state,
        });
        return ctx;
    }

    const dashCalls = (ctx: CanvasRenderingContext2D): number[][] =>
        (ctx.setLineDash as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as number[]);

    it('draws no dashes when there is no guide and no gap', async () => {
        const ctx = await draw({});
        expect(dashCalls(ctx).filter(d => d.length > 0)).toHaveLength(0);
    });

    it('draws a dashed guide line from the user to the nearest point of the route', async () => {
        const ctx = await draw({ guidePoint: makeBreadcrumb(51.5005, -0.1015), isOffRoute: true });
        expect(dashCalls(ctx).some(d => d.length > 0)).toBe(true);
        // The guide starts at the user, who is always at the origin of the translated view
        const moves = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls;
        expect(moves.some((c: number[]) => c[0] === 0 && c[1] === 0)).toBe(true);
    });

    it('draws gap segments as dashed straight lines and then clears the dash', async () => {
        const ctx = await draw({ gapSegments: [1] });
        const dashes = dashCalls(ctx);
        expect(dashes.some(d => d.length > 0)).toBe(true);
        expect(dashes[dashes.length - 1]).toEqual([]);
    });

    it('ignores gap indices outside the trail', async () => {
        const ctx = await draw({ gapSegments: [-1, 2, 99] });
        expect(dashCalls(ctx).filter(d => d.length > 0)).toHaveLength(0);
    });

    it('counter-rotates landmark labels so they read upright', async () => {
        const ctx = await draw({
            trail: [
                makeBreadcrumb(51.5, -0.1),
                { ...makeBreadcrumb(51.501, -0.1), label: 'Gate' },
                makeBreadcrumb(51.502, -0.1),
            ],
            compassHeading: 90,
        });
        const rotates = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls.map(
            c => c[0] as number
        );
        // The whole view is rotated by -90 degrees, and the label by +90 degrees
        expect(rotates[0]).toBeCloseTo(-Math.PI / 2, 5);
        expect(rotates).toContainEqual(expect.closeTo(Math.PI / 2, 5));
    });

    it('draws the user on top of everything else', async () => {
        const ctx = await draw({});
        const arcs = (ctx.arc as ReturnType<typeof vi.fn>).mock.calls;
        // Target waypoint (radius 6) is drawn before the user dot (radius 9)
        expect(arcs[arcs.length - 1][2]).toBe(9);
    });

    it('still draws when there is no GPS fix yet (view centred on the target crumb)', async () => {
        const ctx = await draw({ currentPosition: null });
        expect((ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
});

describe('createTrailRenderer – walked vs remaining colouring', () => {
    function makeCtx() {
        const strokes: Array<{ color: string; moves: number[][]; count: number }> = [];
        let color = '';
        let moves: number[][] = [];
        const ctx = {
            save: vi.fn(),
            restore: vi.fn(),
            rotate: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            clearRect: vi.fn(),
            beginPath: vi.fn(() => {
                moves = [];
            }),
            closePath: vi.fn(),
            moveTo: vi.fn((x: number, y: number) => moves.push([x, y])),
            lineTo: vi.fn(),
            bezierCurveTo: vi.fn(),
            arc: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(() => strokes.push({ color, moves: [...moves], count: strokes.length })),
            setLineDash: vi.fn(),
            lineWidth: 1,
            lineCap: '',
            lineJoin: '',
            fillStyle: '',
            get strokeStyle() {
                return color;
            },
            set strokeStyle(v: string) {
                color = v;
            },
        } as unknown as CanvasRenderingContext2D;
        return { ctx, strokes };
    }

    async function draw(currentIndex: number) {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 500 });
        const { ctx, strokes } = makeCtx();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
        const trail = [0, 1, 2, 3].map(i => makeBreadcrumb(51.5 + i * 0.001, -0.1));
        createTrailRenderer({ canvas }).render({
            trail,
            currentIndex,
            currentPosition: trail[Math.max(currentIndex - 1, 0)],
        });
        return strokes.filter(st => st.color === '#9ca3af' || st.color === '#3b82f6');
    }

    it('draws the whole route in blue before anything has been reached', async () => {
        const strokes = await draw(0);
        expect(strokes.map(st => st.color)).toEqual(['#3b82f6']);
    });

    it('draws the first leg blue too: it is the leg being walked, not one already walked', async () => {
        // Standing on crumb 0 and heading for crumb 1
        const strokes = await draw(1);
        expect(strokes.map(st => st.color)).toEqual(['#3b82f6']);
    });

    it('greys only what lies behind the last reached crumb, and starts the blue there', async () => {
        const strokes = await draw(3);
        expect(strokes.map(st => st.color)).toEqual(['#9ca3af', '#3b82f6']);
        // The blue line starts at the last reached crumb (index 2), so the join is seamless
        const grey = strokes[0];
        expect(grey.moves).toHaveLength(1);
    });

    it('draws only grey when everything has been walked', async () => {
        const strokes = await draw(4);
        expect(strokes.map(st => st.color)).toEqual(['#9ca3af']);
    });
});
