import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountAppShell, startRecording } from './main';
import { appendBreadcrumb, clearSession } from './storage';

const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * Real-world scenario: the app auto-records on open, so a session from days ago (or from
 * a different city) is silently continued and "Take me back" would lead to that old start.
 *
 * `it.fails` marks a KNOWN BUG: it passes while the bug exists and starts failing once fixed,
 * at which point change it to `it`.
 */
describe('stale session on open', () => {
    let root: HTMLElement;

    beforeEach(async () => {
        await clearSession();
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        mountAppShell(root);
        vi.stubGlobal('navigator', {
            geolocation: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
        });
        vi.stubGlobal('isSecureContext', true);
    });

    afterEach(async () => {
        await clearSession();
        document.body.removeChild(root);
        vi.unstubAllGlobals();
    });

    // Phase 11: needs an explicit session lifecycle (Start walk / stale-session prompt).
    it.fails('[Phase 11] does not silently continue a two-day-old session', async () => {
        await appendBreadcrumb({
            lat: 51.5,
            lng: -0.1,
            accuracy: 5,
            timestamp: Date.now() - 2 * DAY_MS,
        });

        startRecording(root);
        await new Promise(resolve => setTimeout(resolve, 50));

        const message = root.querySelector('#route-quality');
        expect(message?.textContent).not.toContain('Continuing your previous route');
    });
});
