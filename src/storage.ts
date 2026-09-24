import { openDB, type IDBPDatabase } from 'idb';
import type { Breadcrumb, SavedRoute, Session } from '@/types';

const DB_NAME = 'breadcrumbs';
const DB_VERSION = 3;
const SESSION_STORE = 'sessions';
const CRUMBS_STORE = 'crumbs';
const ROUTES_STORE = 'routes';
const CURRENT_SESSION_ID = 'current';

/** Session bookkeeping; the crumbs themselves live one-per-record in CRUMBS_STORE. */
interface SessionMeta {
    id: string;
    startedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

/** One shared connection; reopened if the browser closes it or another tab upgrades the DB. */
function getDB(): Promise<IDBPDatabase> {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            async upgrade(db, oldVersion, _newVersion, transaction) {
                if (!db.objectStoreNames.contains(SESSION_STORE)) {
                    db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(ROUTES_STORE)) {
                    db.createObjectStore(ROUTES_STORE, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(CRUMBS_STORE)) {
                    db.createObjectStore(CRUMBS_STORE, { autoIncrement: true });
                }

                // v1/v2 kept every crumb inside one session record; split it out.
                if (oldVersion >= 1 && oldVersion < 3) {
                    const sessions = transaction.objectStore(SESSION_STORE);
                    const crumbs = transaction.objectStore(CRUMBS_STORE);
                    const legacy = (await sessions.get(CURRENT_SESSION_ID)) as Session | undefined;
                    if (legacy) {
                        for (const crumb of legacy.breadcrumbs) await crumbs.add(crumb);
                        const meta: SessionMeta = {
                            id: CURRENT_SESSION_ID,
                            startedAt: legacy.startedAt,
                        };
                        await sessions.put(meta);
                    }
                }
            },
            blocking() {
                const closing = dbPromise;
                dbPromise = null;
                closing?.then(db => db.close()).catch(() => {});
            },
            terminated() {
                dbPromise = null;
            },
        }).catch(error => {
            dbPromise = null;
            throw error;
        });
    }
    return dbPromise;
}

/**
 * Session writes run strictly one after another in call order, so a burst of fixes can
 * never interleave or reorder.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task);
    writeQueue = run.catch(() => {});
    return run;
}

export function appendBreadcrumb(breadcrumb: Breadcrumb): Promise<void> {
    return enqueueWrite(async () => {
        const db = await getDB();
        const tx = db.transaction([SESSION_STORE, CRUMBS_STORE], 'readwrite');
        const sessions = tx.objectStore(SESSION_STORE);
        if (!(await sessions.get(CURRENT_SESSION_ID))) {
            const meta: SessionMeta = { id: CURRENT_SESSION_ID, startedAt: breadcrumb.timestamp };
            await sessions.put(meta);
        }
        await tx.objectStore(CRUMBS_STORE).add(breadcrumb);
        await tx.done;
    });
}

export async function getSession(): Promise<Session | undefined> {
    // Wait for queued writes so a read straight after an append sees it.
    await writeQueue;
    const db = await getDB();
    const tx = db.transaction([SESSION_STORE, CRUMBS_STORE], 'readonly');
    const meta = (await tx.objectStore(SESSION_STORE).get(CURRENT_SESSION_ID)) as
        | SessionMeta
        | undefined;
    if (!meta) return undefined;
    const breadcrumbs = (await tx.objectStore(CRUMBS_STORE).getAll()) as Breadcrumb[];
    return { id: meta.id, startedAt: meta.startedAt, breadcrumbs };
}

export function clearSession(): Promise<void> {
    return enqueueWrite(async () => {
        const db = await getDB();
        const tx = db.transaction([SESSION_STORE, CRUMBS_STORE], 'readwrite');
        await tx.objectStore(SESSION_STORE).delete(CURRENT_SESSION_ID);
        await tx.objectStore(CRUMBS_STORE).clear();
        await tx.done;
    });
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

export function updateLastBreadcrumb(
    updater: (b: Breadcrumb) => Breadcrumb
): Promise<Breadcrumb | null> {
    return enqueueWrite(async () => {
        const db = await getDB();
        const tx = db.transaction(CRUMBS_STORE, 'readwrite');
        const cursor = await tx.objectStore(CRUMBS_STORE).openCursor(null, 'prev');
        if (!cursor) return null;
        const updated = updater(cursor.value as Breadcrumb);
        await cursor.update(updated);
        await tx.done;
        return updated;
    });
}
