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

### Phase 11: Trustworthy Recording - DONE (two items deferred)

Goal: never lose or corrupt the trail. PWA-only: assume the app stays open in the foreground with the screen on.

- [x] Acquire the Wake Lock while recording; re-acquire on `visibilitychange` (manager already did); show a "keep app open" hint if the lock is unavailable or refused
- [x] Battery saver overlay: the existing 15 s screen-lock overlay is now fully black (OLED pixels off while the wake lock keeps the screen awake); press-and-hold to wake
- [x] GPS watchdog in `gps.ts`: restart `watchPosition` after 20 s without a fix (only after the first fix, so a permission prompt is not a stall) and on returning to the foreground after 5+ s of silence; `onGpsLostChange` drives a "Lost GPS - reconnecting" message
- [x] Flag gaps: a crumb after a >30 s silence with a >60 m jump gets `gap: true` (`Breadcrumb.gap`). Retrace does not use it yet (Phase 13)
- [x] `storage.ts` rewritten: one IndexedDB record per crumb (DB v3, in-place migration from the single-record format), serialized write queue, one cached connection
- [x] Recording filter in `gps.ts`: per-axis median of the last 3 fixes (rejects isolated spikes, damps drift) and crumb spacing never below the fix accuracy. Fixed: 3.3x trail inflation at 20 m accuracy, ~83-crumb cloud when standing still, 60 m spike recorded
- [x] `navigator.storage.persist()` requested when recording starts (no UI for a denied result yet)
- [x] Stale sessions: an unsaved route whose last crumb is over 2 hours old prompts "Start new route" / "Keep old route" instead of silently continuing; new fixes wait for the choice (no race). Escape/backdrop keeps the old route
- [x] Location-request timeout no longer runs while the permission prompt is showing (Permissions API)
- [x] Tests: watchdog, gap flag, median/spacing filter, storage layout/ordering/migration, stale-session dialog, wake lock, permission timeout
- [ ] Explicit "Start walk" / "Set start here" control (auto-record on open is still the model; stale prompt covers the worst case). Revisit after field testing
- [ ] Low-power stationary mode: `maximumAge` does not reduce GPS power, but switching to low-accuracy fixes risks false "movement" flapping. Left unchanged pending field data. iOS motion permission (`DeviceMotionEvent.requestPermission`) also still missing, so iOS never auto-suspends and shake-to-wake in pocket mode does not work there

### Phase 12: Trustworthy Heading - DONE

Goal: an arrow the user can believe.

- [x] Android: `CompassService` listens to `deviceorientationabsolute` when the browser has it (plain `deviceorientation` is relative on Chrome/Android) and exposes `absolute`; heading now comes from `orientationToHeading(alpha, beta, gamma)`, which combines the top-edge and back directions so it is correct flat, upright and in between (equals `360 - alpha` when flat). Manifest locked to portrait so screen rotation cannot skew it
- [x] `heading-fusion.ts` rewritten: GPS course over ground (smoothed) is the heading while walking (>= 1 m/s, held 4 s); compass otherwise
- [x] Learn the compass-vs-GPS offset (circular mean of the last 10 walking samples, needs 3) and apply it to the compass when stopped. This also absorbs magnetic declination, a phone carried at an angle, and a relative-only Android compass
- [x] Compass reliability: offset spread > 35 deg means interference; the raw absolute compass is used as a fallback, a relative one is not used at all. Nav screen shows "Compass is unreliable here...", or "Walk a few steps so the arrow can find its bearings" for a relative compass that has not been calibrated yet
- [x] `main.ts`: one `currentHeading()` helper (fused, else absolute compass, else GPS bearing) replaces four copies; the trail view now rotates by it; fixed a bug where a legitimate compass heading of exactly 0 (north) triggered "Waiting for direction"
- [x] Tests: tilt maths, absolute/relative event handling, fusion (walking, learning, wraparound, interference, recovery), and navigation-screen integration (arrow follows GPS over a misleading compass, hints)
- [ ] Not done: a magnetic declination model. The learned offset covers it once the user has walked a few steps; only the first few seconds before walking are affected (typically < 15 deg)
- [ ] Not done: iOS tilt handling is left to `webkitCompassHeading`; verify on a real iPhone held upright

