import type { Breadcrumb } from '@/types';
import {
    bearingDegrees,
    closestPointOnSegment,
    haversineMeters,
    pointToSegmentMeters,
    simplifyPolyline,
} from '@/geo';

const DEFAULT_PROXIMITY_THRESHOLD_METERS = 15;
const MAX_ACCURACY_ASSIST_METERS = 35;
const OFF_ROUTE_THRESHOLD_METERS = 30;
const OFF_ROUTE_DEBOUNCE_FIXES = 3;

/**
 * Progress only advances through crumbs within this much path ahead of the target (and
 * always at least MIN_WINDOW_CRUMBS beyond it). This tolerates a missed crumb or two, but
 * stops a path that doubles back near itself (hairpin, loop, out-and-back) from being
 * short-cut by mere physical closeness.
 */
const SKIP_WINDOW_M = 45;
const MIN_WINDOW_CRUMBS = 2;

/** Path simplification tolerance used to find turns, ignoring GPS wobble. */
const TURN_SIMPLIFY_TOLERANCE_M = 6;
const TURN_MIN_ANGLE_DEG = 35;
const TURN_MIN_LEG_M = 8;

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

function toRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

/**
 * Compass heading (degrees clockwise from north, [0, 360)) of the direction the user is
 * facing, from W3C DeviceOrientation angles. Works with the phone flat or held upright:
 * the horizontal direction of the device's top edge (flat) and of its back (upright) are
 * combined, so neither pose degenerates. Returns null when the phone is so nearly
 * face-up/face-down and tilted that neither direction is meaningful.
 *
 * With beta = gamma = 0 this equals 360 - alpha.
 */
export function orientationToHeading(alpha: number, beta = 0, gamma = 0): number | null {
    const a = toRad(alpha);
    const b = toRad(beta);
    const g = toRad(gamma);
    const [sA, cA, sB, cB, sG, cG] = [
        Math.sin(a),
        Math.cos(a),
        Math.sin(b),
        Math.cos(b),
        Math.sin(g),
        Math.cos(g),
    ];

    let east = 0;
    let north = 0;
    // Top edge of the device (only while it is not tipped past vertical)
    if (cB > 0) {
        east += -sA * cB;
        north += cA * cB;
    }
    // Back of the device
    east += -(cA * sG + sA * sB * cG);
    north += cA * sB * cG - sA * sG;

    if (Math.hypot(east, north) < 0.05) return null;
    const heading = (Math.atan2(east, north) * 180) / Math.PI;
    return ((heading % 360) + 360) % 360;
}

export interface NavigationProgress {
    currentIndex: number;
    total: number;
    arrived: boolean;
}

/** A place where the path turns; `index` is the trail crumb at the corner. */
export interface TurnPoint {
    index: number;
    direction: 'left' | 'right';
    /** Size of the turn in degrees (35-180). */
    angle: number;
}

export interface NextTurn extends TurnPoint {
    /** Distance from the user to the corner, along the path. */
    meters: number;
}

export interface NearestPathPoint {
    point: Breadcrumb;
    /** Straight-line distance from the user to `point`. */
    distance: number;
    /** Trail index of the crumb just ahead of `point`. */
    index: number;
}

/** Corners along an ordered trail, found on a simplified copy so GPS wobble is ignored. */
export function findTurns(trail: Breadcrumb[]): TurnPoint[] {
    const kept = simplifyPolyline(trail, TURN_SIMPLIFY_TOLERANCE_M);
    const turns: TurnPoint[] = [];
    for (let k = 1; k < kept.length - 1; k++) {
        const before = trail[kept[k - 1]];
        const corner = trail[kept[k]];
        const after = trail[kept[k + 1]];
        if (
            haversineMeters(before, corner) < TURN_MIN_LEG_M ||
            haversineMeters(corner, after) < TURN_MIN_LEG_M
        ) {
            continue;
        }
        let delta = bearingDegrees(corner, after) - bearingDegrees(before, corner);
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        if (Math.abs(delta) >= TURN_MIN_ANGLE_DEG) {
            turns.push({
                index: kept[k],
                direction: delta > 0 ? 'right' : 'left',
                angle: Math.abs(delta),
            });
        }
    }
    return turns;
}

