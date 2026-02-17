import type { Breadcrumb } from '@/types';
import { haversineMeters } from '@/geo';

const MIN_DISTANCE_METERS = 10;
const MAX_ACCURACY_METERS = 30;

export type BreadcrumbCallback = (breadcrumb: Breadcrumb) => void;
export type ErrorCallback = (error: GeolocationPositionError) => void;

export interface GeolocationService {
    start(onBreadcrumb: BreadcrumbCallback, onError?: ErrorCallback): void;
    stop(): void;
}

export function createGeolocationService(): GeolocationService {
    let watchId: number | null = null;
    let lastBreadcrumb: Breadcrumb | null = null;

    function start(onBreadcrumb: BreadcrumbCallback, onError?: ErrorCallback): void {
        if (watchId !== null) return;

        watchId = navigator.geolocation.watchPosition(
            position => {
                const { latitude, longitude, accuracy } = position.coords;

                if (accuracy > MAX_ACCURACY_METERS) return;

                const candidate: Breadcrumb = {
                    lat: latitude,
                    lng: longitude,
                    accuracy,
                    timestamp: position.timestamp,
                };

                if (lastBreadcrumb !== null) {
                    const distance = haversineMeters(lastBreadcrumb, candidate);
                    if (distance < MIN_DISTANCE_METERS) return;
                }

                lastBreadcrumb = candidate;
                onBreadcrumb(candidate);
            },
            error => {
                onError?.(error);
            },
            { enableHighAccuracy: true }
        );
    }

    function stop(): void {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
    }

    return { start, stop };
}
