import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createNavigationService, createCompassService } from '@/navigation';
import type { Breadcrumb } from '@/types';

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
