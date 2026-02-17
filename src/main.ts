import './styles.css';
import { createGeolocationService } from '@/gps';
import { createTrailRenderer } from '@/trail-renderer';
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
import { haversineMeters, bearingDegrees } from '@/geo';
import { createNavigationService, createCompassService } from '@/navigation';
import { createFeedbackService } from '@/feedback';
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
import { LANDMARK_PRESETS } from '@/landmarks';
import type { Breadcrumb, SavedRoute } from '@/types';

function renderA11yControls(): string {
    const size = getFontSize();
    const mode = getThemeMode();
    const minDisabled = size === FONT_SIZES[0] ? 'disabled' : '';
    const maxDisabled = size === FONT_SIZES[FONT_SIZES.length - 1] ? 'disabled' : '';

    function pressed(m: ThemeMode): string {
        return mode === m ? 'aria-pressed="true"' : 'aria-pressed="false"';
    }

    return `
        <div class="a11y-controls" role="toolbar" aria-label="Accessibility controls">
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
    `;
}

function wireA11yControls(root: HTMLElement): void {
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
}

export function mountAppShell(root: HTMLElement): void {
    root.innerHTML = `
        <header>
            <h1>Breadcrumbs</h1>
        </header>
        ${renderA11yControls()}
        <main>
            <div class="card" id="recording-status-card">
                <h2>Recording Status</h2>
                <div id="status-indicator">
                    <span class="status-badge status-badge--idle" id="status-badge" aria-live="polite">
                        <span class="status-dot" aria-hidden="true"></span>
                        <span id="status-text">Idle</span>
                    </span>
                </div>
                <div class="recording-stats" id="recording-stats" aria-live="polite" hidden>
                    <div class="stat">
                        <span class="stat-value" id="elapsed-time">0:00</span>
                        <span class="stat-label">elapsed</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value" id="distance-walked">0 m</span>
                        <span class="stat-label">walked</span>
                    </div>
                </div>
                <div id="stationary-badge" class="stationary-badge" aria-live="polite" hidden>
                    Stationary
                </div>
            </div>
            <div class="actions" role="group" aria-label="Route actions">
                <button
                    class="btn btn--primary"
                    id="btn-take-me-back"
                    aria-label="Take me back to my starting point"
                    disabled
                >
                    Take me back
                </button>
                <button
                    class="btn btn--secondary"
                    id="btn-save-route"
                    aria-label="Save this route for later"
                    disabled
                >
                    Save this route
                </button>
                <button
                    class="btn btn--landmark"
                    id="btn-mark-landmark"
                    aria-label="Mark this spot as a landmark"
                    disabled
                >
                    Mark landmark
                </button>
                <button
                    class="btn btn--secondary"
                    id="btn-view-routes"
                    aria-label="View saved routes"
                >
                    Saved routes
                </button>
            </div>
        </main>
        <footer>Breadcrumbs &mdash; map-free navigation</footer>
    `;
    wireA11yControls(root);
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

function setStatusError(root: HTMLElement, message: string): void {
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
}

function enableActionButtons(root: HTMLElement): void {
    const takeBack = root.querySelector<HTMLButtonElement>('#btn-take-me-back');
    const saveRoute = root.querySelector<HTMLButtonElement>('#btn-save-route');
    const markLandmark = root.querySelector<HTMLButtonElement>('#btn-mark-landmark');
    if (takeBack) takeBack.disabled = false;
    if (saveRoute) saveRoute.disabled = false;
    if (markLandmark) markLandmark.disabled = false;
}

export function mountNavigationView(root: HTMLElement): void {
    root.innerHTML = `
        <header>
            <h1>Breadcrumbs</h1>
        </header>
        ${renderA11yControls()}
        <main>
            <div class="nav-view">
                <div class="nav-primary">
                    <div class="nav-trail-container">
                        <canvas class="nav-trail-canvas" id="nav-trail-canvas" aria-label="Trail map"></canvas>
                        <div class="nav-trail-overlay">
                            <div class="nav-distance-display">
                                <span class="nav-distance-value" id="nav-distance-value">--</span>
                                <span class="nav-distance-label">to next point</span>
                            </div>
                            <div class="nav-progress" id="nav-progress" aria-live="polite">
                                <span id="nav-progress-text">Loading&hellip;</span>
                            </div>
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
                </div>
            </div>
        </main>
        <footer>
            <button class="btn btn--secondary" id="btn-stop-navigation" aria-label="Stop navigation and return to recording screen">
                Stop navigation
            </button>
            <button class="btn btn--secondary" id="btn-silent-mode" aria-label="Toggle silent mode (tones and vibration only, no speech)" aria-pressed="false">
                Silent mode: Off
            </button>
        </footer>
    `;
    wireA11yControls(root);
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

function updateNavProgress(root: HTMLElement, current: number, total: number): void {
    const el = root.querySelector('#nav-progress-text');
    if (el) el.textContent = `Breadcrumb ${current} of ${total}`;
}

function showNavArrived(root: HTMLElement): void {
    const el = root.querySelector('#nav-progress-text');
    if (el) el.textContent = "You've arrived!";
    const distanceEl = root.querySelector('#nav-distance-value');
    if (distanceEl) distanceEl.textContent = '0 m';
    const arrow = root.querySelector<SVGElement>('#nav-compass-arrow');
    if (arrow) arrow.style.opacity = '0.3';
}

/**
 * Detects if advancing to a new navigation leg requires a major turn (> 90°).
 *
 * @param fromPos    The current GPS position (where the user just was)
 * @param prevTarget The breadcrumb just reached
 * @param newTarget  The next target breadcrumb
 * @returns 'turn left', 'turn right', or null if no major turn
 */
export function majorTurnDirection(
    fromPos: Breadcrumb,
    prevTarget: Breadcrumb,
    newTarget: Breadcrumb
): 'turn left' | 'turn right' | null {
    const prevBearing = bearingDegrees(fromPos, prevTarget);
    const newBearing = bearingDegrees(prevTarget, newTarget);

    // Compute the signed angular difference from prevBearing to newBearing
    let delta = newBearing - prevBearing;
    // Normalise to -180..+180
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    if (delta > 90) return 'turn right';
    if (delta < -90) return 'turn left';
    return null;
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

export function switchToNavigationView(
    root: HTMLElement,
    breadcrumbsOverride?: Breadcrumb[]
): void {
    const followMode = breadcrumbsOverride !== undefined;
    mountNavigationView(root);
    const nav = createNavigationService();
    const compass = createCompassService();
    const feedback = createFeedbackService();

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

    let currentPos: Breadcrumb | null = null;
    let bearingToBreadcrumb: number | null = null;
    let trailBreadcrumbs: Breadcrumb[] = [];

    const offCourseDetector = createOffCourseDetector();

    // Trail renderer — initialised once breadcrumbs are loaded
    let trailRenderer: TrailRenderer | null = null;

    function renderTrail(): void {
        if (!trailRenderer || trailBreadcrumbs.length === 0) return;
        trailRenderer.render({
            trail: trailBreadcrumbs,
            currentIndex: nav.progress.currentIndex,
            currentPosition: currentPos,
            compassHeading: compass.compassHeading,
            isOffRoute: nav.isOffRoute,
        });
    }

    function refreshArrow(): void {
        const target = nav.targetBreadcrumb;
        if (currentPos && target) {
            bearingToBreadcrumb = bearingDegrees(currentPos, target);
        }
        const compassHeading = compass.compassHeading;
        if (bearingToBreadcrumb !== null && compassHeading !== null) {
            const arrowDeg = (bearingToBreadcrumb - compassHeading + 360) % 360;
            updateNavArrow(root, arrowDeg);
        }
    }

    function refreshCalibrationHint(): void {
        const hint = root.querySelector<HTMLElement>('#nav-calibration-hint');
        if (hint) hint.hidden = !compass.needsCalibration;
    }

    compass.onHeadingChange = () => {
        refreshArrow();
        refreshCalibrationHint();
        renderTrail();
        if (bearingToBreadcrumb !== null && compass.compassHeading !== null) {
            const bearingDelta = bearingToBreadcrumb - compass.compassHeading;
            feedback.vibrateAlignment(bearingDelta);
        }
    };

    const navGps = createGeolocationService({ disableMotionSuspension: true });

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

            // Store trail for rendering (nav.load() reverses, nav.loadForward() doesn't)
            // We always render the trail in the order that NavigationService uses it.
            // Access the ordered trail via nav.progress and nav.targetBreadcrumb won't give us
            // the full list, so we reconstruct from breadcrumbs + navigation mode.
            trailBreadcrumbs = followMode ? breadcrumbs : [...breadcrumbs].reverse();

            // Initialise trail renderer
            const canvas = root.querySelector<HTMLCanvasElement>('#nav-trail-canvas');
            if (canvas) {
                trailRenderer = createTrailRenderer({ canvas });
            }

            const progress = nav.progress;
            updateNavProgress(root, progress.currentIndex + 1, progress.total);

            const distanceEl = root.querySelector('#nav-distance-value');
            if (distanceEl) distanceEl.textContent = '-- m';

            compass.start();

            // Landmark announcement state
            let landmarkAnnouncedFar = false;
            let landmarkAnnouncedNear = false;

            nav.onOffRouteChange = (offRoute: boolean) => {
                if (offRoute) {
                    feedback.playOffRouteFeedback();
                } else {
                    feedback.playBackOnTrackFeedback();
                }
                renderTrail();
            };

            navGps.start(
                (breadcrumb: Breadcrumb) => {
                    currentPos = breadcrumb;

                    if (nav.progress.arrived) {
                        showNavArrived(root);
                        feedback.cancelPending();
                        feedback.playArrivalFeedback();
                        navGps.stop();
                        compass.stop();
                        return;
                    }

                    const target = nav.targetBreadcrumb;
                    if (target) {
                        const dist = haversineMeters(breadcrumb, target);
                        updateNavDistance(root, dist);
                        feedback.announceDistance(dist);
                        feedback.vibrateProximity(dist);

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

                    const prevTarget = nav.targetBreadcrumb;
                    const advanced = nav.advanceIfClose(breadcrumb);
                    if (advanced) {
                        feedback.playConfirmationBeep();
                        feedback.resetDistanceAnnouncements();
                        offCourseDetector.reset();
                        landmarkAnnouncedFar = false;
                        landmarkAnnouncedNear = false;
                        if (nav.progress.arrived) {
                            showNavArrived(root);
                            feedback.cancelPending();
                            feedback.playArrivalFeedback();
                            navGps.stop();
                            compass.stop();
                        } else {
                            const p = nav.progress;
                            updateNavProgress(root, p.currentIndex + 1, p.total);
                            // Announce major turn (> 90°) when the new leg requires it
                            const newTarget = nav.targetBreadcrumb;
                            if (prevTarget && newTarget) {
                                const turn = majorTurnDirection(breadcrumb, prevTarget, newTarget);
                                if (turn) {
                                    feedback.announce(turn);
                                }
                            }
                        }
                    } else {
                        const p = nav.progress;
                        updateNavProgress(root, p.currentIndex + 1, p.total);
                        // Check for sustained off-course heading on GPS updates
                        if (bearingToBreadcrumb !== null && compass.compassHeading !== null) {
                            if (
                                offCourseDetector.check(
                                    bearingToBreadcrumb - compass.compassHeading
                                )
                            ) {
                                feedback.speak("you're going the wrong way");
                            }
                        }
                    }

                    refreshArrow();
                    renderTrail();
                },
                () => {
                    const progressText = root.querySelector('#nav-progress-text');
                    if (progressText) progressText.textContent = 'GPS signal lost, trying\u2026';
                }
            );
        })
        .catch(() => {
            const progressText = root.querySelector('#nav-progress-text');
            if (progressText) progressText.textContent = 'Could not load route.';
        });

    const stopBtn = root.querySelector<HTMLButtonElement>('#btn-stop-navigation');
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            feedback.cancelPending();
            compass.stop();
            navGps.stop();
            mountAppShell(root);
            startRecording(root);
        });
    }
}

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
        <header>
            <h1>Breadcrumbs</h1>
        </header>
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
        <footer>Breadcrumbs &mdash; map-free navigation</footer>
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

