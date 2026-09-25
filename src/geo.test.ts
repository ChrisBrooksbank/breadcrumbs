import { describe, expect, it } from 'vitest';
import {
    bearingDegrees,
    closestPointOnSegment,
    foldBackTrack,
    haversineMeters,
    lookAheadPoint,
    pointToSegmentMeters,
    simplifyPolyline,
    trailDistanceMeters,
} from '@/geo';
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

describe('trailDistanceMeters', () => {
    it('returns 0 for an empty trail or a single point', () => {
        expect(trailDistanceMeters([])).toBe(0);
        expect(trailDistanceMeters([crumb(51.5, 0)])).toBe(0);
    });

    it('sums consecutive breadcrumb distances', () => {
        const total = trailDistanceMeters([
            crumb(51.5, 0),
            crumb(51.5000899, 0),
            crumb(51.5001798, 0),
        ]);
        expect(total).toBeCloseTo(20, 0);
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

describe('lookAheadPoint', () => {
    // Trail going due north: each point ~111m apart (0.001° lat ≈ 111m)
    const trail = [
        crumb(0, 0),
        crumb(0.001, 0), // ~111m north
        crumb(0.002, 0), // ~222m north
        crumb(0.003, 0), // ~333m north
    ];

    it('throws when trail is empty', () => {
        expect(() => lookAheadPoint([], 0, 30)).toThrow();
    });

    it('returns last point when startIndex is at end of trail', () => {
        const result = lookAheadPoint(trail, 3, 30);
        expect(result).toEqual(trail[3]);
    });

    it('returns last point when trail is shorter than requested distance', () => {
        const result = lookAheadPoint(trail, 0, 99999);
        expect(result).toEqual(trail[3]);
    });

    it('interpolates within first segment for short look-ahead', () => {
        // First segment is ~111m. Look ahead 50m from index 0.
        const result = lookAheadPoint(trail, 0, 50);
        // t ≈ 50/111 ≈ 0.45
        expect(result.lat).toBeGreaterThan(0);
        expect(result.lat).toBeLessThan(0.001);
        expect(result.lng).toBeCloseTo(0, 5);
    });

    it('spans multiple segments for longer look-ahead', () => {
        // Look ahead 150m from index 0: should be ~39m into second segment
        // First segment ~111m, so remaining ~39m into second segment
        const result = lookAheadPoint(trail, 0, 150);
        expect(result.lat).toBeGreaterThan(0.001);
        expect(result.lat).toBeLessThan(0.002);
    });

    it('returns last point when startIndex is at trail.length - 1', () => {
        const result = lookAheadPoint(trail, 3, 30);
        expect(result).toEqual(trail[3]);
    });

    it('works with default distance parameter (30m)', () => {
        const result = lookAheadPoint(trail, 0);
        // Should interpolate ~30m into the first ~111m segment
        expect(result.lat).toBeGreaterThan(0);
        expect(result.lat).toBeLessThan(0.001);
    });
});

// Local helper: metres east/north of a fixed origin
const M_PER_DEG = 111_195;
function local(x: number, y: number): Breadcrumb {
    const lat0 = 51.5;
    return crumb(lat0 + y / M_PER_DEG, x / (M_PER_DEG * Math.cos((lat0 * Math.PI) / 180)));
}

describe('closestPointOnSegment', () => {
    it('projects onto the middle of a segment', () => {
        const result = closestPointOnSegment(local(10, 50), local(0, 0), local(0, 100));
        expect(result.t).toBeCloseTo(0.5, 2);
        expect(haversineMeters(result.point, local(0, 50))).toBeLessThan(0.5);
    });

    it('clamps to the start and end of the segment', () => {
        expect(closestPointOnSegment(local(5, -30), local(0, 0), local(0, 100)).t).toBe(0);
        expect(closestPointOnSegment(local(5, 200), local(0, 0), local(0, 100)).t).toBe(1);
    });

    it('handles a zero-length segment', () => {
        const result = closestPointOnSegment(local(5, 5), local(0, 0), local(0, 0));
        expect(result.t).toBe(0);
        expect(haversineMeters(result.point, local(0, 0))).toBeLessThan(0.01);
    });
});

describe('simplifyPolyline', () => {
    it('returns every index for one or two points', () => {
        expect(simplifyPolyline([], 5)).toEqual([]);
        expect(simplifyPolyline([local(0, 0)], 5)).toEqual([0]);
        expect(simplifyPolyline([local(0, 0), local(0, 10)], 5)).toEqual([0, 1]);
    });

    it('drops collinear points', () => {
        const line = [0, 10, 20, 30, 40].map(y => local(0, y));
        expect(simplifyPolyline(line, 2)).toEqual([0, 4]);
    });

    it('keeps the corner of an L-shaped path', () => {
        const path = [local(0, 0), local(0, 20), local(0, 40), local(20, 40), local(40, 40)];
        expect(simplifyPolyline(path, 3)).toEqual([0, 2, 4]);
    });

    it('drops wobble smaller than the tolerance but keeps larger deviations', () => {
        const wobbly = [local(0, 0), local(2, 10), local(-2, 20), local(1, 30), local(0, 40)];
        expect(simplifyPolyline(wobbly, 5)).toEqual([0, 4]);
        const detour = [local(0, 0), local(15, 20), local(0, 40)];
        expect(simplifyPolyline(detour, 5)).toEqual([0, 1, 2]);
    });

    it('keeps every dropped point within the tolerance of the result', () => {
        const path = Array.from({ length: 200 }, (_, i) => local(Math.sin(i / 8) * 25, i * 3));
        const kept = simplifyPolyline(path, 4);
        for (let k = 0; k < kept.length - 1; k++) {
            for (let i = kept[k] + 1; i < kept[k + 1]; i++) {
                expect(
                    pointToSegmentMeters(path[i], path[kept[k]], path[kept[k + 1]])
                ).toBeLessThan(4.01);
            }
        }
    });

    it('copes with a very long trail without overflowing the stack', () => {
        const path = Array.from({ length: 20_000 }, (_, i) => local(i % 2 === 0 ? 0 : 50, i));
        expect(simplifyPolyline(path, 1).length).toBeGreaterThan(2);
    });
});

describe('foldBackTrack', () => {
    const out = Array.from({ length: 11 }, (_, i) => local(0, i * 50)); // 500 m north

    it('leaves a plain outward walk alone', () => {
        expect(foldBackTrack(out)).toEqual(out);
    });

    it('drops the leg already walked back, keeping the way out from where they are', () => {
        const trail = [...out, local(3, 450), local(3, 400), local(3, 350)];
        const folded = foldBackTrack(trail);
        expect(folded.length).toBeLessThan(trail.length);
        expect(haversineMeters(folded[folded.length - 1], local(0, 350))).toBeLessThan(60);
    });

    it('ignores a little jitter at the end', () => {
        const trail = [...out, local(2, 495), local(1, 500)];
        expect(foldBackTrack(trail)).toEqual(trail);
    });
});
