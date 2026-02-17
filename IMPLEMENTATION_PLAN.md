# Implementation Plan

## Status

- Planning iterations: 1
- Build iterations: 0
- Last updated: 2026-02-17

## Tasks

### Phase 1: PWA Shell (spec: pwa-shell.md)

- [ ] Create index.html with app root, viewport meta, and theme-color meta tag (spec: pwa-shell.md)
- [ ] Create Web App Manifest (manifest.webmanifest) with name, icons, theme color, standalone display (spec: pwa-shell.md)
- [ ] Generate placeholder app icons at 192x192 and 512x512 (spec: pwa-shell.md)
- [ ] Configure vite-plugin-pwa with autoUpdate registerType and workbox asset caching (spec: pwa-shell.md)
- [ ] Wire up src/main.ts to render app shell with large-font, high-contrast, touch-friendly base CSS (spec: pwa-shell.md)
- [ ] Write Vitest unit tests for app shell mounting (spec: pwa-shell.md)

### Phase 2: GPS Recording (spec: gps-recording.md)

- [ ] Create `src/gps.ts` — GeolocationService that calls `watchPosition` with `enableHighAccuracy: true` on init (spec: gps-recording.md)
- [ ] Implement distance-based breadcrumb filtering: drop waypoint every 10m, skip readings with accuracy > 30m (spec: gps-recording.md)
- [ ] Define Breadcrumb type: `{ lat, lng, accuracy, timestamp }` and Session type (spec: gps-recording.md)
- [ ] Create `src/storage.ts` — IndexedDB wrapper for persisting breadcrumb trail across sessions (spec: gps-recording.md)
- [ ] Implement Haversine distance calculation utility in `src/geo.ts` (spec: gps-recording.md)
- [ ] Create recording UI component: "Recording..." status, elapsed time, distance walked (spec: gps-recording.md)
- [ ] Handle GPS permission request with friendly prompt; show user-facing error on denial/unavailable (spec: gps-recording.md)
- [ ] Write unit tests for distance calculation and breadcrumb filtering logic (spec: gps-recording.md)

### Phase 3: Retrace Navigation (spec: retrace-navigation.md)

- [ ] Create large "Take me back" button on main screen (spec: retrace-navigation.md)
- [ ] Implement `src/navigation.ts` — reverse breadcrumb trail, track current target index (spec: retrace-navigation.md)
- [ ] Implement bearing calculation: `atan2(sin(dLon)*cos(lat2), cos(lat1)*sin(lat2) - sin(lat1)*cos(lat2)*cos(dLon))` in `src/geo.ts` (spec: retrace-navigation.md)
- [ ] Implement DeviceOrientation compass: use `alpha` on Android, `webkitCompassHeading` on iOS (spec: retrace-navigation.md)
- [ ] Create large compass arrow SVG that rotates based on (bearing - compass heading) (spec: retrace-navigation.md)
- [ ] Show distance to next breadcrumb in large text; show progress "Breadcrumb N of M" (spec: retrace-navigation.md)
- [ ] Auto-advance to next breadcrumb when user is within 15m proximity threshold (spec: retrace-navigation.md)
- [ ] Show "You've arrived!" screen when user reaches the starting breadcrumb (spec: retrace-navigation.md)
- [ ] Write unit tests for bearing calculation, proximity detection, and trail reversal (spec: retrace-navigation.md)

### Phase 4: Multi-Modal Feedback (spec: multi-modal-feedback.md)

- [ ] Create `src/feedback.ts` — spoken directions via Web Speech API `SpeechSynthesis` ("turn left", "turn right", "straight ahead", "wrong way") (spec: multi-modal-feedback.md)
- [ ] Add distance announcements via speech: "50 metres", "20 metres", "almost there" (spec: multi-modal-feedback.md)
- [ ] Implement audio tones via Web Audio API: confirmation beep on breadcrumb advance, proximity alert (spec: multi-modal-feedback.md)
- [ ] Implement haptic feedback via Vibration API: pattern/intensity based on alignment to target heading (spec: multi-modal-feedback.md)
- [ ] Detect Vibration API support; fall back to audio-only on iOS/unsupported browsers (spec: multi-modal-feedback.md)
- [ ] Add silent mode toggle (tones + vibration only, no speech); persist preference in localStorage (spec: multi-modal-feedback.md)
- [ ] Throttle feedback updates to avoid overwhelming the user (spec: multi-modal-feedback.md)
- [ ] Write unit tests for direction classification (left/right/straight/wrong way) and feedback throttling (spec: multi-modal-feedback.md)

### Phase 5: Saved Routes (spec: saved-routes.md)

- [ ] Add "Save this route" button to main screen alongside "Take me back" (spec: saved-routes.md)
- [ ] Create save-route modal: large text input for route name, confirm button (spec: saved-routes.md)
- [ ] Extend `src/storage.ts` to persist named routes (name, date, distance, breadcrumb count, breadcrumbs) in IndexedDB (spec: saved-routes.md)
- [ ] Create saved routes list screen: show name, date, distance, breadcrumb count per route (spec: saved-routes.md)
- [ ] Implement follow mode: load a saved route and navigate it forward (not retrace) using same compass+distance UI (spec: saved-routes.md)
- [ ] Implement delete saved route with confirmation (spec: saved-routes.md)
- [ ] Write unit tests for route persistence and retrieval from IndexedDB (spec: saved-routes.md)

## Completed

<!-- Completed tasks move here -->

## Notes

### Architecture Decisions

- **No framework**: Vanilla TypeScript + Vite. All UI via DOM manipulation or lightweight HTML templating.
- **Module structure**: flat `src/` — `main.ts`, `gps.ts`, `geo.ts`, `storage.ts`, `navigation.ts`, `feedback.ts`
- **State**: no state library; each module owns its state; main.ts coordinates via function calls/callbacks
- **Storage**: IndexedDB for breadcrumbs and saved routes (survives cache clear); localStorage for user preferences (mode toggle)
- **PWA**: vite-plugin-pwa ^1.2.0 (required for Vite 6 compatibility)
- **Testing**: Vitest with jsdom; mock `navigator.geolocation`, `DeviceOrientationEvent`, `speechSynthesis`, `vibrate`
- **Priority order**: PWA Shell → GPS Recording → Retrace Navigation → Multi-Modal Feedback → Saved Routes
    - Each phase depends on the prior (you can't retrace without recording; feedback requires navigation)
    - Saved Routes is lowest priority — app is usable without it
