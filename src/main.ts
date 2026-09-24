import './styles.css';
import { createGeolocationService } from '@/gps';
import { createTrailRenderer, ZOOM_RANGES_METERS } from '@/trail-renderer';
import type { TrailRenderer } from '@/trail-renderer';
import {
    appendBreadcrumb,
    getSession,
    saveRoute,
    listRoutes,
    deleteRoute,
    clearSession,
    updateLastBreadcrumb,
} from '@/storage';
import { haversineMeters, bearingDegrees, lookAheadPoint, trailDistanceMeters } from '@/geo';
import {
    createNavigationService,
    createCompassService,
    createPositionSmoother,
} from '@/navigation';
import type { NextTurn } from '@/navigation';
import { createWakeLockManager } from '@/wake-lock';
import { createAudioKeepAlive } from '@/audio-keepalive';
import { createShakeDetector } from '@/motion';
import { createFeedbackService } from '@/feedback';
import { createGuidanceCoach } from '@/coach';
import {
    initSettings,
    getFontSize,
    increaseFontSize,
    decreaseFontSize,
    getThemeMode,
    setThemeMode,
    FONT_SIZES,
} from '@/settings';
import type { ThemeMode } from '@/settings';
import { classifyDirectionWithHysteresis } from '@/feedback';
import type { Direction } from '@/feedback';
import { createHeadingFusion } from '@/heading-fusion';
import { LANDMARK_PRESETS } from '@/landmarks';
import { installBreadcrumbSimulator, isSimulatorEnabled } from '@/simulator';
import type { Breadcrumb, SavedRoute } from '@/types';

let activeRecordingCleanup: (() => void) | null = null;
let activeNavigationCleanup: (() => void) | null = null;

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>;
};

function renderSimulatorControls(): string {
    if (!isSimulatorEnabled()) return '';
    return `
        <div class="simulator-controls" aria-label="Walk simulator controls">
            <button class="simulator-controls__btn" id="btn-sim-walk" type="button">Sim walk</button>
            <button class="simulator-controls__btn" id="btn-sim-return" type="button">Sim return</button>
            <button class="simulator-controls__btn" id="btn-sim-weak-gps" type="button">Bad GPS</button>
        </div>
    `;
}

function renderA11yControls(): string {
    const size = getFontSize();
    const mode = getThemeMode();
    const minDisabled = size === FONT_SIZES[0] ? 'disabled' : '';
    const maxDisabled = size === FONT_SIZES[FONT_SIZES.length - 1] ? 'disabled' : '';

    function pressed(m: ThemeMode): string {
        return mode === m ? 'aria-pressed="true"' : 'aria-pressed="false"';
    }

    return `
        <div class="a11y-controls" role="toolbar" aria-label="Display controls">
            <button class="a11y-controls__btn a11y-controls__toggle" id="btn-display-toggle" aria-expanded="false" aria-controls="a11y-panel" aria-label="Display settings: text size and theme">
                Aa Display
            </button>
            <div class="a11y-controls__panel" id="a11y-panel" hidden>
            <div class="a11y-controls__group">
                <span class="a11y-controls__label">Text</span>
                <button class="a11y-controls__btn" id="btn-font-down" aria-label="Decrease font size" ${minDisabled}>A-</button>
                <button class="a11y-controls__btn" id="btn-font-up" aria-label="Increase font size" ${maxDisabled}>A+</button>
            </div>
            <div class="a11y-controls__group">
                <span class="a11y-controls__label">Theme</span>
                <button class="a11y-controls__btn" id="btn-theme-light" aria-label="Light theme" ${pressed('light')}>Day</button>
                <button class="a11y-controls__btn" id="btn-theme-dark" aria-label="Dark theme" ${pressed('dark')}>Night</button>
                <button class="a11y-controls__btn" id="btn-theme-system" aria-label="System theme" ${pressed('system')}>Auto</button>
            </div>
            </div>
        </div>
    `;
}

function wireA11yControls(root: HTMLElement): void {
    const displayToggle = root.querySelector<HTMLButtonElement>('#btn-display-toggle');
    const displayPanel = root.querySelector<HTMLElement>('#a11y-panel');
    displayToggle?.addEventListener('click', () => {
        if (!displayPanel) return;
        const opening = displayPanel.hidden;
        displayPanel.hidden = !opening;
        displayToggle.setAttribute('aria-expanded', String(opening));
    });

    const fontDown = root.querySelector<HTMLButtonElement>('#btn-font-down');
    const fontUp = root.querySelector<HTMLButtonElement>('#btn-font-up');

    function refreshFontButtons(): void {
        const size = getFontSize();
        if (fontDown) fontDown.disabled = size === FONT_SIZES[0];
        if (fontUp) fontUp.disabled = size === FONT_SIZES[FONT_SIZES.length - 1];
    }

    fontDown?.addEventListener('click', () => {
        decreaseFontSize();
        refreshFontButtons();
    });
    fontUp?.addEventListener('click', () => {
        increaseFontSize();
        refreshFontButtons();
    });

    const themeButtons: { id: string; mode: ThemeMode }[] = [
        { id: '#btn-theme-light', mode: 'light' },
        { id: '#btn-theme-dark', mode: 'dark' },
        { id: '#btn-theme-system', mode: 'system' },
    ];

    function refreshThemeButtons(): void {
        const current = getThemeMode();
        for (const { id, mode } of themeButtons) {
            const btn = root.querySelector<HTMLButtonElement>(id);
            btn?.setAttribute('aria-pressed', String(current === mode));
        }
    }

    for (const { id, mode } of themeButtons) {
        const btn = root.querySelector<HTMLButtonElement>(id);
        btn?.addEventListener('click', () => {
            setThemeMode(mode);
            refreshThemeButtons();
        });
    }

    root.querySelector<HTMLButtonElement>('#btn-sim-walk')?.addEventListener('click', () => {
        window.__breadcrumbsSimulator?.startWalk();
    });
    root.querySelector<HTMLButtonElement>('#btn-sim-return')?.addEventListener('click', () => {
        window.__breadcrumbsSimulator?.startReturn();
    });
    root.querySelector<HTMLButtonElement>('#btn-sim-weak-gps')?.addEventListener('click', () => {
        window.__breadcrumbsSimulator?.sendWeakFix();
    });
}

export function mountAppShell(root: HTMLElement): void {
    root.innerHTML = renderRecordingView();
    wireA11yControls(root);
}

function renderRecordingView(): string {
    return `
        <div class="home-status-bar home-status-bar--idle" id="home-status-bar" aria-live="polite"></div>
        ${renderA11yControls()}
        ${renderSimulatorControls()}
        <main class="home-main">
            <div class="home-status-card" id="recording-status-card">
                <div class="home-stats" id="recording-stats" aria-live="polite">
                    <span class="home-stats__time" id="elapsed-time">0:00</span>
                    <span class="home-stats__distance" id="distance-walked">0 m</span>
                </div>
                <span class="status-badge status-badge--idle" id="status-badge" aria-live="polite">
                    <span class="status-dot" aria-hidden="true"></span>
                    <span id="status-text">Idle</span>
                </span>
                <div id="stationary-badge" class="stationary-badge" aria-live="polite" hidden>
                    Stationary
                </div>
                <p class="route-quality route-quality--hidden" id="route-quality" aria-live="polite"></p>
                <p class="keep-open-hint" id="keep-open-hint" hidden>
                    Keep this app open with the screen on, or the route may stop recording.
                </p>
                <button
                    class="btn btn--secondary home-location-retry"
                    id="btn-location-retry"
                    aria-label="Try location again"
                    hidden
                >
                    Try location again
                </button>
            </div>
            <div class="actions" role="group" aria-label="Route actions">
                <button
                    class="home-take-me-back"
                    id="btn-take-me-back"
                    aria-label="Take me back to my starting point"
                    disabled
                >
                    Take me back
                </button>
                <div class="home-actions-row">
                    <button
                        class="btn btn--secondary"
                        id="btn-save-route"
                        aria-label="Save this route for later"
                        disabled
                    >
                        Save route
                    </button>
                    <button
                        class="btn btn--landmark"
                        id="btn-mark-landmark"
                        aria-label="Mark this spot as a landmark"
                        disabled
                    >
                        Landmark
                    </button>
                </div>
                <div class="home-actions-row">
                    <button
                        class="btn btn--secondary"
                        id="btn-view-routes"
                        aria-label="View saved routes"
                    >
                        Saved routes
                    </button>
                    <button
                        class="btn btn--secondary"
                        id="btn-more-options"
                        aria-label="More options"
                        aria-expanded="false"
                        aria-controls="more-panel"
                    >
                        More&hellip;
                    </button>
                </div>
                <div class="home-more-panel" id="more-panel" hidden>
                    <button
                        class="btn btn--danger"
                        id="btn-new-route"
                        aria-label="Clear current route and start a new route"
                        disabled
                    >
                        New route
                    </button>
                </div>
            </div>
        </main>
    `;
}

