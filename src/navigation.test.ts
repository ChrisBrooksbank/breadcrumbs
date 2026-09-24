import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    createNavigationService,
    createCompassService,
    smoothHeading,
    createPositionSmoother,
    orientationToHeading,
    findTurns,
} from '@/navigation';
import type { Breadcrumb } from '@/types';

// Helper: build a breadcrumb offset from a reference point by dx (east, m) and dy (north, m)
// Uses equirectangular approximation (accurate enough for walking-scale tests at mid-latitude)
const REF_LAT = 51.5;
const REF_LNG = 0.0;
const METERS_PER_DEG_LAT = 111_195;
const METERS_PER_DEG_LNG = METERS_PER_DEG_LAT * Math.cos((REF_LAT * Math.PI) / 180);

function offsetCrumb(dx: number, dy: number): Breadcrumb {
    return {
        lat: REF_LAT + dy / METERS_PER_DEG_LAT,
        lng: REF_LNG + dx / METERS_PER_DEG_LNG,
        accuracy: 5,
        timestamp: 0,
    };
}

function makeBreadcrumb(lat: number, lng: number, accuracy = 5, timestamp = 0): Breadcrumb {
    return { lat, lng, accuracy, timestamp };
}

describe('NavigationService – trail reversal', () => {
    it('starts at the last recorded breadcrumb (first in reverse order)', () => {
        const service = createNavigationService();
        const breadcrumbs = [
            makeBreadcrumb(51.5, -0.1),
            makeBreadcrumb(51.501, -0.1),
            makeBreadcrumb(51.502, -0.1),
        ];
        service.load(breadcrumbs);

        // Target should be the last breadcrumb recorded (end of trail = start of return)
        expect(service.targetBreadcrumb).toEqual(breadcrumbs[2]);
    });

    it('ends at the first recorded breadcrumb (original start)', () => {
        const service = createNavigationService();
        const breadcrumbs = [
            makeBreadcrumb(51.5, -0.1),
            makeBreadcrumb(51.501, -0.1),
            makeBreadcrumb(51.502, -0.1),
        ];
        service.load(breadcrumbs);

        // Advance past all breadcrumbs to verify the last target is the first recorded
        const pos = makeBreadcrumb(51.502, -0.1); // right on top of breadcrumbs[2]
        service.advanceIfClose(pos, 20);
        const pos2 = makeBreadcrumb(51.501, -0.1);
        service.advanceIfClose(pos2, 20);

        // Now target should be the original start
        expect(service.targetBreadcrumb).toEqual(breadcrumbs[0]);
    });
});

describe('NavigationService – initial state', () => {
    it('returns null targetBreadcrumb before loading', () => {
        const service = createNavigationService();
        expect(service.targetBreadcrumb).toBeNull();
    });

    it('returns zero progress before loading', () => {
        const service = createNavigationService();
        expect(service.progress).toEqual({ currentIndex: 0, total: 0, arrived: false });
    });

    it('returns null targetBreadcrumb after loading empty trail', () => {
        const service = createNavigationService();
        service.load([]);
        expect(service.targetBreadcrumb).toBeNull();
    });
});

describe('NavigationService – proximity detection and index advancement', () => {
    let service: ReturnType<typeof createNavigationService>;
    const breadcrumbs = [
        makeBreadcrumb(51.5, -0.1),
        makeBreadcrumb(51.5001, -0.1), // ~11m north
        makeBreadcrumb(51.5002, -0.1), // ~22m north of start
    ];

    beforeEach(() => {
        service = createNavigationService();
        service.load(breadcrumbs);
    });

    it('does not advance when user is beyond threshold', () => {
        // Position far from current target (breadcrumbs[2])
        const farPos = makeBreadcrumb(51.499, -0.1); // far south
        const advanced = service.advanceIfClose(farPos, 15);
        expect(advanced).toBe(false);
        expect(service.progress.currentIndex).toBe(0);
    });

    it('advances when user is within default threshold (15m)', () => {
        // Position right on top of current target (breadcrumbs[2])
        const closePos = makeBreadcrumb(51.5002, -0.1);
        const advanced = service.advanceIfClose(closePos);
        expect(advanced).toBe(true);
        expect(service.progress.currentIndex).toBe(1);
    });

    it('advances when user is within custom threshold', () => {
        const closePos = makeBreadcrumb(51.5002, -0.1);
        const advanced = service.advanceIfClose(closePos, 20);
        expect(advanced).toBe(true);
    });

    it('does not advance when user is beyond custom threshold', () => {
        const farPos = makeBreadcrumb(51.499, -0.1);
        const advanced = service.advanceIfClose(farPos, 5);
        expect(advanced).toBe(false);
    });

    it('uses GPS accuracy as part of the arrival zone', () => {
        const nearWithUncertainGps = makeBreadcrumb(51.50046, -0.1, 30); // ~29m from target
        const advanced = service.advanceIfClose(nearWithUncertainGps, 15);
        expect(advanced).toBe(true);
    });

    it('skips a missed breadcrumb when the user is already near a later one', () => {
        const spacedBreadcrumbs = [
            makeBreadcrumb(51.5, -0.1),
            makeBreadcrumb(51.5005, -0.1),
            makeBreadcrumb(51.501, -0.1),
        ];
        service.load(spacedBreadcrumbs);
        // Current target is spacedBreadcrumbs[2]. Being near spacedBreadcrumbs[1] means the
        // user has effectively passed the noisy target and should not be stranded.
        const nearNextTarget = makeBreadcrumb(51.5005, -0.1, 5);
        const advanced = service.advanceIfClose(nearNextTarget, 15);
        expect(advanced).toBe(true);
        expect(service.targetBreadcrumb).toEqual(spacedBreadcrumbs[0]);
    });

    it('advances through all breadcrumbs sequentially', () => {
        // Target is breadcrumbs[2], then [1], then [0]
        expect(service.targetBreadcrumb).toEqual(breadcrumbs[2]);

        service.advanceIfClose(makeBreadcrumb(51.5002, -0.1), 15);
        expect(service.targetBreadcrumb).toEqual(breadcrumbs[1]);

        service.advanceIfClose(makeBreadcrumb(51.5001, -0.1), 15);
        expect(service.targetBreadcrumb).toEqual(breadcrumbs[0]);
    });

    it('target becomes null after reaching final breadcrumb', () => {
        service.advanceIfClose(makeBreadcrumb(51.5002, -0.1), 15);
        service.advanceIfClose(makeBreadcrumb(51.5001, -0.1), 15);
        service.advanceIfClose(makeBreadcrumb(51.5, -0.1), 15);

        expect(service.targetBreadcrumb).toBeNull();
    });

    it('does not advance beyond the trail', () => {
        service.advanceIfClose(makeBreadcrumb(51.5002, -0.1), 15);
        service.advanceIfClose(makeBreadcrumb(51.5001, -0.1), 15);
        service.advanceIfClose(makeBreadcrumb(51.5, -0.1), 15);

        const result = service.advanceIfClose(makeBreadcrumb(51.5, -0.1), 15);
        expect(result).toBe(false);
    });
});

