# Implementation Plan

## Status

- Planning iterations: 24
- Build iterations: 0
- Last updated: 2026-09-24 (added Phases 10-16: real-world reliability plan, PWA-only)

## Tasks

### Phase 1: PWA Shell (spec: pwa-shell.md)

- [x] Wire up src/main.ts: replace placeholder with real app shell DOM (title, recording status card, "Take me back" and "Save this route" action buttons); extract inline index.html CSS to src/styles.css and import in main.ts; ensure 48px minimum tap targets and high-contrast colors (spec: pwa-shell.md)
- [x] Create public/icons/ directory (public/ does not exist yet) and generate placeholder app icons at 192x192 and 512x512; vite.config.ts already references these paths (spec: pwa-shell.md)
- [x] Write Vitest unit tests for app shell mounting (verify DOM elements rendered, buttons present) (spec: pwa-shell.md)

### Phase 2: GPS Recording (spec: gps-recording.md)

- [x] Create `src/types.ts` — define Breadcrumb `{ lat, lng, accuracy, timestamp }` and Session types used across all modules (spec: gps-recording.md)
- [x] Implement Haversine distance calculation in `src/geo.ts`; export `haversineMeters(a, b)` (spec: gps-recording.md)
- [x] Write unit tests for `haversineMeters` in `src/geo.test.ts` (spec: gps-recording.md)
- [x] Install `idb` as a direct dependency (`npm install idb`) and `fake-indexeddb` as a devDependency (`npm install -D fake-indexeddb`); then create `src/storage.ts` — IndexedDB wrapper using `idb`: `openDB()`, `appendBreadcrumb()`, `getSession()`, `clearSession()` (spec: gps-recording.md)
- [x] Write unit tests for storage module using fake-indexeddb (import `fake-indexeddb/auto` in test file) (spec: gps-recording.md)
- [x] Create `src/gps.ts` — GeolocationService: `watchPosition` with `enableHighAccuracy: true`, distance-based filtering (10m), accuracy threshold (30m), calls back with each accepted Breadcrumb (spec: gps-recording.md)
- [x] Wire GPS recording into main.ts: start on app load, persist each breadcrumb via storage.ts, update recording UI (spec: gps-recording.md)
- [x] Update recording UI in index.html/main.ts: show "Recording..." badge, elapsed time, distance walked in large text (spec: gps-recording.md)
- [x] Handle GPS permission request with friendly prompt; show user-facing error message on denial/unavailable (spec: gps-recording.md)
- [x] Write unit tests for GPS breadcrumb filtering logic (distance threshold, accuracy filtering) (spec: gps-recording.md)
- [x] Write unit tests for GeolocationService: mock `navigator.geolocation`, verify watchPosition called with enableHighAccuracy, verify error callback invoked on denial (spec: gps-recording.md)

### Phase 3: Retrace Navigation (spec: retrace-navigation.md)

- [x] Add bearing calculation to `src/geo.ts`: `bearingDegrees(from, to)` using atan2 formula (spec: retrace-navigation.md)
- [x] Write unit tests for `bearingDegrees` (cardinal directions: N/S/E/W expected values) (spec: retrace-navigation.md)
- [x] Create `src/navigation.ts` — NavigationService: reverse breadcrumb trail, track current target index, `advanceIfClose(pos, threshold=15)`, expose `progress` and `targetBreadcrumb` (spec: retrace-navigation.md)
- [x] Implement DeviceOrientation compass in `src/navigation.ts`: `alpha` on Android, `webkitCompassHeading` on iOS; expose `compassHeading`; handle compass calibration prompt on devices that require it (spec: retrace-navigation.md)
- [x] Add large "Take me back" button to main screen (shown when session has breadcrumbs); switches app to navigation view (spec: retrace-navigation.md)
- [x] Create navigation view in main.ts: large compass arrow SVG rotated by `(bearingToBreadcrumb - compassHeading)`, distance in large text, progress "Breadcrumb N of M" (spec: retrace-navigation.md)
- [x] Auto-advance to next breadcrumb when within 15m; show "You've arrived!" screen when last breadcrumb reached (spec: retrace-navigation.md)
- [x] Write unit tests for NavigationService: trail reversal, proximity detection, index advancement (spec: retrace-navigation.md)

