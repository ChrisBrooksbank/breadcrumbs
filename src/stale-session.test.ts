import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountAppShell, startRecording, formatAge, _resetModalOpen } from './main';
import { appendBreadcrumb, clearSession, getSession } from './storage';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const wait = (ms = 50): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/*
 * Real-world scenario: the app auto-records on open, so a session from hours or days ago
 * (or from another city) used to be silently continued, and "Take me back" would lead to
 * that old start. Old unsaved routes now ask first.
 */
describe('stale session on open', () => {
    let root: HTMLElement;
    let onPosition: PositionCallback;

    function sendFix(lat: number, lng: number): void {
        onPosition({
            coords: { latitude: lat, longitude: lng, accuracy: 5 } as GeolocationCoordinates,
            timestamp: Date.now(),
        } as GeolocationPosition);
    }

    function dialog(): HTMLElement | null {
        return document.querySelector<HTMLElement>('.modal-backdrop');
    }

    async function seedOldRoute(ageMs: number): Promise<void> {
        await appendBreadcrumb({ lat: 40, lng: -74, accuracy: 5, timestamp: Date.now() - ageMs });
    }

    beforeEach(async () => {
        await clearSession();
        _resetModalOpen();
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        mountAppShell(root);
        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: vi.fn((success: PositionCallback) => {
                    onPosition = success;
                    return 1;
                }),
                clearWatch: vi.fn(),
            },
        });
        vi.stubGlobal('isSecureContext', true);
    });

    afterEach(async () => {
        dialog()?.remove();
        _resetModalOpen();
        await clearSession();
        document.body.removeChild(root);
        vi.unstubAllGlobals();
    });

    it('asks before continuing a two-day-old session and does not silently restore it', async () => {
        await seedOldRoute(2 * DAY_MS);

        startRecording(root);
        await wait();

        expect(dialog()?.textContent).toContain('Old route found');
        expect(dialog()?.textContent).toContain('2 days ago');
        expect(root.querySelector('#route-quality')?.textContent).not.toContain(
            'Continuing your previous route'
        );
        expect(root.querySelector<HTMLButtonElement>('#btn-take-me-back')?.disabled).toBe(true);
    });

    it('"Start new route" clears the old session and begins a fresh one', async () => {
        await seedOldRoute(2 * DAY_MS);
        startRecording(root);
        await wait();

        dialog()?.querySelector<HTMLButtonElement>('#btn-confirm-yes')?.click();
        await wait();
        sendFix(51.5, -0.1);
        await wait();

        const session = await getSession();
        expect(session?.breadcrumbs).toHaveLength(1);
        expect(session?.breadcrumbs[0].lat).toBe(51.5);
        expect(root.querySelector('#route-quality')?.textContent).not.toContain('Continuing');
    });

    it('"Keep old route" continues the old session', async () => {
        await seedOldRoute(3 * HOUR_MS);
        startRecording(root);
        await wait();

        dialog()?.querySelector<HTMLButtonElement>('#btn-confirm-cancel')?.click();
        await wait();

        expect(root.querySelector('#route-quality')?.textContent).toContain(
            'Continuing your previous route'
        );
        expect(root.querySelector<HTMLButtonElement>('#btn-take-me-back')?.disabled).toBe(false);

        sendFix(40.001, -74);
        await wait();
        expect((await getSession())?.breadcrumbs).toHaveLength(2);
    });

    it('dismissing the dialog (Escape) keeps the old route rather than deleting it', async () => {
        await seedOldRoute(3 * HOUR_MS);
        startRecording(root);
        await wait();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await wait();

        expect(dialog()).toBeNull();
        expect((await getSession())?.breadcrumbs).toHaveLength(1);
        expect(root.querySelector('#route-quality')?.textContent).toContain('Continuing');
    });

    it('does not persist new fixes until the choice is made', async () => {
        await seedOldRoute(2 * DAY_MS);
        startRecording(root);
        await wait();

        sendFix(51.5, -0.1);
        await wait();
        expect((await getSession())?.breadcrumbs).toHaveLength(1); // still just the old crumb
        expect((await getSession())?.breadcrumbs[0].lat).toBe(40);

        dialog()?.querySelector<HTMLButtonElement>('#btn-confirm-yes')?.click();
        await wait();
        const session = await getSession();
        expect(session?.breadcrumbs).toHaveLength(1);
        expect(session?.breadcrumbs[0].lat).toBe(51.5);
    });

    it('continues a recent session without asking', async () => {
        await seedOldRoute(30 * MINUTE_MS);
        startRecording(root);
        await wait();

        expect(dialog()).toBeNull();
        expect(root.querySelector('#route-quality')?.textContent).toContain(
            'Continuing your previous route'
        );
    });
});

describe('formatAge', () => {
    it('describes minutes, hours and days', () => {
        expect(formatAge(20 * MINUTE_MS)).toBe('20 minutes ago');
        expect(formatAge(HOUR_MS + MINUTE_MS)).toBe('1 hour ago');
        expect(formatAge(5 * HOUR_MS)).toBe('5 hours ago');
        expect(formatAge(3 * DAY_MS)).toBe('3 days ago');
    });
});