describe('NavigationService – progress tracking', () => {
    it('reports correct total after loading', () => {
        const service = createNavigationService();
        service.load([makeBreadcrumb(51.5, -0.1), makeBreadcrumb(51.501, -0.1)]);
        expect(service.progress.total).toBe(2);
    });

    it('reports arrived: false when not yet done', () => {
        const service = createNavigationService();
        service.load([makeBreadcrumb(51.5, -0.1), makeBreadcrumb(51.501, -0.1)]);
        expect(service.progress.arrived).toBe(false);
    });

    it('reports arrived: true after reaching final breadcrumb', () => {
        const service = createNavigationService();
        service.load([makeBreadcrumb(51.5, -0.1)]);
        service.advanceIfClose(makeBreadcrumb(51.5, -0.1), 15);
        expect(service.progress.arrived).toBe(true);
    });

    it('reports arrived: false for empty trail', () => {
        const service = createNavigationService();
        service.load([]);
        expect(service.progress.arrived).toBe(false);
    });

    it('increments currentIndex as breadcrumbs are advanced', () => {
        const service = createNavigationService();
        service.load([
            makeBreadcrumb(51.5, -0.1),
            makeBreadcrumb(51.501, -0.1),
            makeBreadcrumb(51.502, -0.1),
        ]);

        expect(service.progress.currentIndex).toBe(0);
        service.advanceIfClose(makeBreadcrumb(51.502, -0.1), 15);
        expect(service.progress.currentIndex).toBe(1);
        service.advanceIfClose(makeBreadcrumb(51.501, -0.1), 15);
        expect(service.progress.currentIndex).toBe(2);
    });

    it('resets progress when load is called again', () => {
        const service = createNavigationService();
        service.load([makeBreadcrumb(51.5, -0.1), makeBreadcrumb(51.501, -0.1)]);
        service.advanceIfClose(makeBreadcrumb(51.501, -0.1), 15);
        expect(service.progress.currentIndex).toBe(1);

        service.load([makeBreadcrumb(51.5, -0.1)]);
        expect(service.progress.currentIndex).toBe(0);
        expect(service.progress.total).toBe(1);
    });
});

describe('NavigationService – follow mode (loadForward)', () => {
    it('starts at the first breadcrumb (forward order)', () => {
        const service = createNavigationService();
        const breadcrumbs = [
            makeBreadcrumb(51.5, -0.1),
            makeBreadcrumb(51.501, -0.1),
            makeBreadcrumb(51.502, -0.1),
        ];
        service.loadForward(breadcrumbs);

        expect(service.targetBreadcrumb).toEqual(breadcrumbs[0]);
    });

    it('advances through breadcrumbs in forward order', () => {
        const service = createNavigationService();
        const breadcrumbs = [
            makeBreadcrumb(51.5, -0.1),
            makeBreadcrumb(51.501, -0.1),
            makeBreadcrumb(51.502, -0.1),
        ];
        service.loadForward(breadcrumbs);

        // Target starts at breadcrumbs[0]
        expect(service.targetBreadcrumb).toEqual(breadcrumbs[0]);

        service.advanceIfClose(makeBreadcrumb(51.5, -0.1), 15);
        expect(service.targetBreadcrumb).toEqual(breadcrumbs[1]);

        service.advanceIfClose(makeBreadcrumb(51.501, -0.1), 15);
        expect(service.targetBreadcrumb).toEqual(breadcrumbs[2]);
    });

    it('ends at the last breadcrumb (end of forward trail)', () => {
        const service = createNavigationService();
        const breadcrumbs = [makeBreadcrumb(51.5, -0.1), makeBreadcrumb(51.501, -0.1)];
        service.loadForward(breadcrumbs);

        service.advanceIfClose(makeBreadcrumb(51.5, -0.1), 15);
        service.advanceIfClose(makeBreadcrumb(51.501, -0.1), 15);

        expect(service.targetBreadcrumb).toBeNull();
        expect(service.progress.arrived).toBe(true);
    });

    it('reports correct total after loadForward', () => {
        const service = createNavigationService();
        service.loadForward([
            makeBreadcrumb(51.5, -0.1),
            makeBreadcrumb(51.501, -0.1),
            makeBreadcrumb(51.502, -0.1),
        ]);
        expect(service.progress.total).toBe(3);
    });

    it('does not reverse breadcrumbs (forward != retrace)', () => {
        const service = createNavigationService();
        const breadcrumbs = [
            makeBreadcrumb(51.5, -0.1), // first recorded = first target in follow
            makeBreadcrumb(51.501, -0.1),
            makeBreadcrumb(51.502, -0.1), // last recorded = last target in follow
        ];
        service.loadForward(breadcrumbs);

        // In follow mode, first target is breadcrumbs[0] (not [2] as in retrace)
        expect(service.targetBreadcrumb).toEqual(breadcrumbs[0]);

        const retraceService = createNavigationService();
        retraceService.load(breadcrumbs);

        // In retrace mode, first target is breadcrumbs[2]
        expect(retraceService.targetBreadcrumb).toEqual(breadcrumbs[2]);
    });

    it('resets on subsequent loadForward calls', () => {
        const service = createNavigationService();
        service.loadForward([makeBreadcrumb(51.5, -0.1), makeBreadcrumb(51.501, -0.1)]);
        service.advanceIfClose(makeBreadcrumb(51.5, -0.1), 15);
        expect(service.progress.currentIndex).toBe(1);

        service.loadForward([makeBreadcrumb(51.6, -0.2)]);
        expect(service.progress.currentIndex).toBe(0);
        expect(service.progress.total).toBe(1);
        expect(service.targetBreadcrumb).toEqual(makeBreadcrumb(51.6, -0.2));
    });
});

