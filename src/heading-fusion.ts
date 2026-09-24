/**
 * HeadingFusion — decides which way the user is facing.
 *
 * Like a Garmin watch: while walking, the GPS course over ground is the heading (it is
 * unaffected by magnetic interference, how the phone is held, or sensor drift). While
 * stopped or slow there is no course, so the compass is used, corrected by an offset
 * learned from the difference between compass and GPS while walking. That single offset
 * also absorbs magnetic declination, a phone carried at an angle to the body, and a
 * "relative" Android compass that is north-referenced to an arbitrary direction.
 *
 * If the offset will not settle (compass and GPS keep disagreeing by a varying amount, as
 * near metal or magnets), the compass is reported as unreliable.
 */

/** Signed angle a - b normalised to -180..+180. */
function angleDiff(a: number, b: number): number {
    let d = (a - b) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

function normalise(deg: number): number {
    return ((deg % 360) + 360) % 360;
}

/** Exponential moving average along the shortest arc. */
function smoothAngle(previous: number, next: number, alpha: number): number {
    return normalise(previous + alpha * angleDiff(next, previous));
}

type HeadingSource = 'gps' | 'compass+offset' | 'compass';

interface HeadingFusion {
    /**
     * Feed a compass heading (degrees, 0–360). Pass `absolute = false` when the compass is
     * only relative to an arbitrary direction (useless until an offset has been learned).
     */
    updateCompass(heading: number, absolute?: boolean): void;
    /** Feed a GPS movement bearing (degrees, 0–360) and speed (m/s). */
    updateGps(bearing: number, speedMs: number): void;
    /** Best heading (degrees, 0–360), or null if nothing trustworthy is known yet. */
    readonly fusedHeading: number | null;
    /** Where `fusedHeading` currently comes from, or null when it is null. */
    readonly source: HeadingSource | null;
    /** Learned correction added to the compass (degrees), or null until learned. */
    readonly offset: number | null;
    /** False when compass and GPS disagree by a varying amount (interference). */
    readonly compassReliable: boolean;
    /** Compass trust from 0 (unreliable) to 1 (consistent with GPS, or not yet tested). */
    readonly confidence: number;
    /** Reset all state. */
    reset(): void;
}

/** Below this speed the GPS bearing is noise, not a course. */
const MIN_SPEED_MS = 1.0;
/** Keep using the GPS course this long after the last fix at walking speed. */
const MOVING_HOLD_MS = 4000;
/** After this long without moving, the next GPS course starts fresh. */
const COURSE_STALE_MS = 10_000;
/** Weight of each new GPS bearing in the smoothed course. */
const COURSE_ALPHA = 0.5;
/** Recent (gps - compass) samples used to learn the offset. */
const OFFSET_WINDOW = 10;
const MIN_OFFSET_SAMPLES = 3;
/** Mean absolute deviation (degrees) of the samples above which the compass is unreliable. */
const MAX_OFFSET_SPREAD_DEG = 35;

export function createHeadingFusion(): HeadingFusion {
    const samples: number[] = [];
    let lastCompass: number | null = null;
    let compassAbsolute = true;
    let course: number | null = null;
    let lastMovingAt = -Infinity;

    let offset: number | null = null;
    let spread = 0;

    function updateCompass(heading: number, absolute = true): void {
        lastCompass = heading;
        compassAbsolute = absolute;
    }

    function recomputeOffset(): void {
        if (samples.length === 0) {
            offset = null;
            spread = 0;
            return;
        }
        let sumSin = 0;
        let sumCos = 0;
        for (const sample of samples) {
            sumSin += Math.sin((sample * Math.PI) / 180);
            sumCos += Math.cos((sample * Math.PI) / 180);
        }
        offset = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
        let total = 0;
        for (const sample of samples) total += Math.abs(angleDiff(sample, offset));
        spread = total / samples.length;
    }

    function updateGps(bearing: number, speedMs: number): void {
        if (speedMs < MIN_SPEED_MS) return;

        const now = Date.now();
        if (course === null || now - lastMovingAt > COURSE_STALE_MS) {
            course = bearing;
        } else {
            course = smoothAngle(course, bearing, COURSE_ALPHA);
        }
        lastMovingAt = now;

        if (lastCompass !== null) {
            samples.push(angleDiff(bearing, lastCompass));
            if (samples.length > OFFSET_WINDOW) samples.shift();
            recomputeOffset();
        }
    }

    const offsetKnown = (): boolean => samples.length >= MIN_OFFSET_SAMPLES;
    const offsetUsable = (): boolean => offsetKnown() && spread <= MAX_OFFSET_SPREAD_DEG;

    function resolve(): { heading: number; source: HeadingSource } | null {
        if (course !== null && Date.now() - lastMovingAt <= MOVING_HOLD_MS) {
            return { heading: course, source: 'gps' };
        }
        if (lastCompass === null) return null;
        if (offsetUsable() && offset !== null) {
            return { heading: normalise(lastCompass + offset), source: 'compass+offset' };
        }
        // A relative compass with no usable offset points in an arbitrary direction
        if (!compassAbsolute) return null;
        return { heading: lastCompass, source: 'compass' };
    }

    function reset(): void {
        samples.length = 0;
        lastCompass = null;
        compassAbsolute = true;
        course = null;
        lastMovingAt = -Infinity;
        offset = null;
        spread = 0;
    }

    return {
        updateCompass,
        updateGps,
        get fusedHeading() {
            return resolve()?.heading ?? null;
        },
        get source() {
            return resolve()?.source ?? null;
        },
        get offset() {
            return offsetUsable() ? offset : null;
        },
        get compassReliable() {
            // Not yet tested against GPS counts as reliable; a relative compass has no
            // meaning until its offset has been learned.
            if (!offsetKnown()) return compassAbsolute;
            return spread <= MAX_OFFSET_SPREAD_DEG;
        },
        get confidence() {
            if (!offsetKnown()) return 1;
            return Math.max(0, 1 - spread / MAX_OFFSET_SPREAD_DEG);
        },
        reset,
    };
}
