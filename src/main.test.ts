import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    mountAppShell,
    startRecording,
    formatElapsed,
    formatDistance,
    formatRouteDate,
    mountNavigationView,
    switchToNavigationView,
    openSaveModal,
    openLandmarkPicker,
    mountSavedRoutesView,
    _resetModalOpen,
    createOffCourseDetector,
    majorTurnDirection,
    updateStationaryBadge,
    shortestArcDistance,
    lerpAngle,
} from './main';
import { clearSession, appendBreadcrumb, listRoutes, saveRoute, deleteRoute } from './storage';
import { initSettings, setFontSize, FONT_SIZES } from './settings';

describe('App Shell', () => {
    let root: HTMLElement;

    beforeEach(async () => {
        await clearSession();
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        mountAppShell(root);
        return () => {
            document.body.removeChild(root);
        };
    });

    it('renders without a header (compact layout)', () => {
        const header = root.querySelector('header');
        expect(header).toBeNull();
    });

    it('renders the recording status card', () => {
        const card = root.querySelector('#recording-status-card');
        expect(card).not.toBeNull();
    });

    it('renders the status badge', () => {
        const badge = root.querySelector('#status-badge');
        expect(badge).not.toBeNull();
        expect(badge?.textContent?.trim()).toContain('Idle');
    });

    it('renders "Take me back" button', () => {
        const btn = root.querySelector('#btn-take-me-back') as HTMLButtonElement | null;
        expect(btn).not.toBeNull();
        expect(btn?.textContent?.trim()).toBe('Take me back');
    });

    it('renders "Save route" button', () => {
        const btn = root.querySelector('#btn-save-route') as HTMLButtonElement | null;
        expect(btn).not.toBeNull();
        expect(btn?.textContent?.trim()).toBe('Save route');
    });

    it('"Take me back" button is disabled by default', () => {
        const btn = root.querySelector('#btn-take-me-back') as HTMLButtonElement | null;
        expect(btn?.disabled).toBe(true);
    });

    it('"Save this route" button is disabled by default', () => {
        const btn = root.querySelector('#btn-save-route') as HTMLButtonElement | null;
        expect(btn?.disabled).toBe(true);
    });

    it('buttons have aria-label attributes for accessibility', () => {
        const takeBack = root.querySelector('#btn-take-me-back');
        const saveRoute = root.querySelector('#btn-save-route');
        expect(takeBack?.getAttribute('aria-label')).toBeTruthy();
        expect(saveRoute?.getAttribute('aria-label')).toBeTruthy();
    });

    it('does not render a footer (compact layout)', () => {
        const footer = root.querySelector('footer');
        expect(footer).toBeNull();
    });

    it('actions group has role="group" for accessibility', () => {
        const group = root.querySelector('.actions');
        expect(group?.getAttribute('role')).toBe('group');
    });
});

describe('startRecording', () => {
    let root: HTMLElement;
    let watchPositionCallback: PositionCallback;
    let watchErrorCallback: PositionErrorCallback | undefined;

    beforeEach(async () => {
        await clearSession();
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        mountAppShell(root);

        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
                    watchPositionCallback = success;
                    watchErrorCallback = error;
                    return 1;
                }),
                clearWatch: vi.fn(),
            },
        });
        vi.stubGlobal('isSecureContext', true);

        return () => {
            document.body.removeChild(root);
            vi.unstubAllGlobals();
        };
    });

    it('calls watchPosition with enableHighAccuracy on start', () => {
        startRecording(root);
        expect(navigator.geolocation.watchPosition).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Function),
            { enableHighAccuracy: true }
        );
    });

    it('updates status badge to Recording after first breadcrumb', async () => {
        startRecording(root);

        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 5 },
            timestamp: 1000,
        } as GeolocationPosition);

        // Wait for async appendBreadcrumb to complete
        await new Promise(resolve => setTimeout(resolve, 50));

        const statusText = root.querySelector('#status-text');
        expect(statusText?.textContent).toBe('Recording...');
    });

    it('enables action buttons after first breadcrumb', async () => {
        startRecording(root);

        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 5 },
            timestamp: 1000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const takeBack = root.querySelector<HTMLButtonElement>('#btn-take-me-back');
        const saveRoute = root.querySelector<HTMLButtonElement>('#btn-save-route');
        expect(takeBack?.disabled).toBe(false);
        expect(saveRoute?.disabled).toBe(false);
    });

    it('shows permission denied error message on PERMISSION_DENIED', () => {
        startRecording(root);

        const error = {
            code: 1,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'User denied',
        } as GeolocationPositionError;

        watchErrorCallback?.(error);

        const statusText = root.querySelector('#status-text');
        expect(statusText?.textContent).toContain('Location is turned off');
    });

    it('shows a retry button after a location error and restarts location watching', () => {
        startRecording(root);

        const error = {
            code: 1,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'User denied',
        } as GeolocationPositionError;

        watchErrorCallback?.(error);

        const retryBtn = root.querySelector<HTMLButtonElement>('#btn-location-retry');
        expect(retryBtn).not.toBeNull();
        expect(retryBtn?.hidden).toBe(false);

        retryBtn?.click();

        expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(1);
        expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(2);
    });

    it('shows unavailable error message on POSITION_UNAVAILABLE', () => {
        startRecording(root);

        const error = {
            code: 2,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'Position unavailable',
        } as GeolocationPositionError;

        watchErrorCallback?.(error);

        const statusText = root.querySelector('#status-text');
        expect(statusText?.textContent).toContain('find your location');
    });

    it('shows timeout error message on TIMEOUT', () => {
        startRecording(root);

        const error = {
            code: 3,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'Timeout',
        } as GeolocationPositionError;

        watchErrorCallback?.(error);

        const statusText = root.querySelector('#status-text');
        expect(statusText?.textContent).toContain('Taking too long');
    });

    it('shows a route quality warning when GPS accuracy is weak', async () => {
        startRecording(root);

        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 90 },
            timestamp: 1000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const warning = root.querySelector('#route-quality');
        expect(warning?.textContent).toContain('GPS weak');
    });

    it('adds error CSS class on geolocation error', () => {
        startRecording(root);

        const error = {
            code: 1,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'User denied',
        } as GeolocationPositionError;

        watchErrorCallback?.(error);

        const badge = root.querySelector('#status-badge');
        expect(badge?.classList.contains('status-badge--error')).toBe(true);
    });

    it('shows requesting state immediately when recording starts', () => {
        startRecording(root);
        const badge = root.querySelector('#status-badge');
        const statusText = root.querySelector('#status-text');
        expect(badge?.classList.contains('status-badge--requesting')).toBe(true);
        expect(statusText?.textContent).toContain('Requesting location');
    });

    it('restores an existing safety trail instead of starting from zero', async () => {
        await clearSession();
        await appendBreadcrumb({
            lat: 51.5,
            lng: -0.1,
            accuracy: 5,
            timestamp: Date.now() - 60_000,
        });
        await appendBreadcrumb({
            lat: 51.5001,
            lng: -0.1,
            accuracy: 5,
            timestamp: Date.now() - 30_000,
        });

        startRecording(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        const takeBack = root.querySelector<HTMLButtonElement>('#btn-take-me-back');
        const distance = root.querySelector('#distance-walked');
        expect(takeBack?.disabled).toBe(false);
        expect(distance?.textContent).not.toBe('0 m');
        await clearSession();
    });

    it('recording stats are hidden before first breadcrumb', () => {
        startRecording(root);
        const stats = root.querySelector<HTMLElement>('#recording-stats');
        expect(stats?.hidden).toBe(true);
    });

    it('recording stats become visible after first breadcrumb', async () => {
        startRecording(root);

        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 5 },
            timestamp: 1000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const stats = root.querySelector<HTMLElement>('#recording-stats');
        expect(stats?.hidden).toBe(false);
    });

    it('shows elapsed time element after first breadcrumb', async () => {
        startRecording(root);

        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 5 },
            timestamp: 1000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const elapsed = root.querySelector('#elapsed-time');
        expect(elapsed).not.toBeNull();
        expect(elapsed?.textContent).toBeTruthy();
    });

    it('shows distance element after first breadcrumb', async () => {
        startRecording(root);

        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 5 },
            timestamp: 1000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const distance = root.querySelector('#distance-walked');
        expect(distance).not.toBeNull();
        expect(distance?.textContent).toContain('m');
    });

    it('accumulates distance across multiple breadcrumbs', async () => {
        startRecording(root);

        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 5 },
            timestamp: 1000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        // Second breadcrumb ~1.1km away
        watchPositionCallback({
            coords: { latitude: 51.51, longitude: -0.1, accuracy: 5 },
            timestamp: 2000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const distance = root.querySelector('#distance-walked');
        // ~1.1km between lat 51.5 and 51.51
        expect(distance?.textContent).toContain('km');
    });
});

