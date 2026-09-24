import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

/**
 * GPS mock strategy:
 * We replace navigator.geolocation.watchPosition with a controlled mock
 * before the app loads. The mock stores the success callback so we can
 * send GPS positions on demand via page.evaluate().
 */
const GPS_MOCK_SCRIPT = `
    window.__geoCallbacks = [];
    window.__geoWatchId = 0;

    navigator.geolocation.watchPosition = function(success, error, options) {
        const id = ++window.__geoWatchId;
        window.__geoCallbacks.push({ id, success, error });
        return id;
    };

    navigator.geolocation.clearWatch = function(id) {
        window.__geoCallbacks = window.__geoCallbacks.filter(cb => cb.id !== id);
    };

    // Mock getCurrentPosition too, in case it's used
    navigator.geolocation.getCurrentPosition = function(success, error) {
        // no-op; we control all GPS via sendGPS
    };

    // Ensure isSecureContext is true
    if (!window.isSecureContext) {
        Object.defineProperty(window, 'isSecureContext', { value: true });
    }
`;

async function sendGPS(page: Page, lat: number, lng: number, accuracy = 5): Promise<void> {
    await page.evaluate(
        ({ lat, lng, accuracy }) => {
            const position = {
                coords: {
                    latitude: lat,
                    longitude: lng,
                    accuracy: accuracy,
                    altitude: null,
                    altitudeAccuracy: null,
                    heading: null,
                    speed: null,
                },
                timestamp: Date.now(),
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const cb of (window as any).__geoCallbacks) {
                cb.success(position);
            }
        },
        { lat, lng, accuracy }
    );
}

