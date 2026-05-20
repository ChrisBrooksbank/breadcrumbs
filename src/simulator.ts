import type { Breadcrumb } from '@/types';

type WatchEntry = {
    id: number;
    success: PositionCallback;
    error?: PositionErrorCallback | null;
};

type SimulatorController = {
    startWalk(): void;
    startReturn(): void;
    sendWeakFix(): void;
    stop(): void;
};

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

    function emit(fix: Breadcrumb): void {
        const position = {
            coords: {
                latitude: fix.lat,
                longitude: fix.lng,
                accuracy: fix.accuracy,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
            },
            timestamp: fix.timestamp || Date.now(),
        } as GeolocationPosition;

        for (const watch of watches) {
            watch.success(position);
        }
    }

    function playRoute(route: Breadcrumb[]): void {
        stop();
        route.forEach((fix, index) => {
            timers.push(
                setTimeout(() => {
                    emit({ ...fix, timestamp: Date.now() });
                }, index * 700)
            );
        });
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
