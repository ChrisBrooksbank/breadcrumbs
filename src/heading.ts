import type { Breadcrumb } from '@/types';
import { haversineMeters } from '@/geo';
import { smoothHeading } from '@/navigation';

/** Minimum distance (metres) between GPS fixes to trust the bearing. */
const MIN_MOVEMENT_DISTANCE_M = 3;

/** GPS bearing expires after this many ms of no movement. */
const GPS_BEARING_STALENESS_MS = 10_000;

/** Need this many consistent bearings before trusting GPS heading. */
const MIN_BEARING_HISTORY = 3;

/** Bearing history must be within this spread (degrees) to be "stable". */
const MAX_BEARING_SPREAD_DEG = 40;

/** EMA weight for GPS bearing smoothing (faster convergence than compass). */
const GPS_EMA_ALPHA = 0.4;

type HeadingConfidence = 'high' | 'medium' | 'low' | 'none';

interface HeadingSource {
    heading: number | null;
    confidence: HeadingConfidence;
    source: 'gps' | 'compass' | 'none';
    stale: boolean;
}

/** Compute the circular mean of an array of bearings (degrees). */
export function circularMean(bearings: readonly number[]): number {
    if (bearings.length === 0) return 0;
    let sinSum = 0;
    let cosSum = 0;
    for (const b of bearings) {
        const rad = (b * Math.PI) / 180;
        sinSum += Math.sin(rad);
        cosSum += Math.cos(rad);
    }
    const meanRad = Math.atan2(sinSum / bearings.length, cosSum / bearings.length);
    return ((meanRad * 180) / Math.PI + 360) % 360;
}

/** Compute the maximum circular spread (degrees) in a bearing set. */
export function bearingSpread(bearings: readonly number[]): number {
    if (bearings.length < 2) return 0;
    let maxSpread = 0;
    for (let i = 0; i < bearings.length; i++) {
        for (let j = i + 1; j < bearings.length; j++) {
            const diff = Math.abs(bearings[i] - bearings[j]) % 360;
            const d = diff > 180 ? 360 - diff : diff;
            if (d > maxSpread) maxSpread = d;
        }
    }
    return maxSpread;
}

interface HeadingFusionService {
    /** Feed a new GPS fix to the fusion service. */
    updateFromGps(current: Breadcrumb, previous: Breadcrumb | null, timestamp: number): void;
    /** Update the bearing history reference from the GPS service. */
    setBearingHistory(history: readonly number[]): void;
    /** Feed compass heading to the fusion service. */
    updateFromCompass(heading: number): void;
    /** Get the current fused heading source. */
    readonly current: HeadingSource;
    /** Convenience: the effective heading (null when confidence is 'none'). */
    readonly effectiveHeading: number | null;
}

export function createHeadingFusionService(): HeadingFusionService {
    let smoothedGpsBearing: number | null = null;
    let lastMovementTimestamp: number | null = null;
    let compassHeading: number | null = null;
    let bearingHistory: readonly number[] = [];

    function updateFromGps(
        current: Breadcrumb,
        previous: Breadcrumb | null,
        timestamp: number
    ): void {
        if (!previous) return;
        const distance = haversineMeters(previous, current);
        if (distance >= MIN_MOVEMENT_DISTANCE_M) {
            // GPS service already computed the bearing and added it to history;
            // we just need to smooth the latest bearing from the history.
            const latestBearing =
                bearingHistory.length > 0 ? bearingHistory[bearingHistory.length - 1] : null;
            if (latestBearing !== null) {
                smoothedGpsBearing = smoothHeading(
                    latestBearing,
                    smoothedGpsBearing,
                    GPS_EMA_ALPHA
                );
                lastMovementTimestamp = timestamp;
            }
        }
    }

    function setBearingHistory(history: readonly number[]): void {
        bearingHistory = history;
    }

    function updateFromCompass(heading: number): void {
        compassHeading = heading;
    }

    function isGpsStale(now: number): boolean {
        if (lastMovementTimestamp === null) return true;
        return now - lastMovementTimestamp > GPS_BEARING_STALENESS_MS;
    }

    function getGpsStability(): 'high' | 'medium' | 'unstable' {
        if (bearingHistory.length < MIN_BEARING_HISTORY) return 'unstable';
        const recent = bearingHistory.slice(-MIN_BEARING_HISTORY);
        const spread = bearingSpread(recent);
        if (spread <= MAX_BEARING_SPREAD_DEG) return 'high';
        if (spread <= MAX_BEARING_SPREAD_DEG * 1.5) return 'medium';
        return 'unstable';
    }

    function getCurrent(): HeadingSource {
        const now = Date.now();
        const gpsFresh = !isGpsStale(now);
        const stability = getGpsStability();

        // GPS bearing is available and fresh
        if (gpsFresh && smoothedGpsBearing !== null && stability !== 'unstable') {
            return {
                heading: smoothedGpsBearing,
                confidence: stability === 'high' ? 'high' : 'medium',
                source: 'gps',
                stale: false,
            };
        }

        // Compass fallback
        if (compassHeading !== null) {
            return {
                heading: compassHeading,
                confidence: 'medium',
                source: 'compass',
                stale: gpsFresh ? false : smoothedGpsBearing !== null,
            };
        }

        // Nothing reliable
        return {
            heading: null,
            confidence: 'none',
            source: 'none',
            stale: true,
        };
    }

    return {
        updateFromGps,
        setBearingHistory,
        updateFromCompass,
        get current(): HeadingSource {
            return getCurrent();
        },
        get effectiveHeading(): number | null {
            const source = getCurrent();
            return source.confidence === 'none' ? null : source.heading;
        },
    };
}