describe('startRecording – geolocation unavailable', () => {
    let root: HTMLElement;

    beforeEach(() => {
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        mountAppShell(root);

        vi.stubGlobal('navigator', { geolocation: undefined });

        return () => {
            document.body.removeChild(root);
            vi.unstubAllGlobals();
        };
    });

    it('shows unsupported error when geolocation is not available', () => {
        startRecording(root);
        const statusText = root.querySelector('#status-text');
        expect(statusText?.textContent).toContain('not supported');
    });

    it('adds error CSS class when geolocation is not available', () => {
        startRecording(root);
        const badge = root.querySelector('#status-badge');
        expect(badge?.classList.contains('status-badge--error')).toBe(true);
    });
});

describe('formatElapsed', () => {
    it('formats 0 seconds as 0:00', () => {
        expect(formatElapsed(0)).toBe('0:00');
    });

    it('formats 59 seconds as 0:59', () => {
        expect(formatElapsed(59)).toBe('0:59');
    });

    it('formats 60 seconds as 1:00', () => {
        expect(formatElapsed(60)).toBe('1:00');
    });

    it('formats 90 seconds as 1:30', () => {
        expect(formatElapsed(90)).toBe('1:30');
    });

    it('formats 3600 seconds as 1:00:00', () => {
        expect(formatElapsed(3600)).toBe('1:00:00');
    });

    it('formats 125 seconds as 2:05', () => {
        expect(formatElapsed(125)).toBe('2:05');
    });

    it('formats 3661 seconds as 1:01:01', () => {
        expect(formatElapsed(3661)).toBe('1:01:01');
    });

    it('formats 7200 seconds as 2:00:00', () => {
        expect(formatElapsed(7200)).toBe('2:00:00');
    });
});

describe('formatDistance', () => {
    it('formats 0 meters as "0 m"', () => {
        expect(formatDistance(0)).toBe('0 m');
    });

    it('formats 500 meters as "500 m"', () => {
        expect(formatDistance(500)).toBe('500 m');
    });

    it('formats 999 meters as "999 m"', () => {
        expect(formatDistance(999)).toBe('999 m');
    });

    it('formats 1000 meters as "1.00 km"', () => {
        expect(formatDistance(1000)).toBe('1.00 km');
    });

    it('formats 2500 meters as "2.50 km"', () => {
        expect(formatDistance(2500)).toBe('2.50 km');
    });

    it('formats fractional meters by rounding', () => {
        expect(formatDistance(10.7)).toBe('11 m');
    });
});

describe('mountNavigationView', () => {
    let root: HTMLElement;

    beforeEach(() => {
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        mountNavigationView(root);
        return () => {
            document.body.removeChild(root);
        };
    });

    it('renders without a header (compact layout)', () => {
        const header = root.querySelector('header');
        expect(header).toBeNull();
    });

    it('renders the compass arrow SVG', () => {
        const arrow = root.querySelector('#nav-compass-arrow');
        expect(arrow).not.toBeNull();
        expect(arrow?.tagName.toLowerCase()).toBe('svg');
    });

    it('renders the distance value element', () => {
        const distanceEl = root.querySelector('#nav-distance-value');
        expect(distanceEl).not.toBeNull();
    });

    it('renders the progress text element', () => {
        const progressEl = root.querySelector('#nav-progress-text');
        expect(progressEl).not.toBeNull();
    });

    it('renders the stop navigation button', () => {
        const btn = root.querySelector('#btn-stop-navigation') as HTMLButtonElement | null;
        expect(btn).not.toBeNull();
        expect(btn?.textContent?.trim()).toBe('Stop navigation');
    });

    it('stop navigation button has aria-label for accessibility', () => {
        const btn = root.querySelector('#btn-stop-navigation');
        expect(btn?.getAttribute('aria-label')).toBeTruthy();
    });

    it('calibration hint is hidden by default', () => {
        const hint = root.querySelector<HTMLElement>('#nav-calibration-hint');
        expect(hint?.hidden).toBe(true);
    });

    it('compass arrow is inside nav-compass-corner (small indicator position)', () => {
        const corner = root.querySelector('.nav-compass-corner');
        expect(corner).not.toBeNull();
        const arrow = corner?.querySelector('#nav-compass-arrow');
        expect(arrow).not.toBeNull();
    });

    it('compass arrow has nav-compass-arrow class (48x48 CSS size)', () => {
        const arrow = root.querySelector('#nav-compass-arrow');
        expect(arrow?.classList.contains('nav-compass-arrow')).toBe(true);
    });

    it('distance and progress are inside nav-primary (primary content area)', () => {
        const primary = root.querySelector('.nav-primary');
        expect(primary).not.toBeNull();
        const distanceEl = primary?.querySelector('#nav-distance-value');
        const progressEl = primary?.querySelector('#nav-progress-text');
        expect(distanceEl).not.toBeNull();
        expect(progressEl).not.toBeNull();
    });

    it('nav-compass-corner is inside nav-trail-container (overlaid on the trail canvas)', () => {
        const container = root.querySelector('.nav-trail-container');
        expect(container).not.toBeNull();
        const corner = container?.querySelector('.nav-compass-corner');
        expect(corner).not.toBeNull();
    });

    it('renders the trail canvas element', () => {
        const canvas = root.querySelector('#nav-trail-canvas');
        expect(canvas).not.toBeNull();
        expect(canvas?.tagName.toLowerCase()).toBe('canvas');
    });

    it('trail canvas is inside nav-trail-container inside nav-primary', () => {
        const primary = root.querySelector('.nav-primary');
        const container = primary?.querySelector('.nav-trail-container');
        const canvas = container?.querySelector('#nav-trail-canvas');
        expect(canvas).not.toBeNull();
    });
});