export function startRecording(root: HTMLElement): void {
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
    const requestTimeout = setTimeout(() => {
        if (!gotResponse) {
            setStatusError(
                root,
                'Location access timed out. Check browser permissions and try reloading.'
            );
        }
    }, 10_000);

    const gps = createGeolocationService();
    let breadcrumbCount = 0;
    let totalMeters = 0;
    let lastBreadcrumb: Breadcrumb | null = null;
    let startTime: number | null = null;
    let timerInterval: ReturnType<typeof setInterval> | null = null;

    const viewRoutesBtn = root.querySelector<HTMLButtonElement>('#btn-view-routes');
    if (viewRoutesBtn) {
        viewRoutesBtn.addEventListener('click', () => {
            gps.stop();
            if (timerInterval !== null) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
            mountSavedRoutesView(root, () => {
                mountAppShell(root);
                startRecording(root);
            });
        });
    }

    gps.start(
        async (breadcrumb: Breadcrumb) => {
            if (!gotResponse) {
                gotResponse = true;
                clearTimeout(requestTimeout);
            }
            try {
                await appendBreadcrumb(breadcrumb);
            } catch (e) {
                console.error('Failed to persist breadcrumb:', e);
            }
            breadcrumbCount++;

            if (lastBreadcrumb !== null) {
                totalMeters += haversineMeters(lastBreadcrumb, breadcrumb);
            }
            lastBreadcrumb = breadcrumb;

            updateStationaryBadge(root, gps.isStationary, gps.isSuspended);

            if (breadcrumbCount === 1) {
                setStatusRecording(root);
                enableActionButtons(root);

                // Wire landmark button
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

                // Wire suspension badge
                gps.onSuspendedChange = (isSuspended: boolean) => {
                    updateStationaryBadge(root, gps.isStationary, isSuspended);
                };

                const takeBackBtn = root.querySelector<HTMLButtonElement>('#btn-take-me-back');
                if (takeBackBtn) {
                    takeBackBtn.addEventListener('click', () => {
                        gps.stop();
                        if (timerInterval !== null) {
                            clearInterval(timerInterval);
                            timerInterval = null;
                        }
                        switchToNavigationView(root);
                    });
                }

                const saveBtn = root.querySelector<HTMLButtonElement>('#btn-save-route');
                if (saveBtn) {
                    saveBtn.addEventListener('click', () => {
                        const onSaved = () => {
                            gps.stop();
                            if (timerInterval !== null) {
                                clearInterval(timerInterval);
                                timerInterval = null;
                            }
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

                startTime = Date.now();
                timerInterval = setInterval(() => {
                    const elapsedSeconds = Math.floor(
                        (Date.now() - (startTime ?? Date.now())) / 1000
                    );
                    updateStats(root, elapsedSeconds, totalMeters);
                }, 1000);
                updateStats(root, 0, totalMeters);
            } else {
                const elapsedSeconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
                updateStats(root, elapsedSeconds, totalMeters);
            }
        },
        (error: GeolocationPositionError) => {
            gotResponse = true;
            clearTimeout(requestTimeout);
            if (timerInterval !== null) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
            let message: string;
            if (error.code === error.PERMISSION_DENIED) {
                message = 'Location access denied. Please allow location to record your route.';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                message = 'Location unavailable. Please check your GPS signal.';
            } else {
                message = 'Location error. Please try again.';
            }
            setStatusError(root, message);
        }
    );
}

const appRoot = document.getElementById('app');
if (appRoot) {
    initSettings();
    mountAppShell(appRoot);
    clearSession().then(() => startRecording(appRoot));
}
