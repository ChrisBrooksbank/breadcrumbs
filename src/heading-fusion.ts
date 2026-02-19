/**
 * HeadingFusion — blends compass heading with GPS movement bearing
 * to compensate for compass errors near metal/electromagnetic interference.
 *
 * Maintains a rolling window of (compass, gpsBearing) sample pairs collected
 * when the user is moving (speed > 1 m/s). Computes compass confidence from
 * how well compass and GPS bearings agree. When confidence drops (persistent
 * disagreement > 60°), blends heading toward the GPS movement bearing.
 * When slow/stationary, uses compass-only.
 */

/** Normalise an angle difference to -180..+180 */
function angleDiff(a: number, b: number): number {
    let d = a - b;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

interface Sample {
    compass: number;
    gps: number;
}

interface HeadingFusion {
    /** Feed a new compass heading (degrees, 0–360). */
    updateCompass(heading: number): void;
    /** Feed a new GPS movement bearing (degrees, 0–360) and speed (m/s). */
    updateGps(bearing: number, speedMs: number): void;
    /** The fused heading (degrees, 0–360), or null if no compass data. */
    readonly fusedHeading: number | null;
    /** Current compass confidence (0–1). 1 = full trust in compass. */
    readonly confidence: number;
    /** Reset all state. */
    reset(): void;
}

const WINDOW_SIZE = 5;
const DISAGREEMENT_THRESHOLD_DEG = 60;
const MIN_SPEED_MS = 1.0;

export function createHeadingFusion(): HeadingFusion {
    const samples: Sample[] = [];
    let lastCompass: number | null = null;
    let lastGpsBearing: number | null = null;
    let currentConfidence = 1.0;

    function updateCompass(heading: number): void {
        lastCompass = heading;
    }

    function updateGps(bearing: number, speedMs: number): void {
        lastGpsBearing = bearing;
        // Only collect samples when moving meaningfully
        if (speedMs >= MIN_SPEED_MS && lastCompass !== null) {
            samples.push({ compass: lastCompass, gps: bearing });
            if (samples.length > WINDOW_SIZE) samples.shift();
            recomputeConfidence();
        }
    }

    function recomputeConfidence(): void {
        if (samples.length === 0) {
            currentConfidence = 1.0;
            return;
        }

        // Average absolute disagreement across the window
        let totalDisagreement = 0;
        for (const s of samples) {
            totalDisagreement += Math.abs(angleDiff(s.compass, s.gps));
        }
        const avgDisagreement = totalDisagreement / samples.length;

        // Map disagreement to confidence: 0° → 1.0, ≥60° → 0.0
        currentConfidence = Math.max(0, 1 - avgDisagreement / DISAGREEMENT_THRESHOLD_DEG);
    }

    function getFusedHeading(): number | null {
        if (lastCompass === null) return null;
        if (lastGpsBearing === null || currentConfidence >= 1.0) return lastCompass;

        // Blend: high confidence → compass, low confidence → GPS bearing
        const diff = angleDiff(lastGpsBearing, lastCompass);
        const blendAmount = 1 - currentConfidence; // 0 = all compass, 1 = all GPS
        const fused = lastCompass + diff * blendAmount;
        return ((fused % 360) + 360) % 360;
    }

    function reset(): void {
        samples.length = 0;
        lastCompass = null;
        lastGpsBearing = null;
        currentConfidence = 1.0;
    }

    return {
        updateCompass,
        updateGps,
        get fusedHeading() {
            return getFusedHeading();
        },
        get confidence() {
            return currentConfidence;
        },
        reset,
    };
}
