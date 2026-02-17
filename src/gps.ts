import type { Breadcrumb } from '@/types';
import { haversineMeters, bearingDegrees } from '@/geo';
import { createMotionDetector } from '@/motion';

const DEFAULT_DISTANCE_METERS = 10;
const TURN_DISTANCE_METERS = 5;
const STRAIGHT_DISTANCE_METERS = 20;
const MAX_GAP_METERS = 50;
const MAX_ACCURACY_METERS = 30;

/** Bearing change > 30° means we're turning */
const TURN_BEARING_THRESHOLD = 30;
/** Bearing change < 15° counts as straight */
const STRAIGHT_BEARING_THRESHOLD = 15;
/** How many consecutive straight fixes before increasing threshold */
const STRAIGHT_FIX_COUNT = 3;

/** Stationary detection: no movement >5m for this many milliseconds → low-power mode */
const STATIONARY_TIME_MS = 30_000;
/** Stationary detection: max displacement within the window to be considered stationary */
const STATIONARY_DISTANCE_METERS = 5;
/** Resume high-accuracy polling when movement exceeds this distance from stationary point */
const RESUME_MOVEMENT_METERS = 5;
/** maximumAge to use in low-power (stationary) mode */
const LOW_POWER_MAX_AGE_MS = 10_000;

/** Compute the absolute angular difference between two bearings (0–180°) */
export function bearingDelta(a: number, b: number): number {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
}

/** Calculate the adaptive distance threshold based on recent bearing history */
export function adaptiveThreshold(bearingHistory: number[]): number {
    if (bearingHistory.length < 2) return DEFAULT_DISTANCE_METERS;

    const latest = bearingHistory[bearingHistory.length - 1];
    const previous = bearingHistory[bearingHistory.length - 2];
    const delta = bearingDelta(latest, previous);

    // On turns, record more frequently
    if (delta > TURN_BEARING_THRESHOLD) return TURN_DISTANCE_METERS;

    // On straight stretches (3+ consecutive fixes with small bearing change), record less frequently
    if (bearingHistory.length >= STRAIGHT_FIX_COUNT) {
        const recentBearings = bearingHistory.slice(-STRAIGHT_FIX_COUNT);
        const allStraight = recentBearings.every((bearing, i) => {
            if (i === 0) return true;
            return bearingDelta(recentBearings[i - 1], bearing) < STRAIGHT_BEARING_THRESHOLD;
        });
        if (allStraight) return STRAIGHT_DISTANCE_METERS;
    }

    return DEFAULT_DISTANCE_METERS;
}

export type BreadcrumbCallback = (breadcrumb: Breadcrumb) => void;
export type ErrorCallback = (error: GeolocationPositionError) => void;

export interface GeolocationServiceOptions {
    disableMotionSuspension?: boolean;
}

export interface GeolocationService {
    start(onBreadcrumb: BreadcrumbCallback, onError?: ErrorCallback): void;
    stop(): void;
    /** Most recently computed bearing from raw GPS fixes (degrees, 0–360). null until 2+ fixes received. */
    readonly movementBearing: number | null;
    /** True when in low-power stationary mode (no movement >5m for 30s). */
    readonly isStationary: boolean;
    /** True when GPS is fully suspended due to prolonged motionlessness. */
    readonly isSuspended: boolean;
    /** Called when suspension state changes. */
    onSuspendedChange: ((suspended: boolean) => void) | null;
}

interface TimestampedFix {
    fix: Breadcrumb;
    timestamp: number;
}

