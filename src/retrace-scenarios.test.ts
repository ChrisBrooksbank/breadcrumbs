import { describe, it, expect, vi, afterEach } from 'vitest';
import { createGeolocationService } from '@/gps';
import { createNavigationService } from '@/navigation';
import { trailDistanceMeters } from '@/geo';
import type { Breadcrumb } from '@/types';
import {
    SCENARIO_ROUTES,
    WALKING_SPEED_MS,
    FIX_INTERVAL_MS,
    addJitter,
    addOutliers,
    createRng,
    dropFixes,
    insertStandStill,
    localToBreadcrumb,
    pointAlong,
    polylineLength,
    walkWaypoints,
} from '@/scenarios';
import type { LocalPoint } from '@/scenarios';

/** Feed fixes through the real GeolocationService and return the breadcrumbs it records. */
function recordTrack(fixes: Breadcrumb[]): Breadcrumb[] {
    let onPosition: PositionCallback | null = null;
    vi.stubGlobal('navigator', {
        geolocation: {
            watchPosition: vi.fn((success: PositionCallback) => {
                onPosition = success;
                return 1;
            }),
            clearWatch: vi.fn(),
        },
    });
    const gps = createGeolocationService({ disableMotionSuspension: true });
    const recorded: Breadcrumb[] = [];
    gps.start(b => recorded.push(b));
    for (const fix of fixes) {
        onPosition!({
            coords: {
                latitude: fix.lat,
                longitude: fix.lng,
                accuracy: fix.accuracy,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
            },
            timestamp: fix.timestamp,
        } as GeolocationPosition);
    }
    gps.stop();
    vi.unstubAllGlobals();
    return recorded;
}

interface RetraceResult {
    arrived: boolean;
    /** True straight-line distance from the walker to the real start when "arrived" fired. */
    distanceToStartAtArrivalM: number;
    /** True metres the walker still had to walk along the route when "arrived" fired. */
    remainingAtArrivalM: number;
    /** Largest trail distance jumped over by a single advance. */
    maxSkipM: number;
    offRouteAlerts: number;
}

interface RetraceOptions {
    accuracy?: number;
    sigmaScale?: number;
    correlation?: number;
    seed?: number;
}

/**
 * Walk the ground-truth route backwards at walking speed, with GPS noise, and feed each fix
 * to a NavigationService loaded with the recorded trail (exactly as "Take me back" does).
 */
function simulateRetrace(
    recorded: Breadcrumb[],
    route: LocalPoint[],
    options: RetraceOptions = {}
): RetraceResult {
    const accuracy = options.accuracy ?? 8;
    const rng = createRng(options.seed ?? 42);
    const back = [...route].reverse();
    const total = polylineLength(back);
    const trail = [...recorded].reverse();

    const nav = createNavigationService();
    nav.load(recorded);
    let offRouteAlerts = 0;
    nav.onOffRouteChange = off => {
        if (off) offRouteAlerts++;
    };

    const steps = Math.ceil((total + 60) / WALKING_SPEED_MS);
    const truthFixes: Breadcrumb[] = [];
    for (let i = 0; i <= steps; i++) {
        const walked = Math.min(i * WALKING_SPEED_MS, total);
        truthFixes.push(localToBreadcrumb(pointAlong(back, walked), i * FIX_INTERVAL_MS, accuracy));
    }
    const noisyFixes = addJitter(truthFixes, rng, options.sigmaScale ?? 0.5, options.correlation);

    let maxSkipM = 0;
    for (let i = 0; i <= steps; i++) {
        const walked = Math.min(i * WALKING_SPEED_MS, total);
        const fix = noisyFixes[i];

        const before = nav.progress.currentIndex;
        nav.advanceIfClose(fix);
        const after = nav.progress.currentIndex;
        if (after - before > 1) {
            maxSkipM = Math.max(maxSkipM, trailDistanceMeters(trail.slice(before, after)));
        }
        if (nav.progress.arrived) {
            const [px, py] = pointAlong(back, walked);
            return {
                arrived: true,
                distanceToStartAtArrivalM: Math.hypot(
                    px - back[back.length - 1][0],
                    py - back[back.length - 1][1]
                ),
                remainingAtArrivalM: total - walked,
                maxSkipM,
                offRouteAlerts,
            };
        }
    }
    return {
        arrived: false,
        distanceToStartAtArrivalM: Infinity,
        remainingAtArrivalM: total,
        maxSkipM,
        offRouteAlerts,
    };
}

function walkAndRecord(route: LocalPoint[], seed = 7, accuracy = 8): Breadcrumb[] {
    const rng = createRng(seed);
    return recordTrack(addJitter(walkWaypoints(route, { accuracy }), rng, 0.5));
}

/** Largest distance (m) from any recorded crumb to the straight north-south route at x = 0. */
function worstCrossTrackMeters(recorded: Breadcrumb[]): number {
    const zero = localToBreadcrumb([0, 0], 0);
    const metersPerDegLng = 111_319.5 * Math.cos((zero.lat * Math.PI) / 180);
    return Math.max(...recorded.map(b => Math.abs((b.lng - zero.lng) * metersPerDegLng)));
}