function setStatusRecording(root: HTMLElement): void {
    const badge = root.querySelector('#status-badge');
    const statusText = root.querySelector('#status-text');
    const stats = root.querySelector<HTMLElement>('#recording-stats');
    if (badge) {
        badge.classList.remove(
            'status-badge--idle',
            'status-badge--error',
            'status-badge--requesting'
        );
        badge.classList.add('status-badge--recording');
    }
    if (statusText) {
        statusText.textContent = 'Recording...';
    }
    if (stats) {
        stats.hidden = false;
    }
    // Simple mode status bar
    const simpleBar = root.querySelector<HTMLElement>('#home-status-bar');
    if (simpleBar) {
        simpleBar.classList.remove('home-status-bar--idle', 'home-status-bar--error');
        simpleBar.classList.add('home-status-bar--recording');
    }
}

export function formatElapsed(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m)}:${String(s).padStart(2, '0')}`;
}

export function formatDistance(meters: number): string {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${Math.round(meters)} m`;
}

function updateStats(root: HTMLElement, elapsedSeconds: number, totalMeters: number): void {
    const elapsedEl = root.querySelector('#elapsed-time');
    const distanceEl = root.querySelector('#distance-walked');
    if (elapsedEl) {
        elapsedEl.textContent = formatElapsed(elapsedSeconds);
    }
    if (distanceEl) {
        distanceEl.textContent = formatDistance(totalMeters);
    }
}

function updateRouteQuality(root: HTMLElement, message: string | null, urgent = false): void {
    const el = root.querySelector<HTMLElement>('#route-quality');
    if (!el) return;
    el.textContent = message ?? '';
    el.classList.toggle('route-quality--hidden', message === null);
    el.classList.toggle('route-quality--urgent', urgent);
}

export function updateStationaryBadge(
    root: HTMLElement,
    isStationary: boolean,
    isSuspended = false
): void {
    const badge = root.querySelector<HTMLElement>('#stationary-badge');
    if (badge) {
        badge.hidden = !isStationary && !isSuspended;
        if (isSuspended) {
            badge.textContent = 'Paused \u2014 saving battery';
            badge.classList.add('stationary-badge--suspended');
        } else {
            badge.textContent = 'Stationary';
            badge.classList.remove('stationary-badge--suspended');
        }
    }
}

function setStatusRequesting(root: HTMLElement): void {
    const badge = root.querySelector('#status-badge');
    const statusText = root.querySelector('#status-text');
    if (badge) {
        badge.classList.remove(
            'status-badge--idle',
            'status-badge--recording',
            'status-badge--error'
        );
        badge.classList.add('status-badge--requesting');
    }
    if (statusText) {
        statusText.textContent = 'Requesting location access\u2026';
    }
}

function setStatusGpsWeak(root: HTMLElement): void {
    const badge = root.querySelector('#status-badge');
    const statusText = root.querySelector('#status-text');
    if (badge) {
        badge.classList.remove(
            'status-badge--idle',
            'status-badge--recording',
            'status-badge--error'
        );
        badge.classList.add('status-badge--requesting');
    }
    if (statusText) {
        statusText.textContent = 'GPS signal is weak. Move toward open sky if you can.';
    }
}

function setStatusError(root: HTMLElement, message: string, options?: { retry?: boolean }): void {
    const badge = root.querySelector('#status-badge');
    const statusText = root.querySelector('#status-text');
    if (badge) {
        badge.classList.remove(
            'status-badge--idle',
            'status-badge--recording',
            'status-badge--requesting'
        );
        badge.classList.add('status-badge--error');
    }
    if (statusText) {
        statusText.textContent = message;
    }
    const retryBtn = root.querySelector<HTMLButtonElement>('#btn-location-retry');
    if (retryBtn) {
        retryBtn.hidden = options?.retry !== true;
        retryBtn.onclick = () => {
            mountAppShell(root);
            startRecording(root);
        };
    }
    // Simple mode status bar
    const simpleBar = root.querySelector<HTMLElement>('#home-status-bar');
    if (simpleBar) {
        simpleBar.classList.remove('home-status-bar--idle', 'home-status-bar--recording');
        simpleBar.classList.add('home-status-bar--error');
    }
}

function enableActionButtons(root: HTMLElement): void {
    const takeBack = root.querySelector<HTMLButtonElement>('#btn-take-me-back');
    const saveRoute = root.querySelector<HTMLButtonElement>('#btn-save-route');
    const markLandmark = root.querySelector<HTMLButtonElement>('#btn-mark-landmark');
    const newRoute = root.querySelector<HTMLButtonElement>('#btn-new-route');
    if (takeBack) takeBack.disabled = false;
    if (saveRoute) saveRoute.disabled = false;
    if (markLandmark) markLandmark.disabled = false;
    if (newRoute) newRoute.disabled = false;
}

export function mountNavigationView(root: HTMLElement): void {
    root.innerHTML = renderNavigationView();
    wireA11yControls(root);
}

function renderNavigationView(): string {
    return `
        ${renderA11yControls()}
        ${renderSimulatorControls()}
        <main class="nav-main">
            <section class="nav-panel nav-panel--idle" id="nav-panel">
                <div class="nav-direction" id="nav-direction" aria-live="polite">Finding way</div>
                <div class="nav-distance-display">
                    <span class="nav-distance-value" id="nav-distance-value">--</span>
                    <span class="nav-distance-label" id="nav-distance-label">to start</span>
                </div>
                <div class="nav-next-turn" id="nav-next-turn" aria-live="polite" hidden></div>
                <div class="nav-progress" id="nav-progress" aria-live="polite">
                    <span id="nav-progress-text">Loading&hellip;</span>
                </div>
                <div class="nav-recovery-hint" id="nav-recovery-hint" aria-live="polite" hidden></div>
            </section>
            <div class="nav-trail-container">
                <canvas class="nav-trail-canvas" id="nav-trail-canvas" aria-label="Trail map"></canvas>
                <div class="nav-zoom" role="group" aria-label="Map zoom">
                    <button class="nav-zoom__btn" id="nav-zoom-in" aria-label="Zoom in">+</button>
                    <button class="nav-zoom__btn" id="nav-zoom-out" aria-label="Zoom out">&minus;</button>
                    <button class="nav-zoom__btn nav-zoom__btn--auto" id="nav-zoom-auto" aria-label="Automatic zoom" hidden>Auto</button>
                </div>
                <div class="nav-compass-corner" aria-label="Compass direction indicator">
                    <svg class="nav-compass-arrow" id="nav-compass-arrow"
                        viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true">
                        <polygon points="50,5 62,70 50,60 38,70" class="compass-north"/>
                        <polygon points="50,95 62,30 50,40 38,30" class="compass-south"/>
                    </svg>
                    <p class="nav-calibration-hint" id="nav-calibration-hint" hidden>
                        Move your phone in a figure-8 to calibrate compass
                    </p>
                </div>
            </div>
        </main>
        <footer class="nav-footer">
            <div class="nav-footer__row">
                <button class="btn btn--secondary" id="btn-pocket-mode" aria-label="Put phone in pocket for voice-only navigation" hidden>
                    Pocket mode
                </button>
                <button class="btn btn--secondary" id="btn-enable-compass" aria-label="Enable compass direction" hidden>
                    Enable compass
                </button>
                <button class="btn btn--secondary" id="btn-silent-mode" aria-label="Toggle silent mode (tones and vibration only, no speech)" aria-pressed="false">
                    Silent: Off
                </button>
            </div>
            <div class="nav-arrival-actions" id="nav-arrival-actions" role="group" aria-label="You have arrived" hidden>
                <button class="btn btn--primary btn--large" id="btn-arrival-done" aria-label="Done, finish this walk">
                    Done
                </button>
                <button class="btn btn--secondary" id="btn-arrival-save" aria-label="Save this route for later">
                    Save this route
                </button>
            </div>
            <button class="btn btn--secondary" id="btn-stop-navigation" aria-label="Stop navigation and return to recording screen">
                Stop navigation
            </button>
        </footer>
    `;
}

function updateNavArrow(root: HTMLElement, arrowDeg: number): void {
    const arrow = root.querySelector<SVGElement>('#nav-compass-arrow');
    if (arrow) {
        arrow.style.transform = `rotate(${arrowDeg}deg)`;
    }
}

function updateNavDistance(root: HTMLElement, meters: number): void {
    const el = root.querySelector('#nav-distance-value');
    if (el) el.textContent = formatDistance(meters);
}

function updateNavProgress(root: HTMLElement, currentIndex: number, total: number): void {
    const el = root.querySelector('#nav-progress-text');
    if (!el) return;
    const current = Math.min(currentIndex + 1, total);
    el.textContent = `Breadcrumb ${current} of ${total}`;
}

/** A corner closer than this is announced as imminent. */
const TURN_SOON_METERS = 40;

function updateNavNextTurn(root: HTMLElement, turn: NextTurn | null): void {
    const el = root.querySelector<HTMLElement>('#nav-next-turn');
    if (!el) return;
    if (turn === null) {
        el.hidden = true;
        el.textContent = '';
        return;
    }
    el.hidden = false;
    el.textContent = `Turn ${turn.direction} in ${formatDistance(turn.meters)}`;
    el.classList.toggle('nav-next-turn--soon', turn.meters <= TURN_SOON_METERS);
}