### Phase 13: Retrace Engine - DONE (four items deferred)

Goal: get back correctly, including loops and out-and-back routes. Decision (user, PWA-only): follow the path **strictly** by default; shortcuts are not taken just because two parts of the path are physically close.

- [x] `geo.ts`: `simplifyPolyline` (iterative Douglas-Peucker) and `closestPointOnSegment`
- [x] Strict windowed progress in `navigation.ts`: advancing only considers crumbs within ~45 m of path ahead (at least 2 crumbs), so hairpins, loops and out-and-back paths are never short-cut by mere closeness; the old unbounded skip-ahead loop is gone. Walking past a crumb up to 30 m sideways still advances (the old 15-30 m dead zone). Progress never moves backwards
- [x] Rejoin after a detour: at the moment the walker comes back on route it snaps to the EARLIEST remaining segment within 30 m (never the nearest, never a standing shortcut). Off-route is now measured against the path still to walk, and not evaluated after arrival
- [x] Arrival: retrace mode counts being at the start point as arrived from anywhere (a loop walked back to the car is done straight away); the wider allowance for the start crumb's own accuracy applies only when following the path in. Follow mode stays strict (being at the start of a saved loop is not arrival)
- [x] Remaining distance to the start along the path (`remainingMeters`), now the main number in both full and simple mode ("to start" / "to finish")
- [x] Turn points (`findTurns`, `nextTurn`) from a simplified copy of the path; "Turn left in 40 m" shown in both views, highlighted within 40 m. Left/right correctly mirror when retracing
- [x] Off-route recovery: the arrow points at the nearest point of the remaining route and the message says how far away it is; a first fix over 100 m from the route says so immediately
- [x] No faked start position: navigation shows "Finding your position..." until the first real fix (was: assumed the user stood on the last crumb)
- [x] `GPS gap` awareness: `Breadcrumb.gap` (Phase 11) now yields `inGap`, with a "route is a straight-line guess" hint
- [x] Arrival state: "Done" (clears the finished session so the app starts fresh; leaves the session alone when following a saved route) and "Save this route" instead of a hold-to-confirm stop button
- [x] Tests: engine rules, 40-seed scenario statistics, on-screen guidance and arrival flows
- [ ] Deferred: navigating on the simplified path. Progress stays crumb-based so the crumb countdown that field testers liked still works; simplification is used for turn detection only
- [ ] Deferred: ETA at walking speed
- [ ] Deferred: recording the return leg. The safety-net need (getting lost on the way back) is met by off-route recovery to the nearest point of the outbound path; appending a return leg to the same session would make a second "Take me back" ambiguous. Revisit with a session-segment model
- [ ] Deferred: a "shortcut" setting (take physical shortcuts across doubled-back paths) - only if field testing asks for it
- [ ] Deferred: a better start point. The start crumb is a single raw fix; averaging the first fixes while stationary would help "exact start"

#### Phase 13 findings

- The single-seed "arrives 62 m away with weak GPS" failure from Phase 10 was mostly a noise floor: at 20 m accuracy both the recorded start and the returning fix can each be 25-30 m off. Over 40 seeds arrival is always reached; p90 distance to the true start is ~25 m at 8 m accuracy and ~3x accuracy at 20 m. Tests now assert those limits instead of a single seed
- The real premature-arrival mechanisms were unbounded skip-ahead and a lingering rejoin flag that snapped to the final segment; both are fixed and covered

### Phase 14: One Garmin-style Screen - DONE (one item deferred)

Goal: glanceable "walk, track back". Decision (user): one screen, no separate Simple mode, to reduce confusion.

