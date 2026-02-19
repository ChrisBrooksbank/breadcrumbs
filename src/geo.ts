import type { Breadcrumb } from '@/types';

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
}

export function haversineMeters(a: Breadcrumb, b: Breadcrumb): number {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);

    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

    return EARTH_RADIUS_METERS * c;
}

/**
 * Calculate the perpendicular distance in meters from a point to a line segment.
 * Uses equirectangular projection (sufficient for walking-scale distances).
 *
 * @param point - The point to measure from
 * @param segA - First endpoint of the segment
 * @param segB - Second endpoint of the segment
 * @returns Distance in meters from point to the nearest position on the segment
 */
export function pointToSegmentMeters(
    point: Breadcrumb,
    segA: Breadcrumb,
    segB: Breadcrumb
): number {
    // Use a local equirectangular projection centered on segA
    // Scale lng by cos(lat) so x/y units are approximately equal in meters
    const cosLat = Math.cos(toRadians(segA.lat));

    const px = (point.lng - segA.lng) * cosLat * EARTH_RADIUS_METERS * (Math.PI / 180);
    const py = (point.lat - segA.lat) * EARTH_RADIUS_METERS * (Math.PI / 180);
    const dx = (segB.lng - segA.lng) * cosLat * EARTH_RADIUS_METERS * (Math.PI / 180);
    const dy = (segB.lat - segA.lat) * EARTH_RADIUS_METERS * (Math.PI / 180);

    const segLenSq = dx * dx + dy * dy;

    if (segLenSq === 0) {
        // Degenerate segment — segA === segB; return distance to the point
        return Math.sqrt(px * px + py * py);
    }

    // Project point onto the segment; clamp t to [0, 1] so we measure to the nearest endpoint
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / segLenSq));

    const closestX = px - t * dx;
    const closestY = py - t * dy;

    return Math.sqrt(closestX * closestX + closestY * closestY);
}

/**
 * Sum of haversine distances along the trail from currentPos through
 * remaining breadcrumbs starting at trailIndex.
 * Returns the approximate walking distance left to the end of the trail.
 */
export function remainingTrailDistance(
    currentPos: Breadcrumb,
    trail: Breadcrumb[],
    trailIndex: number
): number {
    if (trailIndex >= trail.length) return 0;

    // Distance from current position to the current target
    let total = haversineMeters(currentPos, trail[trailIndex]);

    // Plus distances between successive remaining breadcrumbs
    for (let i = trailIndex; i < trail.length - 1; i++) {
        total += haversineMeters(trail[i], trail[i + 1]);
    }

    return total;
}

/**
 * Find a look-ahead point along the trail polyline, a given distance ahead
 * from startIndex. Interpolates between breadcrumbs when the distance falls
 * mid-segment. Returns the last breadcrumb if the trail is shorter than
 * the requested distance.
 *
 * @param trail - The ordered trail breadcrumbs
 * @param startIndex - Index to start looking ahead from
 * @param distanceMeters - How far ahead to look (default 30m)
 * @returns The interpolated look-ahead point
 */
export function lookAheadPoint(
    trail: Breadcrumb[],
    startIndex: number,
    distanceMeters = 30
): Breadcrumb {
    if (trail.length === 0) {
        throw new Error('Trail must not be empty');
    }
    if (startIndex >= trail.length - 1) {
        return trail[trail.length - 1];
    }

    let remaining = distanceMeters;
    for (let i = startIndex; i < trail.length - 1; i++) {
        const segLen = haversineMeters(trail[i], trail[i + 1]);
        if (segLen >= remaining) {
            // Interpolate within this segment
            const t = remaining / segLen;
            return {
                lat: trail[i].lat + t * (trail[i + 1].lat - trail[i].lat),
                lng: trail[i].lng + t * (trail[i + 1].lng - trail[i].lng),
                accuracy: trail[i + 1].accuracy,
                timestamp: trail[i + 1].timestamp,
            };
        }
        remaining -= segLen;
    }

    // Trail shorter than requested distance — return last point
    return trail[trail.length - 1];
}

export function bearingDegrees(from: Breadcrumb, to: Breadcrumb): number {
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const dLon = toRadians(to.lng - from.lng);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    const bearing = toDegrees(Math.atan2(y, x));
    return (bearing + 360) % 360;
}