function updateNavRecoveryHint(root: HTMLElement, message: string | null): void {
    const el = root.querySelector<HTMLElement>('#nav-recovery-hint');
    if (!el) return;
    el.hidden = message === null;
    el.textContent = message ?? '';
}

/** Map a Direction to a simple display word. */
function directionWord(dir: Direction): string {
    switch (dir) {
        case 'straight ahead':
            return 'STRAIGHT';
        case 'turn right':
            return 'TURN RIGHT';
        case 'turn left':
            return 'TURN LEFT';
        default:
            return 'BEHIND YOU';
    }
}

type PanelState = 'idle' | 'on-track' | 'turn' | 'wrong';

/** Map a Direction to the navigation panel's state (drives its colour). */
function panelState(dir: Direction): PanelState {
    switch (dir) {
        case 'straight ahead':
            return 'on-track';
        case 'turn right':
        case 'turn left':
            return 'turn';
        default:
            return 'wrong';
    }
}

function setPanelState(root: HTMLElement, state: PanelState): void {
    const panel = root.querySelector<HTMLElement>('#nav-panel');
    if (!panel) return;
    panel.classList.remove(
        'nav-panel--idle',
        'nav-panel--on-track',
        'nav-panel--turn',
        'nav-panel--wrong'
    );
    panel.classList.add(`nav-panel--${state}`);
}

function updateNavDirection(root: HTMLElement, dir: Direction, offRoute = false): void {
    const dirEl = root.querySelector<HTMLElement>('#nav-direction');
    if (dirEl) dirEl.textContent = directionWord(dir);
    // Off the route the panel is red whatever the direction, so it reads at a glance
    setPanelState(root, offRoute ? 'wrong' : panelState(dir));
}

function showNavArrived(root: HTMLElement): void {
    const el = root.querySelector('#nav-progress-text');
    if (el) el.textContent = "You're near your start point.";
    const distanceEl = root.querySelector('#nav-distance-value');
    if (distanceEl) distanceEl.textContent = '0 m';
    const arrow = root.querySelector<SVGElement>('#nav-compass-arrow');
    if (arrow) arrow.style.opacity = '0.3';
    const dirEl = root.querySelector<HTMLElement>('#nav-direction');
    if (dirEl) dirEl.textContent = 'ARRIVED';
    setPanelState(root, 'on-track');
    updateNavNextTurn(root, null);
}

/** Detects sustained off-course heading across consecutive GPS fixes. */
export interface OffCourseDetector {
    /**
     * Call on each GPS update with the bearing delta (target bearing minus
     * compass heading). Returns true when the off-course warning should fire.
     */
    check(bearingDelta: number): boolean;
    /** Reset state (e.g. when advancing to the next breadcrumb). */
    reset(): void;
}

/**
 * Factory for sustained off-course detection.
 * Triggers only when |bearingDelta| > 60° for 3+ consecutive fixes OR 3+ seconds.
 * After triggering, resets so it can fire again on the next sustained stretch.
 */
export function createOffCourseDetector(
    minFixes = 3,
    minMs = 3000,
    deltaThreshold = 60
): OffCourseDetector {
    let consecutiveCount = 0;
    let firstTime: number | null = null;

    function check(bearingDelta: number): boolean {
        // Normalize to -180..+180
        const delta = (((bearingDelta % 360) + 540) % 360) - 180;
        const isOffCourse = Math.abs(delta) > deltaThreshold;

        if (isOffCourse) {
            consecutiveCount++;
            if (firstTime === null) {
                firstTime = Date.now();
            }
            const elapsed = Date.now() - firstTime;
            if (consecutiveCount >= minFixes || elapsed >= minMs) {
                // Reset so we don't re-fire on every subsequent fix
                consecutiveCount = 0;
                firstTime = null;
                return true;
            }
        } else {
            consecutiveCount = 0;
            firstTime = null;
        }
        return false;
    }

    function reset(): void {
        consecutiveCount = 0;
        firstTime = null;
    }

    return { check, reset };
}

/** Shortest angular distance between two angles in degrees (0..180). */
export function shortestArcDistance(a: number, b: number): number {
    let diff = (((b - a) % 360) + 360) % 360;
    if (diff > 180) diff = 360 - diff;
    return diff;
}

