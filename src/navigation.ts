import type { Breadcrumb } from '@/types';
import { haversineMeters, pointToSegmentMeters } from '@/geo';

const DEFAULT_PROXIMITY_THRESHOLD_METERS = 15;
const OFF_ROUTE_THRESHOLD_METERS = 30;
const OFF_ROUTE_DEBOUNCE_FIXES = 3;

const EMA_ALPHA = 0.2;
const COMPASS_UPDATE_INTERVAL_MS = 100; // ~10fps

/**
 * Exponential moving average smoothing for compass headings.
 * Uses shortest-arc interpolation to correctly handle the 0°/360° wraparound.
 *
 * @param raw - The new raw heading in degrees [0, 360)
 * @param previous - The previous smoothed heading, or null if no prior reading
 * @param alpha - EMA weight for the new sample (0 = no update, 1 = no smoothing)
 * @returns The smoothed heading in degrees [0, 360)
 */
export function smoothHeading(raw: number, previous: number | null, alpha = EMA_ALPHA): number {
    if (previous === null) return raw;

    // Compute the shortest-arc difference between raw and previous
    let diff = raw - previous;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    // Apply EMA along the shortest arc and wrap back to [0, 360)
    return (((previous + alpha * diff) % 360) + 360) % 360;
}

export interface NavigationProgress {
    currentIndex: number;
    total: number;
    arrived: boolean;
}

export interface NavigationService {
    load(breadcrumbs: Breadcrumb[]): void;
    loadForward(breadcrumbs: Breadcrumb[]): void;
    advanceIfClose(pos: Breadcrumb, threshold?: number): boolean;
    distanceToTrailMeters(pos: Breadcrumb): number;
    readonly progress: NavigationProgress;
    readonly targetBreadcrumb: Breadcrumb | null;
    readonly isOffRoute: boolean;
    onOffRouteChange: ((offRoute: boolean) => void) | null;
}

// Extended DeviceOrientationEvent with iOS-specific webkitCompassHeading
interface DeviceOrientationEventWithCompass extends DeviceOrientationEvent {
    webkitCompassHeading?: number;
    webkitCompassAccuracy?: number;
}

export interface CompassService {
    start(): void;
    stop(): void;
    readonly compassHeading: number | null;
    readonly needsCalibration: boolean;
    onHeadingChange: ((heading: number) => void) | null;
}

export function createCompassService(): CompassService {
    let compassHeading: number | null = null;
    let needsCalibration = false;
    let onHeadingChange: ((heading: number) => void) | null = null;
    let lastCallbackTime = -Infinity;

    function handleOrientation(event: DeviceOrientationEventWithCompass): void {
        let rawHeading: number | null = null;

        // iOS provides webkitCompassHeading (0-360, magnetic north)
        if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
            rawHeading = event.webkitCompassHeading;

            // iOS reports compass accuracy via webkitCompassAccuracy
            // Negative values indicate the compass needs calibration
            if (event.webkitCompassAccuracy !== undefined && event.webkitCompassAccuracy < 0) {
                needsCalibration = true;
            } else {
                needsCalibration = false;
            }
        } else if (event.alpha !== null && event.alpha !== undefined) {
            // Android: alpha is degrees from north (0-360, counterclockwise)
            // Convert to clockwise compass heading
            rawHeading = (360 - event.alpha) % 360;
            needsCalibration = false;
        }

        if (rawHeading !== null) {
            // Always apply EMA smoothing so the filter accumulates correctly
            compassHeading = smoothHeading(rawHeading, compassHeading);

            // Clamp callback rate to ~10fps to reduce DOM thrashing
            const now = Date.now();
            if (onHeadingChange && now - lastCallbackTime >= COMPASS_UPDATE_INTERVAL_MS) {
                lastCallbackTime = now;
                onHeadingChange(compassHeading);
            }
        }
    }

    function start(): void {
        window.addEventListener('deviceorientation', handleOrientation as EventListener);
    }

    function stop(): void {
        window.removeEventListener('deviceorientation', handleOrientation as EventListener);
    }

    return {
        start,
        stop,
        get compassHeading() {
            return compassHeading;
        },
        get needsCalibration() {
            return needsCalibration;
        },
        get onHeadingChange() {
            return onHeadingChange;
        },
        set onHeadingChange(fn: ((heading: number) => void) | null) {
            onHeadingChange = fn;
        },
    };
}

