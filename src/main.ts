import './styles.css';
import { createGeolocationService } from '@/gps';
import {
    appendBreadcrumb,
    getSession,
    saveRoute,
    listRoutes,
    deleteRoute,
    clearSession,
} from '@/storage';
import { haversineMeters, bearingDegrees } from '@/geo';
import { createNavigationService, createCompassService } from '@/navigation';
import { createFeedbackService, classifyDirection } from '@/feedback';
import type { Breadcrumb, SavedRoute } from '@/types';

export function mountAppShell(root: HTMLElement): void {
    root.innerHTML = `
        <header>
            <h1>Breadcrumbs</h1>
        </header>
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
    if (takeBack) takeBack.disabled = false;
    if (saveRoute) saveRoute.disabled = false;
}

export function mountNavigationView(root: HTMLElement): void {
    root.innerHTML = `
        <header>
            <h1>Breadcrumbs</h1>
        </header>
        <main>
            <div class="nav-view">
                <div class="nav-compass-container" aria-label="Compass direction indicator">
                    <svg class="nav-compass-arrow" id="nav-compass-arrow"
                        viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true">
                        <polygon points="50,5 62,70 50,60 38,70" fill="#1d4ed8"/>
                        <polygon points="50,95 62,30 50,40 38,30" fill="#9ca3af"/>
                    </svg>
                    <p class="nav-calibration-hint" id="nav-calibration-hint" hidden>
                        Move your phone in a figure-8 to calibrate compass
                    </p>
                </div>
                <div class="nav-distance-display">
                    <span class="nav-distance-value" id="nav-distance-value">--</span>
                    <span class="nav-distance-label">to next point</span>
                </div>
                <div class="nav-progress" id="nav-progress" aria-live="polite">
                    <span id="nav-progress-text">Loading&hellip;</span>
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
        if (bearingToBreadcrumb !== null && compass.compassHeading !== null) {
            const bearingDelta = bearingToBreadcrumb - compass.compassHeading;
            feedback.speak(classifyDirection(bearingDelta));
            feedback.vibrateAlignment(bearingDelta);
        }
    };

    const navGps = createGeolocationService();

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

            const progress = nav.progress;
            updateNavProgress(root, progress.currentIndex + 1, progress.total);

            const distanceEl = root.querySelector('#nav-distance-value');
            if (distanceEl) distanceEl.textContent = '-- m';

            compass.start();

            navGps.start(
                (breadcrumb: Breadcrumb) => {
                    currentPos = breadcrumb;

                    if (nav.progress.arrived) {
                        showNavArrived(root);
                        return;
                    }

                    const target = nav.targetBreadcrumb;
                    if (target) {
                        const dist = haversineMeters(breadcrumb, target);
                        updateNavDistance(root, dist);
                        feedback.announceDistance(dist);
                        feedback.vibrateProximity(dist);
                    }

                    const advanced = nav.advanceIfClose(breadcrumb);
                    if (advanced) {
                        feedback.playConfirmationBeep();
                        feedback.resetDistanceAnnouncements();
                        if (nav.progress.arrived) {
                            showNavArrived(root);
                        } else {
                            const p = nav.progress;
                            updateNavProgress(root, p.currentIndex + 1, p.total);
                        }
                    } else {
                        const p = nav.progress;
                        updateNavProgress(root, p.currentIndex + 1, p.total);
                    }

                    refreshArrow();
                },
                () => {
                    // GPS error during navigation — keep existing display, don't crash
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
            compass.stop();
            navGps.stop();
            mountAppShell(root);
            startRecording(root);
        });
    }
}

export function openSaveModal(
    breadcrumbs: Breadcrumb[],
    totalMeters: number,
    onSaved?: () => void
): void {
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

    function closeModal(): void {
        backdrop.remove();
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeModal);
    }

    // Allow dismissing by clicking outside the modal panel
    backdrop.addEventListener('click', (e: MouseEvent) => {
        if (e.target === backdrop) closeModal();
    });

    if (confirmBtn && input) {
        confirmBtn.addEventListener('click', () => {
            const name = input.value.trim();
            if (!name) {
                input.focus();
                return;
            }
            const route = {
                id: `route-${Date.now()}`,
                name,
                date: Date.now(),
                distance: totalMeters,
                breadcrumbCount: breadcrumbs.length,
                breadcrumbs,
            };
            saveRoute(route)
                .then(() => {
                    closeModal();
                    onSaved?.();
                })
                .catch(() => {
                    const modal = backdrop.querySelector('.modal');
                    if (modal && !modal.querySelector('.modal-error')) {
                        const errorMsg = document.createElement('p');
                        errorMsg.className = 'modal-error';
                        errorMsg.style.color = '#dc2626';
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

    item.innerHTML = `
        <div class="route-card__name">${escapeHtml(route.name)}</div>
        <div class="route-card__meta">
            <span>${dateText}</span>
            <span>${distanceText}</span>
            <span>${countText}</span>
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
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'delete-modal-title');

    backdrop.innerHTML = `
        <div class="modal">
            <h2 id="delete-modal-title">Delete route?</h2>
            <p style="color:#374151;">"${escapeHtml(route.name)}" will be permanently deleted.</p>
            <div class="modal-actions">
                <button class="btn btn--danger" id="btn-delete-confirm" aria-label="Confirm delete route">Delete</button>
                <button class="btn btn--secondary" id="btn-delete-cancel" aria-label="Cancel delete">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    function closeDialog(): void {
        backdrop.remove();
    }

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
            deleteRoute(route.id)
                .then(() => {
                    closeDialog();
                    renderRoutesList(root, onBack);
                })
                .catch(() => {
                    closeDialog();
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

    clearSession();

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
            await appendBreadcrumb(breadcrumb);
            breadcrumbCount++;

            if (lastBreadcrumb !== null) {
                totalMeters += haversineMeters(lastBreadcrumb, breadcrumb);
            }
            lastBreadcrumb = breadcrumb;

            if (breadcrumbCount === 1) {
                setStatusRecording(root);
                enableActionButtons(root);

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
                        getSession()
                            .then(session => {
                                openSaveModal(session?.breadcrumbs ?? [], totalMeters);
                            })
                            .catch(() => {
                                openSaveModal([], totalMeters);
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
    mountAppShell(appRoot);
    startRecording(appRoot);
}
