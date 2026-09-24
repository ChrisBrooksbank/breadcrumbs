import type { Breadcrumb } from '@/types';

const DEFAULT_GPX_ACCURACY_METERS = 10;
/** GPX carries no accuracy; when <hdop> is present, approximate metres as hdop * 5. */
const HDOP_TO_METERS = 5;

/**
 * Parse the track points of a GPX document into breadcrumbs.
 * Points without a <time> get synthetic 1 s spacing so replays stay ordered.
 * Returns an empty array for malformed XML.
 */
export function parseGpx(xml: string): Breadcrumb[] {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return [];

    const fixes: Breadcrumb[] = [];
    const points = doc.querySelectorAll('trkpt');
    points.forEach((point, index) => {
        const lat = Number(point.getAttribute('lat'));
        const lng = Number(point.getAttribute('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const timeText = point.querySelector('time')?.textContent ?? '';
        const parsedTime = Date.parse(timeText);
        const hdop = Number(point.querySelector('hdop')?.textContent);
        fixes.push({
            lat,
            lng,
            accuracy:
                Number.isFinite(hdop) && hdop > 0
                    ? hdop * HDOP_TO_METERS
                    : DEFAULT_GPX_ACCURACY_METERS,
            timestamp: Number.isFinite(parsedTime) ? parsedTime : index * 1000,
        });
    });
    return fixes;
}