### Phase 4: Multi-Modal Feedback (spec: multi-modal-feedback.md)

- [x] Create `src/feedback.ts` — FeedbackService: spoken directions via Web Speech API (`SpeechSynthesisUtterance`) for "turn left", "turn right", "straight ahead", "you're going the wrong way" (spec: multi-modal-feedback.md)
- [x] Add distance announcements via speech: "50 metres", "20 metres", "almost there" triggered at proximity thresholds (spec: multi-modal-feedback.md)
- [x] Implement audio tones via Web Audio API in feedback.ts: confirmation beep on breadcrumb advance, proximity alert tone (spec: multi-modal-feedback.md)
- [x] Implement haptic feedback via Vibration API: short pulse when aligned to target, stronger/faster as user approaches breadcrumb (spec: multi-modal-feedback.md)
- [x] Detect Vibration API support (`'vibrate' in navigator`); fall back to audio-only on iOS/unsupported browsers (spec: multi-modal-feedback.md)
- [x] Add silent mode toggle button in navigation view (tones + vibration only, no speech); persist preference in localStorage; toggle live during navigation (spec: multi-modal-feedback.md)
- [x] Throttle feedback updates (debounce heading changes, min interval between speech announcements) to avoid overwhelming user (spec: multi-modal-feedback.md)
- [x] Write unit tests for direction classification (left/right/straight/wrong way from bearing delta), throttle logic (spec: multi-modal-feedback.md)

### Phase 5: Saved Routes (spec: saved-routes.md)

- [x] Extend `src/storage.ts`: add `SavedRoute` type (name, date, distance, breadcrumbCount, breadcrumbs[]) and `saveRoute()`, `listRoutes()`, `deleteRoute()` IndexedDB operations (spec: saved-routes.md)
- [x] Add "Save this route" button to main screen (shown when session has breadcrumbs alongside "Take me back"); opens save modal (spec: saved-routes.md)
- [x] Create save-route modal: large text input for route name, confirm/cancel buttons; on confirm, persist to IndexedDB via storage.ts (spec: saved-routes.md)
- [x] Create saved routes list screen (accessible from main screen): show name, date, distance, breadcrumb count per route; tap to navigate, swipe/button to delete (spec: saved-routes.md)
- [x] Implement follow mode in navigation.ts: load saved route, navigate breadcrumbs in forward order using same compass+distance UI as retrace (spec: saved-routes.md)
- [x] Implement delete saved route with confirmation dialog (spec: saved-routes.md)
- [x] Write unit tests for route persistence, listing, and deletion via storage.ts (spec: saved-routes.md)

### Phase 6: Compass Smoothing (spec: compass-smoothing.md)

- [x] Add exponential moving average (EMA) smoothing to compass heading in `src/navigation.ts`: wrap raw heading values with `smoothHeading(raw)` using alpha ~0.2; handle 0°/360° wraparound using shortest-arc interpolation (spec: compass-smoothing.md)
- [x] Clamp compass update rate to ~10fps in `CompassService.onHeadingChange` — skip intermediate events to reduce DOM thrashing (spec: compass-smoothing.md)
- [x] Add CSS transition to compass arrow SVG rotation (`transition: transform 300ms ease-out`) for visual smoothness between JS updates (spec: compass-smoothing.md)
- [x] Reduce compass arrow size in navigation view: change from dominant element to small 48x48px indicator; reposition to corner of navigation area (spec: compass-smoothing.md)
- [x] Write unit tests for heading smoothing: verify EMA output, wraparound handling (359°→1° transition), and that smoothed heading converges to raw heading within 500ms of a 90° turn (spec: compass-smoothing.md)

### Phase 7: Voice Feedback Tuning (spec: voice-tuning.md)