/** Interpolate from angle `a` toward angle `b` by `t` (0..1), using shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
    let diff = (((b - a) % 360) + 360) % 360;
    if (diff > 180) diff -= 360;
    return (((a + diff * t) % 360) + 360) % 360;
}

export function switchToNavigationView(
    root: HTMLElement,
    breadcrumbsOverride?: Breadcrumb[]
): void {
    // Only one navigation session at a time: stop any that is still listening
    activeNavigationCleanup?.();
    activeNavigationCleanup = null;

    const followMode = breadcrumbsOverride !== undefined;
    root.classList.add('nav-active');
    mountNavigationView(root);
    const nav = createNavigationService();
    const compass = createCompassService();
    const feedback = createFeedbackService();
    const guidanceCoach = createGuidanceCoach();
    const orientationEvent = window.DeviceOrientationEvent as
        | DeviceOrientationEventWithPermission
        | undefined;
    const compassPermissionButton = root.querySelector<HTMLButtonElement>('#btn-enable-compass');

    if (compassPermissionButton && typeof orientationEvent?.requestPermission === 'function') {
        compassPermissionButton.hidden = false;
        updateNavRecoveryHint(
            root,
            'Enable compass for steadier turn directions, or start walking.'
        );
        compassPermissionButton.addEventListener('click', () => {
            orientationEvent
                .requestPermission?.()
                .then(permission => {
                    if (permission === 'granted') {
                        compassPermissionButton.hidden = true;
                        compass.start();
                        updateNavRecoveryHint(root, 'Compass enabled.');
                    } else {
                        updateNavRecoveryHint(
                            root,
                            'Compass blocked. Keep walking and the app will use GPS direction.'
                        );
                    }
                })
                .catch(() => {
                    updateNavRecoveryHint(
                        root,
                        'Compass could not start. Keep walking and the app will use GPS direction.'
                    );
                });
        });
    }

    // Wire up silent mode toggle
    const silentBtn = root.querySelector<HTMLButtonElement>('#btn-silent-mode');
    function updateSilentButton(): void {
        if (!silentBtn) return;
        const isOn = feedback.silentMode;
        silentBtn.textContent = isOn ? 'Silent mode: On' : 'Silent mode: Off';
        silentBtn.setAttribute('aria-pressed', String(isOn));
    }
    updateSilentButton();
    if (silentBtn) {
        silentBtn.addEventListener('click', () => {
            feedback.silentMode = !feedback.silentMode;
            updateSilentButton();
        });
    }

    // Zoom: automatic by default; + / - take over, Auto hands it back
    const zoomAutoBtn = root.querySelector<HTMLButtonElement>('#nav-zoom-auto');
    function setZoom(next: number | null): void {
        zoomIndex = next;
        if (zoomAutoBtn) zoomAutoBtn.hidden = next === null;
        renderTrail();
    }
    root.querySelector<HTMLButtonElement>('#nav-zoom-in')?.addEventListener('click', () => {
        // Closer in = shorter range. From automatic, start at the second step.
        setZoom(zoomIndex === null ? 1 : Math.max(0, zoomIndex - 1));
    });
    root.querySelector<HTMLButtonElement>('#nav-zoom-out')?.addEventListener('click', () => {
        setZoom(zoomIndex === null ? 2 : Math.min(ZOOM_RANGES_METERS.length - 1, zoomIndex + 1));
    });
    zoomAutoBtn?.addEventListener('click', () => setZoom(null));

    // Pocket mode: wake lock, audio keepalive, shake detector
    const wakeLock = createWakeLockManager();
    const audioKeepAlive = createAudioKeepAlive();
    const shakeDetector = createShakeDetector();
    let pocketMode = false;

    // Acquire wake lock by default (keep screen on)
    wakeLock.acquire().catch(() => {});

    function enterPocketMode(): void {
        pocketMode = true;
        wakeLock.release().catch(() => {});
        audioKeepAlive.start();
        shakeDetector.start();
        feedback.announce('Pocket mode on. Shake to wake.');
        const pocketBtn = root.querySelector<HTMLButtonElement>('#btn-pocket-mode');
        if (pocketBtn) pocketBtn.textContent = 'Exit pocket mode';
    }

    function exitPocketMode(): void {
        pocketMode = false;
        audioKeepAlive.stop();
        shakeDetector.stop();
        wakeLock.acquire().catch(() => {});
        feedback.announce('Screen on.');
        const pocketBtn = root.querySelector<HTMLButtonElement>('#btn-pocket-mode');
        if (pocketBtn) pocketBtn.textContent = 'Pocket mode';
    }

    shakeDetector.onShake = () => {
        if (pocketMode) exitPocketMode();
    };

    const pocketBtn = root.querySelector<HTMLButtonElement>('#btn-pocket-mode');
    if (pocketBtn) {
        pocketBtn.hidden = false;
        pocketBtn.addEventListener('click', () => {
            if (pocketMode) {
                exitPocketMode();
            } else {
                enterPocketMode();
            }
        });
    }

    let currentPos: Breadcrumb | null = null;
    let bearingToBreadcrumb: number | null = null;
    let trailBreadcrumbs: Breadcrumb[] = [];

    // Arrow smoothing state: deadzone + LERP
    let targetArrowDeg: number | null = null;
    let displayedArrowDeg: number | null = null;
    const ARROW_DEADZONE_DEG = 4;
    const ARROW_LERP_FACTOR = 0.3;

    const offCourseDetector = createOffCourseDetector();

    // Direction reliability: position smoother, heading fusion, hysteresis state
    const smoother = createPositionSmoother(3);
    const fusion = createHeadingFusion();
    const navGps = createGeolocationService({ disableMotionSuspension: true, emitEveryFix: true });
    let previousDirection: Direction | null = null;
    let lastDirectionUpdateTime = 0;
    const DIRECTION_THROTTLE_MS = 1000;

    // Trail renderer — initialised once breadcrumbs are loaded
    let trailRenderer: TrailRenderer | null = null;
    /** Manual zoom step (index into ZOOM_RANGES_METERS); null = automatic. */
    let zoomIndex: number | null = null;

    /**
     * Which way the user is facing: GPS course while walking, corrected compass when
     * stopped. A relative-only compass is never used raw, since it has no north.
     */
    function currentHeading(): number | null {
        const compassFallback = compass.absolute === false ? null : compass.compassHeading;
        return fusion.fusedHeading ?? compassFallback ?? navGps.movementBearing;
    }

    /** Update the big direction word, with hysteresis and a 1 s throttle so it never flickers. */
    function refreshDirection(): void {
        const heading = currentHeading();
        if (bearingToBreadcrumb === null || heading === null) return;
        const now = Date.now();
        if (now - lastDirectionUpdateTime < DIRECTION_THROTTLE_MS) return;
        lastDirectionUpdateTime = now;
        const dir = classifyDirectionWithHysteresis(
            bearingToBreadcrumb - heading,
            previousDirection
        );
        previousDirection = dir;
        updateNavDirection(root, dir, nav.isOffRoute);
    }

    /** Ask the coach what to say/buzz for the current state, and deliver it. */
    function deliverGuidance(accuracy?: number): void {
        if (!currentPos) return;
        const nearest = nav.nearestPathPoint(currentPos);
        const cues = guidanceCoach.update({
            arrived: nav.progress.arrived,
            offRoute: nav.isOffRoute,
            distanceToRoute: nearest?.distance ?? null,
            remainingMeters: nav.remainingMeters(currentPos),
            nextTurn: nav.nextTurn(currentPos),
            inGap: nav.inGap,
            currentIndex: nav.progress.currentIndex,
            accuracy: accuracy ?? currentPos.accuracy,
        });
        for (const cue of cues) feedback.cue(cue);
    }

    /** Arrived: celebrate, stop tracking, and offer Save / Done instead of "stop navigation". */
    function handleArrival(): void {
        showNavArrived(root);
        updateNavRecoveryHint(root, null);
        feedback.cancelPending();
        deliverGuidance();
        navGps.stop();
        compass.stop();
        if (pocketMode) exitPocketMode();

        const actions = root.querySelector<HTMLElement>('#nav-arrival-actions');
        const stopButton = root.querySelector<HTMLElement>('#btn-stop-navigation');
        if (stopButton) stopButton.hidden = true;
        if (!actions) return;
        actions.hidden = false;

        const saveButton = root.querySelector<HTMLButtonElement>('#btn-arrival-save');
        const doneButton = root.querySelector<HTMLButtonElement>('#btn-arrival-done');
        // A followed saved route is already saved and is not the recording session
        if (followMode && saveButton) saveButton.hidden = true;

        doneButton?.addEventListener('click', () => {
            if (followMode) {
                leaveNavigation();
                return;
            }
            // The walk is over: start fresh next time rather than resuming this trail
            clearSession()
                .catch(() => {})
                .finally(leaveNavigation);
        });

        saveButton?.addEventListener('click', () => {
            getSession()
                .then(session => {
                    const crumbs = session?.breadcrumbs ?? [];
                    // Saving clears the session, so just return to the recording screen after
                    openSaveModal(crumbs, trailDistanceMeters(crumbs), leaveNavigation);
                })
                .catch(() => {});
        });

        doneButton?.focus();
    }

    function renderTrail(): void {
        if (!trailRenderer || trailBreadcrumbs.length === 0) return;
        trailRenderer.render({
            trail: trailBreadcrumbs,
            currentIndex: nav.progress.currentIndex,
            currentPosition: currentPos,
            compassHeading: currentHeading(),
            isOffRoute: nav.isOffRoute,
            zoomRangeMeters: zoomIndex === null ? null : ZOOM_RANGES_METERS[zoomIndex],
            gapSegments: nav.gapSegments,
            guidePoint:
                nav.isOffRoute && currentPos
                    ? (nav.nearestPathPoint(currentPos)?.point ?? null)
                    : null,
        });
    }

    /**
     * Where to point the user. On the route: a look-ahead point along it, for a stable
     * bearing. Off the route: the nearest point of the route still to walk, so the arrow
     * always shows the quickest way back onto it.
     */
    function guidanceTarget(from: Breadcrumb): Breadcrumb | null {
        if (nav.isOffRoute) {
            const nearest = nav.nearestPathPoint(from);
            if (nearest) return nearest.point;
        }
        if (trailBreadcrumbs.length > 0) {
            return lookAheadPoint(trailBreadcrumbs, nav.progress.currentIndex, 30);
        }
        return nav.targetBreadcrumb;
    }

    function refreshArrow(): void {
        const posForBearing = smoother.smoothed ?? currentPos;
        if (posForBearing) {
            const bearingTarget = guidanceTarget(posForBearing);
            if (bearingTarget) {
                bearingToBreadcrumb = bearingDegrees(posForBearing, bearingTarget);
            }
        }
        const heading = currentHeading();
        if (bearingToBreadcrumb !== null && heading !== null) {
            const rawDeg = (bearingToBreadcrumb - heading + 360) % 360;

            // Deadzone: only update target if change exceeds threshold
            if (
                targetArrowDeg === null ||
                shortestArcDistance(rawDeg, targetArrowDeg) >= ARROW_DEADZONE_DEG
            ) {
                targetArrowDeg = rawDeg;
            }

            // LERP: smoothly interpolate displayed angle toward target
            if (displayedArrowDeg === null) {
                displayedArrowDeg = targetArrowDeg;
            } else {
                displayedArrowDeg = lerpAngle(displayedArrowDeg, targetArrowDeg, ARROW_LERP_FACTOR);
            }

            updateNavArrow(root, displayedArrowDeg);
        }
    }

    function refreshCalibrationHint(): void {
        const hint = root.querySelector<HTMLElement>('#nav-calibration-hint');
        if (!hint) return;
        const unreliable = !fusion.compassReliable;
        hint.hidden = !compass.needsCalibration && !unreliable;
        if (compass.needsCalibration) {
            hint.textContent = 'Move your phone in a figure-8 to calibrate compass';
        } else if (compass.absolute === false && fusion.offset === null) {
            hint.textContent = 'Walk a few steps so the arrow can find its bearings.';
        } else {
            hint.textContent = 'Compass is unreliable here. Keep walking and follow the arrow.';
        }
    }

    compass.onHeadingChange = (heading: number) => {
        // Feed compass heading into fusion
        fusion.updateCompass(heading, compass.absolute !== false);

        refreshArrow();
        refreshCalibrationHint();
        renderTrail();

        const fusedHeading = currentHeading();
        if (bearingToBreadcrumb !== null && fusedHeading !== null) {
            feedback.vibrateAlignment(bearingToBreadcrumb - fusedHeading);
        }
        refreshDirection();
    };

    const loadBreadcrumbs: Promise<Breadcrumb[]> = breadcrumbsOverride
        ? Promise.resolve(breadcrumbsOverride)
        : getSession().then(session => session?.breadcrumbs ?? []);

    loadBreadcrumbs
        .then(breadcrumbs => {
            if (breadcrumbs.length === 0) {
                const progressText = root.querySelector('#nav-progress-text');
                if (progressText) progressText.textContent = 'No route recorded yet.';
                return;
            }

            // Follow mode navigates forward through a saved route;
            // retrace mode reverses the recorded trail to guide the user back.
            if (followMode) {
                nav.loadForward(breadcrumbs);
            } else {
                nav.load(breadcrumbs);
            }

            // Render the trail in exactly the order the navigation service follows it
            trailBreadcrumbs = [...nav.trail];

            // Initialise trail renderer
            const canvas = root.querySelector<HTMLCanvasElement>('#nav-trail-canvas');
            if (canvas) {
                trailRenderer = createTrailRenderer({ canvas });
            }

            const progress = nav.progress;
            updateNavProgress(root, progress.currentIndex, progress.total);

            const distanceEl = root.querySelector('#nav-distance-value');
            if (distanceEl) distanceEl.textContent = '-- m';
            const distanceLabel = root.querySelector('#nav-distance-label');
            if (distanceLabel && followMode) distanceLabel.textContent = 'to finish';

            // No position is assumed: guidance starts with the first real GPS fix
            if (!compassPermissionButton || compassPermissionButton.hidden) {
                updateNavRecoveryHint(root, 'Finding your position\u2026');
            }

            compass.start();

            // Landmark announcement state
            let firstFix = true;
            let landmarkAnnouncedFar = false;
            let landmarkAnnouncedNear = false;

            nav.onOffRouteChange = (offRoute: boolean) => {
                // Recolour the panel straight away rather than waiting for the next direction update
                setPanelState(
                    root,
                    offRoute ? 'wrong' : previousDirection ? panelState(previousDirection) : 'idle'
                );
                if (offRoute) {
                    const nearest = currentPos ? nav.nearestPathPoint(currentPos) : null;
                    updateNavRecoveryHint(
                        root,
                        nearest
                            ? `Off trail \u2014 the route is ${formatDistance(nearest.distance)} away. Follow the direction back toward it.`
                            : 'Off trail. Turn until the direction says STRAIGHT, then walk back toward the route.'
                    );
                } else {
                    updateNavRecoveryHint(root, 'Back on track.');
                }
                renderTrail();
            };

            // Fixes worse than the GPS service's accuracy gate never reach the callback below,
            // so weak signal is reported through this hook instead.
            navGps.onPoorAccuracy = (accuracy: number) => {
                if (nav.progress.arrived) return;
                updateNavRecoveryHint(root, 'GPS signal is weak. Move toward open sky if you can.');
                deliverGuidance(accuracy);
            };

            navGps.start(
                (breadcrumb: Breadcrumb) => {
                    currentPos = breadcrumb;
                    smoother.push(breadcrumb);

                    // Feed GPS movement bearing into fusion for compass correction
                    if (navGps.movementBearing !== null && navGps.estimatedSpeedMs !== null) {
                        fusion.updateGps(navGps.movementBearing, navGps.estimatedSpeedMs);
                    }

                    if (nav.progress.arrived) {
                        handleArrival();
                        return;
                    }

                    const advanced = nav.advanceIfClose(breadcrumb);
                    if (advanced) {
                        feedback.playConfirmationBeep();
                        offCourseDetector.reset();
                        previousDirection = null; // reset hysteresis on breadcrumb advance
                        // Reset arrow smoothing so it snaps to the new target
                        targetArrowDeg = null;
                        displayedArrowDeg = null;
                        feedback.resetAlignmentHysteresis();
                        landmarkAnnouncedFar = false;
                        landmarkAnnouncedNear = false;
                        if (nav.progress.arrived) {
                            handleArrival();
                        } else {
                            const p = nav.progress;
                            updateNavProgress(root, p.currentIndex, p.total);
                        }
                    } else {
                        const p = nav.progress;
                        updateNavProgress(root, p.currentIndex, p.total);
                        // Check for sustained off-course heading on GPS updates
                        const headingForCheck = currentHeading();
                        if (bearingToBreadcrumb !== null && headingForCheck !== null) {
                            if (
                                offCourseDetector.check(bearingToBreadcrumb - headingForCheck) &&
                                !nav.isOffRoute
                            ) {
                                feedback.speak("you're going the wrong way");
                            }
                        }
                    }

                    const target = nav.targetBreadcrumb;
                    if (target) {
                        const dist = haversineMeters(breadcrumb, target);
                        updateNavDistance(root, nav.remainingMeters(breadcrumb));
                        feedback.vibrateProximity(dist);

                        // Smart GPS: low accuracy when far, high when close
                        if (pocketMode) {
                            navGps.setHighAccuracy(dist <= 100);
                        }

                        // Landmark announcements
                        if (target.label) {
                            if (!landmarkAnnouncedFar && dist <= 40) {
                                landmarkAnnouncedFar = true;
                                feedback.announce(
                                    `${target.label} ahead in ${Math.round(dist)} metres`
                                );
                            }
                            if (!landmarkAnnouncedNear && dist <= 15) {
                                landmarkAnnouncedNear = true;
                                feedback.announce(`Approaching ${target.label}`);
                            }
                        }
                    }

                    updateNavNextTurn(root, nav.nextTurn(breadcrumb));
                    deliverGuidance();

                    if (!nav.isOffRoute) {
                        const nearest = nav.nearestPathPoint(breadcrumb);
                        if (firstFix && nearest && nearest.distance > FAR_FROM_ROUTE_METERS) {
                            updateNavRecoveryHint(
                                root,
                                `You are ${formatDistance(nearest.distance)} from your route. Head toward it, then follow the direction.`
                            );
                        } else if (currentHeading() === null) {
                            updateNavRecoveryHint(
                                root,
                                'Waiting for direction. Point your phone forward or walk a few steps.'
                            );
                        } else if (nav.inGap) {
                            updateNavRecoveryHint(
                                root,
                                'GPS was lost along this stretch, so the route is a straight-line guess. Head for the next point.'
                            );
                        } else {
                            updateNavRecoveryHint(root, null);
                        }
                    }
                    firstFix = false;

                    refreshArrow();
                    refreshDirection();
                    renderTrail();
                },
                () => {
                    const progressText = root.querySelector('#nav-progress-text');
                    if (progressText)
                        progressText.textContent =
                            'Lost your location \u2014 stay still, trying to reconnect\u2026';
                }
            );
        })
        .catch(() => {
            const progressText = root.querySelector('#nav-progress-text');
            if (progressText) progressText.textContent = 'Could not load route.';
        });

    function cleanupPocketMode(): void {
        audioKeepAlive.stop();
        shakeDetector.stop();
        shakeDetector.onShake = null;
        wakeLock.destroy();
    }

    // A PWA in the background is throttled or stopped: warn as it goes there, and on return
    let hiddenAt: number | null = null;
    function handleVisibilityChange(): void {
        if (nav.progress.arrived) return;
        if (document.visibilityState === 'hidden') {
            // Pocket mode keeps the app alive on purpose with audio; it needs no warning
            if (pocketMode) return;
            hiddenAt = Date.now();
            feedback.cue({
                id: 'app-hidden',
                speech: 'The app is in the background. Keep it open on screen for directions.',
                haptic: [150, 100, 150],
                priority: 'critical',
            });
        } else if (hiddenAt !== null) {
            const away = Date.now() - hiddenAt;
            hiddenAt = null;
            if (away >= 10_000) {
                updateNavRecoveryHint(root, 'Welcome back. Waiting for a fresh GPS fix\u2026');
            }
        }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    /** Stop everything this navigation session started (GPS, compass, alerts, pocket mode). */
    function stopNavigationServices(): void {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        feedback.cancelPending();
        compass.stop();
        navGps.stop();
        cleanupPocketMode();
        if (activeNavigationCleanup === stopNavigationServices) activeNavigationCleanup = null;
    }
    activeNavigationCleanup = stopNavigationServices;

    /** Leave navigation and go back to the recording screen. */
    function leaveNavigation(): void {
        stopNavigationServices();
        root.classList.remove('nav-active');
        mountAppShell(root);
        startRecording(root);
    }

    const stopBtn = root.querySelector<HTMLButtonElement>('#btn-stop-navigation');
    if (stopBtn) {
        const HOLD_MS = 1000;
        let holdTimer: ReturnType<typeof setTimeout> | null = null;

        function cancelHold(): void {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            stopBtn!.classList.remove('btn-hold--active');
        }

        const doStop = leaveNavigation;

        stopBtn.addEventListener('pointerdown', (e: PointerEvent) => {
            e.preventDefault();
            stopBtn!.classList.add('btn-hold--active');
            holdTimer = setTimeout(() => {
                holdTimer = null;
                stopBtn!.classList.remove('btn-hold--active');
                openConfirmDialog(
                    'Stop directions?',
                    'You will stop getting directions. Your route is still saved \u2014 you can follow it again from Saved Routes.',
                    'Stop',
                    doStop,
                    { delay: 1500 }
                );
            }, HOLD_MS);
        });
        stopBtn.addEventListener('pointerup', cancelHold);
        stopBtn.addEventListener('pointercancel', cancelHold);
        stopBtn.addEventListener('pointerleave', cancelHold);
        // Prevent click from firing after hold
        stopBtn.addEventListener('click', (e: MouseEvent) => e.preventDefault());
    }
}

