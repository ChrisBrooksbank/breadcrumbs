import type { Breadcrumb } from '@/types';

/**
 * Synthetic walking tracks and GPS-noise injectors.
 *
 * Tracks are described as waypoints in local metres (x = east, y = north) from a fixed
 * origin, walked at a steady speed with one fix per second. Noise injectors are
 * deterministic (seeded) so scenario tests are reproducible.
 */

export type LocalPoint = [x: number, y: number];

const ORIGIN = { lat: 51.5074, lng: -0.1278 };
const METERS_PER_DEGREE_LAT = 111_319.5;
const METERS_PER_DEGREE_LNG = METERS_PER_DEGREE_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const WALKING_SPEED_MS = 1.4;
export const FIX_INTERVAL_MS = 1000;
const DEFAULT_ACCURACY_METERS = 8;

/** Small deterministic PRNG (mulberry32); returns values in [0, 1). */
export function createRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Standard normal sample via Box-Muller. */
function gaussian(rng: () => number): number {
    const u = Math.max(rng(), Number.EPSILON);
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function localToBreadcrumb(
    [x, y]: LocalPoint,
    timestamp: number,
    accuracy = DEFAULT_ACCURACY_METERS
): Breadcrumb {
    return {
        lat: ORIGIN.lat + y / METERS_PER_DEGREE_LAT,
        lng: ORIGIN.lng + x / METERS_PER_DEGREE_LNG,
        accuracy,
        timestamp,
    };
}

function offsetMeters(fix: Breadcrumb, dx: number, dy: number): Breadcrumb {
    return {
        ...fix,
        lat: fix.lat + dy / METERS_PER_DEGREE_LAT,
        lng: fix.lng + dx / METERS_PER_DEGREE_LNG,
    };
}

export function polylineLength(points: LocalPoint[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    return total;
}

/** Position `distance` metres along a polyline (clamped to its ends). */
export function pointAlong(points: LocalPoint[], distance: number): LocalPoint {
    let remaining = Math.max(0, distance);
    for (let i = 1; i < points.length; i++) {
        const segLen = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        if (remaining <= segLen && segLen > 0) {
            const t = remaining / segLen;
            return [
                points[i - 1][0] + t * (points[i][0] - points[i - 1][0]),
                points[i - 1][1] + t * (points[i][1] - points[i - 1][1]),
            ];
        }
        remaining -= segLen;
    }
    return points[points.length - 1];
}

interface WalkOptions {
    speedMs?: number;
    startTime?: number;
    accuracy?: number;
}

/** Perfect (noise-free) fixes for walking the waypoints at a steady speed, one per second. */
export function walkWaypoints(waypoints: LocalPoint[], options: WalkOptions = {}): Breadcrumb[] {
    const speed = options.speedMs ?? WALKING_SPEED_MS;
    const startTime = options.startTime ?? 1_700_000_000_000;
    const accuracy = options.accuracy ?? DEFAULT_ACCURACY_METERS;
    const total = polylineLength(waypoints);
    const fixes: Breadcrumb[] = [];
    const steps = Math.ceil(total / speed);
    for (let i = 0; i <= steps; i++) {
        const distance = Math.min(i * speed, total);
        fixes.push(
            localToBreadcrumb(
                pointAlong(waypoints, distance),
                startTime + i * FIX_INTERVAL_MS,
                accuracy
            )
        );
    }
    return fixes;
}

/** How strongly each fix's error follows the previous one (real GPS error wanders slowly). */
const DEFAULT_ERROR_CORRELATION = 0.9;

/**
 * Gaussian position error, sigma = accuracy * sigmaScale per axis. Errors are an AR(1)
 * series: `correlation` 0 gives independent per-fix noise (worst case), values near 1 give
 * slow drift like a real receiver.
 */
export function addJitter(
    fixes: Breadcrumb[],
    rng: () => number,
    sigmaScale = 0.5,
    correlation = DEFAULT_ERROR_CORRELATION
): Breadcrumb[] {
    const innovation = Math.sqrt(1 - correlation * correlation);
    let errX = 0;
    let errY = 0;
    let first = true;
    return fixes.map(fix => {
        const sigma = fix.accuracy * sigmaScale;
        if (first) {
            errX = gaussian(rng) * sigma;
            errY = gaussian(rng) * sigma;
            first = false;
        } else {
            errX = correlation * errX + innovation * gaussian(rng) * sigma;
            errY = correlation * errY + innovation * gaussian(rng) * sigma;
        }
        return offsetMeters(fix, errX, errY);
    });
}

/** With the given probability per fix, throw the fix `distanceMeters` off in a random direction. */
export function addOutliers(
    fixes: Breadcrumb[],
    rng: () => number,
    probability: number,
    distanceMeters: number
): Breadcrumb[] {
    return fixes.map(fix => {
        if (rng() >= probability) return fix;
        const angle = rng() * 2 * Math.PI;
        return offsetMeters(
            fix,
            Math.cos(angle) * distanceMeters,
            Math.sin(angle) * distanceMeters
        );
    });
}

/** Remove fixes whose timestamp falls in [fromMs, toMs) after the first fix (a dropout/gap). */
export function dropFixes(fixes: Breadcrumb[], fromMs: number, toMs: number): Breadcrumb[] {
    if (fixes.length === 0) return fixes;
    const t0 = fixes[0].timestamp;
    return fixes.filter(fix => {
        const elapsed = fix.timestamp - t0;
        return elapsed < fromMs || elapsed >= toMs;
    });
}

/**
 * Insert a period of standing still after fix `index`: `seconds` extra fixes at the same
 * spot with wandering GPS drift, then shift later timestamps so time stays continuous.
 */
export function insertStandStill(
    fixes: Breadcrumb[],
    index: number,
    seconds: number,
    rng: () => number,
    driftSigmaMeters = 4
): Breadcrumb[] {
    const anchor = fixes[index];
    const still: Breadcrumb[] = [];
    for (let s = 1; s <= seconds; s++) {
        still.push(
            offsetMeters(
                { ...anchor, timestamp: anchor.timestamp + s * FIX_INTERVAL_MS },
                gaussian(rng) * driftSigmaMeters,
                gaussian(rng) * driftSigmaMeters
            )
        );
    }
    const shift = seconds * FIX_INTERVAL_MS;
    return [
        ...fixes.slice(0, index + 1),
        ...still,
        ...fixes.slice(index + 1).map(f => ({ ...f, timestamp: f.timestamp + shift })),
    ];
}

/**
 * Named ground-truth routes (the path the person really walks). Retrace scenarios walk these
 * forwards, record them, then walk them backwards.
 */
export const SCENARIO_ROUTES = {
    /** A simple out-and-return-free straight line. */
    straight: [
        [0, 0],
        [0, 400],
    ],
    /** An L-shaped walk with a right angle. */
    lShape: [
        [0, 0],
        [0, 250],
        [200, 250],
    ],
    /** Around a block, ending 8 m from where it began. */
    closedLoop: [
        [0, 0],
        [0, 200],
        [200, 200],
        [200, 0],
        [8, -2],
    ],
    /** Out along one side of a street and back on the other (legs 15 m apart), then away. */
    hairpin15: [
        [0, 0],
        [0, 300],
        [15, 300],
        [15, -10],
        [220, -10],
    ],
    /** Same as hairpin15 but with legs 60 m apart (well clear of any proximity radius). */
    hairpin60: [
        [0, 0],
        [0, 300],
        [60, 300],
        [60, -10],
        [260, -10],
    ],
    /** Walk a loop that crosses the earlier path, then head away (a lasso). */
    lasso: [
        [0, 0],
        [0, 150],
        [0, 300],
        [100, 300],
        [100, 150],
        [0, 150],
        [-200, 150],
    ],
} satisfies Record<string, LocalPoint[]>;

type ScenarioName = keyof typeof SCENARIO_ROUTES;

export function isScenarioName(name: string): name is ScenarioName {
    return Object.prototype.hasOwnProperty.call(SCENARIO_ROUTES, name);
}

/** Clean fixes for a named scenario. */
export function buildScenario(name: ScenarioName, options?: WalkOptions): Breadcrumb[] {
    return walkWaypoints(SCENARIO_ROUTES[name], options);
}