- [x] Remove per-heading-change direction announcements from navigation loop in `main.ts`; stop calling `speak(classifyDirection(...))` on every `compass.onHeadingChange` (spec: voice-tuning.md)
- [x] Add sustained off-course detection: track bearing delta over consecutive GPS updates; only trigger "you're going the wrong way" when delta > 60° for 3+ consecutive fixes or 3+ seconds (spec: voice-tuning.md)
- [x] Add major-turn announcement: when advancing to next breadcrumb, compare bearing of new leg vs previous leg; announce direction if turn > 90° (spec: voice-tuning.md)
- [x] Increase `MIN_SPEECH_INTERVAL_MS` from 5000ms to 10000ms in `src/feedback.ts` (spec: voice-tuning.md)
- [x] Add arrival feedback: spoken "You've arrived!" announcement, distinct haptic pattern `[200, 100, 200, 100, 200]`, and lower-pitch confirmation tone when navigation completes; fire haptic+tone even in silent mode (spec: voice-tuning.md)
- [x] Write unit tests for sustained off-course detection logic, major-turn detection, and arrival feedback triggers (spec: voice-tuning.md)

### Phase 8: Trail View Navigation (spec: trail-view.md)

- [x] Create `src/trail-renderer.ts` — Canvas 2D trail renderer: project lat/lng to local x/y using equirectangular projection; draw breadcrumb polyline with walked (grey) and remaining (blue) segments (spec: trail-view.md)
- [x] Add Catmull-Rom spline interpolation to trail renderer for smooth "wiggly line" appearance between breadcrumb points (spec: trail-view.md)
- [x] Implement auto-zoom: calculate bounding box of remaining route + current position, apply 15% padding, smooth zoom transitions; minimum 3 upcoming breadcrumbs always visible (spec: trail-view.md)
- [x] Implement heading-up rotation: rotate entire canvas by `-compassHeading` so direction of travel points up (spec: trail-view.md)
- [x] Render current position dot (prominent, e.g. blue circle) and next-target waypoint (highlighted) on the trail canvas (spec: trail-view.md)
- [x] Integrate trail canvas into navigation view in `main.ts`: replace large compass as primary element; overlay distance text and progress indicator; keep small compass arrow in corner (spec: trail-view.md)
- [x] Implement off-route detection in `src/navigation.ts`: calculate perpendicular distance from current position to nearest trail segment; trigger warning at >30m with debounce (3+ consecutive fixes) (spec: trail-view.md)
- [x] Add off-route feedback: voice "You're off the trail" / "Back on track" announcements, distinct haptic pattern `[100, 50, 100, 50, 100]`, change position dot color to red when off-route (spec: trail-view.md)
- [x] Handle `devicePixelRatio` for crisp canvas rendering on high-DPI screens; throttle redraws to requestAnimationFrame (spec: trail-view.md)
- [x] Write unit tests for: equirectangular projection, bounding box calculation, point-to-segment distance, off-route detection with debounce (spec: trail-view.md)

### Phase 9: Adaptive GPS & Battery (spec: adaptive-gps.md)

- [x] Add movement bearing tracking to `src/gps.ts`: calculate bearing between consecutive raw GPS fixes (not just accepted breadcrumbs) using `bearingDegrees()` from `geo.ts` (spec: adaptive-gps.md)
- [x] Implement adaptive breadcrumb threshold in `src/gps.ts`: on turns (bearing change > 30°) reduce distance threshold to 5m; on straight stretches (bearing change < 15° for 3+ fixes) increase to 20m; enforce 50m maximum gap (spec: adaptive-gps.md)
- [x] Implement stationary detection in `src/gps.ts`: if position hasn't changed by >5m for 30 seconds, switch to low-power polling by setting `maximumAge: 10000` in geolocation options (spec: adaptive-gps.md)
- [x] Resume high-accuracy polling when movement detected (position change > 5m from stationary point); ensure resumption within 5 seconds (spec: adaptive-gps.md)
- [x] Add battery-saving UI indicator on recording screen: show "Low power" badge when in stationary/low-power mode (spec: adaptive-gps.md)
- [x] Write unit tests for: adaptive threshold calculation based on bearing change, stationary detection trigger, low-power mode transitions (spec: adaptive-gps.md)

