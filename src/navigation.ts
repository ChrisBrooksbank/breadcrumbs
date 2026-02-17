import type { Breadcrumb } from '@/types';
import { haversineMeters } from '@/geo';

const DEFAULT_PROXIMITY_THRESHOLD_METERS = 15;

export interface NavigationProgress {
    currentIndex: number;
    total: number;
    arrived: boolean;
}

export interface NavigationService {
    load(breadcrumbs: Breadcrumb[]): void;
    loadForward(breadcrumbs: Breadcrumb[]): void;
    advanceIfClose(pos: Breadcrumb, threshold?: number): boolean;
    readonly progress: NavigationProgress;
    readonly targetBreadcrumb: Breadcrumb | null;
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

    function handleOrientation(event: DeviceOrientationEventWithCompass): void {
        let heading: number | null = null;

        // iOS provides webkitCompassHeading (0-360, magnetic north)
        if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
            heading = event.webkitCompassHeading;

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
            heading = (360 - event.alpha) % 360;
            needsCalibration = false;
        }

        if (heading !== null) {
            compassHeading = heading;
            if (onHeadingChange) {
                onHeadingChange(heading);
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

    function load(breadcrumbs: Breadcrumb[]): void {
        trail = [...breadcrumbs].reverse();
        currentIndex = 0;
    }

    function loadForward(breadcrumbs: Breadcrumb[]): void {
        trail = [...breadcrumbs];
        currentIndex = 0;
    }

    function advanceIfClose(
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

    return {
        load,
        loadForward,
        advanceIfClose,
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
    };
}