/** Seed routes into IndexedDB before the app reads them. */
async function seedRoutes(
    page: Page,
    routes: Array<{
        id: string;
        name: string;
        date: number;
        distance: number;
        breadcrumbCount: number;
        breadcrumbs: Array<{ lat: number; lng: number; accuracy: number; timestamp: number }>;
    }>
): Promise<void> {
    await page.evaluate(async routes => {
        return new Promise<void>((resolve, reject) => {
            const request = indexedDB.open('breadcrumbs', 3);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('sessions')) {
                    db.createObjectStore('sessions', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('routes')) {
                    db.createObjectStore('routes', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('crumbs')) {
                    db.createObjectStore('crumbs', { autoIncrement: true });
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('routes', 'readwrite');
                const store = tx.objectStore('routes');
                for (const route of routes) {
                    store.put(route);
                }
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => reject(tx.error);
            };
            request.onerror = () => reject(request.error);
        });
    }, routes);
}

// Two GPS positions >10m apart (roughly 15m apart at this latitude)
const POS_A = { lat: 51.5074, lng: -0.1278 }; // London start
const POS_B = { lat: 51.50755, lng: -0.1278 }; // ~17m north

test.describe('UI Screenshot Capture - Pixel 7a', () => {
    test.beforeEach(async ({ page }) => {
        // Install GPS mock before any page scripts run
        await page.addInitScript(GPS_MOCK_SCRIPT);

        // Mock speechSynthesis and vibration to avoid errors
        await page.addInitScript(`
            window.speechSynthesis = window.speechSynthesis || {
                speak: () => {},
                cancel: () => {},
                getVoices: () => [],
                speaking: false,
                pending: false,
                paused: false,
                addEventListener: () => {},
                removeEventListener: () => {},
                onvoiceschanged: null,
            };
            window.SpeechSynthesisUtterance = window.SpeechSynthesisUtterance || class {
                constructor() {}
            };
            navigator.vibrate = navigator.vibrate || (() => true);

            // Mock DeviceOrientationEvent
            window.DeviceOrientationEvent = window.DeviceOrientationEvent || class extends Event {
                constructor(type, init) { super(type, init); }
            };
        `);
    });

    test('1 - Recording requesting', async ({ page }) => {
        await page.goto('/');

        // Wait for the status to show "Requesting location access..."
        await expect(page.locator('#status-text')).toHaveText('Requesting location access\u2026', {
            timeout: 5000,
        });

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '01-recording-requesting.png'),
            fullPage: true,
        });
    });

    test('2 - Recording active', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#status-text')).toHaveText('Requesting location access\u2026', {
            timeout: 5000,
        });

        // Send first GPS position — triggers "Recording..." status
        await sendGPS(page, POS_A.lat, POS_A.lng);
        await expect(page.locator('#status-text')).toHaveText('Recording...', { timeout: 5000 });

        // Send second position >10m away to show distance
        await sendGPS(page, POS_B.lat, POS_B.lng);

        // Wait for stats to be visible and show a non-zero distance
        await expect(page.locator('#recording-stats')).toBeVisible();
        await expect(page.locator('#distance-walked')).not.toHaveText('0 m');

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '02-recording-active.png'),
            fullPage: true,
        });
    });

    test('3 - Navigation view', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#status-text')).toHaveText('Requesting location access\u2026', {
            timeout: 5000,
        });

        // Record 2 breadcrumbs
        await sendGPS(page, POS_A.lat, POS_A.lng);
        await expect(page.locator('#status-text')).toHaveText('Recording...', { timeout: 5000 });
        await sendGPS(page, POS_B.lat, POS_B.lng);

        // Click "Take me back"
        await page.click('#btn-take-me-back');
        await expect(page.locator('#confirm-modal-title')).toHaveText('Go back now?', {
            timeout: 5000,
        });
        await expect(page.locator('#btn-confirm-yes')).toBeEnabled({ timeout: 3000 });
        await page.click('#btn-confirm-yes');

        // Wait for the navigation screen to appear
        await expect(page.locator('#nav-panel')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#nav-progress-text')).not.toHaveText('Loading\u2026');

        // Send a GPS position so the distance shows a real value
        await sendGPS(page, POS_B.lat, POS_B.lng);
        await page.waitForTimeout(300);

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '03-navigation.png'),
            fullPage: true,
        });
    });

    test('4 - Navigation arrived', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#status-text')).toHaveText('Requesting location access\u2026', {
            timeout: 5000,
        });

        // Record just 1 breadcrumb at POS_A
        await sendGPS(page, POS_A.lat, POS_A.lng);
        await expect(page.locator('#status-text')).toHaveText('Recording...', { timeout: 5000 });

        // Navigate
        await page.click('#btn-take-me-back');
        await expect(page.locator('#confirm-modal-title')).toHaveText('Go back now?', {
            timeout: 5000,
        });
        await expect(page.locator('#btn-confirm-yes')).toBeEnabled({ timeout: 3000 });
        await page.click('#btn-confirm-yes');
        await expect(page.locator('#nav-panel')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#nav-progress-text')).not.toHaveText('Loading\u2026');

        // Send position at same coords — should trigger "arrived"
        await sendGPS(page, POS_A.lat, POS_A.lng);
        await expect(page.locator('#nav-progress-text')).toHaveText(
            "You're near your start point.",
            {
                timeout: 5000,
            }
        );

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '04-navigation-arrived.png'),
            fullPage: true,
        });
    });

    test('5 - Saved routes empty', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#status-text')).toHaveText('Requesting location access\u2026', {
            timeout: 5000,
        });

        // Click "Saved routes"
        await page.click('#btn-view-routes');

        // Wait for empty state message
        await expect(page.locator('.routes-empty')).toContainText('No saved routes yet', {
            timeout: 5000,
        });

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '05-saved-routes-empty.png'),
            fullPage: true,
        });
    });

    test('6 - Saved routes populated', async ({ page }) => {
        // Seed routes into IndexedDB before loading the page
        await page.goto('/');

        const sampleRoutes = [
            {
                id: 'route-1001',
                name: 'Morning park walk',
                date: Date.now() - 86400000 * 2,
                distance: 1250,
                breadcrumbCount: 45,
                breadcrumbs: [{ lat: 51.5074, lng: -0.1278, accuracy: 5, timestamp: Date.now() }],
            },
            {
                id: 'route-1002',
                name: 'To the shops and back',
                date: Date.now() - 86400000,
                distance: 830,
                breadcrumbCount: 28,
                breadcrumbs: [{ lat: 51.508, lng: -0.128, accuracy: 5, timestamp: Date.now() }],
            },
            {
                id: 'route-1003',
                name: 'Sunday afternoon stroll',
                date: Date.now(),
                distance: 2100,
                breadcrumbCount: 72,
                breadcrumbs: [{ lat: 51.509, lng: -0.129, accuracy: 5, timestamp: Date.now() }],
            },
        ];

        await seedRoutes(page, sampleRoutes);

        await expect(page.locator('#status-text')).toHaveText('Requesting location access\u2026', {
            timeout: 5000,
        });

        // Click "Saved routes"
        await page.click('#btn-view-routes');

        // Wait for route cards to render
        await expect(page.locator('.route-card')).toHaveCount(3, { timeout: 5000 });

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '06-saved-routes-populated.png'),
            fullPage: true,
        });
    });

    /** A crumb x m east and y m north of the London start. */
    const at = (x: number, y: number) => ({
        lat: 51.5074 + y / 111195,
        lng: -0.1278 + x / (111195 * Math.cos((51.5074 * Math.PI) / 180)),
        accuracy: 5,
        timestamp: Date.now(),
    });

    /** A saved route: 120 m north then 120 m east, a crumb every 10 m. */
    const lRoute = [
        ...Array.from({ length: 13 }, (_, i) => at(0, i * 10)),
        ...Array.from({ length: 12 }, (_, i) => at((i + 1) * 10, 120)),
    ];

    async function followLRoute(page: Page): Promise<void> {
        await page.goto('/');
        await seedRoutes(page, [
            {
                id: 'route-l',
                name: 'Park loop',
                date: Date.now(),
                distance: 240,
                breadcrumbCount: lRoute.length,
                breadcrumbs: lRoute,
            },
        ]);
        await expect(page.locator('#status-text')).toHaveText('Requesting location access…', {
            timeout: 5000,
        });
        await page.click('#btn-view-routes');
        await page.click('[data-action="follow"]');
        await expect(page.locator('#nav-panel')).toBeVisible({ timeout: 5000 });
    }

    test('9 - Navigation mid-route with a turn coming up', async ({ page }) => {
        await followLRoute(page);

        // Walk north along the first leg, a fix every metre or so, towards the corner
        for (let y = 0; y <= 90; y += 6) await sendGPS(page, at(0, y).lat, at(0, y).lng);
        await expect(page.locator('#nav-next-turn')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#nav-next-turn')).toContainText('Turn right');

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '09-navigation-turn-ahead.png'),
            fullPage: true,
        });
    });

    test('10 - Navigation off the route', async ({ page }) => {
        await followLRoute(page);

        for (let y = 0; y <= 40; y += 8) await sendGPS(page, at(0, y).lat, at(0, y).lng);
        // Wander 60 m east of the path
        for (let i = 0; i < 4; i++) await sendGPS(page, at(60, 45).lat, at(60, 45).lng);
        await expect(page.locator('#nav-recovery-hint')).toContainText('Off trail', {
            timeout: 3000,
        });

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '10-navigation-off-route.png'),
            fullPage: true,
        });
    });

    test('7 - Save route modal', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#status-text')).toHaveText('Requesting location access\u2026', {
            timeout: 5000,
        });

        // Record breadcrumbs
        await sendGPS(page, POS_A.lat, POS_A.lng);
        await expect(page.locator('#status-text')).toHaveText('Recording...', { timeout: 5000 });
        await sendGPS(page, POS_B.lat, POS_B.lng);

        await page.click('#btn-save-route');

        // Wait for modal to appear
        await expect(page.locator('.modal-backdrop')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#save-route-name')).toBeVisible();

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '07-save-route-modal.png'),
            fullPage: true,
        });
    });

    test('8 - Delete confirmation modal', async ({ page }) => {
        // Seed a route first
        await page.goto('/');

        await seedRoutes(page, [
            {
                id: 'route-delete-test',
                name: 'Route to delete',
                date: Date.now(),
                distance: 500,
                breadcrumbCount: 15,
                breadcrumbs: [{ lat: 51.5074, lng: -0.1278, accuracy: 5, timestamp: Date.now() }],
            },
        ]);

        await expect(page.locator('#status-text')).toHaveText('Requesting location access\u2026', {
            timeout: 5000,
        });

        // Navigate to saved routes
        await page.click('#btn-view-routes');
        await expect(page.locator('.route-card')).toHaveCount(1, { timeout: 5000 });

        // Click delete button
        await page.click('[data-action="delete"]');

        // Wait for delete confirmation modal
        await expect(page.locator('.modal-backdrop')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#delete-modal-title')).toHaveText('Delete route?');

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '08-delete-confirmation.png'),
            fullPage: true,
        });
    });
});
