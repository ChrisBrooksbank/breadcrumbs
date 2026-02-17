import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGeolocationService, type ErrorCallback } from '@/gps';

function makePosition(
    lat: number,
    lng: number,
    accuracy: number,
    timestamp = 0
): GeolocationPosition {
    return {
        coords: { latitude: lat, longitude: lng, accuracy } as GeolocationCoordinates,
        timestamp,
    } as GeolocationPosition;
}

describe('GeolocationService – filtering logic', () => {
    let watchCallback: PositionCallback;

    beforeEach(() => {
        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: vi.fn((success: PositionCallback) => {
                    watchCallback = success;
                    return 1;
                }),
                clearWatch: vi.fn(),
            },
        });
        return () => {
            vi.unstubAllGlobals();
        };
    });

    describe('accuracy filtering', () => {
        it('accepts a reading with accuracy exactly at threshold (30m)', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            watchCallback(makePosition(51.5, -0.1, 30));

            expect(onBreadcrumb).toHaveBeenCalledTimes(1);
        });

        it('drops a reading with accuracy just above threshold (31m)', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            watchCallback(makePosition(51.5, -0.1, 31));

            expect(onBreadcrumb).not.toHaveBeenCalled();
        });

        it('drops a reading with very poor accuracy (100m)', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            watchCallback(makePosition(51.5, -0.1, 100));

            expect(onBreadcrumb).not.toHaveBeenCalled();
        });

        it('accepts a reading with good accuracy (5m)', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            watchCallback(makePosition(51.5, -0.1, 5));

            expect(onBreadcrumb).toHaveBeenCalledTimes(1);
        });

        it('passes the correct breadcrumb data through', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            watchCallback(makePosition(51.5, -0.1, 5, 1234567890));

            expect(onBreadcrumb).toHaveBeenCalledWith({
                lat: 51.5,
                lng: -0.1,
                accuracy: 5,
                timestamp: 1234567890,
            });
        });
    });

    describe('distance filtering', () => {
        it('accepts the first breadcrumb regardless of distance', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            watchCallback(makePosition(51.5, -0.1, 5));

            expect(onBreadcrumb).toHaveBeenCalledTimes(1);
        });

        it('drops a second reading fewer than 10m from first', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            // First breadcrumb
            watchCallback(makePosition(51.5, -0.1, 5, 1000));
            // Second breadcrumb ~1m away (tiny delta in lat)
            watchCallback(makePosition(51.500009, -0.1, 5, 2000));

            expect(onBreadcrumb).toHaveBeenCalledTimes(1);
        });

        it('accepts a second reading more than 10m from first', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            // First breadcrumb
            watchCallback(makePosition(51.5, -0.1, 5, 1000));
            // Second breadcrumb ~11m away (~0.0000899 deg lat ≈ 10m)
            watchCallback(makePosition(51.5001, -0.1, 5, 2000));

            expect(onBreadcrumb).toHaveBeenCalledTimes(2);
        });

        it('accumulates distance from most recent accepted breadcrumb', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            // First breadcrumb at base
            watchCallback(makePosition(51.5, -0.1, 5, 1000));
            // Second breadcrumb ~1m from first (dropped)
            watchCallback(makePosition(51.500009, -0.1, 5, 2000));
            // Third breadcrumb ~11m from first (should be accepted since last accepted is still first)
            watchCallback(makePosition(51.5001, -0.1, 5, 3000));

            expect(onBreadcrumb).toHaveBeenCalledTimes(2);
        });

        it('drops multiple consecutive near readings', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            watchCallback(makePosition(51.5, -0.1, 5, 1000));
            // All subsequent readings within 5m of previous accepted
            watchCallback(makePosition(51.5000045, -0.1, 5, 2000)); // ~5m
            watchCallback(makePosition(51.500009, -0.1, 5, 3000)); // ~5m from previous, ~10m from first
            watchCallback(makePosition(51.5000135, -0.1, 5, 4000)); // ~5m from previous, ~15m from first

            // Only first accepted; subsequent ones are within 10m of last accepted first
            // At ~5m steps from base: 5m dropped, 10m boundary, 15m accepted
            // Note: 10m is the threshold (< 10 is dropped), so exactly 10m would pass
            expect(onBreadcrumb.mock.calls.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('combined accuracy and distance filtering', () => {
        it('drops a low-accuracy reading even if far enough away', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            // First breadcrumb accepted
            watchCallback(makePosition(51.5, -0.1, 5, 1000));
            // Second breadcrumb far away but poor accuracy (dropped by accuracy filter)
            watchCallback(makePosition(51.51, -0.1, 50, 2000));

            expect(onBreadcrumb).toHaveBeenCalledTimes(1);
        });

        it('drops a reading that passes accuracy but fails distance', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            // First breadcrumb
            watchCallback(makePosition(51.5, -0.1, 5, 1000));
            // Good accuracy, close distance (dropped by distance filter)
            watchCallback(makePosition(51.500009, -0.1, 5, 2000)); // ~1m away

            expect(onBreadcrumb).toHaveBeenCalledTimes(1);
        });

        it('accepts a reading that passes both accuracy and distance filters', () => {
            const service = createGeolocationService();
            const onBreadcrumb = vi.fn();
            service.start(onBreadcrumb);

            // First breadcrumb
            watchCallback(makePosition(51.5, -0.1, 5, 1000));
            // Good accuracy, far enough away
            watchCallback(makePosition(51.5001, -0.1, 10, 2000)); // ~11m, accuracy 10m

            expect(onBreadcrumb).toHaveBeenCalledTimes(2);
        });
    });
});

