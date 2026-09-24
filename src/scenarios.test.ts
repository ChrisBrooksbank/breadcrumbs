import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { haversineMeters } from '@/geo';
import { parseGpx } from '@/gpx';
import { installBreadcrumbSimulator } from '@/simulator';
import {
    SCENARIO_ROUTES,
    FIX_INTERVAL_MS,
    WALKING_SPEED_MS,
    addJitter,
    addOutliers,
    buildScenario,
    createRng,
    dropFixes,
    insertStandStill,
    isScenarioName,
    pointAlong,
    polylineLength,
    walkWaypoints,
} from '@/scenarios';

describe('scenario generators', () => {
    it('createRng is deterministic per seed and stays in [0, 1)', () => {
        const a = createRng(1);
        const b = createRng(1);
        const values = Array.from({ length: 50 }, () => a());
        expect(values).toEqual(Array.from({ length: 50 }, () => b()));
        expect(values.every(v => v >= 0 && v < 1)).toBe(true);
        expect(createRng(2)()).not.toBe(createRng(1)());
    });

    it('polylineLength and pointAlong follow the path and clamp at the ends', () => {
        const path: Array<[number, number]> = [
            [0, 0],
            [0, 100],
            [100, 100],
        ];
        expect(polylineLength(path)).toBe(200);
        expect(pointAlong(path, 50)).toEqual([0, 50]);
        expect(pointAlong(path, 150)).toEqual([50, 100]);
        expect(pointAlong(path, -5)).toEqual([0, 0]);
        expect(pointAlong(path, 999)).toEqual([100, 100]);
    });

    it('walkWaypoints produces one fix per second at walking speed', () => {
        const fixes = walkWaypoints(SCENARIO_ROUTES.straight);
        expect(fixes[1].timestamp - fixes[0].timestamp).toBe(FIX_INTERVAL_MS);
        const step = haversineMeters(fixes[10], fixes[11]);
        expect(step).toBeGreaterThan(WALKING_SPEED_MS * 0.95);
        expect(step).toBeLessThan(WALKING_SPEED_MS * 1.05);
        const total = haversineMeters(fixes[0], fixes[fixes.length - 1]);
        expect(total).toBeGreaterThan(395);
        expect(total).toBeLessThan(405);
    });

    it('addJitter is reproducible and moves fixes by roughly accuracy * sigmaScale', () => {
        const clean = walkWaypoints(SCENARIO_ROUTES.straight, { accuracy: 10 });
        const a = addJitter(clean, createRng(9));
        const b = addJitter(clean, createRng(9));
        expect(a).toEqual(b);
        const offsets = a.map((fix, i) => haversineMeters(fix, clean[i]));
        const mean = offsets.reduce((sum, d) => sum + d, 0) / offsets.length;
        expect(mean).toBeGreaterThan(2);
        expect(mean).toBeLessThan(10);
    });

    it('correlated jitter wanders more slowly than independent jitter', () => {
        const clean = walkWaypoints(SCENARIO_ROUTES.straight, { accuracy: 10 });
        const stepChange = (correlation: number): number => {
            const noisy = addJitter(clean, createRng(4), 0.5, correlation);
            let total = 0;
            for (let i = 1; i < noisy.length; i++) {
                const dNoisy = haversineMeters(noisy[i - 1], noisy[i]);
                const dClean = haversineMeters(clean[i - 1], clean[i]);
                total += Math.abs(dNoisy - dClean);
            }
            return total / noisy.length;
        };
        expect(stepChange(0.95)).toBeLessThan(stepChange(0));
    });

    it('addOutliers only displaces the requested share of fixes, by the requested distance', () => {
        const clean = walkWaypoints(SCENARIO_ROUTES.straight);
        const spiky = addOutliers(clean, createRng(2), 0.1, 60);
        const moved = spiky.filter((fix, i) => haversineMeters(fix, clean[i]) > 1);
        expect(moved.length).toBeGreaterThan(0);
        expect(moved.length).toBeLessThan(clean.length * 0.25);
        for (const fix of moved) {
            const i = spiky.indexOf(fix);
            expect(haversineMeters(fix, clean[i])).toBeCloseTo(60, 0);
        }
    });

    it('dropFixes removes a time window after the first fix', () => {
        const clean = walkWaypoints(SCENARIO_ROUTES.straight);
        const gapped = dropFixes(clean, 100_000, 220_000);
        expect(gapped.length).toBe(clean.length - 120);
        const t0 = clean[0].timestamp;
        expect(gapped.some(f => f.timestamp - t0 >= 100_000 && f.timestamp - t0 < 220_000)).toBe(
            false
        );
    });

    it('insertStandStill adds drift fixes at the spot and keeps time continuous', () => {
        const clean = walkWaypoints(SCENARIO_ROUTES.straight);
        const stopped = insertStandStill(clean, 50, 30, createRng(1), 3);
        expect(stopped.length).toBe(clean.length + 30);
        for (let i = 1; i < stopped.length; i++) {
            expect(stopped[i].timestamp - stopped[i - 1].timestamp).toBe(FIX_INTERVAL_MS);
        }
        for (const fix of stopped.slice(51, 81)) {
            expect(haversineMeters(fix, clean[50])).toBeLessThan(20);
        }
    });

    it('isScenarioName and buildScenario cover every named route', () => {
        for (const name of Object.keys(SCENARIO_ROUTES)) {
            expect(isScenarioName(name)).toBe(true);
            expect(buildScenario(name as keyof typeof SCENARIO_ROUTES).length).toBeGreaterThan(50);
        }
        expect(isScenarioName('nope')).toBe(false);
        expect(isScenarioName('toString')).toBe(false);
    });
});

