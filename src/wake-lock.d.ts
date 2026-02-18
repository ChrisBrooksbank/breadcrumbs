/** Wake Lock API type declarations (not yet in all TypeScript DOM libs). */

interface WakeLockSentinel extends EventTarget {
    readonly released: boolean;
    readonly type: 'screen';
    release(): Promise<void>;
    addEventListener(type: 'release', listener: EventListener): void;
    removeEventListener(type: 'release', listener: EventListener): void;
}

interface WakeLock {
    request(type: 'screen'): Promise<WakeLockSentinel>;
}

interface Navigator {
    readonly wakeLock: WakeLock;
}
