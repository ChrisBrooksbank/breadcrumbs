# Implementation Plan

## Status

- Planning iterations: 22
- Build iterations: 0
- Last updated: 2026-02-17

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

## Completed

<!-- Completed tasks move here -->

## Notes

### Codebase State (as of iteration 21, verified)

- `index.html`: exists with good PWA metadata, inline CSS, placeholder content — needs real app shell wired in
- `src/main.ts`: placeholder only (console.log) — needs real app shell implementation
- `vite.config.ts`: vite-plugin-pwa correctly configured (^1.2.0 for Vite 6), workbox caching ready
- `public/`: directory does not exist — must be created along with icons/icon-192.png and icons/icon-512.png
- `src/main.test.ts`: placeholder tests only (1+1=2) — needs real tests
- All feature modules (gps.ts, geo.ts, storage.ts, navigation.ts, feedback.ts, types.ts): not yet created
- `idb` is in node_modules (transitive via workbox-build) but NOT a direct dependency — `npm install idb` still required
- `fake-indexeddb` is NOT installed — `npm install -D fake-indexeddb` required before storage tests

### Architecture Decisions

- **No framework**: Vanilla TypeScript + Vite. All UI via DOM manipulation or lightweight HTML templating.
- **Module structure**: flat `src/` — `main.ts`, `types.ts`, `gps.ts`, `geo.ts`, `storage.ts`, `navigation.ts`, `feedback.ts`
- **State**: no state library; each module owns its state; main.ts coordinates via function calls/callbacks
- **Storage**: IndexedDB for breadcrumbs and saved routes (survives cache clear); localStorage for user preferences (mode toggle)
- **PWA**: vite-plugin-pwa ^1.2.0 (required for Vite 6 compatibility)
- **Testing**: Vitest with jsdom; mock `navigator.geolocation`, `DeviceOrientationEvent`, `speechSynthesis`, `vibrate`
- **Priority order**: PWA Shell → GPS Recording → Retrace Navigation → Multi-Modal Feedback → Saved Routes
    - Each phase depends on the prior (you can't retrace without recording; feedback requires navigation)
    - Saved Routes is lowest priority — app is usable without it
- **types.ts first**: shared types extracted to their own file to avoid circular imports between gps.ts, storage.ts, navigation.ts
- **`idb` package**: `idb` is a transitive dependency only (via workbox-build); do NOT import it directly without `npm install idb`. For storage.ts: either `npm install idb` as a direct dependency, or use raw IndexedDB API. For tests: use `fake-indexeddb` (install as devDependency).
- **`fake-indexeddb`**: install as devDependency for storage.ts unit tests; provides in-memory IndexedDB compatible with jsdom