describe('switchToNavigationView', () => {
    let root: HTMLElement;

    beforeEach(async () => {
        await clearSession();
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        return () => {
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            _resetModalOpen();
            document.body.removeChild(root);
        };
    });

    it('switches root to navigation view', async () => {
        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(root.querySelector('#nav-compass-arrow')).not.toBeNull();
        expect(root.querySelector('#btn-stop-navigation')).not.toBeNull();
    });

    it('shows "no route" message when session is empty', async () => {
        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        const progressText = root.querySelector('#nav-progress-text');
        expect(progressText?.textContent).toContain('No route recorded yet');
    });

    it('stop navigation button returns to app shell', async () => {
        vi.useFakeTimers();
        mountAppShell(root);
        switchToNavigationView(root);
        await vi.advanceTimersByTimeAsync(50);

        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: vi.fn(() => 1),
                clearWatch: vi.fn(),
            },
        });
        vi.stubGlobal('isSecureContext', true);

        const stopBtn = root.querySelector<HTMLButtonElement>('#btn-stop-navigation');
        // Simulate press-and-hold: pointerdown then wait 1s for the hold timer
        stopBtn?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(1000);

        // Confirm dialog should appear with delayed button
        const confirmBtn = document.querySelector<HTMLButtonElement>('#btn-confirm-yes');
        expect(confirmBtn).not.toBeNull();

        // Advance past the 1.5s delay
        await vi.advanceTimersByTimeAsync(1500);
        confirmBtn?.click();

        expect(root.querySelector('#btn-take-me-back')).not.toBeNull();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
});

describe('"Take me back" button switches to navigation view', () => {
    let root: HTMLElement;
    let watchPositionCallback: PositionCallback;

    beforeEach(() => {
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        mountAppShell(root);

        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: vi.fn((success: PositionCallback) => {
                    watchPositionCallback = success;
                    return 1;
                }),
                clearWatch: vi.fn(),
            },
        });
        vi.stubGlobal('isSecureContext', true);

        return () => {
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            _resetModalOpen();
            document.body.removeChild(root);
            vi.unstubAllGlobals();
        };
    });

    it('clicking "Take me back" after first breadcrumb shows confirmation then navigation view', async () => {
        vi.useFakeTimers();
        startRecording(root);

        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 5 },
            timestamp: 1000,
        } as GeolocationPosition);

        await vi.advanceTimersByTimeAsync(50);

        const takeBackBtn = root.querySelector<HTMLButtonElement>('#btn-take-me-back');
        expect(takeBackBtn?.disabled).toBe(false);
        takeBackBtn?.click();

        await vi.advanceTimersByTimeAsync(50);

        // Confirm button should be disabled initially (1.5s delay)
        const confirmBtn = document.querySelector<HTMLButtonElement>('#btn-confirm-yes');
        expect(confirmBtn).not.toBeNull();
        expect(confirmBtn?.disabled).toBe(true);

        // Advance past the delay
        await vi.advanceTimersByTimeAsync(1500);
        expect(confirmBtn?.disabled).toBe(false);

        confirmBtn?.click();

        await vi.advanceTimersByTimeAsync(50);

        expect(root.querySelector('#nav-compass-arrow')).not.toBeNull();
        vi.useRealTimers();
    });
});

