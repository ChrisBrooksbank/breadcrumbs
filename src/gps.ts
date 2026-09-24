import type { Breadcrumb } from '@/types';
import { haversineMeters, bearingDegrees } from '@/geo';
import { createMotionDetector } from '@/motion';

const DEFAULT_DISTANCE_METERS = 10;
const TURN_DISTANCE_METERS = 5;
const STRAIGHT_DISTANCE_METERS = 20;
const MAX_GAP_METERS = 50;
const MAX_ACCURACY_METERS = 30;

/** No fixes for this long AND a jump of GAP_MIN_DISTANCE_METERS marks an unobserved gap. */
const GAP_MIN_MS = 30_000;
const GAP_MIN_DISTANCE_METERS = 60;

/** No fix for this long (after the first one) means the watcher has stalled: restart it. */
const STALL_MS = 20_000;
const WATCHDOG_INTERVAL_MS = 5_000;
/** On returning to the foreground, restart the watcher if it has been quiet this long. */
const RESUME_STALE_MS = 5_000;

/** Number of recent fixes whose per-axis median is recorded (rejects isolated spikes). */
const MEDIAN_WINDOW = 3;
/** A pause longer than this between fixes starts the median window afresh. */
const MEDIAN_WINDOW_RESET_MS = 10_000;

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

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Per-axis median of the given fixes, stamped with the newest fix's accuracy and time.
 * A single wild fix in an odd-sized window never survives, and a steady walk is unaffected
 * apart from lagging by one fix.
 */
export function medianFix(window: Breadcrumb[]): Breadcrumb {
    const latest = window[window.length - 1];
    return {
        lat: median(window.map(f => f.lat)),
        lng: median(window.map(f => f.lng)),
        accuracy: latest.accuracy,
        timestamp: latest.timestamp,
    };
}

export type BreadcrumbCallback = (breadcrumb: Breadcrumb) => void;
export type ErrorCallback = (error: GeolocationPositionError) => void;

export interface GeolocationServiceOptions {
    disableMotionSuspension?: boolean;
    emitEveryFix?: boolean;
}

export interface GeolocationService {
    start(onBreadcrumb: BreadcrumbCallback, onError?: ErrorCallback): void;
    stop(): void;
    /** Most recently computed bearing from raw GPS fixes (degrees, 0–360). null until 2+ fixes received. */
    readonly movementBearing: number | null;
    /** Estimated speed in m/s from distance/time between consecutive raw fixes. null until 2+ fixes. */
    readonly estimatedSpeedMs: number | null;
    /** True when in low-power stationary mode (no movement >5m for 30s). */
    readonly isStationary: boolean;
    /** True when GPS is fully suspended due to prolonged motionlessness. */
    readonly isSuspended: boolean;
    /** Called when stationary state changes. */
    onStationaryChange: ((stationary: boolean) => void) | null;
    /** Called when suspension state changes. */
    onSuspendedChange: ((suspended: boolean) => void) | null;
    /** Called when a GPS fix is too inaccurate to trust for breadcrumb recording. */
    onPoorAccuracy: ((accuracy: number) => void) | null;
    /** Called with true when fixes stop arriving (watcher restarted), false when they resume. */
    onGpsLostChange: ((lost: boolean) => void) | null;
    /** True while fixes have stopped arriving. */
    readonly isGpsLost: boolean;
    /** Switch enableHighAccuracy on the fly (restarts the GPS watcher). */
    setHighAccuracy(value: boolean): void;
}

interface TimestampedFix {
    fix: Breadcrumb;
    timestamp: number;
}

