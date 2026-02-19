import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { circularMean, bearingSpread, createHeadingFusionService } from './heading';
import type { Breadcrumb } from './types';

function bc(lat: number, lng: number, timestamp = 0): Breadcrumb {
    return { lat, lng, accuracy: 5, timestamp };
}

describe('circularMean', () => {
    it('returns 0 for empty array', () => {
        expect(circularMean([])).toBe(0);
    });

    it('returns the single bearing for a one-element array', () => {
        expect(circularMean([90])).toBeCloseTo(90, 1);
    });

    it('handles 0°/360° wraparound correctly', () => {
        // [355, 0, 5] should average to ~0°
        const mean = circularMean([355, 0, 5]);
        expect(mean).toBeCloseTo(0, 0);
    });

    it('computes mean of bearings in the same quadrant', () => {
        const mean = circularMean([80, 90, 100]);
        expect(mean).toBeCloseTo(90, 0);
    });

    it('handles bearings around 180°', () => {
        const mean = circularMean([170, 180, 190]);
        expect(mean).toBeCloseTo(180, 0);
    });
});

describe('bearingSpread', () => {
    it('returns 0 for fewer than 2 bearings', () => {
        expect(bearingSpread([])).toBe(0);
        expect(bearingSpread([45])).toBe(0);
    });

    it('computes spread for simple bearings', () => {
        expect(bearingSpread([10, 30])).toBeCloseTo(20, 1);
    });

    it('handles 0°/360° wraparound', () => {
        // 350° and 10° are 20° apart, not 340°
        expect(bearingSpread([350, 10])).toBeCloseTo(20, 1);
    });

    it('detects unstable bearing set', () => {
        // Spread of 90° — unstable
        expect(bearingSpread([0, 45, 90])).toBeCloseTo(90, 1);
    });

    it('detects stable bearing set', () => {
        // All within 10°
        expect(bearingSpread([85, 90, 95])).toBeCloseTo(10, 1);
    });
});

describe('createHeadingFusionService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns confidence none when no data is available', () => {
        const service = createHeadingFusionService();
        expect(service.current.confidence).toBe('none');
        expect(service.current.source).toBe('none');
        expect(service.effectiveHeading).toBeNull();
    });

    it('uses compass as fallback when stationary (no GPS movement)', () => {
        const service = createHeadingFusionService();
        service.updateFromCompass(90);
        expect(service.current.source).toBe('compass');
        expect(service.current.confidence).toBe('medium');
        expect(service.effectiveHeading).toBeCloseTo(90, 0);
    });

    it('uses GPS bearing when walking with stable history', () => {
        const service = createHeadingFusionService();

        // Provide a stable bearing history (3+ bearings, low spread)
        service.setBearingHistory([0, 2, 1]);

        // Feed GPS fixes >3m apart
        const prev = bc(51.5, -0.1, 500);
        const curr = bc(51.5001, -0.1, 1000); // ~11m north
        service.updateFromGps(curr, prev, 1000);

        expect(service.current.source).toBe('gps');
        expect(service.current.confidence).toBe('high');
        expect(service.effectiveHeading).not.toBeNull();
    });

    it('GPS bearing goes stale after 10s of no movement', () => {
        const service = createHeadingFusionService();
        service.setBearingHistory([0, 2, 1]);

        const prev = bc(51.5, -0.1, 500);
        const curr = bc(51.5001, -0.1, 1000);
        service.updateFromGps(curr, prev, 1000);

        expect(service.current.source).toBe('gps');

        // Advance time past staleness threshold
        vi.setSystemTime(12_000);

        // Also provide compass so there's a fallback
        service.updateFromCompass(45);
        expect(service.current.source).toBe('compass');
    });

    it('GPS bearing goes stale and returns none without compass', () => {
        const service = createHeadingFusionService();
        service.setBearingHistory([0, 2, 1]);

        const prev = bc(51.5, -0.1, 500);
        const curr = bc(51.5001, -0.1, 1000);
        service.updateFromGps(curr, prev, 1000);

        vi.setSystemTime(12_000);
        expect(service.current.source).toBe('none');
        expect(service.effectiveHeading).toBeNull();
    });

    it('returns medium confidence for moderately stable GPS bearings', () => {
        const service = createHeadingFusionService();

        // Spread between 40-60° → medium stability
        service.setBearingHistory([0, 25, 50]);

        const prev = bc(51.5, -0.1, 500);
        const curr = bc(51.5001, -0.1, 1000);
        service.updateFromGps(curr, prev, 1000);

        expect(service.current.source).toBe('gps');
        expect(service.current.confidence).toBe('medium');
    });

    it('falls back to compass when GPS bearings are unstable', () => {
        const service = createHeadingFusionService();

        // Very wide spread → unstable
        service.setBearingHistory([0, 90, 180]);

        const prev = bc(51.5, -0.1, 500);
        const curr = bc(51.5001, -0.1, 1000);
        service.updateFromGps(curr, prev, 1000);

        service.updateFromCompass(270);
        expect(service.current.source).toBe('compass');
    });

    it('does not update GPS bearing when fix distance is too small', () => {
        const service = createHeadingFusionService();
        service.setBearingHistory([0, 2, 1]);

        // Two fixes < 3m apart
        const prev = bc(51.5, -0.1, 500);
        const curr = bc(51.50001, -0.1, 1000); // ~1m
        service.updateFromGps(curr, prev, 1000);

        // No GPS bearing should have been set
        expect(service.current.source).toBe('none');
    });

    it('does not update when previous fix is null', () => {
        const service = createHeadingFusionService();
        service.setBearingHistory([0, 2, 1]);
        service.updateFromGps(bc(51.5, -0.1, 1000), null, 1000);
        expect(service.current.source).toBe('none');
    });

    it('applies EMA smoothing to GPS bearings', () => {
        const service = createHeadingFusionService();

        // First update: bearing ~0° (north)
        service.setBearingHistory([0, 1, 2]);
        const prev1 = bc(51.5, -0.1, 500);
        const curr1 = bc(51.5001, -0.1, 1000);
        service.updateFromGps(curr1, prev1, 1000);

        const firstHeading = service.effectiveHeading;
        expect(firstHeading).not.toBeNull();

        // Second update: bearing shifts to ~20° (still within stable spread)
        // History [2, 5, 20] has spread of 18° — stable
        service.setBearingHistory([2, 5, 20]);
        const prev2 = bc(51.5001, -0.1, 1500);
        const curr2 = bc(51.5002, -0.0998, 2000);
        vi.setSystemTime(2000);
        service.updateFromGps(curr2, prev2, 2000);

        const secondHeading = service.effectiveHeading;
        expect(secondHeading).not.toBeNull();
        // EMA should smooth: second heading between first heading and 20
        if (firstHeading !== null && secondHeading !== null) {
            expect(secondHeading).toBeGreaterThan(firstHeading);
            expect(secondHeading).toBeLessThan(20);
        }
    });
});