### Phase 10: Test Harness (real-world scenarios first) - DONE except real-walk fixture

Goal: make real-world failures reproducible before fixing them. Do this phase first.

- [x] Add GPX/JSON track replay to `src/simulator.ts` (`startScenario(name, speedup)`, `playGpx(xml, speedup)` on `window.__breadcrumbsSimulator`, emitting `speed`/`heading`); GPX parsing in `src/gpx.ts`
- [x] Add noise injectors in `src/scenarios.ts`: correlated (AR(1)) GPS jitter, standing-still drift, single-fix outliers, dropped-fix gaps (poor-accuracy bursts = jitter with a large `accuracy`)
- [x] Add scenario routes + tests: straight, L-shape, closed loop, hairpin (15 m and 60 m legs), lasso (`src/retrace-scenarios.test.ts`: real GeolocationService record -> real NavigationService retrace)
- [ ] Record one real walk (GPX) as a fixture and commit it (needs a real device walk; replay it with `__breadcrumbsSimulator.playGpx(xml)` or add a fixture-based test)
- [x] Add failing-bug tests using `it.fails` (they pass while the bug exists and fail once it is fixed; then flip to `it`)

#### Phase 10 findings (measured, seeded, deterministic)

Confirmed bugs (each has an `it.fails` test tagged with the phase that should fix it):

- Standing still for 2 min adds ~83 crumbs (drift cloud) -> Phase 11
- A 400 m walk at 20 m accuracy records a trail ~3.3x too long (1.2x at 8 m accuracy) -> Phase 11
- A single 60 m GPS spike (with good reported accuracy) is recorded as a crumb -> Phase 11
- A 2-minute GPS dropout leaves a ~180 m jump between crumbs with no gap marker -> Phase 11
- A 2-day-old session is silently continued ("Continuing your previous route") -> Phase 11
- With weak GPS (20 m) "arrived" fires ~62 m from the real start on the 60 m hairpin (arrival radius grows with accuracy, skip-ahead can jump to the last crumb) -> Phase 13

Corrections to the original analysis:

- Loops and out-and-back routes do NOT end early in practice: at 8 m accuracy every scenario arrives within ~20 m of the real start. Skip-ahead does shortcut whole legs when the path passes within the proximity radius (e.g. 15 m hairpin skips ~700 m). That is a shortcut only if the ground between is walkable, so it is a product decision for Phase 13 rather than a definite bug. Phase 13 should still add forward-only windowed progress and a stricter arrival test.

### Phase 11: Trustworthy Recording

Goal: never lose or corrupt the trail. PWA-only: assume the app stays open in the foreground with the screen on.

- [ ] Acquire the Wake Lock while recording (currently navigation only); re-acquire on `visibilitychange`; show a clear "keep app open" hint if the lock is unavailable
- [ ] Add a dim/black "battery saver" overlay (OLED-friendly) that keeps the screen on but near-black; tap-and-hold to wake
- [ ] Add a GPS watchdog in `gps.ts`: if no fix for N seconds, restart `watchPosition`; also restart on `visibilitychange` to visible; surface "Lost GPS" state to the UI
- [ ] Flag gaps: when the time/distance since the last crumb is large, mark the crumb `gap: true` (extend `Breadcrumb`); retrace treats gap segments as straight-line and warns
- [ ] Rewrite `storage.ts` session storage: one IndexedDB record per crumb (keyed by sequence), serialized append queue, single cached DB connection; migrate the DB version and keep old sessions readable
- [ ] Filtering in `gps.ts`: scale the distance threshold with fix accuracy; reject implausible speed jumps (>~12 m/s walking); drop standing-still drift crumbs
- [ ] Call `navigator.storage.persist()` on first save; show a warning if it is denied
- [ ] Explicit session lifecycle: "Start walk" / "Set start here"; on open, if the previous session is stale (>~2h old or far from current position) ask "Continue or start new?" instead of silently appending
- [ ] Fix the location-request timeout so it does not fire while the permission prompt is still open (`startRecording`)
- [ ] Reconsider low-power mode: `maximumAge` does not reduce GPS power; remove or replace with a lower-rate strategy, and request iOS `DeviceMotionEvent.requestPermission` from a user gesture if motion is kept
- [ ] Tests for watchdog restart, gap flagging, storage append ordering, stale-session prompt