/** On the first fix, further than this from the route gets an immediate "head toward it" message. */
const FAR_FROM_ROUTE_METERS = 100;

let modalOpen = false;

/** @internal Reset modal guard — exposed for tests only. */
export function _resetModalOpen(): void {
    modalOpen = false;
}

export function openLandmarkPicker(onSelect: (label: string) => void): void {
    if (modalOpen) return;
    modalOpen = true;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'landmark-modal-title');

    const presetButtons = LANDMARK_PRESETS.map(
        p =>
            `<button class="landmark-btn" data-label="${escapeHtml(p.label)}" aria-label="Mark as ${escapeHtml(p.label)}">
                <span class="landmark-btn__icon" aria-hidden="true">${p.icon}</span>
                <span>${escapeHtml(p.label)}</span>
            </button>`
    ).join('');

    backdrop.innerHTML = `
        <div class="modal">
            <h2 id="landmark-modal-title">Mark landmark</h2>
            <div class="landmark-grid">${presetButtons}</div>
            <div class="landmark-custom">
                <input
                    class="modal-input"
                    id="landmark-custom-input"
                    type="text"
                    placeholder="Custom label"
                    aria-label="Custom landmark label"
                    maxlength="40"
                    autocomplete="off"
                />
                <button class="btn btn--primary" id="btn-landmark-custom-confirm" aria-label="Confirm custom landmark">OK</button>
            </div>
            <div class="modal-actions">
                <button class="btn btn--secondary" id="btn-landmark-cancel" aria-label="Cancel marking landmark">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    const customInput = backdrop.querySelector<HTMLInputElement>('#landmark-custom-input');

    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Escape') closeModal();
    }

    function closeModal(): void {
        modalOpen = false;
        document.removeEventListener('keydown', handleKeydown);
        backdrop.remove();
    }

    function select(label: string): void {
        closeModal();
        onSelect(label);
    }

    document.addEventListener('keydown', handleKeydown);

    // Preset buttons
    for (const btn of backdrop.querySelectorAll<HTMLButtonElement>('.landmark-btn')) {
        btn.addEventListener('click', () => {
            const label = btn.dataset.label;
            if (label) select(label);
        });
    }

    // Custom input
    const customConfirm = backdrop.querySelector<HTMLButtonElement>('#btn-landmark-custom-confirm');
    if (customConfirm && customInput) {
        customConfirm.addEventListener('click', () => {
            const label = customInput.value.trim();
            if (label) select(label);
        });
        customInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                const label = customInput.value.trim();
                if (label) select(label);
            }
        });
    }

    // Cancel button
    const cancelBtn = backdrop.querySelector<HTMLButtonElement>('#btn-landmark-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // Backdrop click
    backdrop.addEventListener('click', (e: MouseEvent) => {
        if (e.target === backdrop) closeModal();
    });
}

export function openSaveModal(
    breadcrumbs: Breadcrumb[],
    totalMeters: number,
    onSaved?: () => void
): void {
    if (modalOpen) return;
    modalOpen = true;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'save-modal-title');

    backdrop.innerHTML = `
        <div class="modal">
            <h2 id="save-modal-title">Save this route</h2>
            <input
                class="modal-input"
                id="save-route-name"
                type="text"
                placeholder="Route name (e.g. Morning walk)"
                aria-label="Route name"
                maxlength="80"
                autocomplete="off"
            />
            <div class="modal-actions">
                <button class="btn btn--primary" id="btn-save-confirm" aria-label="Confirm and save route">Save route</button>
                <button class="btn btn--secondary" id="btn-save-cancel" aria-label="Cancel saving route">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    const input = backdrop.querySelector<HTMLInputElement>('#save-route-name');
    const confirmBtn = backdrop.querySelector<HTMLButtonElement>('#btn-save-confirm');
    const cancelBtn = backdrop.querySelector<HTMLButtonElement>('#btn-save-cancel');

    // Focus input on open
    setTimeout(() => input?.focus(), 0);

    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            closeModal();
        }
    }

    function closeModal(): void {
        modalOpen = false;
        document.removeEventListener('keydown', handleKeydown);
        backdrop.remove();
    }

    document.addEventListener('keydown', handleKeydown);

    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeModal);
    }

    // Allow dismissing by clicking outside the modal panel
    backdrop.addEventListener('click', (e: MouseEvent) => {
        if (e.target === backdrop) closeModal();
    });

    // Bug 5: Enter key submits the save modal
    if (input) {
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                confirmBtn?.click();
            }
        });
    }

    if (confirmBtn && input) {
        confirmBtn.addEventListener('click', () => {
            const name = input.value.trim();
            if (!name) {
                input.focus();
                return;
            }
            // Clear any stale error message from a previous attempt
            const existingError = backdrop.querySelector('.modal-error');
            if (existingError) existingError.remove();

            confirmBtn.disabled = true;

            const route = {
                id: `route-${Date.now()}`,
                name,
                date: Date.now(),
                distance: totalMeters,
                breadcrumbCount: breadcrumbs.length,
                breadcrumbs,
                landmarkCount: breadcrumbs.filter(b => b.label).length,
            };
            saveRoute(route)
                .then(async () => {
                    closeModal();
                    await clearSession();
                    onSaved?.();
                })
                .catch(() => {
                    confirmBtn.disabled = false;
                    const modal = backdrop.querySelector('.modal');
                    if (modal) {
                        const errorMsg = document.createElement('p');
                        errorMsg.className = 'modal-error';
                        errorMsg.textContent = 'Could not save route. Please try again.';
                        modal.appendChild(errorMsg);
                    }
                });
        });
    }
}

