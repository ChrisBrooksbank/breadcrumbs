import { describe, expect, it } from 'vitest';
import { bearingDegrees, haversineMeters } from '@/geo';
import type { Breadcrumb } from '@/types';

function crumb(lat: number, lng: number): Breadcrumb {
    return { lat, lng, accuracy: 5, timestamp: 0 };
}

describe('haversineMeters', () => {
    it('returns 0 for identical points', () => {
        const a = crumb(51.5074, -0.1278);
        expect(haversineMeters(a, a)).toBe(0);
    });

    it('calculates ~111km per degree of latitude', () => {
        const a = crumb(0, 0);
        const b = crumb(1, 0);
        const dist = haversineMeters(a, b);
        // 1 degree latitude ≈ 111,195m
        expect(dist).toBeCloseTo(111_195, -2);
    });

    it('calculates ~111km per degree of longitude at equator', () => {
        const a = crumb(0, 0);
        const b = crumb(0, 1);
        const dist = haversineMeters(a, b);
        expect(dist).toBeCloseTo(111_195, -2);
    });

    it('is symmetric', () => {
        const a = crumb(51.5074, -0.1278); // London
        const b = crumb(48.8566, 2.3522); // Paris
        expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 5);
    });

    it('calculates London to Paris (~340km)', () => {
        const london = crumb(51.5074, -0.1278);
        const paris = crumb(48.8566, 2.3522);
        const dist = haversineMeters(london, paris);
        // Approximately 340km
        expect(dist).toBeGreaterThan(330_000);
        expect(dist).toBeLessThan(350_000);
    });

    it('calculates short distances accurately (~10m)', () => {
        // ~10m north along Greenwich meridian
        const a = crumb(51.5, 0);
        const b = crumb(51.5000899, 0); // ~10m north
        const dist = haversineMeters(a, b);
        expect(dist).toBeCloseTo(10, 0);
    });
});

describe('bearingDegrees', () => {
    it('returns 0 (north) when moving due north', () => {
        const from = crumb(0, 0);
        const to = crumb(1, 0);
        expect(bearingDegrees(from, to)).toBeCloseTo(0, 0);
    });

    it('returns 180 (south) when moving due south', () => {
        const from = crumb(1, 0);
        const to = crumb(0, 0);
        expect(bearingDegrees(from, to)).toBeCloseTo(180, 0);
    });

    it('returns 90 (east) when moving due east at equator', () => {
        const from = crumb(0, 0);
        const to = crumb(0, 1);
        expect(bearingDegrees(from, to)).toBeCloseTo(90, 0);
    });

    it('returns 270 (west) when moving due west at equator', () => {
        const from = crumb(0, 1);
        const to = crumb(0, 0);
        expect(bearingDegrees(from, to)).toBeCloseTo(270, 0);
    });

    it('returns value in range [0, 360)', () => {
        const from = crumb(51.5074, -0.1278); // London
        const to = crumb(48.8566, 2.3522); // Paris
        const bearing = bearingDegrees(from, to);
        expect(bearing).toBeGreaterThanOrEqual(0);
        expect(bearing).toBeLessThan(360);
    });

    it('London to Paris is roughly southeast (~148°)', () => {
        const london = crumb(51.5074, -0.1278);
        const paris = crumb(48.8566, 2.3522);
        const bearing = bearingDegrees(london, paris);
        expect(bearing).toBeGreaterThan(140);
        expect(bearing).toBeLessThan(160);
    });
});