### Phase 12: Trustworthy Heading

Goal: an arrow the user can believe.

- [ ] Android: listen to `deviceorientationabsolute` (fall back to `deviceorientation` only when unavailable); compute heading with tilt compensation from alpha/beta/gamma plus screen orientation, not `360 - alpha`
- [ ] Use GPS course-over-ground (`coords.heading` when present, else computed bearing) as the primary heading when speed > ~1 m/s; use the compass only when slow or stopped
- [ ] Learn the compass-vs-GPS offset while moving (circular mean over a window) and apply it to the compass when stopped; replace the confidence-only blend in `heading-fusion.ts`
- [ ] Show "compass unreliable" only when the offset is unstable; keep the calibration hint for iOS
- [ ] Optional: apply magnetic declination so compass and GPS bearings share a reference (small offline lookup or a coarse model)
- [ ] Tests: offset learning, moving/stopped switching, 0/360 wrap, tilt compensation

### Phase 13: Retrace Engine

Goal: get back correctly, including loops and out-and-back routes.

- [ ] Add `simplifyTrail()` (Douglas-Peucker, tolerance ~ accuracy-aware, min 3-5 m) to `geo.ts`; navigate the simplified path, keep raw for display/saving
- [ ] Replace crumb-by-crumb advance in `navigation.ts` with monotonic progress along the path: project position onto the path within a forward window; never jump beyond the window; never go backwards; remove the unbounded skip-ahead loop and the `trail[0]` pre-advance in `main.ts`
- [ ] Track `distanceRemaining` along the path (always shown, not only in Simple mode) and an ETA at current walking speed
- [ ] Derive turn points from the simplified path (bearing change > ~35deg) with distance to the next turn
- [ ] Off-route recovery: when off the trail, point at the nearest path point (with distance), then resume path following; announce "back on route"
- [ ] Keep recording while returning (append the detour); "Take me back" again from a new position works
- [ ] Wait for the first real fix before showing distance/direction (no faked `currentPos`); warn if the current position is far from the trail end
- [ ] Explicit arrived state: confirm within accuracy-aware radius, offer "Done" / "Save route"
- [ ] Tests using the Phase 10 scenarios: loop, out-and-back, self-crossing, noisy trail, gap

### Phase 14: Garmin-style Single Screen

Goal: glanceable "walk, track back".

- [ ] Redesign the trail view: user fixed near bottom-centre, heading-up, rotate about the user (not canvas centre), fixed zoom showing the next ~100-200 m with +/- zoom buttons and auto-zoom only as a fallback
- [ ] Big "distance to start" as the primary number; next-turn arrow with distance as secondary; small compass as tertiary
- [ ] One primary "Take me back" / "I'm back" flow; fold Simple and Full into one adaptive layout (keep font scaling and high-contrast themes)
- [ ] Larger canvas text (min 16px), accessible colours (contrast >= 4.5:1), off-route state not colour-only
- [ ] Visual regression screenshots (Playwright) for home, recording, returning, off-route, arrived

### Phase 15: Turn-by-turn Feedback

- [ ] Speech with distance: "Turn left in 30 metres", "Continue 200 metres", "Off route, head back toward the trail"; keep the throttle but never drop arrival/off-route messages
- [ ] Distinct haptic patterns for left, right, off-route, arrived (Android); audio tone equivalents for iOS and silent mode
- [ ] Alert when GPS accuracy degrades or the app is backgrounded during navigation ("Keep the app open")
- [ ] Tests for cue selection and throttling

### Phase 16: Structure and Maintainability

