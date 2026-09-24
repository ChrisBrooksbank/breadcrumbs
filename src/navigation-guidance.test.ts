import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { switchToNavigationView, _resetModalOpen } from './main';
import { getSimpleMode, toggleSimpleMode } from './settings';
import { appendBreadcrumb, clearSession, getSession, listRoutes, deleteRoute } from './storage';
import type { Breadcrumb } from './types';

const ORIGIN = { lat: 51.5, lng: -0.1 };
const M_PER_DEG_LAT = 111_195;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** Put the app in the requested simple/full mode. */
function setSimpleMode(enabled: boolean): void {
    if (getSimpleMode() !== enabled) toggleSimpleMode();
}

const wait = (ms = 30): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** A crumb x m east and y m north of the origin. */
function at(x: number, y: number, extra: Partial<Breadcrumb> = {}): Breadcrumb {
    return {
        lat: ORIGIN.lat + y / M_PER_DEG_LAT,
        lng: ORIGIN.lng + x / M_PER_DEG_LNG,
        accuracy: 5,
        timestamp: 1000,
        ...extra,
    };
}

/** Crumbs every 10 m along a straight line. */
function line(x0: number, y0: number, x1: number, y1: number): Breadcrumb[] {
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 10));
    return Array.from({ length: steps + 1 }, (_, i) =>
        at(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps)
    );
}