export function formatRouteDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

export function mountSavedRoutesView(root: HTMLElement, onBack: () => void): void {
    root.innerHTML = `
        ${renderA11yControls()}
        <main>
            <div class="routes-screen">
                <button class="btn btn--secondary" id="btn-routes-back" aria-label="Back to recording screen">
                    &larr; Back
                </button>
                <div id="routes-list-container" aria-live="polite">
                    <p class="routes-empty">Loading routes&hellip;</p>
                </div>
            </div>
        </main>
    `;

    wireA11yControls(root);

    const backBtn = root.querySelector<HTMLButtonElement>('#btn-routes-back');
    if (backBtn) {
        backBtn.addEventListener('click', onBack);
    }

    renderRoutesList(root, onBack);
}

function renderRoutesList(root: HTMLElement, onBack: () => void): void {
    const container = root.querySelector<HTMLElement>('#routes-list-container');
    if (!container) return;

    listRoutes()
        .then(routes => {
            if (routes.length === 0) {
                container.innerHTML =
                    '<p class="routes-empty">No saved routes yet. Record a walk and tap "Save this route".</p>';
                return;
            }

            const list = document.createElement('ul');
            list.className = 'routes-list';
            list.setAttribute('aria-label', 'Saved routes');

            for (const route of routes) {
                const item = buildRouteCard(route, root, onBack);
                list.appendChild(item);
            }

            container.innerHTML = '';
            container.appendChild(list);
        })
        .catch(() => {
            container.innerHTML = '<p class="routes-empty">Could not load saved routes.</p>';
        });
}

