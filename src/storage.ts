import { openDB, type IDBPDatabase } from 'idb';
import type { Breadcrumb, SavedRoute, Session } from '@/types';

const DB_NAME = 'breadcrumbs';
const DB_VERSION = 2;
const SESSION_STORE = 'sessions';
const ROUTES_STORE = 'routes';
const CURRENT_SESSION_ID = 'current';

async function getDB(): Promise<IDBPDatabase> {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(SESSION_STORE)) {
                db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(ROUTES_STORE)) {
                db.createObjectStore(ROUTES_STORE, { keyPath: 'id' });
            }
        },
    });
}

export async function appendBreadcrumb(breadcrumb: Breadcrumb): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(SESSION_STORE, 'readwrite');
    const store = tx.objectStore(SESSION_STORE);
    const existing = (await store.get(CURRENT_SESSION_ID)) as Session | undefined;
    if (existing) {
        existing.breadcrumbs.push(breadcrumb);
        await store.put(existing);
    } else {
        const session: Session = {
            id: CURRENT_SESSION_ID,
            startedAt: breadcrumb.timestamp,
            breadcrumbs: [breadcrumb],
        };
        await store.put(session);
    }
    await tx.done;
}

export async function getSession(): Promise<Session | undefined> {
    const db = await getDB();
    return db.get(SESSION_STORE, CURRENT_SESSION_ID) as Promise<Session | undefined>;
}

export async function clearSession(): Promise<void> {
    const db = await getDB();
    await db.delete(SESSION_STORE, CURRENT_SESSION_ID);
}

export async function saveRoute(route: SavedRoute): Promise<void> {
    const db = await getDB();
    await db.put(ROUTES_STORE, route);
}

export async function listRoutes(): Promise<SavedRoute[]> {
    const db = await getDB();
    return db.getAll(ROUTES_STORE) as Promise<SavedRoute[]>;
}

export async function deleteRoute(id: string): Promise<void> {
    const db = await getDB();
    await db.delete(ROUTES_STORE, id);
}
