import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installBreadcrumbSimulator, isSimulatorEnabled } from '@/simulator';

describe('breadcrumb simulator', () => {
    const originalUrl = window.location.href;
    const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

    beforeEach(() => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/?simulate=1');
    });

    afterEach(() => {
        vi.useRealTimers();
        window.history.replaceState({}, '', originalUrl);
        if (originalGeolocation) {
            Object.defineProperty(navigator, 'geolocation', originalGeolocation);
        }
        delete window.__breadcrumbsSimulator;
    });

    it('is enabled only by the simulate query flag', () => {
        expect(isSimulatorEnabled()).toBe(true);
        window.history.replaceState({}, '', '/');
        expect(isSimulatorEnabled()).toBe(false);
    });

    it('installs a geolocation mock that emits a walk', async () => {
        installBreadcrumbSimulator();
        const onPosition = vi.fn();

        navigator.geolocation.watchPosition(onPosition);
        window.__breadcrumbsSimulator?.startWalk();
        await vi.advanceTimersByTimeAsync(1500);

        expect(onPosition.mock.calls.length).toBeGreaterThanOrEqual(2);
        const first = onPosition.mock.calls[0][0] as GeolocationPosition;
        expect(first.coords.accuracy).toBeLessThanOrEqual(10);
    });

    it('can emit a deliberately weak GPS fix', () => {
        installBreadcrumbSimulator();
        const onPosition = vi.fn();

        navigator.geolocation.watchPosition(onPosition);
        window.__breadcrumbsSimulator?.sendWeakFix();

        const fix = onPosition.mock.calls[0][0] as GeolocationPosition;
        expect(fix.coords.accuracy).toBe(85);
    });
});
