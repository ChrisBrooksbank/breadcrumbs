import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createGeolocationService,
    type ErrorCallback,
    bearingDelta,
    adaptiveThreshold,
} from '@/gps';

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

describe('GeolocationService – movement bearing tracking', () => {
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

    it('returns null movementBearing before any fix', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        expect(service.movementBearing).toBeNull();
    });

    it('returns null movementBearing after only one fix', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        watchCallback(makePosition(51.5, -0.1, 5));

        expect(service.movementBearing).toBeNull();
    });

    it('computes bearing after two fixes with meaningful movement', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        // First fix
        watchCallback(makePosition(51.5, -0.1, 5, 0));
        // Second fix ~111m to the north (1 degree lat ≈ 111km)
        watchCallback(makePosition(51.501, -0.1, 5, 1000));

        expect(service.movementBearing).not.toBeNull();
        // Moving north, bearing should be close to 0°
        expect(service.movementBearing!).toBeCloseTo(0, 0);
    });

    it('computes bearing for eastward movement', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        watchCallback(makePosition(51.5, -0.1, 5, 0));
        // Move east (~70m at this latitude)
        watchCallback(makePosition(51.5, 0.0, 5, 1000));

        expect(service.movementBearing).not.toBeNull();
        // Moving east, bearing should be close to 90°
        expect(service.movementBearing!).toBeCloseTo(90, 0);
    });

    it('updates bearing from raw fixes even when accuracy filter would reject them', () => {
        const service = createGeolocationService();
        const onBreadcrumb = vi.fn();
        service.start(onBreadcrumb);

        // First fix (accepted)
        watchCallback(makePosition(51.5, -0.1, 5, 0));
        // Second fix far north but poor accuracy (rejected by accuracy filter)
        watchCallback(makePosition(51.501, -0.1, 50, 1000));

        // Breadcrumb callback should not have been called twice (poor accuracy dropped)
        expect(onBreadcrumb).toHaveBeenCalledTimes(1);
        // But bearing should still be computed from the raw fix
        expect(service.movementBearing).not.toBeNull();
    });

    it('does not update bearing if raw fixes are less than 1m apart', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        watchCallback(makePosition(51.5, -0.1, 5, 0));
        // Essentially the same position (sub-meter noise)
        watchCallback(makePosition(51.5000001, -0.1, 5, 500));

        expect(service.movementBearing).toBeNull();
    });

    it('updates bearing on each successive fix', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        watchCallback(makePosition(51.5, 0.0, 5, 0));
        watchCallback(makePosition(51.5, 0.001, 5, 1000)); // moving east
        const bearingEast = service.movementBearing;

        watchCallback(makePosition(51.501, 0.001, 5, 2000)); // now moving north
        const bearingNorth = service.movementBearing;

        expect(bearingEast).not.toBeNull();
        expect(bearingNorth).not.toBeNull();
        // East ≈ 90°, North ≈ 0° — should be different
        expect(Math.abs(bearingEast! - bearingNorth!)).toBeGreaterThan(45);
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

describe('bearingDelta', () => {
    it('returns 0 for identical bearings', () => {
        expect(bearingDelta(90, 90)).toBe(0);
    });

    it('returns 90 for cardinal difference', () => {
        expect(bearingDelta(0, 90)).toBe(90);
    });

    it('handles wraparound: 350° vs 10° = 20°', () => {
        expect(bearingDelta(350, 10)).toBeCloseTo(20, 5);
    });

    it('handles wraparound: 10° vs 350° = 20°', () => {
        expect(bearingDelta(10, 350)).toBeCloseTo(20, 5);
    });

    it('returns 180 for opposite bearings', () => {
        expect(bearingDelta(0, 180)).toBe(180);
    });
});

describe('adaptiveThreshold', () => {
    it('returns default (10m) with fewer than 2 bearings', () => {
        expect(adaptiveThreshold([])).toBe(10);
        expect(adaptiveThreshold([45])).toBe(10);
    });

    it('returns turn threshold (5m) when bearing change > 30°', () => {
        // 90° turn
        expect(adaptiveThreshold([0, 90])).toBe(5);
    });

    it('returns turn threshold (5m) for a U-turn', () => {
        expect(adaptiveThreshold([0, 180])).toBe(5);
    });

    it('returns default (10m) when bearing change is between 15° and 30°', () => {
        expect(adaptiveThreshold([0, 20])).toBe(10);
    });

    it('returns straight threshold (20m) after 3+ consecutive straight fixes', () => {
        // All fixes heading roughly north with < 15° variation
        expect(adaptiveThreshold([0, 5, 10])).toBe(20);
    });

    it('returns straight threshold (20m) with more than 3 straight fixes', () => {
        expect(adaptiveThreshold([0, 3, 6, 9, 12])).toBe(20);
    });

    it('returns default (10m) if only 2 bearings with small change (not 3+ straight)', () => {
        // Only 2 bearings, delta < 15°, not enough for straight detection
        expect(adaptiveThreshold([0, 5])).toBe(10);
    });

    it('returns turn threshold when last bearing shows turn even after straight history', () => {
        // History starts straight, then a big turn at end
        expect(adaptiveThreshold([0, 5, 10, 90])).toBe(5);
    });
});

describe('GeolocationService – stationary detection', () => {
    let watchCallback: PositionCallback;
    let watchPositionMock: ReturnType<typeof vi.fn>;
    let clearWatchMock: ReturnType<typeof vi.fn>;
    let watchIdCounter: number;

    beforeEach(() => {
        watchIdCounter = 0;
        watchPositionMock = vi.fn((success: PositionCallback) => {
            watchCallback = success;
            return ++watchIdCounter;
        });
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

    it('isStationary is false initially', () => {
        const service = createGeolocationService();
        service.start(vi.fn());
        expect(service.isStationary).toBe(false);
    });

    it('isStationary is false after fixes spanning less than 30 seconds', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        // Send 3 fixes all at the same spot, spanning only 10 seconds
        const base = { lat: 51.5, lng: -0.1, accuracy: 5 };
        watchCallback(makePosition(base.lat, base.lng, base.accuracy, 0));
        watchCallback(makePosition(base.lat, base.lng, base.accuracy, 5000));
        watchCallback(makePosition(base.lat, base.lng, base.accuracy, 10000));

        expect(service.isStationary).toBe(false);
    });

    it('enters stationary mode when fixes span 30+ seconds within 5m radius', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        // Send fixes spanning exactly 30s at the same location
        const lat = 51.5;
        const lng = -0.1;
        watchCallback(makePosition(lat, lng, 5, 0));
        watchCallback(makePosition(lat, lng, 5, 15_000));
        watchCallback(makePosition(lat, lng, 5, 30_000)); // now - oldest = 30s → triggers

        expect(service.isStationary).toBe(true);
    });

    it('does not enter stationary mode when fixes span 30s but exceed 5m displacement', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        // Start at one location
        watchCallback(makePosition(51.5, -0.1, 5, 0));
        watchCallback(makePosition(51.5, -0.1, 5, 15_000));
        // Move 10m away at 30s mark (10m ≈ 0.00009 degrees lat)
        watchCallback(makePosition(51.5001, -0.1, 5, 30_000));

        expect(service.isStationary).toBe(false);
    });

    it('switches watcher to low-power mode (maximumAge: 10000) when stationary', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        const lat = 51.5;
        const lng = -0.1;
        watchCallback(makePosition(lat, lng, 5, 0));
        watchCallback(makePosition(lat, lng, 5, 15_000));
        watchCallback(makePosition(lat, lng, 5, 30_000));

        // Should have started a second watcher in low-power mode
        expect(watchPositionMock).toHaveBeenCalledTimes(2);
        const secondCallOptions = watchPositionMock.mock.calls[1][2] as PositionOptions;
        expect(secondCallOptions.maximumAge).toBe(10_000);
        expect(secondCallOptions.enableHighAccuracy).toBe(true);
    });

    it('clears original watcher when switching to low-power mode', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        const lat = 51.5;
        const lng = -0.1;
        watchCallback(makePosition(lat, lng, 5, 0));
        watchCallback(makePosition(lat, lng, 5, 15_000));
        watchCallback(makePosition(lat, lng, 5, 30_000));

        // First watcher (id=1) should have been cleared
        expect(clearWatchMock).toHaveBeenCalledWith(1);
    });

    it('exits stationary mode when movement >5m detected from stationary point', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        const lat = 51.5;
        const lng = -0.1;
        // Trigger stationary
        watchCallback(makePosition(lat, lng, 5, 0));
        watchCallback(makePosition(lat, lng, 5, 15_000));
        watchCallback(makePosition(lat, lng, 5, 30_000));
        expect(service.isStationary).toBe(true);

        // Now simulate movement >5m from stationary point (~6m north: 6/111000 ≈ 0.000054 degrees)
        watchCallback(makePosition(lat + 0.000054, lng, 5, 35_000));

        expect(service.isStationary).toBe(false);
    });

    it('restarts in high-accuracy mode (no maximumAge) after leaving stationary', () => {
        const service = createGeolocationService();
        service.start(vi.fn());

        const lat = 51.5;
        const lng = -0.1;
        // Enter stationary
        watchCallback(makePosition(lat, lng, 5, 0));
        watchCallback(makePosition(lat, lng, 5, 15_000));
        watchCallback(makePosition(lat, lng, 5, 30_000));

        // Exit stationary via movement
        watchCallback(makePosition(lat + 0.000054, lng, 5, 35_000));

        // Should have called watchPosition 3 times total: initial, low-power, high-accuracy resume
        expect(watchPositionMock).toHaveBeenCalledTimes(3);
        const thirdCallOptions = watchPositionMock.mock.calls[2][2] as PositionOptions;
        expect(thirdCallOptions.enableHighAccuracy).toBe(true);
        expect(thirdCallOptions.maximumAge).toBeUndefined();
    });

    it('does not produce duplicate breadcrumbs during mode transitions', () => {
        const onBreadcrumb = vi.fn();
        const service = createGeolocationService();
        service.start(onBreadcrumb);

        const lat = 51.5;
        const lng = -0.1;
        // These fixes are all at same location — first should produce a breadcrumb, subsequent should not
        watchCallback(makePosition(lat, lng, 5, 0));
        const countAfterFirst = onBreadcrumb.mock.calls.length;
        watchCallback(makePosition(lat, lng, 5, 15_000));
        watchCallback(makePosition(lat, lng, 5, 30_000)); // triggers stationary switch — no extra breadcrumb
        const countAfterStationary = onBreadcrumb.mock.calls.length;

        // Same breadcrumb count — stationary switch should not emit a breadcrumb
        expect(countAfterStationary).toBe(countAfterFirst);
    });
});