describe('switchToNavigationView – live navigation', () => {
    let root: HTMLElement;
    let watchPositionCallback: PositionCallback;

    beforeEach(async () => {
        await clearSession();
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);

        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: vi.fn((success: PositionCallback) => {
                    watchPositionCallback = success;
                    return 1;
                }),
                clearWatch: vi.fn(),
            },
        });
        vi.stubGlobal('isSecureContext', true);

        return () => {
            document.body.removeChild(root);
            vi.unstubAllGlobals();
        };
    });

    it('uses the last recorded point for immediate return guidance', async () => {
        // Seed two breadcrumbs into the session
        await appendBreadcrumb({ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 });
        await appendBreadcrumb({ lat: 51.501, lng: -0.1, accuracy: 5, timestamp: 2000 });

        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        const progressText = root.querySelector('#nav-progress-text');
        const distanceText = root.querySelector('#nav-distance-value');
        expect(progressText?.textContent).toMatch(/Breadcrumb 2 of 2/);
        expect(distanceText?.textContent).not.toBe('-- m');
    });

    it('updates distance display when GPS position received during navigation', async () => {
        await appendBreadcrumb({ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 });
        await appendBreadcrumb({ lat: 51.501, lng: -0.1, accuracy: 5, timestamp: 2000 });

        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Simulate a GPS update far from target
        watchPositionCallback({
            coords: { latitude: 51.495, longitude: -0.1, accuracy: 5 },
            timestamp: 3000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const distanceEl = root.querySelector('#nav-distance-value');
        // Should now show a real distance (not the initial "--")
        expect(distanceEl?.textContent).not.toBe('--');
        expect(distanceEl?.textContent).toMatch(/m|km/);
    });

    it('simulated return advances from the turnaround point and shows distance to the next target immediately', async () => {
        await appendBreadcrumb({ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 });
        await appendBreadcrumb({ lat: 51.5005, lng: -0.1, accuracy: 5, timestamp: 2000 });
        await appendBreadcrumb({ lat: 51.501, lng: -0.1, accuracy: 5, timestamp: 3000 });

        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        watchPositionCallback({
            coords: { latitude: 51.501, longitude: -0.1, accuracy: 5 },
            timestamp: 4000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const progressText = root.querySelector('#nav-progress-text');
        const distanceEl = root.querySelector('#nav-distance-value');
        expect(progressText?.textContent).toMatch(/Breadcrumb 2 of 3/);
        expect(distanceEl?.textContent).toMatch(/5[0-9] m/);
    });

    it('shows recovery guidance after sustained off-trail fixes', async () => {
        await appendBreadcrumb({ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 });
        await appendBreadcrumb({ lat: 51.501, lng: -0.1, accuracy: 5, timestamp: 2000 });
        await appendBreadcrumb({ lat: 51.502, lng: -0.1, accuracy: 5, timestamp: 3000 });

        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        const offTrailFix = {
            coords: { latitude: 51.501, longitude: -0.0985, accuracy: 5 },
            timestamp: 4000,
        } as GeolocationPosition;
        watchPositionCallback(offTrailFix);
        watchPositionCallback({ ...offTrailFix, timestamp: 5000 } as GeolocationPosition);
        watchPositionCallback({ ...offTrailFix, timestamp: 6000 } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const hint = root.querySelector<HTMLElement>('#nav-recovery-hint');
        expect(hint?.hidden).toBe(false);
        expect(hint?.textContent).toContain('Off trail');
    });

    it('rotates compass arrow when deviceorientation event fires', async () => {
        await appendBreadcrumb({ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 });
        await appendBreadcrumb({ lat: 51.501, lng: -0.1, accuracy: 5, timestamp: 2000 });

        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Provide GPS fix first
        watchPositionCallback({
            coords: { latitude: 51.495, longitude: -0.1, accuracy: 5 },
            timestamp: 3000,
        } as GeolocationPosition);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Fire compass heading (Android alpha = 0 → heading = 0)
        const event = new Event('deviceorientation') as DeviceOrientationEvent & {
            alpha: number;
        };
        Object.defineProperty(event, 'alpha', { value: 0, configurable: true });
        window.dispatchEvent(event);

        const arrow = root.querySelector<SVGElement>('#nav-compass-arrow');
        // Arrow style.transform should be set to a rotation
        expect(arrow?.style.transform).toMatch(/rotate\(/);
    });

    it('shows calibration hint when compass needs calibration', async () => {
        await appendBreadcrumb({ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 });

        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Fire iOS-style orientation event with negative webkitCompassAccuracy (needs calibration)
        const event = new Event('deviceorientation') as DeviceOrientationEvent & {
            webkitCompassHeading: number;
            webkitCompassAccuracy: number;
        };
        Object.defineProperty(event, 'webkitCompassHeading', { value: 90, configurable: true });
        Object.defineProperty(event, 'webkitCompassAccuracy', { value: -1, configurable: true });
        window.dispatchEvent(event);

        const hint = root.querySelector<HTMLElement>('#nav-calibration-hint');
        expect(hint?.hidden).toBe(false);
    });

    it('does not call speak on compass heading changes (no per-heading direction announcements)', async () => {
        await appendBreadcrumb({ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 });
        await appendBreadcrumb({ lat: 51.501, lng: -0.1, accuracy: 5, timestamp: 2000 });

        const speakSpy = vi.fn();
        vi.stubGlobal('speechSynthesis', {
            speak: speakSpy,
            cancel: vi.fn(),
            getVoices: () => [],
        });

        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Provide a GPS fix to set currentPos
        watchPositionCallback({
            coords: { latitude: 51.495, longitude: -0.1, accuracy: 5 },
            timestamp: 3000,
        } as GeolocationPosition);
        await new Promise(resolve => setTimeout(resolve, 50));

        speakSpy.mockClear();

        // Fire multiple compass heading changes
        for (let alpha = 0; alpha < 360; alpha += 45) {
            const event = new Event('deviceorientation') as DeviceOrientationEvent & {
                alpha: number;
            };
            Object.defineProperty(event, 'alpha', { value: alpha, configurable: true });
            window.dispatchEvent(event);
        }

        // No speech should have been triggered by heading changes alone
        expect(speakSpy).not.toHaveBeenCalled();

        vi.unstubAllGlobals();
    });

    it('shows a near-start message when the final breadcrumb arrival zone is reached', async () => {
        // One breadcrumb very close to user's incoming position
        await appendBreadcrumb({ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 });

        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        // GPS update at essentially the same position (within 15m threshold)
        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 5 },
            timestamp: 2000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const progressText = root.querySelector('#nav-progress-text');
        expect(progressText?.textContent).toContain('near your start point');
    });
});

describe('openSaveModal', () => {
    beforeEach(() => {
        // Ensure clean modal state
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        _resetModalOpen();
    });

    afterEach(() => {
        // Clean up any lingering modals
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        _resetModalOpen();
    });

    it('renders a modal dialog with a route name input', () => {
        openSaveModal([], 0);
        const backdrop = document.querySelector('.modal-backdrop');
        expect(backdrop).not.toBeNull();
        expect(backdrop?.getAttribute('role')).toBe('dialog');
        const input = document.querySelector<HTMLInputElement>('#save-route-name');
        expect(input).not.toBeNull();
    });

    it('renders Save route and Cancel buttons', () => {
        openSaveModal([], 0);
        const saveBtn = document.querySelector('#btn-save-confirm');
        const cancelBtn = document.querySelector('#btn-save-cancel');
        expect(saveBtn?.textContent?.trim()).toBe('Save route');
        expect(cancelBtn?.textContent?.trim()).toBe('Cancel');
    });

    it('closes modal when Cancel is clicked', () => {
        openSaveModal([], 0);
        const cancelBtn = document.querySelector<HTMLButtonElement>('#btn-save-cancel');
        cancelBtn?.click();
        expect(document.querySelector('.modal-backdrop')).toBeNull();
    });

    it('closes modal when backdrop (outside) is clicked', () => {
        openSaveModal([], 0);
        const backdrop = document.querySelector<HTMLElement>('.modal-backdrop');
        backdrop?.click();
        expect(document.querySelector('.modal-backdrop')).toBeNull();
    });

    it('does not close modal when inner modal panel is clicked', () => {
        openSaveModal([], 0);
        const modal = document.querySelector<HTMLElement>('.modal');
        modal?.click();
        expect(document.querySelector('.modal-backdrop')).not.toBeNull();
    });

    it('does not close or save when confirm clicked with empty name', () => {
        openSaveModal([], 0);
        const confirmBtn = document.querySelector<HTMLButtonElement>('#btn-save-confirm');
        confirmBtn?.click();
        // Modal should still be open
        expect(document.querySelector('.modal-backdrop')).not.toBeNull();
    });

    it('saves route and closes modal when confirm clicked with a name', async () => {
        const breadcrumbs = [
            { lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 },
            { lat: 51.501, lng: -0.1, accuracy: 5, timestamp: 2000 },
        ];
        openSaveModal(breadcrumbs, 111);

        const input = document.querySelector<HTMLInputElement>('#save-route-name');
        if (input) input.value = 'My test walk';

        const confirmBtn = document.querySelector<HTMLButtonElement>('#btn-save-confirm');
        confirmBtn?.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(document.querySelector('.modal-backdrop')).toBeNull();

        const routes = await listRoutes();
        const saved = routes.find(r => r.name === 'My test walk');
        expect(saved).toBeDefined();
        expect(saved?.breadcrumbCount).toBe(2);
        expect(saved?.distance).toBe(111);
    });

    it('calls onSaved callback after saving', async () => {
        const onSaved = vi.fn();
        openSaveModal([{ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 }], 50, onSaved);

        const input = document.querySelector<HTMLInputElement>('#save-route-name');
        if (input) input.value = 'Callback test';

        const confirmBtn = document.querySelector<HTMLButtonElement>('#btn-save-confirm');
        confirmBtn?.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(onSaved).toHaveBeenCalledOnce();
    });
});

describe('openSaveModal – keyboard and guard behaviour', () => {
    afterEach(() => {
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        _resetModalOpen();
    });

    it('disables confirm button during save', async () => {
        openSaveModal([{ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 }], 50);

        const input = document.querySelector<HTMLInputElement>('#save-route-name');
        if (input) input.value = 'Disable test';

        const confirmBtn = document.querySelector<HTMLButtonElement>('#btn-save-confirm');
        confirmBtn?.click();

        // Button should be disabled immediately after click
        expect(confirmBtn?.disabled).toBe(true);

        await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('blocks second openSaveModal call while one is open', () => {
        openSaveModal([], 0);
        openSaveModal([], 0);

        const backdrops = document.querySelectorAll('.modal-backdrop');
        expect(backdrops.length).toBe(1);
    });

    it('closes modal when Escape key is pressed', () => {
        openSaveModal([], 0);

        const event = new KeyboardEvent('keydown', { key: 'Escape' });
        document.dispatchEvent(event);

        expect(document.querySelector('.modal-backdrop')).toBeNull();
    });

    it('submits save modal when Enter is pressed with valid name', async () => {
        openSaveModal([{ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 }], 50);

        const input = document.querySelector<HTMLInputElement>('#save-route-name');
        if (input) input.value = 'Enter key test';

        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
        input?.dispatchEvent(enterEvent);

        await new Promise(resolve => setTimeout(resolve, 50));

        // Modal should close after successful save
        expect(document.querySelector('.modal-backdrop')).toBeNull();

        const routes = await listRoutes();
        expect(routes.some(r => r.name === 'Enter key test')).toBe(true);
    });

    it('does not submit save modal when Enter is pressed with empty name', () => {
        openSaveModal([], 0);

        const input = document.querySelector<HTMLInputElement>('#save-route-name');
        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
        input?.dispatchEvent(enterEvent);

        // Modal should still be open
        expect(document.querySelector('.modal-backdrop')).not.toBeNull();
    });
});

describe('"Save this route" button opens modal after first breadcrumb', () => {
    let root: HTMLElement;
    let watchPositionCallback: PositionCallback;

    beforeEach(() => {
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        mountAppShell(root);

        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: vi.fn((success: PositionCallback) => {
                    watchPositionCallback = success;
                    return 1;
                }),
                clearWatch: vi.fn(),
            },
        });
        vi.stubGlobal('isSecureContext', true);

        return () => {
            document.body.removeChild(root);
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            _resetModalOpen();
            vi.unstubAllGlobals();
        };
    });

    it('clicking "Save this route" after first breadcrumb opens the modal', async () => {
        startRecording(root);

        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 5 },
            timestamp: 1000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const saveBtn = root.querySelector<HTMLButtonElement>('#btn-save-route');
        expect(saveBtn?.disabled).toBe(false);
        saveBtn?.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        const modal = document.querySelector('.modal-backdrop');
        expect(modal).not.toBeNull();
    });
});

describe('formatRouteDate', () => {
    it('returns a non-empty string for a valid timestamp', () => {
        const result = formatRouteDate(Date.now());
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns a different string for different timestamps', () => {
        const a = formatRouteDate(new Date('2024-01-15').getTime());
        const b = formatRouteDate(new Date('2025-06-20').getTime());
        expect(a).not.toBe(b);
    });
});

describe('mountSavedRoutesView', () => {
    let root: HTMLElement;
    const onBack = vi.fn();

    beforeEach(async () => {
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);

        // Clean up any routes from prior tests using deleteRoute
        const existing = await listRoutes();
        for (const r of existing) {
            await deleteRoute(r.id);
        }

        onBack.mockClear();

        return () => {
            document.body.removeChild(root);
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            _resetModalOpen();
        };
    });

    it('renders without a header (compact layout)', () => {
        mountSavedRoutesView(root, onBack);
        const header = root.querySelector('header');
        expect(header).toBeNull();
    });

    it('renders a back button', () => {
        mountSavedRoutesView(root, onBack);
        const backBtn = root.querySelector('#btn-routes-back');
        expect(backBtn).not.toBeNull();
    });

    it('calls onBack when back button is clicked', () => {
        mountSavedRoutesView(root, onBack);
        const backBtn = root.querySelector<HTMLButtonElement>('#btn-routes-back');
        backBtn?.click();
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('shows empty state message when no routes exist', async () => {
        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));
        const container = root.querySelector('#routes-list-container');
        expect(container?.textContent).toContain('No saved routes yet');
    });

    it('renders a route card for each saved route', async () => {
        await saveRoute({
            id: 'test-route-1',
            name: 'Morning walk',
            date: Date.now(),
            distance: 1500,
            breadcrumbCount: 12,
            breadcrumbs: [],
        });
        await saveRoute({
            id: 'test-route-2',
            name: 'Evening jog',
            date: Date.now(),
            distance: 3000,
            breadcrumbCount: 25,
            breadcrumbs: [],
        });

        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));

        const cards = root.querySelectorAll('.route-card');
        expect(cards.length).toBe(2);
    });

    it('displays route name in the card', async () => {
        await saveRoute({
            id: 'test-route-name',
            name: 'My special route',
            date: Date.now(),
            distance: 500,
            breadcrumbCount: 5,
            breadcrumbs: [],
        });

        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));

        const nameEl = root.querySelector('.route-card__name');
        expect(nameEl?.textContent).toContain('My special route');
    });

    it('displays route distance in the card', async () => {
        await saveRoute({
            id: 'test-route-dist',
            name: 'Distance test route',
            date: Date.now(),
            distance: 2500,
            breadcrumbCount: 10,
            breadcrumbs: [],
        });

        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));

        const metaEl = root.querySelector('.route-card__meta');
        expect(metaEl?.textContent).toContain('2.50 km');
    });

    it('displays breadcrumb count in the card', async () => {
        await saveRoute({
            id: 'test-route-count',
            name: 'Count test route',
            date: Date.now(),
            distance: 100,
            breadcrumbCount: 7,
            breadcrumbs: [],
        });

        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));

        const metaEl = root.querySelector('.route-card__meta');
        expect(metaEl?.textContent).toContain('7 points');
    });

    it('uses singular "point" for a single breadcrumb', async () => {
        await saveRoute({
            id: 'test-route-singular',
            name: 'Singular test',
            date: Date.now(),
            distance: 0,
            breadcrumbCount: 1,
            breadcrumbs: [],
        });

        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));

        const metaEl = root.querySelector('.route-card__meta');
        expect(metaEl?.textContent).toContain('1 point');
        expect(metaEl?.textContent).not.toContain('1 points');
    });

    it('renders Follow and Delete buttons per route card', async () => {
        await saveRoute({
            id: 'test-route-btns',
            name: 'Button test route',
            date: Date.now(),
            distance: 200,
            breadcrumbCount: 3,
            breadcrumbs: [],
        });

        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));

        const followBtn = root.querySelector('[data-action="follow"]');
        const deleteBtn = root.querySelector('[data-action="delete"]');
        expect(followBtn).not.toBeNull();
        expect(deleteBtn).not.toBeNull();
    });

    it('opens delete confirmation dialog when Delete is clicked', async () => {
        await saveRoute({
            id: 'test-route-del-confirm',
            name: 'Delete me',
            date: Date.now(),
            distance: 100,
            breadcrumbCount: 2,
            breadcrumbs: [],
        });

        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));

        const deleteBtn = root.querySelector<HTMLButtonElement>('[data-action="delete"]');
        deleteBtn?.click();

        const dialog = document.querySelector('.modal-backdrop');
        expect(dialog).not.toBeNull();
        expect(dialog?.textContent).toContain('Delete route?');
    });

    it('cancels delete dialog without deleting when Cancel is clicked', async () => {
        await saveRoute({
            id: 'test-route-del-cancel',
            name: 'Keep me',
            date: Date.now(),
            distance: 100,
            breadcrumbCount: 2,
            breadcrumbs: [],
        });

        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));

        const deleteBtn = root.querySelector<HTMLButtonElement>('[data-action="delete"]');
        deleteBtn?.click();

        const cancelBtn = document.querySelector<HTMLButtonElement>('#btn-delete-cancel');
        cancelBtn?.click();

        expect(document.querySelector('.modal-backdrop')).toBeNull();

        const routes = await listRoutes();
        expect(routes.some(r => r.id === 'test-route-del-cancel')).toBe(true);
    });

    it('deletes route and refreshes list when Delete confirm is clicked', async () => {
        await saveRoute({
            id: 'test-route-del-execute',
            name: 'Delete for real',
            date: Date.now(),
            distance: 100,
            breadcrumbCount: 2,
            breadcrumbs: [],
        });

        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));

        const deleteBtn = root.querySelector<HTMLButtonElement>('[data-action="delete"]');
        deleteBtn?.click();

        const confirmBtn = document.querySelector<HTMLButtonElement>('#btn-delete-confirm');
        confirmBtn?.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        const routes = await listRoutes();
        expect(routes.some(r => r.id === 'test-route-del-execute')).toBe(false);
        // Dialog should be closed
        expect(document.querySelector('.modal-backdrop')).toBeNull();
    });
});