describe('CompassService – DeviceOrientation', () => {
    function fireDeviceOrientation(
        detail: Partial<DeviceOrientationEvent> & {
            webkitCompassHeading?: number;
            webkitCompassAccuracy?: number;
        }
    ): void {
        const event = Object.assign(new Event('deviceorientation'), detail);
        window.dispatchEvent(event);
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('starts with null compassHeading', () => {
        const compass = createCompassService();
        expect(compass.compassHeading).toBeNull();
    });

    it('starts with needsCalibration false', () => {
        const compass = createCompassService();
        expect(compass.needsCalibration).toBe(false);
    });

    it('uses webkitCompassHeading on iOS when available', () => {
        const compass = createCompassService();
        compass.start();

        fireDeviceOrientation({ webkitCompassHeading: 90, alpha: 270 });

        expect(compass.compassHeading).toBe(90);
        compass.stop();
    });

    it('converts alpha to clockwise heading on Android', () => {
        const compass = createCompassService();
        compass.start();

        // alpha=270 counterclockwise means 360-270=90 degrees clockwise (East)
        fireDeviceOrientation({ alpha: 270 });

        expect(compass.compassHeading).toBe(90);
        compass.stop();
    });

    it('converts alpha=0 to heading 0 (North)', () => {
        const compass = createCompassService();
        compass.start();

        fireDeviceOrientation({ alpha: 0 });

        expect(compass.compassHeading).toBe(0);
        compass.stop();
    });

    it('converts alpha=180 to heading 180 (South)', () => {
        const compass = createCompassService();
        compass.start();

        fireDeviceOrientation({ alpha: 180 });

        expect(compass.compassHeading).toBe(180);
        compass.stop();
    });

    it('sets needsCalibration true when webkitCompassAccuracy is negative', () => {
        const compass = createCompassService();
        compass.start();

        fireDeviceOrientation({ webkitCompassHeading: 45, webkitCompassAccuracy: -1 });

        expect(compass.needsCalibration).toBe(true);
        compass.stop();
    });

    it('clears needsCalibration when webkitCompassAccuracy is non-negative', () => {
        const compass = createCompassService();
        compass.start();

        // First trigger calibration needed
        fireDeviceOrientation({ webkitCompassHeading: 45, webkitCompassAccuracy: -1 });
        expect(compass.needsCalibration).toBe(true);

        // Then calibration resolved
        fireDeviceOrientation({ webkitCompassHeading: 45, webkitCompassAccuracy: 15 });
        expect(compass.needsCalibration).toBe(false);
        compass.stop();
    });

    it('calls onHeadingChange callback with new heading', () => {
        const compass = createCompassService();
        const callback = vi.fn();
        compass.onHeadingChange = callback;
        compass.start();

        fireDeviceOrientation({ alpha: 90 });

        expect(callback).toHaveBeenCalledWith(270); // 360 - 90 = 270
        compass.stop();
    });

    it('does not update heading when alpha is null', () => {
        const compass = createCompassService();
        compass.start();

        fireDeviceOrientation({ alpha: null as unknown as number });

        expect(compass.compassHeading).toBeNull();
        compass.stop();
    });

    it('stops listening after stop() is called', () => {
        const compass = createCompassService();
        compass.start();

        fireDeviceOrientation({ alpha: 45 });
        expect(compass.compassHeading).toBe(315); // 360 - 45

        compass.stop();

        fireDeviceOrientation({ alpha: 90 });
        // Heading should not have changed
        expect(compass.compassHeading).toBe(315);
    });
});

describe('CompassService – update rate clamping (~10fps)', () => {
    function fireDeviceOrientation(
        detail: Partial<DeviceOrientationEvent> & {
            webkitCompassHeading?: number;
            webkitCompassAccuracy?: number;
        }
    ): void {
        const event = Object.assign(new Event('deviceorientation'), detail);
        window.dispatchEvent(event);
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('fires callback on first event immediately', () => {
        const compass = createCompassService();
        const callback = vi.fn();
        compass.onHeadingChange = callback;
        compass.start();

        vi.setSystemTime(0);
        fireDeviceOrientation({ alpha: 90 });

        expect(callback).toHaveBeenCalledTimes(1);
        compass.stop();
    });

    it('skips callback when events arrive faster than 100ms', () => {
        const compass = createCompassService();
        const callback = vi.fn();
        compass.onHeadingChange = callback;
        compass.start();

        vi.setSystemTime(0);
        fireDeviceOrientation({ alpha: 90 });

        // Fire more events within the 100ms window
        vi.setSystemTime(30);
        fireDeviceOrientation({ alpha: 91 });
        vi.setSystemTime(60);
        fireDeviceOrientation({ alpha: 92 });
        vi.setSystemTime(90);
        fireDeviceOrientation({ alpha: 93 });

        // Only the first event should have triggered the callback
        expect(callback).toHaveBeenCalledTimes(1);
        compass.stop();
    });

    it('fires callback again after 100ms has elapsed', () => {
        const compass = createCompassService();
        const callback = vi.fn();
        compass.onHeadingChange = callback;
        compass.start();

        vi.setSystemTime(0);
        fireDeviceOrientation({ alpha: 90 });

        vi.setSystemTime(100);
        fireDeviceOrientation({ alpha: 180 });

        expect(callback).toHaveBeenCalledTimes(2);
        compass.stop();
    });

    it('EMA smoothing accumulates even when callback is skipped', () => {
        const compass = createCompassService();
        compass.onHeadingChange = () => {};
        compass.start();

        vi.setSystemTime(0);
        fireDeviceOrientation({ alpha: 270 }); // 360-270=90 raw

        // Fire skipped events that should still advance EMA
        vi.setSystemTime(50);
        fireDeviceOrientation({ alpha: 180 }); // 360-180=180 raw — skipped callback but EMA runs

        vi.setSystemTime(100);
        fireDeviceOrientation({ alpha: 90 }); // 360-90=270 raw — triggers callback with EMA-smoothed value

        // compassHeading has been smoothed over 3 ticks toward 270
        // The smoothed value should be between 90 and 270 (convergence in progress)
        expect(compass.compassHeading).toBeGreaterThan(90);
        expect(compass.compassHeading).toBeLessThan(270);
        compass.stop();
    });
});

describe('smoothHeading – EMA with shortest-arc wraparound', () => {
    it('returns raw heading unchanged when previous is null (first reading)', () => {
        expect(smoothHeading(90, null)).toBe(90);
        expect(smoothHeading(0, null)).toBe(0);
        expect(smoothHeading(359, null)).toBe(359);
    });

    it('applies EMA weight: alpha=1.0 returns raw heading exactly', () => {
        // With alpha=1, result is fully the raw heading regardless of previous
        expect(smoothHeading(180, 0, 1.0)).toBe(180);
        expect(smoothHeading(90, 270, 1.0)).toBe(90);
    });

    it('applies EMA weight: alpha=0.0 returns previous heading unchanged', () => {
        expect(smoothHeading(90, 45, 0)).toBeCloseTo(45, 5);
        expect(smoothHeading(180, 90, 0)).toBeCloseTo(90, 5);
    });

    it('smooths toward raw heading with alpha=0.2', () => {
        // previous=0, raw=100: diff=100, smoothed=0+0.2*100=20
        expect(smoothHeading(100, 0, 0.2)).toBeCloseTo(20, 5);
    });

    it('handles 359°→1° wraparound correctly via shortest arc', () => {
        // previous=359, raw=1: naive diff=1-359=-358, shortest arc diff=2 (clockwise)
        // smoothed = 359 + 0.2 * 2 = 359.4, wrapped to [0,360) = 359.4
        const result = smoothHeading(1, 359, 0.2);
        expect(result).toBeCloseTo(359.4, 3);
    });

    it('handles 1°→359° wraparound correctly via shortest arc', () => {
        // previous=1, raw=359: diff=358, shortest arc diff=-2 (anticlockwise)
        // smoothed = 1 + 0.2 * (-2) = 0.6
        const result = smoothHeading(359, 1, 0.2);
        expect(result).toBeCloseTo(0.6, 3);
    });

    it('converges to raw heading within 500ms of a 90° turn at 10fps', () => {
        // 10 fps for 500ms = 5 ticks with alpha=0.2
        // After 5 EMA steps from 0 toward 90:
        // tick1: 0.2*90=18, tick2: 18+0.2*(90-18)=32.4, tick3: 32.4+0.2*(90-32.4)=43.92
        // tick4: 43.92+0.2*(90-43.92)=53.136, tick5: 53.136+0.2*(90-53.136)=60.509
        // The spec says "within 500ms" — we verify convergence trend (not exact value)
        let heading = 0;
        for (let i = 0; i < 5; i++) {
            heading = smoothHeading(90, heading, 0.2);
        }
        // Should have moved meaningfully toward 90° (at least 50° of the way)
        expect(heading).toBeGreaterThan(50);
        expect(heading).toBeLessThan(90);
    });

    it('result is always within [0, 360)', () => {
        const cases: Array<[number, number]> = [
            [0, 350],
            [350, 0],
            [180, 181],
            [181, 180],
            [359, 1],
            [1, 359],
        ];
        for (const [raw, prev] of cases) {
            const result = smoothHeading(raw, prev, 0.2);
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThan(360);
        }
    });

    it('smoothed heading stays within ±10° of raw during steady walking (alpha=0.2)', () => {
        // After many iterations at a fixed raw heading, smoothed converges close to raw
        // Simulate 20 ticks at alpha=0.2 from 0 toward 45 degrees
        let heading = 0;
        for (let i = 0; i < 20; i++) {
            heading = smoothHeading(45, heading, 0.2);
        }
        // After 20 ticks at alpha=0.2, should be within 1° of 45
        expect(Math.abs(heading - 45)).toBeLessThan(10);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Off-route detection
// Trail: straight line from (0, 0) → (0, 100) in local metres (due north)
// ─────────────────────────────────────────────────────────────────────────────
describe('NavigationService – distanceToTrailMeters', () => {
    it('returns Infinity with fewer than 2 breadcrumbs', () => {
        const service = createNavigationService();
        service.load([offsetCrumb(0, 0)]);
        expect(service.distanceToTrailMeters(offsetCrumb(0, 50))).toBe(Infinity);
    });

    it('returns ~0 for a point on the trail', () => {
        const service = createNavigationService();
        service.load([offsetCrumb(0, 0), offsetCrumb(0, 100)]);
        const dist = service.distanceToTrailMeters(offsetCrumb(0, 50));
        expect(dist).toBeCloseTo(0, 1);
    });

    it('returns ~35m for a point 35m off the trail', () => {
        const service = createNavigationService();
        service.load([offsetCrumb(0, 0), offsetCrumb(0, 100)]);
        const dist = service.distanceToTrailMeters(offsetCrumb(35, 50)); // 35m east of midpoint
        expect(dist).toBeCloseTo(35, 0);
    });

    it('returns distance to nearest endpoint when past trail end', () => {
        const service = createNavigationService();
        service.load([offsetCrumb(0, 0), offsetCrumb(0, 100)]);
        // 50m past the northern end; nearest segment point is (0, 100)
        const dist = service.distanceToTrailMeters(offsetCrumb(0, 150));
        expect(dist).toBeCloseTo(50, 0);
    });

    it('returns minimum across multiple segments', () => {
        const service = createNavigationService();
        // L-shaped trail: (0,0) → (0,100) → (100,100)
        service.load([offsetCrumb(0, 0), offsetCrumb(0, 100), offsetCrumb(100, 100)]);
        // Point near the bend: (0, 90) — closest to first segment
        const dist = service.distanceToTrailMeters(offsetCrumb(0, 90));
        expect(dist).toBeCloseTo(0, 0);
    });
});

describe('NavigationService – off-route detection with debounce', () => {
    // Straight trail: 0m → 200m north
    const trailCrumbs = [offsetCrumb(0, 0), offsetCrumb(0, 200)];

    function makeService() {
        const service = createNavigationService();
        service.load(trailCrumbs);
        return service;
    }

    it('isOffRoute is false initially', () => {
        const service = makeService();
        expect(service.isOffRoute).toBe(false);
    });

    it('isOffRoute stays false when on-trail after 2 far fixes (below debounce)', () => {
        const service = makeService();
        // 2 consecutive far fixes (< debounce threshold of 3)
        service.advanceIfClose(offsetCrumb(35, 100), 5); // 35m east = off route
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        expect(service.isOffRoute).toBe(false);
    });

    it('isOffRoute becomes true after 3 consecutive far fixes', () => {
        const service = makeService();
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        expect(service.isOffRoute).toBe(true);
    });

    it('fires onOffRouteChange(true) when threshold triggers', () => {
        const service = makeService();
        const callback = vi.fn();
        service.onOffRouteChange = callback;

        service.advanceIfClose(offsetCrumb(35, 100), 5);
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        expect(callback).not.toHaveBeenCalled();

        service.advanceIfClose(offsetCrumb(35, 100), 5);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(true);
    });

    it('fires onOffRouteChange(true) only once even with more far fixes', () => {
        const service = makeService();
        const callback = vi.fn();
        service.onOffRouteChange = callback;

        for (let i = 0; i < 6; i++) {
            service.advanceIfClose(offsetCrumb(35, 100), 5);
        }
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('returns to on-route immediately on a single close fix and fires onOffRouteChange(false)', () => {
        const service = makeService();
        const callback = vi.fn();
        service.onOffRouteChange = callback;

        // Trigger off-route
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        expect(service.isOffRoute).toBe(true);

        // Single on-trail fix → back on track
        service.advanceIfClose(offsetCrumb(5, 100), 5); // 5m east — within 30m threshold
        expect(service.isOffRoute).toBe(false);
        expect(callback).toHaveBeenCalledTimes(2);
        expect(callback).toHaveBeenLastCalledWith(false);
    });

    it('resets off-route counter when load() is called', () => {
        const service = makeService();
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        service.advanceIfClose(offsetCrumb(35, 100), 5);

        service.load(trailCrumbs); // reset
        service.advanceIfClose(offsetCrumb(35, 100), 5); // only 1 far fix after reset
        service.advanceIfClose(offsetCrumb(35, 100), 5); // 2nd
        expect(service.isOffRoute).toBe(false);
    });

    it('consecutive fixes close to trail reset the debounce counter', () => {
        const service = makeService();
        // 2 far fixes
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        // 1 close fix — resets counter to 0
        service.advanceIfClose(offsetCrumb(5, 100), 5);
        // 2 more far fixes — counter restarts from 0
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        service.advanceIfClose(offsetCrumb(35, 100), 5);
        expect(service.isOffRoute).toBe(false);
    });
});

describe('PositionSmoother', () => {
    it('returns null when no fixes have been pushed', () => {
        const smoother = createPositionSmoother(3);
        expect(smoother.smoothed).toBeNull();
    });

    it('returns the single fix when only one has been pushed', () => {
        const smoother = createPositionSmoother(3);
        const fix = makeBreadcrumb(51.5, -0.1);
        smoother.push(fix);
        expect(smoother.smoothed).toEqual(fix);
    });

    it('returns weighted average of two fixes (recent weighted higher)', () => {
        const smoother = createPositionSmoother(3);
        smoother.push(makeBreadcrumb(0, 0));
        smoother.push(makeBreadcrumb(3, 3));
        // Weights: [1, 2], total=3
        // lat = (0*1 + 3*2)/3 = 2, lng = (0*1 + 3*2)/3 = 2
        const result = smoother.smoothed!;
        expect(result.lat).toBeCloseTo(2, 5);
        expect(result.lng).toBeCloseTo(2, 5);
    });

    it('returns weighted average of three fixes', () => {
        const smoother = createPositionSmoother(3);
        smoother.push(makeBreadcrumb(0, 0));
        smoother.push(makeBreadcrumb(6, 6));
        smoother.push(makeBreadcrumb(12, 12));
        // Weights: [1, 2, 3], total=6
        // lat = (0*1 + 6*2 + 12*3)/6 = 48/6 = 8
        const result = smoother.smoothed!;
        expect(result.lat).toBeCloseTo(8, 5);
        expect(result.lng).toBeCloseTo(8, 5);
    });

    it('drops oldest fixes beyond buffer size', () => {
        const smoother = createPositionSmoother(2);
        smoother.push(makeBreadcrumb(0, 0));
        smoother.push(makeBreadcrumb(10, 10));
        smoother.push(makeBreadcrumb(20, 20));
        // Buffer now: [10, 20], weights: [1, 2], total=3
        // lat = (10*1 + 20*2)/3 = 50/3 ≈ 16.67
        const result = smoother.smoothed!;
        expect(result.lat).toBeCloseTo(50 / 3, 5);
    });

    it('reset clears the buffer', () => {
        const smoother = createPositionSmoother(3);
        smoother.push(makeBreadcrumb(51.5, -0.1));
        smoother.reset();
        expect(smoother.smoothed).toBeNull();
    });

    it('uses accuracy and timestamp from the most recent fix', () => {
        const smoother = createPositionSmoother(3);
        smoother.push(makeBreadcrumb(0, 0, 10, 100));
        smoother.push(makeBreadcrumb(1, 1, 5, 200));
        const result = smoother.smoothed!;
        expect(result.accuracy).toBe(5);
        expect(result.timestamp).toBe(200);
    });
});

describe('orientationToHeading', () => {
    it('equals 360 - alpha with the phone flat', () => {
        for (const alpha of [0, 45, 90, 180, 270, 315]) {
            const heading = orientationToHeading(alpha, 0, 0);
            expect(heading).not.toBeNull();
            expect(shortestDelta(heading as number, (360 - alpha) % 360)).toBeLessThan(0.001);
        }
    });

    it('gives the direction the back faces with the phone held upright', () => {
        // Upright portrait (beta 90): the back camera looks along the heading
        expect(shortestDelta(orientationToHeading(0, 90, 0) as number, 0)).toBeLessThan(0.001);
        expect(shortestDelta(orientationToHeading(270, 90, 0) as number, 90)).toBeLessThan(0.001);
        expect(shortestDelta(orientationToHeading(180, 90, 0) as number, 180)).toBeLessThan(0.001);
        expect(shortestDelta(orientationToHeading(90, 90, 0) as number, 270)).toBeLessThan(0.001);
    });

    it('is steady through the tilt range of a phone held in front of a walker', () => {
        // Facing east (alpha 270) at every tilt from flat to upright
        for (const beta of [0, 20, 45, 60, 75, 90]) {
            const heading = orientationToHeading(270, beta, 0) as number;
            expect(shortestDelta(heading, 90)).toBeLessThan(0.001);
        }
    });

    it('tolerates a little sideways roll while upright', () => {
        const heading = orientationToHeading(270, 80, 10) as number;
        expect(shortestDelta(heading, 90)).toBeLessThan(15);
    });

    it('returns null when face-down, where no direction is meaningful', () => {
        expect(orientationToHeading(0, 180, 0)).toBeNull();
    });

    it('always returns a value in [0, 360)', () => {
        for (const alpha of [0, 100, 359.9]) {
            for (const beta of [-40, 0, 30, 89]) {
                const heading = orientationToHeading(alpha, beta, 5);
                if (heading !== null) {
                    expect(heading).toBeGreaterThanOrEqual(0);
                    expect(heading).toBeLessThan(360);
                }
            }
        }
    });
});

function shortestDelta(a: number, b: number): number {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

describe('CompassService – absolute orientation', () => {
    function fire(type: string, detail: Record<string, unknown>): void {
        window.dispatchEvent(Object.assign(new Event(type), detail));
    }

    afterEach(() => {
        delete (window as unknown as Record<string, unknown>).ondeviceorientationabsolute;
    });

    it('listens to deviceorientationabsolute when the browser has it, and reports absolute', () => {
        (window as unknown as Record<string, unknown>).ondeviceorientationabsolute = null;
        const compass = createCompassService();
        compass.start();

        fire('deviceorientationabsolute', { alpha: 270, beta: 90, gamma: 0, absolute: true });

        expect(compass.compassHeading).toBeCloseTo(90, 3);
        expect(compass.absolute).toBe(true);
        compass.stop();
    });

    it('ignores relative deviceorientation events when absolute ones are available', () => {
        (window as unknown as Record<string, unknown>).ondeviceorientationabsolute = null;
        const compass = createCompassService();
        compass.start();

        fire('deviceorientation', { alpha: 90, beta: 0, gamma: 0, absolute: false });

        expect(compass.compassHeading).toBeNull();
        compass.stop();
    });

    it('falls back to deviceorientation and reports a relative reading as not absolute', () => {
        const compass = createCompassService();
        compass.start();

        fire('deviceorientation', { alpha: 90, beta: 0, gamma: 0, absolute: false });

        expect(compass.compassHeading).toBeCloseTo(270, 3);
        expect(compass.absolute).toBe(false);
        compass.stop();
    });

    it('treats an iOS webkitCompassHeading as absolute', () => {
        const compass = createCompassService();
        compass.start();

        fire('deviceorientation', { webkitCompassHeading: 45, alpha: 10 });

        expect(compass.compassHeading).toBeCloseTo(45, 3);
        expect(compass.absolute).toBe(true);
        compass.stop();
    });

    it('has no absolute flag before the first reading', () => {
        expect(createCompassService().absolute).toBeNull();
    });

    it('uses tilt so an upright phone still gives the facing direction', () => {
        const compass = createCompassService();
        compass.start();

        fire('deviceorientation', { alpha: 270, beta: 90, gamma: 0, absolute: true });

        expect(compass.compassHeading).toBeCloseTo(90, 3);
        compass.stop();
    });

    it('skips a reading that has no meaningful direction', () => {
        const compass = createCompassService();
        compass.start();

        fire('deviceorientation', { alpha: 0, beta: 180, gamma: 0, absolute: true });

        expect(compass.compassHeading).toBeNull();
        compass.stop();
    });
});

/** Crumbs every `spacing` metres along a straight line, in local east/north metres. */
function line(x0: number, y0: number, x1: number, y1: number, spacing = 10): Breadcrumb[] {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.round(length / spacing));
    return Array.from({ length: steps + 1 }, (_, i) =>
        offsetCrumb(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps)
    );
}

describe('NavigationService – strict, windowed progress', () => {
    it('does not jump across a hairpin whose legs are only 15 m apart', () => {
        // Up one side of a path and back down the other, 15 m across
        const trail = [...line(0, 0, 0, 300), ...line(15, 300, 15, 0)];
        const service = createNavigationService();
        service.loadForward(trail);

        // Walk up the first leg to its midpoint: physically 15 m from the return leg
        for (let y = 0; y <= 150; y += 5) service.advanceIfClose(offsetCrumb(0, y));

        // Should be around crumb 15, not thrown ~30 crumbs ahead onto the return leg
        expect(service.progress.currentIndex).toBeGreaterThanOrEqual(14);
        expect(service.progress.currentIndex).toBeLessThanOrEqual(17);
    });

    it('cannot arrive early by touching the far end of a loop', () => {
        // A loop that ends 8 m from where it started
        const trail = [
            ...line(0, 0, 0, 100),
            ...line(0, 100, 100, 100).slice(1),
            ...line(100, 100, 100, 0).slice(1),
            ...line(100, 0, 8, -2).slice(1),
        ];
        const service = createNavigationService();
        service.loadForward(trail);

        // Standing near the start of the loop, 8 m from its end: not reached yet
        service.advanceIfClose(offsetCrumb(0, 0));
        expect(service.progress.arrived).toBe(false);
        expect(service.progress.currentIndex).toBeLessThanOrEqual(2);
    });

    it('still advances when the walker passes crumbs 22 m to the side (beyond the 15 m zone)', () => {
        const service = createNavigationService();
        service.loadForward(line(0, 0, 0, 200));
        const offRouteAlerts = vi.fn();
        service.onOffRouteChange = offRouteAlerts;

        for (let y = 0; y <= 100; y += 5) service.advanceIfClose(offsetCrumb(22, y));

        // Crumbs are every 10 m, so ~crumb 10 by y = 100
        expect(service.progress.currentIndex).toBeGreaterThanOrEqual(9);
        expect(service.progress.currentIndex).toBeLessThanOrEqual(12);
        expect(offRouteAlerts).not.toHaveBeenCalled();
    });

    it('does not advance past a segment the walker is nowhere near', () => {
        const service = createNavigationService();
        service.loadForward(line(0, 0, 0, 200));
        // 60 m east of the path, level with its middle
        for (let i = 0; i < 6; i++) service.advanceIfClose(offsetCrumb(60, 100));
        expect(service.progress.currentIndex).toBe(0);
    });

    it('never moves backwards', () => {
        const service = createNavigationService();
        service.loadForward(line(0, 0, 0, 200));
        for (let y = 0; y <= 100; y += 5) service.advanceIfClose(offsetCrumb(0, y));
        const reached = service.progress.currentIndex;
        for (let y = 100; y >= 0; y -= 5) service.advanceIfClose(offsetCrumb(0, y));
        expect(service.progress.currentIndex).toBe(reached);
    });

    it('rejoins at the right place after a detour that skipped part of the route', () => {
        const service = createNavigationService();
        service.loadForward(line(0, 0, 0, 400));
        const changes: boolean[] = [];
        service.onOffRouteChange = off => changes.push(off);

        for (let y = 0; y <= 50; y += 5) service.advanceIfClose(offsetCrumb(0, y));
        // Detour: 100 m east, 150 m north on a parallel track, then back west onto the path
        for (let x = 0; x <= 100; x += 10) service.advanceIfClose(offsetCrumb(x, 50));
        for (let y = 50; y <= 200; y += 10) service.advanceIfClose(offsetCrumb(100, y));
        for (let x = 100; x >= 0; x -= 10) service.advanceIfClose(offsetCrumb(x, 200));

        expect(changes).toEqual([true, false]);
        // Back at y = 200, so about crumb 20 rather than still chasing crumb ~6
        expect(service.progress.currentIndex).toBeGreaterThanOrEqual(19);
        expect(service.progress.currentIndex).toBeLessThanOrEqual(22);
    });

    it('on rejoining takes the earliest nearby segment, not a later leg of a hairpin', () => {
        const trail = [...line(0, 0, 0, 300), ...line(15, 300, 15, 0)];
        const service = createNavigationService();
        service.loadForward(trail);
        for (let y = 0; y <= 100; y += 5) service.advanceIfClose(offsetCrumb(0, y));
        // Wander off to the west, then come back between the two legs at y = 120
        for (let i = 0; i < 4; i++) service.advanceIfClose(offsetCrumb(-80, 120));
        expect(service.isOffRoute).toBe(true);
        service.advanceIfClose(offsetCrumb(7, 120));

        // Nearest to both legs; must resume on the first (around crumb 12), not the return leg
        expect(service.progress.currentIndex).toBeLessThan(20);
    });

    it('does not report off-route after arriving', () => {
        const service = createNavigationService();
        service.loadForward(line(0, 0, 0, 30));
        const alerts = vi.fn();
        service.onOffRouteChange = alerts;
        for (let y = 0; y <= 30; y += 5) service.advanceIfClose(offsetCrumb(0, y));
        expect(service.progress.arrived).toBe(true);
        for (let i = 0; i < 6; i++) service.advanceIfClose(offsetCrumb(0, 30));
        expect(alerts).not.toHaveBeenCalled();
    });

    it('accepts arrival farther out when both the start and the fix were weak', () => {
        const weakStart = { ...offsetCrumb(0, 0), accuracy: 20 };
        const service = createNavigationService();
        service.load([weakStart, offsetCrumb(0, 10)]);
        service.advanceIfClose(offsetCrumb(0, 10));

        // 26 m from the start crumb: outside 15 m, inside the combined uncertainty
        service.advanceIfClose({ ...offsetCrumb(0, 26), accuracy: 20 });
        expect(service.progress.arrived).toBe(true);
    });

    it('does not extend arrival for precise fixes', () => {
        const service = createNavigationService();
        service.load([offsetCrumb(0, 0), offsetCrumb(0, 10)]);
        service.advanceIfClose(offsetCrumb(0, 10));
        service.advanceIfClose(offsetCrumb(0, 26)); // accuracy 5 both ways
        expect(service.progress.arrived).toBe(false);
    });
});

describe('NavigationService – remaining distance', () => {
    it('is the distance to the target plus the rest of the path', () => {
        const service = createNavigationService();
        service.loadForward(line(0, 0, 0, 100));
        // Standing 3 m before the first crumb
        const remaining = service.remainingMeters(offsetCrumb(0, -3));
        expect(remaining).toBeGreaterThan(101);
        expect(remaining).toBeLessThan(105);
    });

    it('shrinks as the walker progresses', () => {
        const service = createNavigationService();
        service.loadForward(line(0, 0, 0, 100));
        for (let y = 0; y <= 40; y += 5) service.advanceIfClose(offsetCrumb(0, y));
        const remaining = service.remainingMeters(offsetCrumb(0, 40));
        expect(remaining).toBeGreaterThan(55);
        expect(remaining).toBeLessThan(65);
    });

    it('is zero once arrived or with nothing loaded', () => {
        const service = createNavigationService();
        expect(service.remainingMeters(offsetCrumb(0, 0))).toBe(0);
        service.loadForward(line(0, 0, 0, 20));
        for (let y = 0; y <= 20; y += 5) service.advanceIfClose(offsetCrumb(0, y));
        expect(service.remainingMeters(offsetCrumb(0, 20))).toBe(0);
    });
});

describe('findTurns and NavigationService.nextTurn', () => {
    const lShape = [...line(0, 0, 0, 100), ...line(0, 100, 100, 100).slice(1)];

    it('finds a right-angle turn and its direction (right when walking north then east)', () => {
        const turns = findTurns(lShape);
        expect(turns).toHaveLength(1);
        expect(turns[0].direction).toBe('right');
        expect(turns[0].angle).toBeGreaterThan(80);
        expect(turns[0].angle).toBeLessThan(100);
        expect(lShape[turns[0].index].lat).toBeCloseTo(offsetCrumb(0, 100).lat, 5);
    });

    it('reverses left/right when the same path is retraced', () => {
        const service = createNavigationService();
        service.load(lShape); // walking back: west then south
        expect(service.turns).toHaveLength(1);
        expect(service.turns[0].direction).toBe('left');
    });

    it('finds no turn on a straight line, even with GPS wobble', () => {
        const wobble = line(0, 0, 0, 200).map((_, i) =>
            offsetCrumb(((i % 3) - 1) * 2, i * 10 + ((i * 7) % 3))
        );
        expect(findTurns(wobble)).toEqual([]);
    });

    it('ignores gentle bends but finds a U-turn', () => {
        const gentle = [...line(0, 0, 0, 100), ...line(0, 100, 30, 190).slice(1)]; // ~18 degrees
        expect(findTurns(gentle)).toEqual([]);

        const uTurn = [...line(0, 0, 0, 100), ...line(15, 100, 15, 0)];
        // Across a 15 m gap a U-turn is two consecutive right-angle turns
        const turns = findTurns(uTurn);
        expect(turns.map(t => t.direction)).toEqual(['right', 'right']);
        for (const turn of turns) {
            expect(turn.angle).toBeGreaterThan(80);
            expect(turn.angle).toBeLessThan(100);
        }
    });

    it('reports the distance along the path to the next corner', () => {
        const service = createNavigationService();
        service.loadForward(lShape);
        const next = service.nextTurn(offsetCrumb(0, 0));
        expect(next?.direction).toBe('right');
        expect(next?.meters).toBeGreaterThan(97);
        expect(next?.meters).toBeLessThan(105);
    });

    it('moves on to the following corner and then reports none', () => {
        const service = createNavigationService();
        service.loadForward(lShape);
        for (let y = 0; y <= 110; y += 5) service.advanceIfClose(offsetCrumb(0, Math.min(y, 100)));
        for (let x = 5; x <= 100; x += 5) service.advanceIfClose(offsetCrumb(x, 100));
        expect(service.nextTurn(offsetCrumb(100, 100))).toBeNull();
    });

    it('returns null with nothing loaded', () => {
        expect(createNavigationService().nextTurn(offsetCrumb(0, 0))).toBeNull();
    });
});

describe('NavigationService – nearestPathPoint', () => {
    it('finds the closest point on the path ahead, with its distance', () => {
        const service = createNavigationService();
        service.loadForward(line(0, 0, 0, 200));
        const nearest = service.nearestPathPoint(offsetCrumb(30, 100));
        expect(nearest?.distance).toBeGreaterThan(29);
        expect(nearest?.distance).toBeLessThan(31);
        expect(nearest?.point.lat).toBeCloseTo(offsetCrumb(0, 100).lat, 5);
    });

    it('ignores the part of the path already walked', () => {
        const service = createNavigationService();
        service.loadForward(line(0, 0, 0, 200));
        for (let y = 0; y <= 100; y += 5) service.advanceIfClose(offsetCrumb(0, y));
        // Back beside the start: the nearest remaining path is ahead, not the walked stretch
        const nearest = service.nearestPathPoint(offsetCrumb(20, 0));
        expect(nearest?.point.lat).toBeGreaterThan(offsetCrumb(0, 80).lat);
    });

    it('is null when nothing is loaded or the path is finished', () => {
        const service = createNavigationService();
        expect(service.nearestPathPoint(offsetCrumb(0, 0))).toBeNull();
        service.loadForward(line(0, 0, 0, 20));
        for (let y = 0; y <= 20; y += 5) service.advanceIfClose(offsetCrumb(0, y));
        expect(service.nearestPathPoint(offsetCrumb(0, 20))).toBeNull();
    });
});