export interface NavigationService {
    load(breadcrumbs: Breadcrumb[]): void;
    loadForward(breadcrumbs: Breadcrumb[]): void;
    advanceIfClose(pos: Breadcrumb, threshold?: number): boolean;
    proximityThresholdMeters(
        pos: Breadcrumb,
        target?: Breadcrumb | null,
        threshold?: number
    ): number;
    distanceToTrailMeters(pos: Breadcrumb): number;
    /** The ordered trail being followed (reversed for retrace). */
    readonly trail: readonly Breadcrumb[];
    /** True while walking a stretch where GPS was lost when it was recorded (a guessed line). */
    readonly inGap: boolean;
    /** Corners along the trail, in walking order. */
    readonly turns: readonly TurnPoint[];
    /** Path distance still to walk from `pos` to the end of the trail (0 once arrived). */
    remainingMeters(pos: Breadcrumb): number;
    /** The next corner ahead, with its distance along the path; null if none remain. */
    nextTurn(pos: Breadcrumb): NextTurn | null;
    /** Closest point on the part of the path still to walk, or null if none remains. */
    nearestPathPoint(pos: Breadcrumb): NearestPathPoint | null;
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
    /**
     * Whether headings are referenced to north: true (iOS, absolute events), false (relative
     * `deviceorientation` only, so headings are offset by an unknown amount), null before
     * the first reading.
     */
    readonly absolute: boolean | null;
    readonly needsCalibration: boolean;
    onHeadingChange: ((heading: number) => void) | null;
}