function buildRouteCard(route: SavedRoute, root: HTMLElement, onBack: () => void): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'route-card';
    item.dataset.routeId = route.id;

    const distanceText = formatDistance(route.distance);
    const dateText = formatRouteDate(route.date);
    const countText = `${route.breadcrumbCount} point${route.breadcrumbCount === 1 ? '' : 's'}`;
    const landmarks = route.landmarkCount ?? route.breadcrumbs.filter(b => b.label).length;
    const landmarkHtml =
        landmarks > 0
            ? `<span class="route-card__landmarks">${landmarks} landmark${landmarks === 1 ? '' : 's'}</span>`
            : '';

    item.innerHTML = `
        <div class="route-card__name">${escapeHtml(route.name)}</div>
        <div class="route-card__meta">
            <span>${dateText}</span>
            <span>${distanceText}</span>
            <span>${countText}</span>
            ${landmarkHtml}
        </div>
        <div class="route-card__actions">
            <button class="btn btn--primary btn--sm" data-action="follow" aria-label="Follow route ${escapeHtml(route.name)}">Follow</button>
            <button class="btn btn--danger btn--sm" data-action="delete" aria-label="Delete route ${escapeHtml(route.name)}">Delete</button>
        </div>
    `;

    const followBtn = item.querySelector<HTMLButtonElement>('[data-action="follow"]');
    if (followBtn) {
        followBtn.addEventListener('click', () => {
            switchToNavigationView(root, route.breadcrumbs);
        });
    }

    const deleteBtn = item.querySelector<HTMLButtonElement>('[data-action="delete"]');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            openDeleteConfirmDialog(route, root, onBack);
        });
    }

    return item;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function openConfirmDialog(
    title: string,
    message: string,
    confirmLabel: string,
    onConfirm: () => void,
    options?: { delay?: number; cancelLabel?: string; onCancel?: () => void }
): void {
    if (modalOpen) return;
    modalOpen = true;

    const delayMs = options?.delay ?? 0;
    const cancelLabel = options?.cancelLabel ?? 'Cancel';

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'confirm-modal-title');

    backdrop.innerHTML = `
        <div class="modal">
            <h2 id="confirm-modal-title">${escapeHtml(title)}</h2>
            <p class="confirm-dialog-text">${escapeHtml(message)}</p>
            <div class="modal-actions">
                <button class="btn btn--primary${delayMs > 0 ? ' btn--delayed' : ''}" id="btn-confirm-yes" aria-label="${escapeHtml(confirmLabel)}"${delayMs > 0 ? ' disabled' : ''}>${delayMs > 0 ? 'Wait\u2026' : escapeHtml(confirmLabel)}</button>
                <button class="btn btn--secondary" id="btn-confirm-cancel" aria-label="${escapeHtml(cancelLabel)}">${escapeHtml(cancelLabel)}</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    const confirmBtn = backdrop.querySelector<HTMLButtonElement>('#btn-confirm-yes');

    // If delay is set, enable the confirm button after the delay
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    if (delayMs > 0 && confirmBtn) {
        delayTimer = setTimeout(() => {
            confirmBtn.disabled = false;
            confirmBtn.classList.remove('btn--delayed');
            confirmBtn.textContent = confirmLabel;
        }, delayMs);
    }

    function cancelDialog(): void {
        closeDialog();
        options?.onCancel?.();
    }

    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Escape') cancelDialog();
    }

    function closeDialog(): void {
        modalOpen = false;
        if (delayTimer) clearTimeout(delayTimer);
        document.removeEventListener('keydown', handleKeydown);
        backdrop.remove();
    }

    document.addEventListener('keydown', handleKeydown);

    const cancelBtn = backdrop.querySelector<HTMLButtonElement>('#btn-confirm-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelDialog);

    backdrop.addEventListener('click', (e: MouseEvent) => {
        if (e.target === backdrop) cancelDialog();
    });

    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            closeDialog();
            onConfirm();
        });
    }
}

function openDeleteConfirmDialog(route: SavedRoute, root: HTMLElement, onBack: () => void): void {
    if (modalOpen) return;
    modalOpen = true;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'delete-modal-title');

    backdrop.innerHTML = `
        <div class="modal">
            <h2 id="delete-modal-title">Delete route?</h2>
            <p class="delete-dialog-text">"${escapeHtml(route.name)}" will be permanently deleted.</p>
            <div class="modal-actions">
                <button class="btn btn--danger" id="btn-delete-confirm" aria-label="Confirm delete route">Delete</button>
                <button class="btn btn--secondary" id="btn-delete-cancel" aria-label="Cancel delete">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            closeDialog();
        }
    }

    function closeDialog(): void {
        modalOpen = false;
        document.removeEventListener('keydown', handleKeydown);
        backdrop.remove();
    }

    document.addEventListener('keydown', handleKeydown);

    const cancelBtn = backdrop.querySelector<HTMLButtonElement>('#btn-delete-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeDialog);
    }

    backdrop.addEventListener('click', (e: MouseEvent) => {
        if (e.target === backdrop) closeDialog();
    });

    const confirmBtn = backdrop.querySelector<HTMLButtonElement>('#btn-delete-confirm');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            confirmBtn.disabled = true;
            deleteRoute(route.id)
                .then(() => {
                    closeDialog();
                    renderRoutesList(root, onBack);
                })
                .catch(() => {
                    confirmBtn.disabled = false;
                    const modal = backdrop.querySelector('.modal');
                    if (modal && !modal.querySelector('.modal-error')) {
                        const errorMsg = document.createElement('p');
                        errorMsg.className = 'modal-error';
                        errorMsg.textContent = 'Could not delete route. Please try again.';
                        modal.appendChild(errorMsg);
                    }
                });
        });
    }
}

/** Screen lock overlay to prevent accidental pocket presses during recording. */
function createScreenLock(root: HTMLElement): { destroy: () => void } {
    const LOCK_DELAY_MS = 15_000;
    const HOLD_DURATION_MS = 1000;
    let lockTimer: ReturnType<typeof setTimeout> | null = null;
    let overlay: HTMLElement | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;

    function showLock(): void {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'screen-lock-overlay';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-label', 'Screen locked. Press and hold to unlock.');
        overlay.innerHTML = `
            <div class="screen-lock__content">
                <div class="screen-lock__icon" aria-hidden="true">&#128274;</div>
                <div class="screen-lock__text">Screen locked</div>
                <div class="screen-lock__hint">Press and hold to unlock</div>
            </div>
            <div class="screen-lock__progress-bar"></div>
        `;
        overlay.addEventListener('pointerdown', handleHoldStart);
        overlay.addEventListener('pointerup', handleHoldEnd);
        overlay.addEventListener('pointercancel', handleHoldEnd);
        // Prevent any touch events from reaching buttons underneath
        overlay.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
        root.appendChild(overlay);
    }

    function hideLock(): void {
        if (overlay) {
            overlay.removeEventListener('pointerdown', handleHoldStart);
            overlay.removeEventListener('pointerup', handleHoldEnd);
            overlay.removeEventListener('pointercancel', handleHoldEnd);
            overlay.remove();
            overlay = null;
        }
        cancelHold();
        resetTimer();
    }

    function handleHoldStart(): void {
        if (!overlay) return;
        const bar = overlay.querySelector<HTMLElement>('.screen-lock__progress-bar');
        const hint = overlay.querySelector<HTMLElement>('.screen-lock__hint');
        if (bar) bar.classList.add('screen-lock__progress-bar--active');
        if (hint) hint.textContent = 'Hold to unlock\u2026';
        holdTimer = setTimeout(() => {
            hideLock();
        }, HOLD_DURATION_MS);
    }

    function handleHoldEnd(): void {
        cancelHold();
    }

    function cancelHold(): void {
        if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
        if (overlay) {
            const bar = overlay.querySelector<HTMLElement>('.screen-lock__progress-bar');
            const hint = overlay.querySelector<HTMLElement>('.screen-lock__hint');
            if (bar) bar.classList.remove('screen-lock__progress-bar--active');
            if (hint) hint.textContent = 'Press and hold to unlock';
        }
    }

    function resetTimer(): void {
        if (lockTimer) clearTimeout(lockTimer);
        lockTimer = setTimeout(showLock, LOCK_DELAY_MS);
    }

    function handleActivity(): void {
        if (!overlay) {
            resetTimer();
        }
    }

    root.addEventListener('touchstart', handleActivity, { passive: true });
    root.addEventListener('click', handleActivity);
    resetTimer();

    function destroy(): void {
        if (lockTimer) clearTimeout(lockTimer);
        if (holdTimer) clearTimeout(holdTimer);
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
        root.removeEventListener('touchstart', handleActivity);
        root.removeEventListener('click', handleActivity);
    }

    return { destroy };
}

/** A saved-but-unfinished route older than this is not silently continued. */
const STALE_SESSION_MS = 2 * 60 * 60 * 1000;

export function formatAge(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${String(Math.max(minutes, 1))} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return hours === 1 ? '1 hour ago' : `${String(hours)} hours ago`;
    return `${String(Math.floor(hours / 24))} days ago`;
}

/** Ask whether to keep adding to an old unsaved route. Resolves true to keep it. */
function askKeepStaleSession(ageMs: number, meters: number): Promise<boolean> {
    return new Promise(resolve => {
        if (modalOpen) {
            resolve(true);
            return;
        }
        openConfirmDialog(
            'Old route found',
            `You have an unsaved route from ${formatAge(ageMs)} (${formatDistance(meters)}). Start a new route from here, or keep adding to the old one?`,
            'Start new route',
            () => resolve(false),
            { cancelLabel: 'Keep old route', onCancel: () => resolve(true) }
        );
    });
}