describe('App Shell has Saved routes button', () => {
    let root: HTMLElement;

    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
        mountAppShell(root);
        return () => {
            document.body.removeChild(root);
        };
    });

    it('renders the "Saved routes" button', () => {
        const btn = root.querySelector('#btn-view-routes');
        expect(btn).not.toBeNull();
    });

    it('"Saved routes" button has aria-label', () => {
        const btn = root.querySelector('#btn-view-routes');
        expect(btn?.getAttribute('aria-label')).toBeTruthy();
    });
});

describe('Accessibility controls bar', () => {
    let root: HTMLElement;
    const onBack = vi.fn();

    beforeEach(() => {
        localStorage.clear();
        document.documentElement.style.fontSize = '';
        document.documentElement.removeAttribute('data-theme');
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        return () => {
            document.body.removeChild(root);
        };
    });

    it('renders controls bar in mountAppShell', () => {
        mountAppShell(root);
        expect(root.querySelector('.a11y-controls')).not.toBeNull();
    });

    it('renders controls bar in mountNavigationView', () => {
        mountNavigationView(root);
        expect(root.querySelector('.a11y-controls')).not.toBeNull();
    });

    it('renders controls bar in mountSavedRoutesView', () => {
        mountSavedRoutesView(root, onBack);
        expect(root.querySelector('.a11y-controls')).not.toBeNull();
    });

    it('renders font size buttons', () => {
        mountAppShell(root);
        expect(root.querySelector('#btn-font-down')).not.toBeNull();
        expect(root.querySelector('#btn-font-up')).not.toBeNull();
    });

    it('renders theme toggle buttons', () => {
        mountAppShell(root);
        expect(root.querySelector('#btn-theme-light')).not.toBeNull();
        expect(root.querySelector('#btn-theme-dark')).not.toBeNull();
        expect(root.querySelector('#btn-theme-system')).not.toBeNull();
    });

    it('controls bar has toolbar role and aria-label', () => {
        mountAppShell(root);
        const bar = root.querySelector('.a11y-controls');
        expect(bar?.getAttribute('role')).toBe('toolbar');
        expect(bar?.getAttribute('aria-label')).toBeTruthy();
    });

    it('font down is disabled at minimum size', () => {
        setFontSize(FONT_SIZES[0]);
        mountAppShell(root);
        const btn = root.querySelector<HTMLButtonElement>('#btn-font-down');
        expect(btn?.disabled).toBe(true);
    });

    it('font up is disabled at maximum size', () => {
        setFontSize(FONT_SIZES[FONT_SIZES.length - 1]);
        mountAppShell(root);
        const btn = root.querySelector<HTMLButtonElement>('#btn-font-up');
        expect(btn?.disabled).toBe(true);
    });

    it('re-renders the recording layout when simple mode is toggled', () => {
        localStorage.setItem('breadcrumbs:simpleMode', 'true');
        initSettings();
        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: vi.fn(() => 1),
                clearWatch: vi.fn(),
            },
        });
        vi.stubGlobal('isSecureContext', true);

        mountAppShell(root);
        expect(root.querySelector('.simple-recording-main')).not.toBeNull();

        root.querySelector<HTMLButtonElement>('#btn-simple-mode')?.click();

        expect(root.querySelector('.simple-recording-main')).toBeNull();
        expect(root.querySelector('.recording-main')).not.toBeNull();
        expect(navigator.geolocation.watchPosition).toHaveBeenCalled();
    });
});