describe('navigation guidance on screen', () => {
    let root: HTMLElement;
    let onPosition: PositionCallback;
    let clock = 10_000;

    function fixAt(x: number, y: number, accuracy = 5): void {
        clock += 1000;
        const p = at(x, y);
        onPosition({
            coords: {
                latitude: p.lat,
                longitude: p.lng,
                accuracy,
            } as GeolocationCoordinates,
            timestamp: clock,
        } as GeolocationPosition);
    }

    const text = (selector: string): string =>
        root.querySelector<HTMLElement>(selector)?.textContent?.trim() ?? '';
    const hidden = (selector: string): boolean | undefined =>
        root.querySelector<HTMLElement>(selector)?.hidden;

    /**
     * Retrace (follow = false) walks back through the recorded session in storage; follow
     * mode is given the saved route directly.
     */
    async function start(trail: Breadcrumb[], follow = false): Promise<void> {
        if (follow) {
            switchToNavigationView(root, trail);
        } else {
            await clearSession();
            for (const crumb of trail) await appendBreadcrumb(crumb);
            switchToNavigationView(root);
        }
        await wait();
    }

    beforeEach(() => {
        setSimpleMode(false);
        _resetModalOpen();
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
    });

    afterEach(() => {
        setSimpleMode(false);
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        document.body.removeChild(root);
        _resetModalOpen();
        vi.unstubAllGlobals();
    });

    describe('distance to the start', () => {
        it('labels the main number "to start" and shows the whole distance left', async () => {
            // Recorded going north for 200 m; the user is back at the far end
            await start(line(0, 0, 0, 200), false);
            expect(text('#nav-distance-label')).toBe('to start');

            fixAt(0, 200);
            await wait();

            // About 200 m of path still to walk (not just the 10 m to the next crumb)
            const distance = text('#nav-distance-value');
            expect(distance).toMatch(/^(19|20)\d m$/);
        });

        it('shrinks as the user walks back', async () => {
            await start(line(0, 0, 0, 200), false);
            fixAt(0, 200);
            for (let y = 190; y >= 100; y -= 10) fixAt(0, y);
            await wait();

            expect(text('#nav-distance-value')).toMatch(/^(9\d|10\d) m$/);
        });

        it('says "to finish" when following a saved route', async () => {
            await start(line(0, 0, 0, 200), true);
            expect(text('#nav-distance-label')).toBe('to finish');
        });
    });

    describe('next turn', () => {
        // Recorded: 100 m north then 100 m east. Retraced: west, then a left turn to go south.
        const lRoute = [...line(0, 0, 0, 100), ...line(0, 100, 100, 100).slice(1)];

        it('shows the direction and distance of the next corner', async () => {
            await start(lRoute, false);
            fixAt(100, 100);
            for (let x = 90; x >= 40; x -= 10) fixAt(x, 100);
            await wait();

            expect(hidden('#nav-next-turn')).toBe(false);
            expect(text('#nav-next-turn')).toMatch(/^Turn left in (3\d|4\d|5\d|6\d) m$/);
        });

        it('highlights an imminent corner', async () => {
            await start(lRoute, false);
            fixAt(100, 100);
            for (let x = 90; x >= 20; x -= 10) fixAt(x, 100);
            await wait();

            expect(
                root
                    .querySelector<HTMLElement>('#nav-next-turn')
                    ?.classList.contains('nav-next-turn--soon')
            ).toBe(true);
        });

        it('shows the mirror-image turn when following the route forwards', async () => {
            await start(lRoute, true);
            fixAt(0, 0);
            for (let y = 10; y <= 40; y += 10) fixAt(0, y);
            await wait();

            expect(text('#nav-next-turn')).toMatch(/^Turn right in/);
        });

        it('is hidden on a straight route', async () => {
            await start(line(0, 0, 0, 200), false);
            fixAt(0, 200);
            await wait();
            expect(hidden('#nav-next-turn')).toBe(true);
        });

        it('appears in simple mode too', async () => {
            setSimpleMode(true);
            await start(lRoute, false);
            fixAt(100, 100);
            for (let x = 90; x >= 60; x -= 10) fixAt(x, 100);
            await wait();

            expect(text('#nav-next-turn')).toMatch(/^Turn left in/);
        });
    });

    describe('getting onto the route', () => {
        it('tells a user who starts far from the route how far away it is', async () => {
            await start(line(0, 0, 0, 200), false);
            fixAt(600, 200); // 600 m east of where the route ends

            await wait();
            expect(text('#nav-recovery-hint')).toMatch(/You are \d+ m from your route/);
        });

        it('does not nag a user who starts on the route', async () => {
            await start(line(0, 0, 0, 200), false);
            fixAt(3, 200);
            await wait();
            expect(text('#nav-recovery-hint')).not.toContain('from your route');
        });

        it('says how far the route is once the user is off it', async () => {
            await start(line(0, 0, 0, 200), false);
            fixAt(0, 200);
            fixAt(0, 190);
            for (let i = 0; i < 4; i++) fixAt(70, 150);
            await wait();

            expect(text('#nav-recovery-hint')).toMatch(/Off trail .* the route is \d+ m away/);
        });

        it('points the arrow at the nearest point of the route when off it', async () => {
            // Route runs north; the user is 70 m east of it, level with y = 100. The nearest
            // point is due west, so with a north-facing compass the arrow points left (270).
            await start(line(0, 0, 0, 200), false);
            // Stationary at the off-route spot, so only the compass gives a heading
            for (let i = 0; i < 4; i++) fixAt(70, 100);
            vi.setSystemTime(Date.now() + 1000);
            window.dispatchEvent(
                Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 0, gamma: 0 })
            );
            await wait();

            const transform = root.querySelector<SVGElement>('#nav-compass-arrow')?.style.transform;
            const degrees = Number(/rotate\((-?[\d.]+)deg\)/.exec(transform ?? '')?.[1]);
            expect(Math.abs(degrees - 270)).toBeLessThan(20);
        });
    });

    describe('arriving', () => {
        it('recognises a user who is already at the start (a loop) straight away', async () => {
            // A loop that ends 8 m from where it began
            const loop = [
                ...line(0, 0, 0, 100),
                ...line(0, 100, 100, 100).slice(1),
                ...line(100, 100, 100, 0).slice(1),
                ...line(100, 0, 8, -2).slice(1),
            ];
            await start(loop, false);
            fixAt(8, -2); // standing where the loop ended, beside where it started
            await wait();

            expect(text('#nav-progress-text')).toContain('near your start point');
        });
    });

    describe('after arriving', () => {
        const short = line(0, 0, 0, 40);

        async function arriveByRetrace(): Promise<void> {
            await start(short, false);
            fixAt(0, 40);
            for (let y = 30; y >= 0; y -= 10) fixAt(0, y);
            await wait();
        }

        const click = (selector: string): void =>
            root.querySelector<HTMLButtonElement>(selector)?.click();

        it('offers Done and Save in place of "stop navigation"', async () => {
            await arriveByRetrace();

            expect(hidden('#nav-arrival-actions')).toBe(false);
            expect(hidden('#btn-stop-navigation')).toBe(true);
            expect(text('#btn-arrival-done')).toBe('Done');
            expect(hidden('#btn-arrival-save')).toBe(false);
        });

        it('keeps the normal stop button until arrival', async () => {
            await start(short, false);
            fixAt(0, 40);
            await wait();
            expect(hidden('#nav-arrival-actions')).toBe(true);
            expect(hidden('#btn-stop-navigation')).toBe(false);
        });

        it('Done ends the walk: clears the session and returns to a fresh recording screen', async () => {
            await arriveByRetrace();
            expect((await getSession())?.breadcrumbs.length).toBeGreaterThan(0);

            click('#btn-arrival-done');
            await wait(80);

            expect(await getSession()).toBeUndefined();
            expect(root.querySelector('#btn-take-me-back')).not.toBeNull();
            expect(root.querySelector('#nav-arrival-actions')).toBeNull();
            expect(text('#route-quality')).not.toContain('Continuing your previous route');
        });

        it('Save opens the save dialog and returns to the recording screen once saved', async () => {
            await arriveByRetrace();
            for (const route of await listRoutes()) await deleteRoute(route.id);

            click('#btn-arrival-save');
            await wait(80);
            const input = document.querySelector<HTMLInputElement>('#save-route-name');
            expect(document.querySelector('#save-modal-title')?.textContent).toBe(
                'Save this route'
            );

            (input as HTMLInputElement).value = 'Walk home';
            document.querySelector<HTMLButtonElement>('#btn-save-confirm')?.click();
            await wait(120);

            const saved = await listRoutes();
            expect(saved.map(r => r.name)).toEqual(['Walk home']);
            expect(saved[0].breadcrumbs.length).toBeGreaterThan(0);
            expect(await getSession()).toBeUndefined();
            expect(root.querySelector('#btn-take-me-back')).not.toBeNull();
            for (const route of saved) await deleteRoute(route.id);
        });

        it('following a saved route offers only Done, and leaves the recording session alone', async () => {
            await clearSession();
            await appendBreadcrumb(at(500, 500));
            await start(short, true);
            fixAt(0, 0);
            for (let y = 10; y <= 40; y += 10) fixAt(0, y);
            await wait();

            expect(hidden('#nav-arrival-actions')).toBe(false);
            expect(hidden('#btn-arrival-save')).toBe(true);

            click('#btn-arrival-done');
            await wait(80);

            expect(root.querySelector('#btn-take-me-back')).not.toBeNull();
            expect((await getSession())?.breadcrumbs).toHaveLength(1);
            await clearSession();
        });
    });

    describe('GPS gaps', () => {
        it('warns that a stretch recorded without GPS is a straight-line guess', async () => {
            const trail = [
                ...line(0, 0, 0, 30),
                at(0, 200, { gap: true }),
                ...line(0, 210, 0, 240),
            ];
            // Retrace: start at the far end, walk to the crumb after the gap
            await start(trail, false);
            fixAt(0, 240);
            fixAt(0, 230);
            fixAt(0, 220);
            fixAt(0, 210);
            fixAt(0, 200); // reached the gap crumb; the next leg crosses the missing stretch
            await wait();

            expect(text('#nav-recovery-hint')).toContain('straight-line guess');
        });
    });
});