export function createCompassService(): CompassService {
    let compassHeading: number | null = null;
    let absolute: boolean | null = null;
    let needsCalibration = false;
    let onHeadingChange: ((heading: number) => void) | null = null;
    let lastCallbackTime = -Infinity;

    // Chrome on Android only reports north-referenced angles via the *absolute* event;
    // plain `deviceorientation` there is relative to an arbitrary start direction.
    const eventName =
        typeof window !== 'undefined' && 'ondeviceorientationabsolute' in window
            ? 'deviceorientationabsolute'
            : 'deviceorientation';

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
            absolute = true;
        } else if (event.alpha !== null && event.alpha !== undefined) {
            // Android: derive a clockwise heading from alpha/beta/gamma so it stays correct
            // when the phone is held upright, not just flat.
            rawHeading = orientationToHeading(event.alpha, event.beta ?? 0, event.gamma ?? 0);
            absolute = eventName === 'deviceorientationabsolute' ? true : (event.absolute ?? null);
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
        window.addEventListener(eventName, handleOrientation as EventListener);
    }

    function stop(): void {
        window.removeEventListener(eventName, handleOrientation as EventListener);
    }

    return {
        start,
        stop,
        get compassHeading() {
            return compassHeading;
        },
        get absolute() {
            return absolute;
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

export interface PositionSmoother {
    /** Feed a new GPS fix into the smoother. */
    push(pos: Breadcrumb): void;
    /** The smoothed position (weighted moving average), or null if no fixes yet. */
    readonly smoothed: Breadcrumb | null;
    /** Reset the buffer. */
    reset(): void;
}

/**
 * Weighted moving average of the last N GPS positions.
 * More recent fixes are weighted higher (linearly: weight = index + 1).
 * Used for bearing calculation only; raw position kept for distance/advance.
 */
export function createPositionSmoother(bufferSize = 3): PositionSmoother {
    const buffer: Breadcrumb[] = [];

    function push(pos: Breadcrumb): void {
        buffer.push(pos);
        if (buffer.length > bufferSize) buffer.shift();
    }

    function computeSmoothed(): Breadcrumb | null {
        if (buffer.length === 0) return null;
        if (buffer.length === 1) return buffer[0];

        let totalWeight = 0;
        let lat = 0;
        let lng = 0;
        for (let i = 0; i < buffer.length; i++) {
            const weight = i + 1; // newer = higher weight
            lat += buffer[i].lat * weight;
            lng += buffer[i].lng * weight;
            totalWeight += weight;
        }
        return {
            lat: lat / totalWeight,
            lng: lng / totalWeight,
            accuracy: buffer[buffer.length - 1].accuracy,
            timestamp: buffer[buffer.length - 1].timestamp,
        };
    }

    function reset(): void {
        buffer.length = 0;
    }

    return {
        push,
        get smoothed() {
            return computeSmoothed();
        },
        reset,
    };
}

export function createNavigationService(): NavigationService {
    let trail: Breadcrumb[] = [];
    /** cumulative[i] = path metres from trail[0] to trail[i]. */
    let cumulative: number[] = [];
    let turns: TurnPoint[] = [];
    let currentIndex = 0;
    /** Retrace (true): the trail end is where the user started, so being near it means arrived. */
    let retraceMode = true;

    // Off-route detection state
    let offRoute = false;
    let offRouteConsecutiveFixes = 0;
    let onOffRouteChange: ((offRoute: boolean) => void) | null = null;

    function prepare(ordered: Breadcrumb[], retrace: boolean): void {
        retraceMode = retrace;
        trail = ordered;
        currentIndex = 0;
        offRoute = false;
        offRouteConsecutiveFixes = 0;
        cumulative = [];
        for (let i = 0; i < trail.length; i++) {
            cumulative.push(
                i === 0 ? 0 : cumulative[i - 1] + haversineMeters(trail[i - 1], trail[i])
            );
        }
        turns = findTurns(trail);
    }

    function load(breadcrumbs: Breadcrumb[]): void {
        prepare([...breadcrumbs].reverse(), true);
    }

    function loadForward(breadcrumbs: Breadcrumb[]): void {
        prepare([...breadcrumbs], false);
    }

    /** Last trail index that may be reached from the current target in one step. */
    function windowEnd(): number {
        const last = trail.length - 1;
        let end = Math.min(currentIndex + MIN_WINDOW_CRUMBS, last);
        while (end < last && cumulative[end + 1] - cumulative[currentIndex] <= SKIP_WINDOW_M) {
            end++;
        }
        return end;
    }

    function proximityThresholdMeters(
        pos: Breadcrumb,
        target: Breadcrumb | null = null,
        threshold = DEFAULT_PROXIMITY_THRESHOLD_METERS
    ): number {
        const posAccuracy = Number.isFinite(pos.accuracy) ? pos.accuracy : 0;
        const targetAccuracy =
            target && Number.isFinite(target.accuracy) ? Math.min(target.accuracy, 15) : 0;
        return Math.max(
            threshold,
            Math.min(posAccuracy, MAX_ACCURACY_ASSIST_METERS),
            targetAccuracy
        );
    }

    /**
     * Arrival radius for the final crumb. The start point was itself recorded with some
     * error, so allow for both the fix's and the crumb's accuracy (root sum of squares).
     */
    function finalArrivalRadius(pos: Breadcrumb, last: Breadcrumb, threshold: number): number {
        const posAccuracy = Number.isFinite(pos.accuracy) ? pos.accuracy : 0;
        const lastAccuracy = Number.isFinite(last.accuracy) ? last.accuracy : 0;
        return Math.max(
            proximityThresholdMeters(pos, last, threshold),
            Math.min(Math.hypot(posAccuracy, lastAccuracy), MAX_ACCURACY_ASSIST_METERS)
        );
    }

    /** Whether the segment between trail[k] and trail[k + 1] was recorded across a GPS gap. */
    function isGapSegment(k: number): boolean {
        if (k < 0 || k >= trail.length - 1) return false;
        // The gap flag sits on the crumb recorded AFTER the gap: the later one in walking
        // order when following, the earlier one when retracing.
        return retraceMode ? trail[k].gap === true : trail[k + 1].gap === true;
    }

    /**
     * The user has gone past `from` on the way to `to` if they are alongside that segment
     * (anywhere in the on-route band, so wider than the arrival zone) and beyond its start.
     * Catches walkers who pass a crumb 15-30 m to the side, who would otherwise never get
     * close enough to "reach" it. Only ever looks at the next segment in sequence, so it
     * cannot jump to a later part of a path that doubles back.
     */
    function hasPassed(
        pos: Breadcrumb,
        from: Breadcrumb,
        to: Breadcrumb,
        threshold: number
    ): boolean {
        const band = Math.max(
            OFF_ROUTE_THRESHOLD_METERS,
            proximityThresholdMeters(pos, null, threshold)
        );
        if (pointToSegmentMeters(pos, from, to) > band) return false;
        return closestPointOnSegment(pos, from, to).t > 0;
    }

    /** Nearest point on the segments still to be walked (including the one just passed). */
    function nearestRemaining(pos: Breadcrumb): { segment: number; distance: number } | null {
        let best: { segment: number; distance: number } | null = null;
        for (let j = Math.max(currentIndex - 1, 0); j < trail.length - 1; j++) {
            const distance = pointToSegmentMeters(pos, trail[j], trail[j + 1]);
            if (best === null || distance < best.distance) best = { segment: j, distance };
        }
        return best;
    }

    /**
     * The moment the user comes back on route after a detour, snap progress to the part of
     * the route they have rejoined. Takes the EARLIEST remaining segment within reach rather
     * than the nearest, so where the path doubles back close to itself the user is never
     * jumped to a later leg. Only ever runs at that moment, never as a standing shortcut.
     */
    function rejoin(pos: Breadcrumb): void {
        for (let j = Math.max(currentIndex - 1, 0); j < trail.length - 1; j++) {
            if (pointToSegmentMeters(pos, trail[j], trail[j + 1]) <= OFF_ROUTE_THRESHOLD_METERS) {
                currentIndex = Math.max(currentIndex, j + 1);
                return;
            }
        }
    }

    function checkAndAdvance(
        pos: Breadcrumb,
        threshold = DEFAULT_PROXIMITY_THRESHOLD_METERS
    ): boolean {
        if (trail.length === 0 || currentIndex >= trail.length) return false;
        const before = currentIndex;

        // Reached the target, or (if it was missed) the nearest crumb ahead within the
        // window, so one noisy crumb does not strand the user.
        const end = windowEnd();
        for (let i = currentIndex; i <= end; i++) {
            const isLast = i === trail.length - 1;
            const radius = isLast
                ? finalArrivalRadius(pos, trail[i], threshold)
                : proximityThresholdMeters(pos, trail[i], threshold);
            if (haversineMeters(pos, trail[i]) <= radius) {
                currentIndex = i + 1;
                break;
            }
        }

        // Walked past the target sideways
        while (
            currentIndex < trail.length - 1 &&
            hasPassed(pos, trail[currentIndex], trail[currentIndex + 1], threshold)
        ) {
            currentIndex++;
        }

        // Retracing: the trail end is where the user started. Standing at it means they are
        // back, however the recorded path got there (the path may loop past its own start).
        // Off the path this uses the plain arrival zone; the wider allowance for the start
        // crumb's own error is only for someone who has followed the path all the way in.
        if (retraceMode && currentIndex < trail.length) {
            const last = trail[trail.length - 1];
            if (haversineMeters(pos, last) <= proximityThresholdMeters(pos, last, threshold)) {
                currentIndex = trail.length;
            }
        }

        return currentIndex > before;
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
     * Update off-route state based on distance to the part of the trail still to be walked.
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

    function remainingMeters(pos: Breadcrumb): number {
        if (trail.length === 0 || currentIndex >= trail.length) return 0;
        return (
            haversineMeters(pos, trail[currentIndex]) +
            (cumulative[trail.length - 1] - cumulative[currentIndex])
        );
    }

    function nextTurn(pos: Breadcrumb): NextTurn | null {
        if (trail.length === 0 || currentIndex >= trail.length) return null;
        const turn = turns.find(t => t.index >= currentIndex);
        if (!turn) return null;
        return {
            ...turn,
            meters:
                haversineMeters(pos, trail[currentIndex]) +
                (cumulative[turn.index] - cumulative[currentIndex]),
        };
    }

    function nearestPathPoint(pos: Breadcrumb): NearestPathPoint | null {
        const nearest = nearestRemaining(pos);
        if (!nearest) return null;
        const { point } = closestPointOnSegment(
            pos,
            trail[nearest.segment],
            trail[nearest.segment + 1]
        );
        return { point, distance: nearest.distance, index: nearest.segment + 1 };
    }

    return {
        load,
        loadForward,
        advanceIfClose(pos: Breadcrumb, threshold = DEFAULT_PROXIMITY_THRESHOLD_METERS): boolean {
            const before = currentIndex;
            checkAndAdvance(pos, threshold);
            if (trail.length >= 2 && currentIndex < trail.length) {
                const nearest = nearestRemaining(pos);
                if (nearest) {
                    if (offRoute && nearest.distance <= OFF_ROUTE_THRESHOLD_METERS) rejoin(pos);
                    updateOffRouteState(nearest.distance);
                }
            }
            return currentIndex > before;
        },
        proximityThresholdMeters,
        distanceToTrailMeters,
        remainingMeters,
        nextTurn,
        nearestPathPoint,
        get trail(): readonly Breadcrumb[] {
            return trail;
        },
        get inGap(): boolean {
            return isGapSegment(currentIndex - 1);
        },
        get turns(): readonly TurnPoint[] {
            return turns;
        },
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
