import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB } from 'idb';
import { IDBFactory } from 'fake-indexeddb';
import {
    appendBreadcrumb,
    getSession,
    clearSession,
    saveRoute,
    listRoutes,
    deleteRoute,
    updateLastBreadcrumb,
} from '@/storage';
import type { Breadcrumb, SavedRoute } from '@/types';

const crumb1: Breadcrumb = { lat: 51.5, lng: -0.1, accuracy: 5, timestamp: 1000 };
const crumb2: Breadcrumb = { lat: 51.501, lng: -0.101, accuracy: 8, timestamp: 2000 };

const route1: SavedRoute = {
    id: 'route-1',
    name: 'Morning Walk',
    date: 1700000000000,
    distance: 1234,
    breadcrumbCount: 2,
    breadcrumbs: [crumb1, crumb2],
};

const route2: SavedRoute = {
    id: 'route-2',
    name: 'Dog Walk',
    date: 1700100000000,
    distance: 500,
    breadcrumbCount: 1,
    breadcrumbs: [crumb1],
};

beforeEach(async () => {
    await clearSession();
    const existing = await listRoutes();
    for (const r of existing) {
        await deleteRoute(r.id);
    }
});

describe('storage - session', () => {
    it('getSession returns undefined when no session exists', async () => {
        const session = await getSession();
        expect(session).toBeUndefined();
    });

    it('appendBreadcrumb creates a new session on first call', async () => {
        await appendBreadcrumb(crumb1);
        const session = await getSession();
        expect(session).toBeDefined();
        expect(session!.breadcrumbs).toHaveLength(1);
        expect(session!.breadcrumbs[0]).toEqual(crumb1);
        expect(session!.startedAt).toBe(crumb1.timestamp);
    });

    it('appendBreadcrumb appends to existing session', async () => {
        await appendBreadcrumb(crumb1);
        await appendBreadcrumb(crumb2);
        const session = await getSession();
        expect(session!.breadcrumbs).toHaveLength(2);
        expect(session!.breadcrumbs[1]).toEqual(crumb2);
    });

    it('clearSession removes the session', async () => {
        await appendBreadcrumb(crumb1);
        await clearSession();
        const session = await getSession();
        expect(session).toBeUndefined();
    });

    it('startedAt is timestamp of first breadcrumb', async () => {
        await appendBreadcrumb(crumb1);
        await appendBreadcrumb(crumb2);
        const session = await getSession();
        expect(session!.startedAt).toBe(crumb1.timestamp);
    });
});

describe('storage - saved routes', () => {
    it('listRoutes returns empty array when no routes saved', async () => {
        const routes = await listRoutes();
        expect(routes).toEqual([]);
    });

    it('saveRoute persists a route', async () => {
        await saveRoute(route1);
        const routes = await listRoutes();
        expect(routes).toHaveLength(1);
        expect(routes[0]).toEqual(route1);
    });

    it('saveRoute can persist multiple routes', async () => {
        await saveRoute(route1);
        await saveRoute(route2);
        const routes = await listRoutes();
        expect(routes).toHaveLength(2);
    });

    it('listRoutes returns all saved routes with correct fields', async () => {
        await saveRoute(route1);
        const routes = await listRoutes();
        expect(routes[0].name).toBe('Morning Walk');
        expect(routes[0].distance).toBe(1234);
        expect(routes[0].breadcrumbCount).toBe(2);
        expect(routes[0].breadcrumbs).toHaveLength(2);
        expect(routes[0].date).toBe(1700000000000);
    });

    it('deleteRoute removes a route by id', async () => {
        await saveRoute(route1);
        await saveRoute(route2);
        await deleteRoute(route1.id);
        const routes = await listRoutes();
        expect(routes).toHaveLength(1);
        expect(routes[0].id).toBe(route2.id);
    });

    it('deleteRoute on non-existent id does not throw', async () => {
        await expect(deleteRoute('does-not-exist')).resolves.toBeUndefined();
    });

    it('saveRoute with same id overwrites existing route', async () => {
        await saveRoute(route1);
        const updated: SavedRoute = { ...route1, name: 'Updated Walk' };
        await saveRoute(updated);
        const routes = await listRoutes();
        expect(routes).toHaveLength(1);
        expect(routes[0].name).toBe('Updated Walk');
    });
});

describe('storage - updateLastBreadcrumb', () => {
    it('returns null when no session exists', async () => {
        const result = await updateLastBreadcrumb(b => ({ ...b, label: 'Gate' }));
        expect(result).toBeNull();
    });

    it('returns null when session has no breadcrumbs', async () => {
        // clearSession already runs in beforeEach, so no session exists
        const result = await updateLastBreadcrumb(b => ({ ...b, label: 'Gate' }));
        expect(result).toBeNull();
    });

    it('updates the last breadcrumb with a label', async () => {
        await appendBreadcrumb(crumb1);
        await appendBreadcrumb(crumb2);

        const result = await updateLastBreadcrumb(b => ({ ...b, label: 'Bench' }));
        expect(result).not.toBeNull();
        expect(result!.label).toBe('Bench');
        expect(result!.lat).toBe(crumb2.lat);

        const session = await getSession();
        expect(session!.breadcrumbs[1].label).toBe('Bench');
        // First breadcrumb should be unchanged
        expect(session!.breadcrumbs[0].label).toBeUndefined();
    });

    it('updates the only breadcrumb when session has one', async () => {
        await appendBreadcrumb(crumb1);

        const result = await updateLastBreadcrumb(b => ({ ...b, label: 'Steps' }));
        expect(result!.label).toBe('Steps');

        const session = await getSession();
        expect(session!.breadcrumbs[0].label).toBe('Steps');
    });
});

