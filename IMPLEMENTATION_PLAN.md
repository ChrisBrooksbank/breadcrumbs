# Implementation Plan

## Status

- Planning iterations: 3
- Build iterations: 0
- Last updated: 2026-02-17

## Tasks

### Phase 1: PWA Shell (spec: pwa-shell.md)

- [ ] Wire up src/main.ts: replace placeholder with real app shell DOM (title, recording status card, action buttons placeholder); add base CSS (large-font, high-contrast, touch-friendly 48px targets) (spec: pwa-shell.md)
- [ ] Generate placeholder app icons at 192x192 and 512x512 and place in public/icons/ (vite.config.ts already references these paths) (spec: pwa-shell.md)
- [ ] Write Vitest unit tests for app shell mounting (verify DOM elements rendered, CSS classes applied) (spec: pwa-shell.md)

### Phase 2: GPS Recording (spec: gps-recording.md)

- [ ] Create `src/types.ts` — define Breadcrumb `{ lat, lng, accuracy, timestamp }` and Session types used across all modules (spec: gps-recording.md)
- [ ] Implement Haversine distance calculation in `src/geo.ts`; export `haversineMeters(a, b)` (spec: gps-recording.md)
- [ ] Write unit tests for `haversineMeters` in `src/geo.test.ts` (spec: gps-recording.md)
- [ ] Create `src/storage.ts` — IndexedDB wrapper: `openDB()`, `appendBreadcrumb()`, `getSession()`, `clearSession()` (spec: gps-recording.md)
- [ ] Write unit tests for storage module using fake-indexeddb or vitest mocks (spec: gps-recording.md)
- [ ] Create `src/gps.ts` — GeolocationService: `watchPosition` with `enableHighAccuracy: true`, distance-based filtering (10m), accuracy threshold (30m), calls back with each accepted Breadcrumb (spec: gps-recording.md)
- [ ] Wire GPS recording into main.ts: start on app load, persist each breadcrumb via storage.ts, update recording UI (spec: gps-recording.md)
- [ ] Update recording UI in index.html/main.ts: show "Recording..." badge, elapsed time, distance walked in large text (spec: gps-recording.md)
- [ ] Handle GPS permission request with friendly prompt; show user-facing error message on denial/unavailable (spec: gps-recording.md)
- [ ] Write unit tests for GPS breadcrumb filtering logic (distance threshold, accuracy filtering) (spec: gps-recording.md)

### Phase 3: Retrace Navigation (spec: retrace-navigation.md)

- [ ] Add bearing calculation to `src/geo.ts`: `bearingDegrees(from, to)` using atan2 formula (spec: retrace-navigation.md)
- [ ] Write unit tests for `bearingDegrees` (cardinal directions: N/S/E/W expected values) (spec: retrace-navigation.md)
- [ ] Create `src/navigation.ts` — NavigationService: reverse breadcrumb trail, track current target index, `advanceIfClose(pos, threshold=15)`, expose `progress` and `targetBreadcrumb` (spec: retrace-navigation.md)
- [ ] Implement DeviceOrientation compass in `src/navigation.ts`: `alpha` on Android, `webkitCompassHeading` on iOS; expose `compassHeading` (spec: retrace-navigation.md)
- [ ] Add large "Take me back" button to main screen (shown when session has breadcrumbs); switches app to navigation view (spec: retrace-navigation.md)
- [ ] Create navigation view in main.ts: large compass arrow SVG rotated by `(bearingToBreadcrumb - compassHeading)`, distance in large text, progress "Breadcrumb N of M" (spec: retrace-navigation.md)
- [ ] Auto-advance to next breadcrumb when within 15m; show "You've arrived!" screen when last breadcrumb reached (spec: retrace-navigation.md)
- [ ] Write unit tests for NavigationService: trail reversal, proximity detection, index advancement (spec: retrace-navigation.md)

### Phase 4: Multi-Modal Feedback (spec: multi-modal-feedback.md)

- [ ] Create `src/feedback.ts` — FeedbackService: spoken directions via Web Speech API (`SpeechSynthesisUtterance`) for "turn left", "turn right", "straight ahead", "you're going the wrong way" (spec: multi-modal-feedback.md)
- [ ] Add distance announcements via speech: "50 metres", "20 metres", "almost there" triggered at proximity thresholds (spec: multi-modal-feedback.md)
- [ ] Implement audio tones via Web Audio API in feedback.ts: confirmation beep on breadcrumb advance, proximity alert tone (spec: multi-modal-feedback.md)
- [ ] Implement haptic feedback via Vibration API: short pulse when aligned to target, stronger/faster as user approaches breadcrumb (spec: multi-modal-feedback.md)
- [ ] Detect Vibration API support (`'vibrate' in navigator`); fall back to audio-only on iOS/unsupported browsers (spec: multi-modal-feedback.md)
- [ ] Add silent mode toggle button in navigation view (tones + vibration only, no speech); persist preference in localStorage; toggle live during navigation (spec: multi-modal-feedback.md)
- [ ] Throttle feedback updates (debounce heading changes, min interval between speech announcements) to avoid overwhelming user (spec: multi-modal-feedback.md)
- [ ] Write unit tests for direction classification (left/right/straight/wrong way from bearing delta), throttle logic (spec: multi-modal-feedback.md)

### Phase 5: Saved Routes (spec: saved-routes.md)

- [ ] Extend `src/storage.ts`: add `SavedRoute` type (name, date, distance, breadcrumbCount, breadcrumbs[]) and `saveRoute()`, `listRoutes()`, `deleteRoute()` IndexedDB operations (spec: saved-routes.md)
- [ ] Add "Save this route" button to main screen (shown when session has breadcrumbs alongside "Take me back"); opens save modal (spec: saved-routes.md)
- [ ] Create save-route modal: large text input for route name, confirm/cancel buttons; on confirm, persist to IndexedDB via storage.ts (spec: saved-routes.md)
- [ ] Create saved routes list screen (accessible from main screen): show name, date, distance, breadcrumb count per route; tap to navigate, swipe/button to delete (spec: saved-routes.md)
- [ ] Implement follow mode in navigation.ts: load saved route, navigate breadcrumbs in forward order using same compass+distance UI as retrace (spec: saved-routes.md)
- [ ] Implement delete saved route with confirmation dialog (spec: saved-routes.md)
- [ ] Write unit tests for route persistence, listing, and deletion via storage.ts (spec: saved-routes.md)

## Completed

<!-- Completed tasks move here -->

## Notes

### Codebase State (as of iteration 2)

- `index.html`: exists with good PWA metadata, inline CSS, placeholder content — needs real app shell wired in
- `src/main.ts`: placeholder only (console.log) — needs real app shell implementation
- `vite.config.ts`: vite-plugin-pwa correctly configured (^1.2.0 for Vite 6), workbox caching ready
- `public/icons/`: missing — icon-192.png and icon-512.png referenced but not created
- `src/main.test.ts`: placeholder tests only (1+1=2) — needs real tests
- All feature modules (gps.ts, geo.ts, storage.ts, navigation.ts, feedback.ts, types.ts): not yet created

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
