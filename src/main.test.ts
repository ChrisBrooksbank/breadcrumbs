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
    mountSavedRoutesView,
    _resetModalOpen,
} from './main';
import { clearSession, appendBreadcrumb, listRoutes, saveRoute, deleteRoute } from './storage';
import { setFontSize, FONT_SIZES } from './settings';

describe('App Shell', () => {
    let root: HTMLElement;

    beforeEach(() => {
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        mountAppShell(root);
        return () => {
            document.body.removeChild(root);
        };
    });

    it('renders a header with the app title', () => {
        const header = root.querySelector('header');
        expect(header).not.toBeNull();
        expect(header?.querySelector('h1')?.textContent).toBe('Breadcrumbs');
    });

    it('renders the recording status card', () => {
        const card = root.querySelector('#recording-status-card');
        expect(card).not.toBeNull();
        expect(card?.querySelector('h2')?.textContent).toBe('Recording Status');
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

    it('renders "Save this route" button', () => {
        const btn = root.querySelector('#btn-save-route') as HTMLButtonElement | null;
        expect(btn).not.toBeNull();
        expect(btn?.textContent?.trim()).toBe('Save this route');
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

    it('renders a footer', () => {
        const footer = root.querySelector('footer');
        expect(footer).not.toBeNull();
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

    beforeEach(() => {
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
        expect(statusText?.textContent).toContain('Location access denied');
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
        expect(statusText?.textContent).toContain('Location unavailable');
    });

    it('shows generic error message on TIMEOUT', () => {
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
        expect(statusText?.textContent).toContain('Location error');
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

    it('renders a header with the app title', () => {
        const header = root.querySelector('header');
        expect(header).not.toBeNull();
        expect(header?.querySelector('h1')?.textContent).toBe('Breadcrumbs');
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
});

describe('switchToNavigationView', () => {
    let root: HTMLElement;

    beforeEach(async () => {
        await clearSession();
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        return () => {
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
        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: vi.fn(() => 1),
                clearWatch: vi.fn(),
            },
        });
        vi.stubGlobal('isSecureContext', true);

        const stopBtn = root.querySelector<HTMLButtonElement>('#btn-stop-navigation');
        stopBtn?.click();

        expect(root.querySelector('#btn-take-me-back')).not.toBeNull();
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
            document.body.removeChild(root);
            vi.unstubAllGlobals();
        };
    });

    it('clicking "Take me back" after first breadcrumb shows navigation view', async () => {
        startRecording(root);

        watchPositionCallback({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 5 },
            timestamp: 1000,
        } as GeolocationPosition);

        await new Promise(resolve => setTimeout(resolve, 50));

        const takeBackBtn = root.querySelector<HTMLButtonElement>('#btn-take-me-back');
        expect(takeBackBtn?.disabled).toBe(false);
        takeBackBtn?.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(root.querySelector('#nav-compass-arrow')).not.toBeNull();
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

    it('shows progress "Breadcrumb 1 of N" when session has breadcrumbs', async () => {
        // Seed two breadcrumbs into the session
        await appendBreadcrumb({ lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 });
        await appendBreadcrumb({ lat: 51.501, lng: -0.1, accuracy: 5, timestamp: 2000 });

        mountAppShell(root);
        switchToNavigationView(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        const progressText = root.querySelector('#nav-progress-text');
        expect(progressText?.textContent).toMatch(/Breadcrumb 1 of 2/);
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

    it('shows "You\'ve arrived!" when last breadcrumb is reached', async () => {
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
        expect(progressText?.textContent).toContain('arrived');
    });
});

describe('openSaveModal', () => {
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

    it('renders a header with the app title', () => {
        mountSavedRoutesView(root, onBack);
        const h1 = root.querySelector('header h1');
        expect(h1?.textContent).toBe('Breadcrumbs');
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
});
