import { describe, expect, it } from 'vitest';
import { bearingDegrees, haversineMeters, pointToSegmentMeters } from '@/geo';
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

describe('pointToSegmentMeters', () => {
    // Segment running east-west along the equator: (0,0) to (0, 0.01) ≈ 1111m
    const segA = crumb(0, 0);
    const segB = crumb(0, 0.01);

    it('returns 0 when point is on one endpoint of the segment', () => {
        expect(pointToSegmentMeters(segA, segA, segB)).toBeCloseTo(0, 1);
    });

    it('returns 0 when point is on the other endpoint of the segment', () => {
        expect(pointToSegmentMeters(segB, segA, segB)).toBeCloseTo(0, 1);
    });

    it('returns ~0 when point is on the midpoint of the segment', () => {
        const mid = crumb(0, 0.005);
        expect(pointToSegmentMeters(mid, segA, segB)).toBeCloseTo(0, 1);
    });

    it('returns perpendicular distance when point is directly north of segment midpoint', () => {
        // Point is 10m north of the midpoint of a horizontal segment
        // 1 degree lat ≈ 111195m, so 10m ≈ 0.0000899 degrees
        const point = crumb(0.0000899, 0.005); // ~10m north of midpoint
        const dist = pointToSegmentMeters(point, segA, segB);
        expect(dist).toBeCloseTo(10, 0);
    });

    it('returns distance to nearest endpoint when point is past segment end', () => {
        // Point is east of segB; nearest point on segment is segB
        const point = crumb(0, 0.02); // east of segB
        const dist = pointToSegmentMeters(point, segA, segB);
        // Distance from (0, 0.02) to (0, 0.01) ≈ 1111m
        expect(dist).toBeCloseTo(1111, -1);
    });

    it('returns distance to nearest endpoint when point is before segment start', () => {
        // Point is west of segA; nearest point on segment is segA
        const point = crumb(0, -0.01); // west of segA
        const dist = pointToSegmentMeters(point, segA, segB);
        // Distance from (0, -0.01) to (0, 0) ≈ 1111m
        expect(dist).toBeCloseTo(1111, -1);
    });

    it('returns haversine distance between the two points when segment is degenerate (A === B)', () => {
        const point = crumb(0, 0.01);
        const same = crumb(0, 0);
        const dist = pointToSegmentMeters(point, same, same);
        // Distance from (0, 0.01) to (0, 0) ≈ 1111m
        expect(dist).toBeCloseTo(1111, -1);
    });

    it('correctly measures off-route distance of ~35m from a north-south trail', () => {
        // Segment runs north: (51.5, 0) to (51.501, 0) ≈ 111m
        const a = crumb(51.5, 0);
        const b = crumb(51.501, 0);
        // Point is east of the segment midpoint by ~35m
        // At lat 51.5°, 1 degree lng ≈ 111195 * cos(51.5°) ≈ 69460m
        // 35m east ≈ 35 / 69460 ≈ 0.000504 degrees lng
        const point = crumb(51.5005, 0.000504);
        const dist = pointToSegmentMeters(point, a, b);
        expect(dist).toBeCloseTo(35, 0);
    });
});