describe('createOffCourseDetector – sustained off-course detection', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns false when bearing delta is within threshold (on course)', () => {
        const detector = createOffCourseDetector();
        // 30° delta — within 60° threshold
        expect(detector.check(30)).toBe(false);
        expect(detector.check(-30)).toBe(false);
        expect(detector.check(0)).toBe(false);
    });

    it('returns false when bearing delta exactly equals threshold', () => {
        const detector = createOffCourseDetector();
        // 60° is NOT over the threshold (threshold is strictly > 60)
        expect(detector.check(60)).toBe(false);
        expect(detector.check(-60)).toBe(false);
    });

    it('does not fire on the first off-course fix', () => {
        const detector = createOffCourseDetector();
        // 90° delta — over threshold, but only 1 fix
        expect(detector.check(90)).toBe(false);
    });

    it('does not fire on second consecutive off-course fix', () => {
        const detector = createOffCourseDetector();
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(false);
    });

    it('fires on the 3rd consecutive off-course fix', () => {
        const detector = createOffCourseDetector();
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(true); // 3rd fix triggers
    });

    it('fires when off-course for 3+ seconds even with fewer than 3 fixes', () => {
        const detector = createOffCourseDetector();
        vi.setSystemTime(0);
        expect(detector.check(90)).toBe(false); // fix 1 at t=0
        vi.setSystemTime(3100); // 3.1 seconds later
        expect(detector.check(90)).toBe(true); // fix 2, but 3s elapsed
    });

    it('resets after firing so it can trigger again', () => {
        const detector = createOffCourseDetector();
        // Trigger first warning
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(true);
        // Should not fire again immediately (counter reset)
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(true); // fires again after 3 more fixes
    });

    it('resets consecutive count when back on course', () => {
        const detector = createOffCourseDetector();
        expect(detector.check(90)).toBe(false); // fix 1 off-course
        expect(detector.check(90)).toBe(false); // fix 2 off-course
        expect(detector.check(10)).toBe(false); // back on course — resets
        expect(detector.check(90)).toBe(false); // fix 1 again (fresh start)
        expect(detector.check(90)).toBe(false); // fix 2
        expect(detector.check(90)).toBe(true); // fix 3 triggers
    });

    it('reset() clears state so detection restarts fresh', () => {
        const detector = createOffCourseDetector();
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(false);
        detector.reset(); // externally reset (e.g. breadcrumb advanced)
        // After reset, need 3 more fixes to trigger
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(true);
    });

    it('handles negative off-course bearing deltas', () => {
        const detector = createOffCourseDetector();
        // -90° is off course (turn left)
        expect(detector.check(-90)).toBe(false);
        expect(detector.check(-90)).toBe(false);
        expect(detector.check(-90)).toBe(true);
    });

    it('handles 180° (wrong way) bearing delta', () => {
        const detector = createOffCourseDetector();
        expect(detector.check(180)).toBe(false);
        expect(detector.check(180)).toBe(false);
        expect(detector.check(180)).toBe(true);
    });

    it('uses custom minFixes parameter', () => {
        const detector = createOffCourseDetector(5, 10000); // 5 fixes required
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(false);
        expect(detector.check(90)).toBe(true); // 5th fix fires
    });

    it('uses custom deltaThreshold parameter', () => {
        const detector = createOffCourseDetector(3, 3000, 45); // 45° threshold
        // 50° should be off-course with threshold=45
        expect(detector.check(50)).toBe(false);
        expect(detector.check(50)).toBe(false);
        expect(detector.check(50)).toBe(true);
    });
});

