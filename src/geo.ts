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

export function bearingDegrees(from: Breadcrumb, to: Breadcrumb): number {
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const dLon = toRadians(to.lng - from.lng);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    const bearing = toDegrees(Math.atan2(y, x));
    return (bearing + 360) % 360;
}