/*
 * Real-world scenario harness. Each scenario records a noisy walk through the real
 * GeolocationService, then walks it back (noisily) through the real NavigationService.
 */
/** Retrace one scenario across many noise seeds; returns sorted distances and skips. */
function retraceManySeeds(
    name: keyof typeof SCENARIO_ROUTES,
    accuracy: number,
    seeds = 40
): { arrivedCount: number; distances: number[]; skips: number[]; falseAlarms: number } {
    const route = SCENARIO_ROUTES[name];
    const distances: number[] = [];
    const skips: number[] = [];
    let arrivedCount = 0;
    let falseAlarms = 0;
    for (let seed = 1; seed <= seeds; seed++) {
        const result = simulateRetrace(walkAndRecord(route, seed, accuracy), route, {
            accuracy,
            seed: seed + 100,
        });
        if (result.arrived) arrivedCount++;
        distances.push(result.distanceToStartAtArrivalM);
        skips.push(result.maxSkipM);
        falseAlarms += result.offRouteAlerts;
    }
    distances.sort((a, b) => a - b);
    skips.sort((a, b) => a - b);
    return { arrivedCount, distances, skips, falseAlarms };
}

const percentile = (sorted: number[], p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/*
 * With GPS error the start point recorded on the way out and the position reported on the
 * way back are BOTH off, so the achievable arrival distance is a couple of times the GPS
 * accuracy. These tests check that arrival is reliable, close to that limit, and never
 * caused by short-cutting the path.
 */
describe('retrace scenarios: arrival at the real start (40 noise seeds each)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const all = ['straight', 'lShape', 'closedLoop', 'hairpin15', 'hairpin60', 'lasso'] as const;

    it.each(all)('%s with good GPS (8 m): always arrives, within 25 m, no big jumps', name => {
        const { arrivedCount, distances, skips } = retraceManySeeds(name, 8);
        expect(arrivedCount).toBe(40);
        expect(percentile(distances, 0.9)).toBeLessThanOrEqual(25);
        expect(skips[skips.length - 1]).toBeLessThan(100);
    });

    it.each(all)('%s with weak GPS (20 m): always arrives, within ~2.5x accuracy', name => {
        const { arrivedCount, distances, skips } = retraceManySeeds(name, 20);
        expect(arrivedCount).toBe(40);
        expect(percentile(distances, 0.9)).toBeLessThanOrEqual(55);
        // A jump of hundreds of metres would mean the path was short-cut
        expect(percentile(skips, 0.9)).toBeLessThan(100);
    });

    it.each(['straight', 'lShape', 'closedLoop', 'hairpin60', 'lasso'] as const)(
        '%s with good GPS raises no false off-route alerts',
        name => {
            expect(retraceManySeeds(name, 8).falseAlarms).toBe(0);
        }
    );
});

describe('recording scenarios: trail quality', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('a good-GPS straight walk records a trail close to the true length', () => {
        const route = SCENARIO_ROUTES.straight;
        const recorded = walkAndRecord(route, 7, 8);
        expect(trailDistanceMeters(recorded) / polylineLength(route)).toBeLessThan(1.5);
    });

    // Regression: crumbs closer than the fix accuracy used to make a 20 m-accuracy walk ~3.3x too long.
    it('a weak-GPS straight walk does not inflate the trail length', () => {
        const route = SCENARIO_ROUTES.straight;
        const recorded = walkAndRecord(route, 7, 20);
        expect(trailDistanceMeters(recorded) / polylineLength(route)).toBeLessThan(1.5);
    });

    // Regression: two minutes of receiver drift used to add ~80 crumbs.
    it('standing still does not drop a cloud of crumbs', () => {
        const clean = walkWaypoints(SCENARIO_ROUTES.straight);
        const withStop = (): Breadcrumb[] => {
            const rng = createRng(3);
            return insertStandStill(addJitter(clean, rng, 0.5), 100, 120, rng, 4);
        };
        const baseline = recordTrack(addJitter(clean, createRng(3), 0.5));
        const extra = recordTrack(withStop()).length - baseline.length;
        expect(extra).toBeLessThanOrEqual(5);
    });

    // Regression: a single wild fix (60 m off, still reporting good accuracy) used to be recorded.
    it('an isolated GPS spike is not recorded as a breadcrumb', () => {
        const rng = createRng(11);
        const clean = walkWaypoints(SCENARIO_ROUTES.straight);
        const spiky = addOutliers(addJitter(clean, rng, 0.5), rng, 0.05, 60);
        expect(worstCrossTrackMeters(recordTrack(spiky))).toBeLessThanOrEqual(25);
    });

    // Regression: a two-minute GPS dropout used to leave a ~180 m jump with nothing marking it.
    it('a GPS dropout is flagged on the crumb after the gap', () => {
        const rng = createRng(5);
        const clean = walkWaypoints(SCENARIO_ROUTES.straight);
        const gapped = dropFixes(addJitter(clean, rng, 0.5), 100_000, 220_000);
        const recorded = recordTrack(gapped) as Array<Breadcrumb & { gap?: boolean }>;
        expect(recorded.some(b => b.gap === true)).toBe(true);
    });
});