describe('majorTurnDirection', () => {
    // Helper: create a Breadcrumb at given lat/lng
    function bc(
        lat: number,
        lng: number
    ): { lat: number; lng: number; accuracy: number; timestamp: number } {
        return { lat, lng, accuracy: 5, timestamp: 0 };
    }

    it('returns null when the new leg is straight ahead (< 90° turn)', () => {
        // Walking north, new leg also north — no turn
        const fromPos = bc(51.5, -0.1);
        const prevTarget = bc(51.501, -0.1); // north of fromPos
        const newTarget = bc(51.502, -0.1); // north of prevTarget
        expect(majorTurnDirection(fromPos, prevTarget, newTarget)).toBeNull();
    });

    it('returns "turn right" when new leg is clearly right (SE) of previous north leg', () => {
        // Walking north, then turning south-east (> 90° right)
        const fromPos = bc(51.5, -0.1);
        const prevTarget = bc(51.501, -0.1); // due north (~0°)
        const newTarget = bc(51.5, -0.08); // SE from prevTarget: south and east (~135°)
        const result = majorTurnDirection(fromPos, prevTarget, newTarget);
        expect(result).toBe('turn right');
    });

    it('returns "turn left" when new leg is clearly left (SW) of previous north leg', () => {
        // Walking north, then turning south-west (> 90° left)
        const fromPos = bc(51.5, -0.1);
        const prevTarget = bc(51.501, -0.1); // due north (~0°)
        const newTarget = bc(51.5, -0.12); // SW from prevTarget: south and west (~225° = -135°)
        const result = majorTurnDirection(fromPos, prevTarget, newTarget);
        expect(result).toBe('turn left');
    });

    it('returns null for a 45° right turn (less than 90°)', () => {
        // Walking north then slight diagonal NE — 45° is not a major turn
        const fromPos = bc(51.5, -0.1);
        const prevTarget = bc(51.501, -0.1);
        // ~45° NE: equal lat and lng change
        const newTarget = bc(51.5017, -0.0895);
        const result = majorTurnDirection(fromPos, prevTarget, newTarget);
        expect(result).toBeNull();
    });

    it('returns "turn right" for a U-turn to the right (180°)', () => {
        // Walking north, then doubling back south — massive right or left turn
        const fromPos = bc(51.5, -0.1);
        const prevTarget = bc(51.501, -0.1);
        // New target is directly south of prevTarget
        const newTarget = bc(51.5, -0.1); // back where we came from
        const result = majorTurnDirection(fromPos, prevTarget, newTarget);
        // 180° u-turn: delta normalises to ±180, which is > 90 or < -90
        expect(result === 'turn right' || result === 'turn left').toBe(true);
    });

    it('returns null for a roughly 45° right diagonal (not a major turn)', () => {
        // Walking north, then turning NE (~45° right) — not a major turn
        const fromPos = bc(51.5, -0.1);
        const prevTarget = bc(51.501, -0.1); // due north
        const newTarget = bc(51.5017, -0.0895); // NE: roughly equal lat/lng change → ~45° turn
        expect(majorTurnDirection(fromPos, prevTarget, newTarget)).toBeNull();
    });

    it('returns "turn right" for a south-east turn (>90° right)', () => {
        // Walking north, then abruptly turning south-east
        const fromPos = bc(51.5, -0.1);
        const prevTarget = bc(51.502, -0.1); // north
        const newTarget = bc(51.499, -0.07); // south-east of prevTarget → big right turn
        expect(majorTurnDirection(fromPos, prevTarget, newTarget)).toBe('turn right');
    });
});

describe('updateStationaryBadge', () => {
    let root: HTMLElement;

    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
        mountAppShell(root);
        return () => {
            document.body.removeChild(root);
        };
    });

    it('stationary badge is rendered in the app shell', () => {
        const badge = root.querySelector('#stationary-badge');
        expect(badge).not.toBeNull();
    });

    it('stationary badge is hidden by default', () => {
        const badge = root.querySelector<HTMLElement>('#stationary-badge');
        expect(badge?.hidden).toBe(true);
    });

    it('shows the badge when isStationary is true', () => {
        updateStationaryBadge(root, true);
        const badge = root.querySelector<HTMLElement>('#stationary-badge');
        expect(badge?.hidden).toBe(false);
    });

    it('hides the badge when isStationary is false', () => {
        // First show it
        updateStationaryBadge(root, true);
        // Then hide it
        updateStationaryBadge(root, false);
        const badge = root.querySelector<HTMLElement>('#stationary-badge');
        expect(badge?.hidden).toBe(true);
    });

    it('badge contains "Stationary" text', () => {
        const badge = root.querySelector<HTMLElement>('#stationary-badge');
        expect(badge?.textContent?.trim()).toContain('Stationary');
    });

    it('badge has aria-live attribute for accessibility', () => {
        const badge = root.querySelector<HTMLElement>('#stationary-badge');
        expect(badge?.getAttribute('aria-live')).toBe('polite');
    });

    it('does nothing when badge element is absent', () => {
        const emptyRoot = document.createElement('div');
        // Should not throw even if #stationary-badge is not in DOM
        expect(() => updateStationaryBadge(emptyRoot, true)).not.toThrow();
    });

    it('shows "Paused" text and suspended class when isSuspended is true', () => {
        updateStationaryBadge(root, true, true);
        const badge = root.querySelector<HTMLElement>('#stationary-badge');
        expect(badge?.hidden).toBe(false);
        expect(badge?.textContent).toContain('Paused');
        expect(badge?.classList.contains('stationary-badge--suspended')).toBe(true);
    });

    it('removes suspended class when isSuspended is false', () => {
        updateStationaryBadge(root, true, true);
        updateStationaryBadge(root, true, false);
        const badge = root.querySelector<HTMLElement>('#stationary-badge');
        expect(badge?.textContent).toContain('Stationary');
        expect(badge?.classList.contains('stationary-badge--suspended')).toBe(false);
    });
});

