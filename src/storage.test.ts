import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
    appendBreadcrumb,
    getSession,
    clearSession,
    saveRoute,
    listRoutes,
    deleteRoute,
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
