import type { Breadcrumb } from '@/types';
import { bearingDegrees, haversineMeters } from '@/geo';
import { buildScenario, isScenarioName, SCENARIO_ROUTES } from '@/scenarios';
import { parseGpx } from '@/gpx';

type WatchEntry = {
    id: number;
    success: PositionCallback;
    error?: PositionErrorCallback | null;
};

type SimulatorController = {
    startWalk(): void;
    startReturn(): void;
    sendWeakFix(): void;
    /** Replay a named ground-truth scenario (see SCENARIO_ROUTES). `speedup` > 1 plays faster. */
    startScenario(name: string, speedup?: number): void;
    /** Replay the track points of a GPX document. */
    playGpx(xml: string, speedup?: number): void;
    stop(): void;
};

/** Below this speed (m/s) a computed heading is meaningless, so report null like real GPS. */
const MIN_HEADING_SPEED_MS = 0.5;

interface FixMotion {
    speed: number | null;
    heading: number | null;
}

declare global {
    interface Window {
        __breadcrumbsSimulator?: SimulatorController;
    }
}

const BASE_ROUTE: Breadcrumb[] = [
    { lat: 51.5074, lng: -0.1278, accuracy: 6, timestamp: 0 },
    { lat: 51.50772, lng: -0.12772, accuracy: 7, timestamp: 0 },
    { lat: 51.50804, lng: -0.1276, accuracy: 8, timestamp: 0 },
    { lat: 51.50822, lng: -0.12722, accuracy: 7, timestamp: 0 },
    { lat: 51.50846, lng: -0.12684, accuracy: 6, timestamp: 0 },
    { lat: 51.50882, lng: -0.12672, accuracy: 8, timestamp: 0 },
];

export function isSimulatorEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('simulate') === '1';
}

export function installBreadcrumbSimulator(): void {
    if (!isSimulatorEnabled() || typeof window === 'undefined') return;

    const watches: WatchEntry[] = [];
    let nextWatchId = 1;
    let timers: ReturnType<typeof setTimeout>[] = [];

    function emit(fix: Breadcrumb, motion?: FixMotion): void {
        const position = {
            coords: {
                latitude: fix.lat,
                longitude: fix.lng,
                accuracy: fix.accuracy,
                altitude: null,
                altitudeAccuracy: null,
                heading: motion?.heading ?? null,
                speed: motion?.speed ?? null,
            },
            timestamp: fix.timestamp || Date.now(),
        } as GeolocationPosition;

        for (const watch of watches) {
            watch.success(position);
        }
    }

    /** Speed/heading between consecutive route fixes, from the route's own timestamps. */
    function motionBetween(previous: Breadcrumb | undefined, fix: Breadcrumb): FixMotion {
        if (!previous) return { speed: null, heading: null };
        const dtSeconds = (fix.timestamp - previous.timestamp) / 1000;
        if (dtSeconds <= 0) return { speed: null, heading: null };
        const speed = haversineMeters(previous, fix) / dtSeconds;
        return {
            speed,
            heading: speed >= MIN_HEADING_SPEED_MS ? bearingDegrees(previous, fix) : null,
        };
    }

    function playRoute(route: Breadcrumb[], intervalMs = 700): void {
        stop();
        route.forEach((fix, index) => {
            const motion = motionBetween(route[index - 1], fix);
            timers.push(
                setTimeout(() => {
                    emit({ ...fix, timestamp: Date.now() }, motion);
                }, index * intervalMs)
            );
        });
    }

    function intervalForSpeedup(speedup: number): number {
        return 1000 / Math.max(speedup, 0.1);
    }

    function stop(): void {
        for (const timer of timers) clearTimeout(timer);
        timers = [];
    }

    const controller: SimulatorController = {
        startWalk() {
            playRoute(BASE_ROUTE);
        },
        startReturn() {
            playRoute([...BASE_ROUTE].reverse());
        },
        startScenario(name, speedup = 1) {
            if (!isScenarioName(name)) {
                throw new Error(
                    `Unknown scenario "${name}". Available: ${Object.keys(SCENARIO_ROUTES).join(', ')}`
                );
            }
            playRoute(buildScenario(name), intervalForSpeedup(speedup));
        },
        playGpx(xml, speedup = 1) {
            playRoute(parseGpx(xml), intervalForSpeedup(speedup));
        },
        sendWeakFix() {
            const last = BASE_ROUTE[BASE_ROUTE.length - 1];
            emit({ ...last, accuracy: 85, timestamp: Date.now() });
        },
        stop,
    };

    const mockGeolocation: Geolocation = {
        watchPosition(success, error) {
            const id = nextWatchId++;
            watches.push({ id, success, error });
            return id;
        },
        clearWatch(id) {
            const index = watches.findIndex(watch => watch.id === id);
            if (index >= 0) watches.splice(index, 1);
        },
        getCurrentPosition(success) {
            emit(BASE_ROUTE[0]);
            success({
                coords: {
                    latitude: BASE_ROUTE[0].lat,
                    longitude: BASE_ROUTE[0].lng,
                    accuracy: BASE_ROUTE[0].accuracy,
                    altitude: null,
                    altitudeAccuracy: null,
                    heading: null,
                    speed: null,
                },
                timestamp: Date.now(),
            } as GeolocationPosition);
        },
    } as Geolocation;

    Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: mockGeolocation,
    });
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: true,
    });

    window.__breadcrumbsSimulator = controller;
}
