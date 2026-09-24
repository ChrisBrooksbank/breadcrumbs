import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { switchToNavigationView, _resetModalOpen } from './main';
import type { Breadcrumb } from './types';

const START = { lat: 51.5, lng: -0.1 };
const METERS_PER_DEG_LAT = 111_319.5;
const METERS_PER_DEG_LNG = METERS_PER_DEG_LAT * Math.cos((START.lat * Math.PI) / 180);

const wait = (ms = 30): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** A follow-mode trail running due north from START, a crumb every 10 m for 200 m. */
const northboundTrail: Breadcrumb[] = Array.from({ length: 21 }, (_, i) => ({
    lat: START.lat + (i * 10) / METERS_PER_DEG_LAT,
    lng: START.lng,
    accuracy: 5,
    timestamp: 1000 + i,
}));

/**
 * Real-world heading behaviour on the navigation screen: while walking the arrow follows
 * the GPS course, and unreliable compasses are called out.
 */
describe('navigation heading', () => {
    let root: HTMLElement;
    let onPosition: PositionCallback;
    let eastMeters = 0;

    /** Advance the clock 1 s and deliver a fix that has moved `stepEast` m east. */
    function walkEast(stepEast = 1.4): void {
        vi.setSystemTime(Date.now() + 1000);
        eastMeters += stepEast;
        onPosition({
            coords: {
                latitude: START.lat,
                longitude: START.lng + eastMeters / METERS_PER_DEG_LNG,
                accuracy: 5,
            } as GeolocationCoordinates,
            timestamp: Date.now(),
        } as GeolocationPosition);
    }

    function compass(alpha: number, extra: Record<string, unknown> = {}): void {
        vi.setSystemTime(Date.now() + 200); // clear the compass callback rate limit
        window.dispatchEvent(
            Object.assign(new Event('deviceorientation'), { alpha, beta: 0, gamma: 0, ...extra })
        );
    }

    function arrowDegrees(): number {
        const transform = root.querySelector<SVGElement>('#nav-compass-arrow')?.style.transform;
        return Number(/rotate\((-?[\d.]+)deg\)/.exec(transform ?? '')?.[1]);
    }

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(1_700_000_000_000);
        _resetModalOpen();
        eastMeters = 0;
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
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
        switchToNavigationView(root, northboundTrail);
        await wait();
    });

    afterEach(() => {
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        document.body.removeChild(root);
        _resetModalOpen();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('points the arrow using the GPS course when the compass disagrees while walking', async () => {
        // Compass says the phone faces north (0), but the walker is really heading east.
        compass(0);
        for (let i = 0; i < 12; i++) {
            walkEast();
            compass(0);
        }
        await wait();

        // Walking east with the trail to the north-west: the arrow should point up-left (~240).
        // Trusting the misleading north compass would give ~330 (nearly straight ahead).
        const degrees = arrowDegrees();
        expect(degrees).toBeGreaterThan(215);
        expect(degrees).toBeLessThan(265);
    });

    it('does not say it is waiting for direction when the compass legitimately reads 0', async () => {
        compass(0); // heading 0 = facing north; falsy but valid
        walkEast(0.2);
        await wait();

        const hint = root.querySelector<HTMLElement>('#nav-recovery-hint');
        expect(hint?.textContent ?? '').not.toContain('Waiting for direction');
    });

    it('warns that the compass is unreliable when it keeps swinging while GPS is steady', async () => {
        // The compass keeps rotating (as near a magnet) while the walker heads steadily east
        for (let i = 0; i < 24; i++) {
            walkEast();
            compass(360 - ((i * 20) % 360));
        }
        await wait();

        const hint = root.querySelector<HTMLElement>('#nav-calibration-hint');
        expect(hint?.hidden).toBe(false);
        expect(hint?.textContent).toContain('unreliable');
    });

    it('does not warn when the compass agrees with the walking direction', async () => {
        // Walking east: compass heading 90 means alpha 270
        for (let i = 0; i < 8; i++) {
            walkEast();
            compass(270);
        }
        await wait();

        expect(root.querySelector<HTMLElement>('#nav-calibration-hint')?.hidden).toBe(true);
    });

    it('asks the user to walk a few steps when the compass is only relative', async () => {
        compass(90, { absolute: false });
        await wait();

        const hint = root.querySelector<HTMLElement>('#nav-calibration-hint');
        expect(hint?.hidden).toBe(false);
        expect(hint?.textContent).toContain('Walk a few steps');
    });

    it('stops asking once walking has taught the app a relative compass offset', async () => {
        // A relative compass that reads 40 degrees off the true walking direction
        for (let i = 0; i < 8; i++) {
            walkEast();
            compass(230, { absolute: false }); // heading 130 while really walking east (90)
        }
        await wait();

        expect(root.querySelector<HTMLElement>('#nav-calibration-hint')?.hidden).toBe(true);
    });
});