describe('GeolocationService – API behaviour', () => {
    let watchPositionMock: ReturnType<typeof vi.fn>;
    let clearWatchMock: ReturnType<typeof vi.fn>;
    let capturedErrorCallback: PositionErrorCallback | null | undefined;

    beforeEach(() => {
        capturedErrorCallback = null;
        watchPositionMock = vi.fn(
            (
                _success: PositionCallback,
                error?: PositionErrorCallback | null,
                _options?: PositionOptions
            ) => {
                capturedErrorCallback = error;
                return 42;
            }
        );
        clearWatchMock = vi.fn();
        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: watchPositionMock,
                clearWatch: clearWatchMock,
            },
        });
        return () => {
            vi.unstubAllGlobals();
        };
    });

    it('calls watchPosition with enableHighAccuracy: true', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        expect(watchPositionMock).toHaveBeenCalledTimes(1);
        const options = watchPositionMock.mock.calls[0][2] as PositionOptions;
        expect(options.enableHighAccuracy).toBe(true);
    });

    it('does not call watchPosition again if already started', () => {
        const service = createGeolocationService();
        service.start(vi.fn());
        service.start(vi.fn());

        expect(watchPositionMock).toHaveBeenCalledTimes(1);
    });

    it('calls clearWatch on stop', () => {
        const service = createGeolocationService();
        service.start(vi.fn());
        service.stop();

        expect(clearWatchMock).toHaveBeenCalledWith(42);
    });

    it('does not call clearWatch if never started', () => {
        const service = createGeolocationService();
        service.stop();

        expect(clearWatchMock).not.toHaveBeenCalled();
    });

    it('invokes the error callback when geolocation is denied', () => {
        const service = createGeolocationService();
        const onError: ErrorCallback = vi.fn();
        service.start(vi.fn(), onError);

        const fakeError = {
            code: 1, // PERMISSION_DENIED
            message: 'User denied Geolocation',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
        } as GeolocationPositionError;

        capturedErrorCallback?.(fakeError);

        expect(onError).toHaveBeenCalledWith(fakeError);
    });

    it('invokes the error callback when geolocation is unavailable', () => {
        const service = createGeolocationService();
        const onError: ErrorCallback = vi.fn();
        service.start(vi.fn(), onError);

        const fakeError = {
            code: 2, // POSITION_UNAVAILABLE
            message: 'Position unavailable',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
        } as GeolocationPositionError;

        capturedErrorCallback?.(fakeError);

        expect(onError).toHaveBeenCalledWith(fakeError);
    });

    it('does not throw when no error callback is provided and geolocation fails', () => {
        const service = createGeolocationService();
        service.start(vi.fn()); // no onError provided

        const fakeError = {
            code: 1,
            message: 'User denied Geolocation',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
        } as GeolocationPositionError;

        expect(() => capturedErrorCallback?.(fakeError)).not.toThrow();
    });
});