export function createGeolocationService(options?: GeolocationServiceOptions): GeolocationService {
    let watchId: number | null = null;
    let lastBreadcrumb: Breadcrumb | null = null;

    // Raw fix tracking for movement bearing (includes fixes rejected by accuracy/distance filters)
    let lastRawFix: Breadcrumb | null = null;
    let currentMovementBearing: number | null = null;

    // Bearing history for adaptive threshold (from raw fixes with meaningful movement)
    const rawBearingHistory: number[] = [];

    // Stationary detection state
    const recentFixes: TimestampedFix[] = [];
    let stationaryPoint: Breadcrumb | null = null;
    let currentlyStationary = false;

    // Motion-aware GPS suspension
    const motionEnabled = !options?.disableMotionSuspension;
    const motion = motionEnabled ? createMotionDetector() : null;
    let suspended = false;
    let onSuspendedChange: ((suspended: boolean) => void) | null = null;
    let savedOnBreadcrumb: BreadcrumbCallback | null = null;
    let savedOnError: ErrorCallback | undefined;

    function startWatcher(
        onBreadcrumb: BreadcrumbCallback,
        onError: ErrorCallback | undefined,
        options: PositionOptions
    ): void {
        watchId = navigator.geolocation.watchPosition(
            position => {
                const { latitude, longitude, accuracy } = position.coords;
                const now = position.timestamp;

                const rawFix: Breadcrumb = {
                    lat: latitude,
                    lng: longitude,
                    accuracy,
                    timestamp: now,
                };

                // Update movement bearing from every raw fix (regardless of accuracy/distance filters)
                if (lastRawFix !== null) {
                    const rawDistance = haversineMeters(lastRawFix, rawFix);
                    // Only update bearing if the fix has moved enough to be meaningful (>1m)
                    if (rawDistance > 1) {
                        currentMovementBearing = bearingDegrees(lastRawFix, rawFix);
                        rawBearingHistory.push(currentMovementBearing);
                        // Keep history bounded to avoid unbounded growth
                        if (rawBearingHistory.length > 10) rawBearingHistory.shift();
                    }
                }
                lastRawFix = rawFix;

                // --- Stationary detection ---
                // Add current fix to sliding window and prune old entries
                recentFixes.push({ fix: rawFix, timestamp: now });
                const cutoff = now - STATIONARY_TIME_MS;
                while (recentFixes.length > 0 && recentFixes[0].timestamp < cutoff) {
                    recentFixes.shift();
                }

                if (currentlyStationary) {
                    // Check if we've moved far enough from the stationary point to resume
                    if (stationaryPoint !== null) {
                        const moveDistance = haversineMeters(stationaryPoint, rawFix);
                        if (moveDistance > RESUME_MOVEMENT_METERS) {
                            // Movement detected — exit stationary mode and restart in high-accuracy mode
                            currentlyStationary = false;
                            stationaryPoint = null;
                            if (motion) motion.stop();
                            if (suspended) {
                                suspended = false;
                                onSuspendedChange?.(false);
                            }
                            if (watchId !== null) {
                                navigator.geolocation.clearWatch(watchId);
                                watchId = null;
                            }
                            startWatcher(onBreadcrumb, onError, { enableHighAccuracy: true });
                            return;
                        }
                    }
                } else {
                    // Check if we should enter stationary mode
                    // Need at least 30s of data and all fixes within 5m of current position
                    if (
                        recentFixes.length >= 2 &&
                        now - recentFixes[0].timestamp >= STATIONARY_TIME_MS
                    ) {
                        const allClose = recentFixes.every(
                            ({ fix }) => haversineMeters(fix, rawFix) <= STATIONARY_DISTANCE_METERS
                        );
                        if (allClose) {
                            currentlyStationary = true;
                            stationaryPoint = rawFix;
                            if (motion) motion.start();
                            // Restart watcher in low-power mode
                            if (watchId !== null) {
                                navigator.geolocation.clearWatch(watchId);
                                watchId = null;
                            }
                            startWatcher(onBreadcrumb, onError, {
                                enableHighAccuracy: true,
                                maximumAge: LOW_POWER_MAX_AGE_MS,
                            });
                            return;
                        }
                    }
                }
                // --- End stationary detection ---

                if (accuracy > MAX_ACCURACY_METERS) return;

                const candidate: Breadcrumb = {
                    lat: latitude,
                    lng: longitude,
                    accuracy,
                    timestamp: position.timestamp,
                };

                if (lastBreadcrumb !== null) {
                    const distance = haversineMeters(lastBreadcrumb, candidate);
                    const threshold = adaptiveThreshold(rawBearingHistory);
                    // Always accept if gap exceeds the maximum, otherwise apply adaptive threshold
                    if (distance < threshold && distance < MAX_GAP_METERS) return;
                }

                lastBreadcrumb = candidate;
                onBreadcrumb(candidate);
            },
            error => {
                onError?.(error);
            },
            options
        );
    }

    function start(onBreadcrumb: BreadcrumbCallback, onError?: ErrorCallback): void {
        if (watchId !== null) return;
        savedOnBreadcrumb = onBreadcrumb;
        savedOnError = onError;

        if (motion) {
            motion.onMotionlessChange = (motionless: boolean) => {
                if (motionless && currentlyStationary && !suspended) {
                    // Fully suspend GPS
                    if (watchId !== null) {
                        navigator.geolocation.clearWatch(watchId);
                        watchId = null;
                    }
                    suspended = true;
                    onSuspendedChange?.(true);
                } else if (!motionless && suspended) {
                    // Resume GPS immediately
                    suspended = false;
                    currentlyStationary = false;
                    stationaryPoint = null;
                    motion.stop();
                    onSuspendedChange?.(false);
                    if (savedOnBreadcrumb) {
                        startWatcher(savedOnBreadcrumb, savedOnError, {
                            enableHighAccuracy: true,
                        });
                    }
                }
            };
        }

        startWatcher(onBreadcrumb, onError, { enableHighAccuracy: true });
    }

    function stop(): void {
        if (motion) {
            motion.stop();
            motion.onMotionlessChange = null;
        }
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        suspended = false;
    }

    return {
        start,
        stop,
        get movementBearing() {
            return currentMovementBearing;
        },
        get isStationary() {
            return currentlyStationary;
        },
        get isSuspended() {
            return suspended;
        },
        get onSuspendedChange() {
            return onSuspendedChange;
        },
        set onSuspendedChange(cb: ((suspended: boolean) => void) | null) {
            onSuspendedChange = cb;
        },
    };
}