- [ ] Extract an app state machine (idle -> recording -> returning -> arrived) from `main.ts`; views become pure render functions of state
- [ ] Split `main.ts` (2,100 lines) into `views/`, `session.ts`, `nav-session.ts`; keep `@/` aliases
- [ ] Keep Knip and coverage clean after each extraction; no behaviour changes in this phase

### Deferred (decision: stay PWA for now)

- Native shell (Capacitor + background location foreground service) for screen-off recording. Revisit only if field tests show the foreground-only PWA is not good enough.
- Watch apps (Wear OS / Garmin Connect IQ).

## Completed

<!-- Completed tasks move here -->

## Priority Order for Phases 10-16

Phase 10 first (reproduce bugs), then 11 -> 12 -> 13 (these fix trust in the core loop), then 14 -> 15 (UX), then 16 (refactor; may be interleaved earlier if `main.ts` blocks progress).

## Notes

### Codebase State (as of iteration 24, verified)

- All Phase 1-5 modules fully implemented and tested
- `src/types.ts`: Breadcrumb, Session, SavedRoute types
- `src/geo.ts`: haversineMeters(), bearingDegrees() — fully tested
- `src/gps.ts`: watchPosition with accuracy (30m) + distance (10m) filtering — no adaptive logic yet
- `src/storage.ts`: IndexedDB via idb; session + routes CRUD — fully tested
- `src/navigation.ts`: NavigationService (retrace + forward modes), CompassService (iOS/Android) — no EMA smoothing yet; MIN_SPEECH_INTERVAL_MS is 5000ms
- `src/feedback.ts`: speech, audio tones, haptics, silent mode — MIN_SPEECH_INTERVAL_MS is 5000ms (needs 10000ms); no sustained off-course detection; no arrival announcement
- `src/settings.ts`: font size (5 levels) + theme (light/dark/system) via localStorage
- `src/main.ts`: full UI — home, recording, navigation, saved routes, modals, accessibility controls
- `src/styles.css`: full styling with light/dark themes
- 7 test suites (main, gps, geo, storage, navigation, feedback, settings) all written
- Trail renderer (`src/trail-renderer.ts`): NOT YET CREATED — Phase 8 work
- Adaptive GPS logic: NOT YET IMPLEMENTED in gps.ts — Phase 9 work

### Architecture Decisions

- **No framework**: Vanilla TypeScript + Vite. All UI via DOM manipulation or lightweight HTML templating.
- **Module structure**: flat `src/` — `main.ts`, `types.ts`, `gps.ts`, `geo.ts`, `storage.ts`, `navigation.ts`, `feedback.ts`
- **State**: no state library; each module owns its state; main.ts coordinates via function calls/callbacks
- **Storage**: IndexedDB for breadcrumbs and saved routes (survives cache clear); localStorage for user preferences (mode toggle)
- **PWA**: vite-plugin-pwa ^1.2.0 (required for Vite 6 compatibility)
- **Testing**: Vitest with jsdom; mock `navigator.geolocation`, `DeviceOrientationEvent`, `speechSynthesis`, `vibrate`
- **Priority order**: PWA Shell → GPS Recording → Retrace Navigation → Multi-Modal Feedback → Saved Routes → Compass Smoothing → Voice Tuning → Trail View → Adaptive GPS
    - Phases 1–5 complete. Phases 6–9 from field test feedback (2026-02-17 retrace walk).
    - Phase 6 (compass smoothing) and 7 (voice tuning) are bug fixes — do first
    - Phase 8 (trail view) is the biggest new feature — depends on smooth compass (Phase 6)
    - Phase 9 (adaptive GPS) is independent and can be done in parallel with Phase 8
- **types.ts first**: shared types extracted to their own file to avoid circular imports between gps.ts, storage.ts, navigation.ts
- **`idb` package**: `idb` is a transitive dependency only (via workbox-build); do NOT import it directly without `npm install idb`. For storage.ts: either `npm install idb` as a direct dependency, or use raw IndexedDB API. For tests: use `fake-indexeddb` (install as devDependency).
- **`fake-indexeddb`**: install as devDependency for storage.ts unit tests; provides in-memory IndexedDB compatible with jsdom