export function startRecording(root: HTMLElement): void {
    activeRecordingCleanup?.();
    activeRecordingCleanup = null;

    if (!navigator.geolocation) {
        setStatusError(
            root,
            'Location is not supported by this browser. Please use a modern browser with GPS support.'
        );
        return;
    }

    if (!window.isSecureContext) {
        setStatusError(
            root,
            'Location requires HTTPS. Please use localhost or enable HTTPS in your dev server.'
        );
        return;
    }

    setStatusRequesting(root);
    let gotResponse = false;
    let requestTimeout: ReturnType<typeof setTimeout> | null = null;
    function clearRequestTimeout(): void {
        if (requestTimeout !== null) clearTimeout(requestTimeout);
        requestTimeout = null;
    }
    function armRequestTimeout(): void {
        if (requestTimeout !== null || gotResponse) return;
        requestTimeout = setTimeout(() => {
            if (!gotResponse) {
                setStatusError(
                    root,
                    'Location access timed out. Check browser permissions and try reloading.'
                );
            }
        }, 10_000);
    }
    // Don't count the time the user spends reading the permission prompt as a timeout.
    if (navigator.permissions?.query) {
        navigator.permissions
            .query({ name: 'geolocation' })
            .then(status => {
                if (status.state === 'prompt') {
                    status.onchange = () => {
                        if (status.state !== 'prompt') armRequestTimeout();
                    };
                } else {
                    armRequestTimeout();
                }
            })
            .catch(armRequestTimeout);
    } else {
        armRequestTimeout();
    }

    const gps = createGeolocationService();
    const wakeLock = createWakeLockManager();
    let breadcrumbCount = 0;
    let totalMeters = 0;
    let lastBreadcrumb: Breadcrumb | null = null;
    let startTime: number | null = null;
    let timerInterval: ReturnType<typeof setInterval> | null = null;
    let screenLock: { destroy: () => void } | null = null;
    let restoredExistingSession = false;
    let recordingActionsWired = false;
    let poorAccuracyStreak = 0;

    // "More..." reveals the rarely used, harder-to-undo actions
    const moreBtn = root.querySelector<HTMLButtonElement>('#btn-more-options');
    const morePanel = root.querySelector<HTMLElement>('#more-panel');
    if (moreBtn && morePanel) {
        moreBtn.addEventListener('click', () => {
            const opening = morePanel.hidden;
            morePanel.hidden = !opening;
            moreBtn.setAttribute('aria-expanded', String(opening));
            moreBtn.textContent = opening ? 'Less' : 'More\u2026';
        });
    }

    function cleanupRecording(): void {
        gps.stop();
        wakeLock.destroy();
        if (timerInterval !== null) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (screenLock) {
            screenLock.destroy();
            screenLock = null;
        }
        if (activeRecordingCleanup === cleanupRecording) {
            activeRecordingCleanup = null;
        }
    }

    activeRecordingCleanup = cleanupRecording;

    // Keep the screen on so the browser keeps delivering GPS fixes; warn if it can't.
    function refreshKeepOpenHint(): void {
        const hint = root.querySelector<HTMLElement>('#keep-open-hint');
        if (hint) hint.hidden = wakeLock.isActive;
    }
    wakeLock
        .acquire()
        .then(refreshKeepOpenHint)
        .catch(() => {
            refreshKeepOpenHint();
        });

    gps.onGpsLostChange = (lost: boolean) => {
        if (lost) {
            updateRouteQuality(root, 'Lost GPS - reconnecting. Keep this app open.', true);
        } else {
            updateRouteQuality(root, 'GPS is back.');
            setTimeout(() => updateRouteQuality(root, null), 4000);
        }
    };

    // Ask the browser not to evict the saved route under storage pressure.
    navigator.storage?.persist?.().catch(() => {});

    function startStatsTimer(): void {
        if (timerInterval !== null) return;
        timerInterval = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - (startTime ?? Date.now())) / 1000);
            updateStats(root, elapsedSeconds, totalMeters);
        }, 1000);
    }

    function ensureRecordingActionsWired(): void {
        if (recordingActionsWired) return;
        recordingActionsWired = true;

        const markBtn = root.querySelector<HTMLButtonElement>('#btn-mark-landmark');
        if (markBtn) {
            markBtn.addEventListener('click', () => {
                openLandmarkPicker((label: string) => {
                    updateLastBreadcrumb(b => ({ ...b, label })).catch(() => {
                        // Silent fail — breadcrumb label not critical
                    });
                });
            });
        }

        gps.onStationaryChange = (isStationary: boolean) => {
            updateStationaryBadge(root, isStationary, gps.isSuspended);
        };

        gps.onSuspendedChange = (isSuspended: boolean) => {
            updateStationaryBadge(root, gps.isStationary, isSuspended);
        };

        const takeBackBtn = root.querySelector<HTMLButtonElement>('#btn-take-me-back');
        if (takeBackBtn) {
            takeBackBtn.addEventListener('click', () => {
                openConfirmDialog(
                    'Go back now?',
                    'This will stop your walk and guide you back near where you started.',
                    'Take me back',
                    () => {
                        cleanupRecording();
                        switchToNavigationView(root);
                    },
                    { delay: 1500 }
                );
            });
        }

        const saveBtn = root.querySelector<HTMLButtonElement>('#btn-save-route');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const onSaved = () => {
                    cleanupRecording();
                    mountAppShell(root);
                    startRecording(root);
                };
                getSession()
                    .then(session => {
                        openSaveModal(session?.breadcrumbs ?? [], totalMeters, onSaved);
                    })
                    .catch(() => {
                        openSaveModal([], totalMeters, onSaved);
                    });
            });
        }

        const newRouteBtn = root.querySelector<HTMLButtonElement>('#btn-new-route');
        if (newRouteBtn) {
            newRouteBtn.addEventListener('click', () => {
                openConfirmDialog(
                    'Start a new route?',
                    'This clears the current unsaved route and starts recording from here.',
                    'New route',
                    () => {
                        cleanupRecording();
                        clearSession()
                            .catch(() => {
                                updateRouteQuality(
                                    root,
                                    'Could not clear the current route.',
                                    true
                                );
                            })
                            .finally(() => {
                                mountAppShell(root);
                                startRecording(root);
                            });
                    }
                );
            });
        }
    }

    // Crumbs are only persisted once this settles, so a stale-session choice can't race them.
    const sessionReady: Promise<void> = getSession()
        .then(async session => {
            if (!session || session.breadcrumbs.length === 0) return;
            const lastCrumb = session.breadcrumbs[session.breadcrumbs.length - 1];
            const ageMs = Date.now() - lastCrumb.timestamp;
            if (ageMs > STALE_SESSION_MS) {
                const keep = await askKeepStaleSession(
                    ageMs,
                    trailDistanceMeters(session.breadcrumbs)
                );
                if (!keep) {
                    await clearSession();
                    return;
                }
            }
            restoredExistingSession = true;
            breadcrumbCount = session.breadcrumbs.length;
            totalMeters = trailDistanceMeters(session.breadcrumbs);
            lastBreadcrumb = session.breadcrumbs[session.breadcrumbs.length - 1];
            startTime = session.startedAt;
            setStatusRecording(root);
            ensureRecordingActionsWired();
            enableActionButtons(root);
            updateRouteQuality(root, 'Continuing your previous route. Use New route to reset.');
            updateStats(
                root,
                Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000)),
                totalMeters
            );
            startStatsTimer();
            if (!screenLock) {
                screenLock = createScreenLock(root);
            }
        })
        .catch(() => {
            // A failed restore should not block a fresh recording.
        });

    const viewRoutesBtn = root.querySelector<HTMLButtonElement>('#btn-view-routes');
    if (viewRoutesBtn) {
        viewRoutesBtn.addEventListener('click', () => {
            cleanupRecording();
            mountSavedRoutesView(root, () => {
                mountAppShell(root);
                startRecording(root);
            });
        });
    }

    gps.onPoorAccuracy = () => {
        poorAccuracyStreak++;
        updateRouteQuality(
            root,
            'GPS weak - route may be rough. Move toward open sky if you can.',
            true
        );
        if (breadcrumbCount === 0) {
            gotResponse = true;
            clearRequestTimeout();
            setStatusGpsWeak(root);
        }
    };

    gps.start(
        async (breadcrumb: Breadcrumb) => {
            if (!gotResponse) {
                gotResponse = true;
                clearRequestTimeout();
            }
            await sessionReady;
            try {
                await appendBreadcrumb(breadcrumb);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Failed to persist breadcrumb:', e);
            }
            breadcrumbCount++;

            if (lastBreadcrumb !== null) {
                totalMeters += haversineMeters(lastBreadcrumb, breadcrumb);
            }
            lastBreadcrumb = breadcrumb;

            if (breadcrumb.accuracy > 20) {
                updateRouteQuality(
                    root,
                    `GPS accuracy is about ${Math.round(
                        breadcrumb.accuracy
                    )} m - use extra care on the return.`,
                    true
                );
            } else if (poorAccuracyStreak > 0) {
                poorAccuracyStreak = 0;
                updateRouteQuality(root, 'GPS looks better now.');
                setTimeout(() => updateRouteQuality(root, null), 5000);
            } else if (breadcrumbCount < 3) {
                updateRouteQuality(
                    root,
                    'Keep walking a little farther for a more reliable route.'
                );
            } else {
                updateRouteQuality(root, null);
            }

            updateStationaryBadge(root, gps.isStationary, gps.isSuspended);

            if (breadcrumbCount === 1 || restoredExistingSession) {
                const isFirstRenderForRestoredSession = restoredExistingSession;
                restoredExistingSession = false;
                setStatusRecording(root);
                enableActionButtons(root);

                // Activate screen lock to prevent accidental pocket presses
                if (!screenLock) {
                    screenLock = createScreenLock(root);
                }

                ensureRecordingActionsWired();

                if (!startTime) {
                    startTime = isFirstRenderForRestoredSession ? breadcrumb.timestamp : Date.now();
                }
                startStatsTimer();
                const elapsedSeconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
                updateStats(root, elapsedSeconds, totalMeters);
            } else {
                const elapsedSeconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
                updateStats(root, elapsedSeconds, totalMeters);
            }
        },
        (error: GeolocationPositionError) => {
            gotResponse = true;
            clearRequestTimeout();
            if (timerInterval !== null) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
            let message: string;
            if (error.code === error.PERMISSION_DENIED) {
                message =
                    'Location is turned off. Allow location for this browser and make sure Location is on for this app.';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                message =
                    'Can\u2019t find your location. Try going outside or moving away from buildings.';
            } else {
                message =
                    'Taking too long to find you. Try going outside, then tap the button again.';
            }
            setStatusError(root, message, { retry: true });
        }
    );
}

const appRoot = document.getElementById('app');
if (appRoot) {
    installBreadcrumbSimulator();
    initSettings();
    mountAppShell(appRoot);
    startRecording(appRoot);

    // Delegated button tap feedback for elderly users —
    // provides haptic + audio confirmation that a tap registered
    const tapFeedback = createFeedbackService();
    appRoot.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('.btn, .a11y-controls__btn, .simple-take-me-back')) {
            tapFeedback.playButtonTap();
        }
    });
}