export function createNavigationService(): NavigationService {
    let trail: Breadcrumb[] = [];
    let currentIndex = 0;

    // Off-route detection state
    let offRoute = false;
    let offRouteConsecutiveFixes = 0;
    let onOffRouteChange: ((offRoute: boolean) => void) | null = null;

    function load(breadcrumbs: Breadcrumb[]): void {
        trail = [...breadcrumbs].reverse();
        currentIndex = 0;
        offRoute = false;
        offRouteConsecutiveFixes = 0;
    }

    function loadForward(breadcrumbs: Breadcrumb[]): void {
        trail = [...breadcrumbs];
        currentIndex = 0;
        offRoute = false;
        offRouteConsecutiveFixes = 0;
    }

    function checkAndAdvance(
        pos: Breadcrumb,
        threshold = DEFAULT_PROXIMITY_THRESHOLD_METERS
    ): boolean {
        if (trail.length === 0 || currentIndex >= trail.length) return false;

        const target = trail[currentIndex];
        const distance = haversineMeters(pos, target);

        if (distance <= threshold) {
            currentIndex++;
            return true;
        }

        return false;
    }

    /**
     * Calculate the minimum perpendicular distance in meters from pos to any segment
     * in the trail. Returns Infinity if the trail has fewer than 2 points.
     */
    function distanceToTrailMeters(pos: Breadcrumb): number {
        if (trail.length < 2) return Infinity;

        let minDist = Infinity;
        for (let i = 0; i < trail.length - 1; i++) {
            const d = pointToSegmentMeters(pos, trail[i], trail[i + 1]);
            if (d < minDist) minDist = d;
        }
        return minDist;
    }

    /**
     * Update off-route state based on distance to trail.
     * Fires onOffRouteChange callback when the state toggles.
     */
    function updateOffRouteState(distToTrail: number): void {
        const isCurrentlyFar = distToTrail > OFF_ROUTE_THRESHOLD_METERS;

        if (isCurrentlyFar) {
            offRouteConsecutiveFixes++;
            if (!offRoute && offRouteConsecutiveFixes >= OFF_ROUTE_DEBOUNCE_FIXES) {
                offRoute = true;
                onOffRouteChange?.(true);
            }
        } else {
            offRouteConsecutiveFixes = 0;
            if (offRoute) {
                offRoute = false;
                onOffRouteChange?.(false);
            }
        }
    }

    return {
        load,
        loadForward,
        advanceIfClose(pos: Breadcrumb, threshold = DEFAULT_PROXIMITY_THRESHOLD_METERS): boolean {
            const advanced = checkAndAdvance(pos, threshold);
            if (trail.length >= 2) {
                updateOffRouteState(distanceToTrailMeters(pos));
            }
            return advanced;
        },
        distanceToTrailMeters,
        get progress(): NavigationProgress {
            return {
                currentIndex,
                total: trail.length,
                arrived: trail.length > 0 && currentIndex >= trail.length,
            };
        },
        get targetBreadcrumb(): Breadcrumb | null {
            if (trail.length === 0 || currentIndex >= trail.length) return null;
            return trail[currentIndex];
        },
        get isOffRoute(): boolean {
            return offRoute;
        },
        get onOffRouteChange() {
            return onOffRouteChange;
        },
        set onOffRouteChange(fn: ((offRoute: boolean) => void) | null) {
            onOffRouteChange = fn;
        },
    };
}