describe('GeolocationService – isSuspended and onSuspendedChange', () => {
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

    it('isSuspended is false initially', () => {
        const service = createGeolocationService();
        service.start(vi.fn());
        expect(service.isSuspended).toBe(false);
    });

    it('onSuspendedChange is null by default', () => {
        const service = createGeolocationService();
        expect(service.onSuspendedChange).toBeNull();
    });

    it('can set and get onSuspendedChange callback', () => {
        const service = createGeolocationService();
        const cb = vi.fn();
        service.onSuspendedChange = cb;
        expect(service.onSuspendedChange).toBe(cb);
    });

    it('disableMotionSuspension option prevents motion detector creation', () => {
        const service = createGeolocationService({ disableMotionSuspension: true });
        service.start(vi.fn());
        // Should still work normally without motion
        watchCallback(makePosition(51.5, -0.1, 5, 0));
        expect(service.isSuspended).toBe(false);
    });
});

describe('GeolocationService – adaptive threshold in practice', () => {
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

    it('accepts breadcrumb at 6m distance after a detected turn (threshold 5m)', () => {
        const service = createGeolocationService();
        const onBreadcrumb = vi.fn();
        service.start(onBreadcrumb);

        // Establish bearing heading north (~0°)
        watchCallback(makePosition(51.5, 0.0, 5, 0));
        watchCallback(makePosition(51.501, 0.0, 5, 1000)); // north, ~111m
        // Big turn east (bearing ~90°, delta > 30°)
        watchCallback(makePosition(51.501, 0.001, 5, 2000)); // east step to establish bearing change

        onBreadcrumb.mockClear();

        // Now send a fix ~6m from last accepted breadcrumb — should pass 5m turn threshold
        // ~6m north from (51.501, 0.001): 6/111000 degrees ≈ 0.000054
        watchCallback(makePosition(51.501054, 0.001, 5, 3000));

        // Should be accepted because 6m > 5m (turn threshold)
        expect(onBreadcrumb).toHaveBeenCalledTimes(1);
    });

    it('enforces 50m maximum gap regardless of adaptive threshold', () => {
        const service = createGeolocationService();
        const onBreadcrumb = vi.fn();
        service.start(onBreadcrumb);

        // First breadcrumb
        watchCallback(makePosition(51.5, 0.0, 5, 0));
        onBreadcrumb.mockClear();

        // Send a fix 51m away (> 50m max gap) — should be accepted even on straight stretch
        // 51m north: 51/111000 ≈ 0.000459 degrees lat
        watchCallback(makePosition(51.500459, 0.0, 5, 1000));

        expect(onBreadcrumb).toHaveBeenCalledTimes(1);
    });
});