describe('storage - per-crumb session records', () => {
    it('stores each crumb as its own record and keeps only bookkeeping in the session record', async () => {
        await appendBreadcrumb(crumb1);
        await appendBreadcrumb(crumb2);

        const db = await openDB('breadcrumbs');
        expect(await db.count('crumbs')).toBe(2);
        const meta = (await db.get('sessions', 'current')) as Record<string, unknown>;
        expect(meta).toEqual({ id: 'current', startedAt: crumb1.timestamp });
        db.close();
    });

    it('keeps a burst of unawaited appends in call order', async () => {
        const crumbs: Breadcrumb[] = Array.from({ length: 60 }, (_, i) => ({
            lat: 51.5 + i * 0.0001,
            lng: -0.1,
            accuracy: 5,
            timestamp: 1000 + i,
        }));
        await Promise.all(crumbs.map(c => appendBreadcrumb(c)));

        const session = await getSession();
        expect(session?.breadcrumbs).toEqual(crumbs);
    });

    it('a read straight after an unawaited append sees it', async () => {
        void appendBreadcrumb(crumb1);
        const session = await getSession();
        expect(session?.breadcrumbs).toEqual([crumb1]);
    });

    it('clearSession removes every crumb so the next session starts empty', async () => {
        await appendBreadcrumb(crumb1);
        await appendBreadcrumb(crumb2);
        await clearSession();

        await appendBreadcrumb({ ...crumb1, timestamp: 9000 });
        const session = await getSession();
        expect(session?.breadcrumbs).toHaveLength(1);
        expect(session?.startedAt).toBe(9000);
    });

    it('round-trips optional fields such as labels and gap flags', async () => {
        const gapCrumb: Breadcrumb = { ...crumb2, gap: true, label: 'Bridge' };
        await appendBreadcrumb(crumb1);
        await appendBreadcrumb(gapCrumb);
        expect((await getSession())?.breadcrumbs[1]).toEqual(gapCrumb);
    });

    it('updateLastBreadcrumb edits only the newest crumb', async () => {
        await appendBreadcrumb(crumb1);
        await appendBreadcrumb(crumb2);
        const updated = await updateLastBreadcrumb(b => ({ ...b, label: 'Cafe' }));

        expect(updated?.label).toBe('Cafe');
        const session = await getSession();
        expect(session?.breadcrumbs[0]).toEqual(crumb1);
        expect(session?.breadcrumbs[1].label).toBe('Cafe');
    });

    it('updateLastBreadcrumb returns null when there is nothing to update', async () => {
        expect(await updateLastBreadcrumb(b => b)).toBeNull();
    });
});

describe('storage - migration from the single-record session format', () => {
    const realIndexedDB = globalThis.indexedDB;

    beforeEach(() => {
        globalThis.indexedDB = new IDBFactory();
        vi.resetModules();
    });

    afterEach(() => {
        globalThis.indexedDB = realIndexedDB;
        vi.resetModules();
    });

    async function createLegacyDb(session?: unknown): Promise<void> {
        const legacy = await openDB('breadcrumbs', 2, {
            upgrade(db) {
                db.createObjectStore('sessions', { keyPath: 'id' });
                db.createObjectStore('routes', { keyPath: 'id' });
            },
        });
        if (session) await legacy.put('sessions', session);
        await legacy.put('routes', route1);
        legacy.close();
    }

    it('moves crumbs out of the old session record without losing any', async () => {
        await createLegacyDb({ id: 'current', startedAt: 500, breadcrumbs: [crumb1, crumb2] });

        const storage = await import('@/storage');
        const session = await storage.getSession();
        expect(session?.startedAt).toBe(500);
        expect(session?.breadcrumbs).toEqual([crumb1, crumb2]);

        await storage.appendBreadcrumb({ ...crumb1, timestamp: 3000 });
        expect((await storage.getSession())?.breadcrumbs).toHaveLength(3);
    });

    it('keeps saved routes through the upgrade', async () => {
        await createLegacyDb({ id: 'current', startedAt: 500, breadcrumbs: [crumb1] });

        const storage = await import('@/storage');
        expect(await storage.listRoutes()).toEqual([route1]);
    });

    it('upgrades a database that has no session', async () => {
        await createLegacyDb();

        const storage = await import('@/storage');
        expect(await storage.getSession()).toBeUndefined();
        await storage.appendBreadcrumb(crumb1);
        expect((await storage.getSession())?.breadcrumbs).toEqual([crumb1]);
    });
});
