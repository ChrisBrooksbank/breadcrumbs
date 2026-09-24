import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountAppShell, startRecording, _resetModalOpen } from './main';
import { clearSession } from './storage';

const wait = (ms = 30): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Tests for what keeps recording alive in the real world (screen lock, dropouts, prompts). */
describe('recording reliability', () => {
    let root: HTMLElement;
    let onPosition: PositionCallback;
    let sentinel: { addEventListener: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    let wakeLockRequest: ReturnType<typeof vi.fn>;
    let persist: ReturnType<typeof vi.fn>;

    function stubNavigator(extra: Record<string, unknown> = {}): void {
        vi.stubGlobal('navigator', {
            geolocation: {
                watchPosition: vi.fn((success: PositionCallback) => {
                    onPosition = success;
                    return 1;
                }),
                clearWatch: vi.fn(),
            },
            wakeLock: { request: wakeLockRequest },
            storage: { persist },
            ...extra,
        });
    }

    function sendFix(): void {
        onPosition({
            coords: {
                latitude: 51.5,
                longitude: -0.1,
                accuracy: 5,
            } as GeolocationCoordinates,
            timestamp: Date.now(),
        } as GeolocationPosition);
    }

    beforeEach(async () => {
        await clearSession();
        _resetModalOpen();
        root = document.createElement('div');
        root.id = 'app';
        document.body.appendChild(root);
        mountAppShell(root);
        sentinel = { addEventListener: vi.fn(), release: vi.fn(() => Promise.resolve()) };
        wakeLockRequest = vi.fn(() => Promise.resolve(sentinel));
        persist = vi.fn(() => Promise.resolve(true));
        stubNavigator();
        vi.stubGlobal('isSecureContext', true);
    });

    afterEach(async () => {
        vi.useRealTimers();
        _resetModalOpen();
        await clearSession();
        document.body.removeChild(root);
        vi.unstubAllGlobals();
    });

    it('holds a screen wake lock while recording and hides the keep-open hint', async () => {
        startRecording(root);
        await wait();

        expect(wakeLockRequest).toHaveBeenCalledWith('screen');
        expect(root.querySelector<HTMLElement>('#keep-open-hint')?.hidden).toBe(true);
    });

    it('shows the keep-open hint when a wake lock is not available', async () => {
        vi.unstubAllGlobals();
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

        startRecording(root);
        await wait();

        const hint = root.querySelector<HTMLElement>('#keep-open-hint');
        expect(hint?.hidden).toBe(false);
        expect(hint?.textContent).toContain('Keep this app open');
    });

    it('shows the keep-open hint when the wake lock request is refused', async () => {
        wakeLockRequest.mockRejectedValue(new Error('NotAllowedError'));

        startRecording(root);
        await wait();

        expect(root.querySelector<HTMLElement>('#keep-open-hint')?.hidden).toBe(false);
    });

    it('releases the wake lock when recording is replaced', async () => {
        startRecording(root);
        await wait();

        startRecording(root); // replaces the active recording, running its cleanup
        await wait();

        expect(sentinel.release).toHaveBeenCalled();
    });

    it('asks the browser for persistent storage', async () => {
        startRecording(root);
        await wait();
        expect(persist).toHaveBeenCalled();
    });

    it('does not fail if the storage API is missing or persist rejects', async () => {
        persist.mockRejectedValue(new Error('nope'));
        startRecording(root);
        await wait();
        expect(root.querySelector('#status-badge')).not.toBeNull();
    });

    it('tells the user when GPS is lost and when it returns', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        startRecording(root);
        sendFix();

        vi.advanceTimersByTime(30_000);
        const message = root.querySelector('#route-quality');
        expect(message?.textContent).toContain('Lost GPS');
        expect(message?.classList.contains('route-quality--urgent')).toBe(true);

        sendFix();
        expect(message?.textContent).toContain('GPS is back');
    });

    describe('location permission prompt', () => {
        function stubPermissionState(state: string): { grant: () => void } {
            const status: { state: string; onchange: (() => void) | null } = {
                state,
                onchange: null,
            };
            stubNavigator({
                permissions: { query: vi.fn(() => Promise.resolve(status)) },
            });
            return {
                grant: () => {
                    status.state = 'granted';
                    status.onchange?.();
                },
            };
        }

        it('does not time out while the permission prompt is still showing', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            stubPermissionState('prompt');

            startRecording(root);
            await vi.advanceTimersByTimeAsync(60_000);

            expect(root.querySelector('#status-text')?.textContent).toContain('Requesting');
        });

        it('starts the timeout once permission is granted but no fix arrives', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            const permission = stubPermissionState('prompt');

            startRecording(root);
            await vi.advanceTimersByTimeAsync(30_000);
            permission.grant();
            await vi.advanceTimersByTimeAsync(11_000);

            expect(root.querySelector('#status-text')?.textContent).toContain('timed out');
        });

        it('times out as before when permission is already granted', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            stubPermissionState('granted');

            startRecording(root);
            await vi.advanceTimersByTimeAsync(11_000);

            expect(root.querySelector('#status-text')?.textContent).toContain('timed out');
        });
    });
});
