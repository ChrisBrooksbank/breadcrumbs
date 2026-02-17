import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    projectToLocal,
    computeBoundingBox,
    computeAutoZoomBoundingBox,
    drawCatmullRom,
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

describe('computeBoundingBox', () => {
    it('returns null for empty array', () => {
        expect(computeBoundingBox([])).toBeNull();
    });

    it('returns single point as degenerate box', () => {
        const result = computeBoundingBox([{ x: 5, y: 10 }]);
        expect(result).toEqual({ minX: 5, maxX: 5, minY: 10, maxY: 10 });
    });

    it('computes correct bounds for multiple points', () => {
        const points = [
            { x: 0, y: 0 },
            { x: 100, y: -50 },
            { x: -20, y: 80 },
            { x: 50, y: 30 },
        ];
        const result = computeBoundingBox(points);
        expect(result).toEqual({ minX: -20, maxX: 100, minY: -50, maxY: 80 });
    });

    it('handles negative coordinates correctly', () => {
        const points = [
            { x: -100, y: -200 },
            { x: -50, y: -10 },
        ];
        const result = computeBoundingBox(points);
        expect(result).toEqual({ minX: -100, maxX: -50, minY: -200, maxY: -10 });
    });

    it('handles all same-value points', () => {
        const points = [
            { x: 5, y: 5 },
            { x: 5, y: 5 },
            { x: 5, y: 5 },
        ];
        const result = computeBoundingBox(points);
        expect(result).toEqual({ minX: 5, maxX: 5, minY: 5, maxY: 5 });
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

describe('computeAutoZoomBoundingBox', () => {
    // Helper: make projected points at simple integer coordinates
    function pt(x: number, y: number): Point {
        return { x, y };
    }

    const projected = [
        pt(0, 0), // index 0
        pt(10, 0), // index 1
        pt(20, 0), // index 2
        pt(30, 0), // index 3
        pt(40, 0), // index 4
    ];

    it('returns null for empty projected array', () => {
        expect(computeAutoZoomBoundingBox([], 0, null)).toBeNull();
    });

    it('uses only remaining breadcrumbs when >= 3 remain', () => {
        // currentIndex=1: remaining = [10,20,30,40] (4 points, >= 3)
        const bbox = computeAutoZoomBoundingBox(projected, 1, null);
        expect(bbox).not.toBeNull();
        // x should span from 10 to 40 (remaining only, no walked points)
        expect(bbox!.minX).toBe(10);
        expect(bbox!.maxX).toBe(40);
    });

    it('includes current position in bounding box', () => {
        // currentIndex=1, currentPt far right at x=100
        const bbox = computeAutoZoomBoundingBox(projected, 1, pt(100, 0));
        expect(bbox).not.toBeNull();
        expect(bbox!.maxX).toBe(100);
    });

    it('includes nearby walked points when fewer than 3 remaining', () => {
        // currentIndex=4: remaining = [pt(40,0)] — only 1 point, need 2 more walked
        // Should pull in indices 2 and 3 (x=20, x=30)
        const bbox = computeAutoZoomBoundingBox(projected, 4, null);
        expect(bbox).not.toBeNull();
        // minX should be 20 (walked index 2), maxX should be 40 (remaining index 4)
        expect(bbox!.minX).toBe(20);
        expect(bbox!.maxX).toBe(40);
    });

    it('includes all walked points when only 2 remaining and trail is short', () => {
        // currentIndex=3: remaining = [pt(30,0), pt(40,0)] — 2 points, need 1 more walked
        const bbox = computeAutoZoomBoundingBox(projected, 3, null);
        expect(bbox).not.toBeNull();
        // Should include index 2 (x=20) as the nearest walked point
        expect(bbox!.minX).toBe(20);
        expect(bbox!.maxX).toBe(40);
    });

    it('returns bounding box from remaining when exactly 3 remain', () => {
        // currentIndex=2: remaining = [pt(20,0), pt(30,0), pt(40,0)] — exactly 3
        const bbox = computeAutoZoomBoundingBox(projected, 2, null);
        expect(bbox).not.toBeNull();
        expect(bbox!.minX).toBe(20);
        expect(bbox!.maxX).toBe(40);
        // Should NOT include walked points (index 0,1 with x=0,10)
    });

    it('handles currentIndex = 0 (no walked points yet)', () => {
        // All 5 points remaining — bbox spans entire trail
        const bbox = computeAutoZoomBoundingBox(projected, 0, null);
        expect(bbox).not.toBeNull();
        expect(bbox!.minX).toBe(0);
        expect(bbox!.maxX).toBe(40);
    });

    it('handles currentIndex beyond end of trail (arrived)', () => {
        // currentIndex=5, no remaining — uses last MIN_VISIBLE_UPCOMING walked points
        const bbox = computeAutoZoomBoundingBox(projected, 5, null);
        expect(bbox).not.toBeNull();
        // Should include indices 2,3,4 (x=20,30,40)
        expect(bbox!.minX).toBe(20);
        expect(bbox!.maxX).toBe(40);
    });

    it('handles single-point trail with current position', () => {
        const single = [pt(50, 50)];
        const bbox = computeAutoZoomBoundingBox(single, 0, pt(60, 70));
        expect(bbox).not.toBeNull();
        expect(bbox!.minX).toBe(50);
        expect(bbox!.maxX).toBe(60);
        expect(bbox!.minY).toBe(50);
        expect(bbox!.maxY).toBe(70);
    });

    it('bounding box is tighter than full trail when near the end', () => {
        // currentIndex=3 (2 remaining): bbox should not span from x=0 to x=40
        const fullBbox = computeBoundingBox(projected)!;
        const zoomBbox = computeAutoZoomBoundingBox(projected, 3, null)!;
        const fullRange = fullBbox.maxX - fullBbox.minX;
        const zoomRange = zoomBbox.maxX - zoomBbox.minX;
        expect(zoomRange).toBeLessThan(fullRange);
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

    it('translates around canvas centre (width/2, height/2)', async () => {
        const { createTrailRenderer } = await import('@/trail-renderer');
        const canvas = document.createElement('canvas');
        // jsdom canvas has 0x0 by default; set explicit CSS size via style
        Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
        Object.defineProperty(canvas, 'clientHeight', { get: () => 300 });
        const ctx = makeFullCtxMock();
        vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

        const renderer = createTrailRenderer({ canvas });
        renderer.render({ trail, currentIndex: 1, currentPosition: null, compassHeading: 45 });

        const translateCalls = (ctx.translate as ReturnType<typeof vi.fn>).mock.calls;
        // First translate: to centre (200, 150)
        expect(translateCalls[0][0]).toBeCloseTo(200, 0);
        expect(translateCalls[0][1]).toBeCloseTo(150, 0);
        // Second translate: back from centre (-200, -150)
        expect(translateCalls[1][0]).toBeCloseTo(-200, 0);
        expect(translateCalls[1][1]).toBeCloseTo(-150, 0);
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
        // First arc = position dot (radius index 2), second = target waypoint
        expect(arcCalls).toHaveLength(2);
        const positionRadius = arcCalls[0][2];
        const waypointRadius = arcCalls[1][2];
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