export function createGeolocationService(options?: GeolocationServiceOptions): GeolocationService {
    const emitEveryFix = options?.emitEveryFix ?? false;
    let watchId: number | null = null;
    let lastBreadcrumb: Breadcrumb | null = null;

    // Raw fix tracking for movement bearing and speed
    let lastRawFix: Breadcrumb | null = null;
    let lastRawTimestamp: number | null = null;
    let currentMovementBearing: number | null = null;
    let currentSpeedMs: number | null = null;

    // Watchdog: browsers throttle or silently stop watchPosition (screen lock, backgrounding)
    let lastFixWallClock = 0;
    let hasFix = false;
    let gpsLost = false;
    let onGpsLostChange: ((lost: boolean) => void) | null = null;
    let currentWatchOptions: PositionOptions = { enableHighAccuracy: true };
    let watchdogTimer: ReturnType<typeof setInterval> | null = null;

    // Set when a GPS dropout is detected; attached to the next recorded crumb
    let pendingGap = false;

    // Recent accepted-accuracy fixes for the median filter (recording only)
    const medianWindow: Breadcrumb[] = [];

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
    let onStationaryChange: ((stationary: boolean) => void) | null = null;
    let onSuspendedChange: ((suspended: boolean) => void) | null = null;
    let onPoorAccuracy: ((accuracy: number) => void) | null = null;
    let savedOnBreadcrumb: BreadcrumbCallback | null = null;
    let savedOnError: ErrorCallback | undefined;

    function startWatcher(
        onBreadcrumb: BreadcrumbCallback,
        onError: ErrorCallback | undefined,
        options: PositionOptions
    ): void {
        currentWatchOptions = options;
        watchId = navigator.geolocation.watchPosition(
            position => {
                lastFixWallClock = Date.now();
                hasFix = true;
                if (gpsLost) {
                    gpsLost = false;
                    onGpsLostChange?.(false);
                }
                const { latitude, longitude, accuracy } = position.coords;
                const now = position.timestamp;

                const rawFix: Breadcrumb = {
                    lat: latitude,
                    lng: longitude,
                    accuracy,
                    timestamp: now,
                };

                // Detect a GPS dropout: long silence plus a big jump means the route in between
                // was not observed.
                if (
                    lastRawFix !== null &&
                    lastRawTimestamp !== null &&
                    now - lastRawTimestamp > GAP_MIN_MS &&
                    haversineMeters(lastRawFix, rawFix) > GAP_MIN_DISTANCE_METERS
                ) {
                    pendingGap = true;
                }

                // Update movement bearing and speed from every raw fix
                if (lastRawFix !== null) {
                    const rawDistance = haversineMeters(lastRawFix, rawFix);
                    // Only update bearing if the fix has moved enough to be meaningful (>1m)
                    if (rawDistance > 1) {
                        currentMovementBearing = bearingDegrees(lastRawFix, rawFix);
                        rawBearingHistory.push(currentMovementBearing);
                        if (rawBearingHistory.length > 10) rawBearingHistory.shift();
                    }
                    // Update speed estimate from time/distance between fixes
                    if (lastRawTimestamp !== null) {
                        const dtMs = now - lastRawTimestamp;
                        if (dtMs > 0) {
                            currentSpeedMs = (rawDistance / dtMs) * 1000;
                        }
                    }
                }
                lastRawFix = rawFix;
                lastRawTimestamp = now;

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
                            onStationaryChange?.(false);
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
                    return; // Stay stationary, don't emit breadcrumbs
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
                            onStationaryChange?.(true);
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

                if (accuracy > MAX_ACCURACY_METERS) {
                    onPoorAccuracy?.(accuracy);
                    return;
                }

                const candidate: Breadcrumb = {
                    lat: latitude,
                    lng: longitude,
                    accuracy,
                    timestamp: position.timestamp,
                };

                // Navigation wants every raw fix; recording filters noise before deciding.
                let recorded = candidate;
                if (!emitEveryFix) {
                    const previous = medianWindow[medianWindow.length - 1];
                    if (
                        previous &&
                        candidate.timestamp - previous.timestamp > MEDIAN_WINDOW_RESET_MS
                    ) {
                        medianWindow.length = 0;
                    }
                    medianWindow.push(candidate);
                    if (medianWindow.length > MEDIAN_WINDOW) medianWindow.shift();
                    if (medianWindow.length === MEDIAN_WINDOW) recorded = medianFix(medianWindow);
                }

                if (!emitEveryFix && lastBreadcrumb !== null) {
                    const distance = haversineMeters(lastBreadcrumb, recorded);
                    // Never place crumbs closer together than the fix's own uncertainty.
                    const threshold = Math.max(adaptiveThreshold(rawBearingHistory), accuracy);
                    // Always accept if gap exceeds the maximum, otherwise apply the threshold
                    if (distance < threshold && distance < MAX_GAP_METERS) return;
                }

                if (pendingGap) {
                    recorded = { ...recorded, gap: true };
                    pendingGap = false;
                }
                lastBreadcrumb = recorded;
                onBreadcrumb(recorded);
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
                    onStationaryChange?.(false);
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
        hasFix = false;
        gpsLost = false;
        lastFixWallClock = Date.now();
        watchdogTimer = setInterval(checkWatchdog, WATCHDOG_INTERVAL_MS);
        document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    /** Restart the watcher with the options it was last started with. */
    function restartWatcher(): void {
        if (!savedOnBreadcrumb) return;
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        startWatcher(savedOnBreadcrumb, savedOnError, currentWatchOptions);
    }

    function checkWatchdog(): void {
        // Only after the first fix (a pending permission prompt is not a stall), and never
        // while deliberately suspended.
        if (!hasFix || watchId === null || suspended) return;
        if (Date.now() - lastFixWallClock <= STALL_MS) return;
        if (!gpsLost) {
            gpsLost = true;
            onGpsLostChange?.(true);
        }
        // Wait a full stall period before the next restart attempt
        lastFixWallClock = Date.now();
        restartWatcher();
    }

    function handleVisibilityChange(): void {
        if (document.visibilityState !== 'visible') return;
        if (!hasFix || watchId === null || suspended) return;
        if (Date.now() - lastFixWallClock > RESUME_STALE_MS) restartWatcher();
    }

    function stop(): void {
        if (watchdogTimer !== null) {
            clearInterval(watchdogTimer);
            watchdogTimer = null;
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (motion) {
            motion.stop();
            motion.onMotionlessChange = null;
        }
        if (watchId !== null) {
            navigator.geolocation?.clearWatch?.(watchId);
            watchId = null;
        }
        suspended = false;
    }

    function setHighAccuracy(value: boolean): void {
        if (watchId === null || !savedOnBreadcrumb) return;
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        startWatcher(savedOnBreadcrumb, savedOnError, { enableHighAccuracy: value });
    }

    return {
        start,
        stop,
        setHighAccuracy,
        get movementBearing() {
            return currentMovementBearing;
        },
        get estimatedSpeedMs() {
            return currentSpeedMs;
        },
        get isStationary() {
            return currentlyStationary;
        },
        get isSuspended() {
            return suspended;
        },
        get onStationaryChange() {
            return onStationaryChange;
        },
        set onStationaryChange(cb: ((stationary: boolean) => void) | null) {
            onStationaryChange = cb;
        },
        get onSuspendedChange() {
            return onSuspendedChange;
        },
        set onSuspendedChange(cb: ((suspended: boolean) => void) | null) {
            onSuspendedChange = cb;
        },
        get isGpsLost() {
            return gpsLost;
        },
        get onGpsLostChange() {
            return onGpsLostChange;
        },
        set onGpsLostChange(cb: ((lost: boolean) => void) | null) {
            onGpsLostChange = cb;
        },
        get onPoorAccuracy() {
            return onPoorAccuracy;
        },
        set onPoorAccuracy(cb: ((accuracy: number) => void) | null) {
            onPoorAccuracy = cb;
        },
    };
}