- [x] Simple mode removed everywhere (setting, storage key, toggle, duplicate views, CSS). There is now one home screen and one navigation screen
- [x] Home: a huge **Take me back** button that takes the spare room, zeroed time/distance always shown, then a row **Save route | Landmark** and a row **Saved routes | More...**; **New route** (destructive) lives behind More. Text size and theme controls are tucked behind a single **Aa Display** button
- [x] Navigation: an instrument panel above the map (never covering it) with the big direction word (STRAIGHT / TURN LEFT / TURN RIGHT / BEHIND YOU / ARRIVED), distance to start/finish, next-turn pill, progress and hints. The panel is green on track, amber for a turn, red when behind you or off the route, and always carries words, not just colour
- [x] `trail-renderer.ts` rewritten Garmin-style: the user is fixed near the bottom-centre and the world rotates about them so ahead is up; auto zoom shows the next ~150 m of path (never less than 40 m ahead); + / - zoom buttons with an Auto button to hand control back; dashed orange line for stretches recorded without GPS; dashed red guide from the user to the nearest point of the route when off it; landmark labels stay upright; the user dot is always on top
- [x] Fixed: the leg being walked was drawn grey (as already walked); it is now blue, and only what lies behind the last reached crumb is grey
- [x] Fixed: the arrival screen kept showing "Waiting for direction"
- [x] Playwright e2e updated (selectors, and a database-version bug in its seed helper) and run: 10 screenshot tests pass on a Pixel 7 viewport, including new mid-route (turn ahead) and off-route screens. Screenshots reviewed by eye
- [ ] Deferred: automated visual-regression comparison (the screenshots are captured and were reviewed manually, but nothing diffs them yet)

### Phase 15: Turn-by-turn Feedback - DONE

Goal: eyes-free guidance that says something useful, rarely.

- [x] New `src/coach.ts` (`GuidanceCoach`, pure logic): given the navigation state on each fix it returns the cues to deliver, usually none. Speech, vibration pattern, tone and a priority (info / normal / critical) per cue
- [x] Corners in stages: "In 100 metres, turn left" (100 m) -> "Turn left in 30 metres" (35 m, with the turn's buzz) -> "Turn left now" (12 m, firmer buzz). Each stage once; a corner first seen close skips the earlier stages; a turn over 120 degrees is "sharp"
- [x] Distinct, learnable patterns: left = two short pulses, right = one long pulse, each with a firmer "now" version; separate patterns for off-route, back on route, weak GPS and arrival. Tone equivalents (left = two low tones, right = one high tone, alert = three) play when the browser cannot vibrate (iOS) or in silent mode
- [x] Legs and progress: "Continue for 400 metres" once per leg when it is 120 m or more; remaining-distance milestones ("500 metres to go" at 1 km / 500 / 250 / 100 m), each once, none already-passed at the start, none right at the end
- [x] Off route: once, with how far the route is ("Off the trail. The route is 60 metres away."), a reminder every 30 s, and "Back on the route"; nothing else is said while off. Arrival: once, always wins
- [x] Gaps and weak GPS: "GPS was lost along this stretch..." once per stretch; "GPS signal is weak..." only after 15 s of poor fixes, at most once a minute. Weak signal is now reported via the GPS service's poor-accuracy hook (fixes over 30 m accuracy never reached navigation before, so it could not have been detected)
- [x] `FeedbackService.cue()`: vibration always fires (also in silent mode); speech is skipped in silent mode; a critical cue interrupts speech in progress; normal cues are dropped within 2.5 s of other speech and info cues within 8 s, so nothing piles up; a dropped cue still buzzes
- [x] Background alert: when the app is sent to the background mid-walk (unless in pocket mode) it speaks and buzzes "Keep it open on screen for directions", and on return after 10 s+ shows "Welcome back. Waiting for a fresh GPS fix"
- [x] Removed the chatter: per-crumb "50 metres / 20 metres / almost there", the old off-route/back-on-track/arrival methods and the crumb-advance "turn left" (all replaced by coach cues), with their tests
- [x] Fixed: a corner vanished from "next turn" up to 15 m before the walker reached it (its crumb counted as reached early), so "turn now" could never fire. A corner now stays next until the walker is round it
- [x] Fixed: navigation sessions leaked (GPS, compass, background listener) when another began; `switchToNavigationView` now stops any session still running, like recording does
- [ ] Not changed: the alignment pulse (a short buzz each time you face the right way) and the crumb-advance beep. Field testers said the haptics "felt great"; revisit if walkers find them too busy
- [ ] Not done: spoken units other than metres/kilometres; other languages

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
