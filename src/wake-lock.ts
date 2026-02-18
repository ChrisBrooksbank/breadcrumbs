/**
 * Wake Lock manager — keeps screen on during navigation,
 * with support for releasing it in "pocket mode".
 */

interface WakeLockManager {
    /** Acquire the wake lock (screen stays on). */
    acquire(): Promise<void>;
    /** Release the wake lock (screen can turn off). */
    release(): Promise<void>;
    /** Whether the wake lock is currently held. */
    readonly isActive: boolean;
    /** Whether the Wake Lock API is available. */
    readonly available: boolean;
    /** Clean up — release lock and remove listeners. */
    destroy(): void;
}

export function createWakeLockManager(): WakeLockManager {
    const available = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
    let sentinel: WakeLockSentinel | null = null;
    let wantLock = false;

    function handleVisibilityChange(): void {
        // Re-acquire on tab becoming visible (browser releases on hide)
        if (wantLock && document.visibilityState === 'visible' && !sentinel) {
            acquire().catch(() => {
                // Silent — user may have revoked permission
            });
        }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    async function acquire(): Promise<void> {
        if (!available) return;
        wantLock = true;
        try {
            sentinel = await navigator.wakeLock.request('screen');
            sentinel.addEventListener('release', () => {
                sentinel = null;
            });
        } catch {
            // NotAllowedError or AbortError — silent fallback
        }
    }

    async function release(): Promise<void> {
        wantLock = false;
        if (sentinel) {
            try {
                await sentinel.release();
            } catch {
                // Already released
            }
            sentinel = null;
        }
    }

    function destroy(): void {
        wantLock = false;
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (sentinel) {
            sentinel.release().catch(() => {});
            sentinel = null;
        }
    }

    return {
        acquire,
        release,
        get isActive() {
            return sentinel !== null;
        },
        get available() {
            return available;
        },
        destroy,
    };
}