describe('parseGpx', () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1"><trk><trkseg>
  <trkpt lat="51.5" lon="-0.1"><time>2026-01-01T10:00:00Z</time><hdop>1.2</hdop></trkpt>
  <trkpt lat="51.5001" lon="-0.1"><time>2026-01-01T10:00:05Z</time></trkpt>
  <trkpt lat="bad" lon="-0.1"></trkpt>
</trkseg></trk></gpx>`;

    it('reads coordinates, timestamps and hdop-derived accuracy', () => {
        const fixes = parseGpx(gpx);
        expect(fixes).toHaveLength(2);
        expect(fixes[0].lat).toBe(51.5);
        expect(fixes[0].lng).toBe(-0.1);
        expect(fixes[0].accuracy).toBeCloseTo(6);
        expect(fixes[1].timestamp - fixes[0].timestamp).toBe(5000);
        expect(fixes[1].accuracy).toBe(10);
    });

    it('gives synthetic 1 s spacing to points without time', () => {
        const fixes = parseGpx(
            '<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="2"/></trkseg></trk></gpx>'
        );
        expect(fixes.map(f => f.timestamp)).toEqual([0, 1000]);
    });

    it('returns an empty array for malformed XML', () => {
        expect(parseGpx('<gpx><trk>')).toEqual([]);
    });
});

describe('simulator scenario and GPX replay', () => {
    const originalUrl = window.location.href;
    const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

    beforeEach(() => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/?simulate=1');
        installBreadcrumbSimulator();
    });

    afterEach(() => {
        window.__breadcrumbsSimulator?.stop();
        vi.useRealTimers();
        window.history.replaceState({}, '', originalUrl);
        if (originalGeolocation) {
            Object.defineProperty(navigator, 'geolocation', originalGeolocation);
        }
        delete window.__breadcrumbsSimulator;
    });

    it('replays a named scenario with speed and heading on moving fixes', async () => {
        const onPosition = vi.fn();
        navigator.geolocation.watchPosition(onPosition);
        window.__breadcrumbsSimulator?.startScenario('straight', 10);
        await vi.advanceTimersByTimeAsync(1000);

        const fixes = onPosition.mock.calls.map(c => c[0] as GeolocationPosition);
        expect(fixes.length).toBeGreaterThanOrEqual(8);
        expect(fixes[0].coords.speed).toBeNull();
        const moving = fixes[fixes.length - 1].coords;
        expect(moving.speed).toBeGreaterThan(1);
        expect(moving.heading).toBeCloseTo(0, 0);
    });

    it('rejects an unknown scenario name and lists the valid ones', () => {
        expect(() => window.__breadcrumbsSimulator?.startScenario('nope')).toThrow(/straight/);
    });

    it('replays the track points of a GPX document', async () => {
        const onPosition = vi.fn();
        navigator.geolocation.watchPosition(onPosition);
        window.__breadcrumbsSimulator?.playGpx(
            '<gpx><trk><trkseg><trkpt lat="51.5" lon="-0.1"/><trkpt lat="51.5001" lon="-0.1"/></trkseg></trk></gpx>',
            10
        );
        await vi.advanceTimersByTimeAsync(300);
        expect(onPosition).toHaveBeenCalledTimes(2);
    });
});