describe('App Shell has Mark landmark button', () => {
    let root: HTMLElement;

    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
        mountAppShell(root);
        return () => {
            document.body.removeChild(root);
        };
    });

    it('renders the "Mark landmark" button', () => {
        const btn = root.querySelector('#btn-mark-landmark');
        expect(btn).not.toBeNull();
        expect(btn?.textContent?.trim()).toBe('Landmark');
    });

    it('"Mark landmark" button is disabled by default', () => {
        const btn = root.querySelector<HTMLButtonElement>('#btn-mark-landmark');
        expect(btn?.disabled).toBe(true);
    });

    it('"Mark landmark" button has aria-label', () => {
        const btn = root.querySelector('#btn-mark-landmark');
        expect(btn?.getAttribute('aria-label')).toBeTruthy();
    });
});

describe('openLandmarkPicker', () => {
    afterEach(() => {
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        _resetModalOpen();
    });

    it('renders a landmark picker modal with preset buttons', () => {
        openLandmarkPicker(vi.fn());
        const backdrop = document.querySelector('.modal-backdrop');
        expect(backdrop).not.toBeNull();
        const presets = backdrop?.querySelectorAll('.landmark-btn');
        expect(presets?.length).toBe(6);
    });

    it('calls onSelect with the preset label when clicked', () => {
        const onSelect = vi.fn();
        openLandmarkPicker(onSelect);
        const gateBtn = document.querySelector<HTMLButtonElement>(
            '.landmark-btn[data-label="Gate"]'
        );
        gateBtn?.click();
        expect(onSelect).toHaveBeenCalledWith('Gate');
    });

    it('calls onSelect with custom text when OK is clicked', () => {
        const onSelect = vi.fn();
        openLandmarkPicker(onSelect);
        const input = document.querySelector<HTMLInputElement>('#landmark-custom-input');
        if (input) input.value = 'The big tree';
        const okBtn = document.querySelector<HTMLButtonElement>('#btn-landmark-custom-confirm');
        okBtn?.click();
        expect(onSelect).toHaveBeenCalledWith('The big tree');
    });

    it('closes modal when Cancel is clicked', () => {
        openLandmarkPicker(vi.fn());
        const cancelBtn = document.querySelector<HTMLButtonElement>('#btn-landmark-cancel');
        cancelBtn?.click();
        expect(document.querySelector('.modal-backdrop')).toBeNull();
    });

    it('closes modal when Escape is pressed', () => {
        openLandmarkPicker(vi.fn());
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.querySelector('.modal-backdrop')).toBeNull();
    });

    it('closes modal when backdrop is clicked', () => {
        openLandmarkPicker(vi.fn());
        const backdrop = document.querySelector<HTMLElement>('.modal-backdrop');
        backdrop?.click();
        expect(document.querySelector('.modal-backdrop')).toBeNull();
    });

    it('does not call onSelect with empty custom text', () => {
        const onSelect = vi.fn();
        openLandmarkPicker(onSelect);
        const okBtn = document.querySelector<HTMLButtonElement>('#btn-landmark-custom-confirm');
        okBtn?.click();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('blocks second picker while one is open', () => {
        openLandmarkPicker(vi.fn());
        openLandmarkPicker(vi.fn());
        const backdrops = document.querySelectorAll('.modal-backdrop');
        expect(backdrops.length).toBe(1);
    });
});

describe('Route card landmark count', () => {
    let root: HTMLElement;
    const onBack = vi.fn();

    beforeEach(async () => {
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        const existing = await listRoutes();
        for (const r of existing) {
            await deleteRoute(r.id);
        }
        return () => {
            document.body.removeChild(root);
        };
    });

    it('shows landmark count when route has landmarks', async () => {
        await saveRoute({
            id: 'landmark-route',
            name: 'Landmark walk',
            date: Date.now(),
            distance: 500,
            breadcrumbCount: 5,
            breadcrumbs: [
                { lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000, label: 'Gate' },
                { lat: 51.501, lng: -0.1, accuracy: 5, timestamp: 2000 },
                { lat: 51.502, lng: -0.1, accuracy: 5, timestamp: 3000, label: 'Bench' },
            ],
            landmarkCount: 2,
        });

        mountSavedRoutesView(root, onBack);
        await new Promise(resolve => setTimeout(resolve, 50));

        const meta = root.querySelector('.route-card__meta');
        expect(meta?.textContent).toContain('2 landmarks');
    });
});

describe('shortestArcDistance', () => {
    it('returns 0 for identical angles', () => {
        expect(shortestArcDistance(90, 90)).toBe(0);
    });

    it('returns correct distance for small differences', () => {
        expect(shortestArcDistance(10, 13)).toBe(3);
    });

    it('returns correct distance across 360/0 boundary', () => {
        expect(shortestArcDistance(350, 10)).toBe(20);
    });

    it('returns correct distance in reverse direction across boundary', () => {
        expect(shortestArcDistance(10, 350)).toBe(20);
    });

    it('returns 180 for opposite angles', () => {
        expect(shortestArcDistance(0, 180)).toBe(180);
    });

    it('filters sub-threshold changes (deadzone use case)', () => {
        // 3° change should be below 4° deadzone
        expect(shortestArcDistance(100, 103)).toBeLessThan(4);
        // 5° change should exceed 4° deadzone
        expect(shortestArcDistance(100, 105)).toBeGreaterThanOrEqual(4);
    });
});

describe('lerpAngle', () => {
    it('returns start angle when t=0', () => {
        expect(lerpAngle(90, 180, 0)).toBe(90);
    });

    it('returns end angle when t=1', () => {
        expect(lerpAngle(90, 180, 1)).toBe(180);
    });

    it('returns midpoint when t=0.5', () => {
        expect(lerpAngle(0, 90, 0.5)).toBe(45);
    });

    it('interpolates correctly across 360/0 boundary', () => {
        // From 350 to 10 (shortest arc is +20°), t=0.5 -> 0°
        expect(lerpAngle(350, 10, 0.5)).toBe(0);
    });

    it('converges toward target over repeated calls', () => {
        let displayed = 0;
        const target = 90;
        for (let i = 0; i < 20; i++) {
            displayed = lerpAngle(displayed, target, 0.3);
        }
        // After 20 iterations of 30% LERP, should be very close to target
        expect(Math.abs(displayed - target)).toBeLessThan(1);
    });

    it('takes shortest arc (does not go the long way around)', () => {
        // From 10 to 350 — shortest arc is -20°, not +340°
        const result = lerpAngle(10, 350, 0.5);
        expect(result).toBe(0);
    });
});
