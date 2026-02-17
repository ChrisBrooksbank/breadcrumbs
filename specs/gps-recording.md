# GPS Recording

## Overview

Automatically record GPS breadcrumbs (waypoints) as the user walks, starting immediately when the app opens.

## User Stories

- As a user, I want recording to start automatically so I never forget to begin tracking
- As a user, I want to see that recording is active without it getting in my way
- As a user, I want my route stored locally so it works without internet

## Requirements

- [ ] Auto-record on app open: GPS tracking begins immediately with zero user interaction
- [ ] Use `navigator.geolocation.watchPosition()` with `enableHighAccuracy: true`
- [ ] Drop breadcrumb waypoints at regular intervals (distance-based, e.g. every 10m)
- [ ] Each breadcrumb stores: latitude, longitude, accuracy, timestamp
- [ ] Filter out low-quality GPS readings (accuracy > threshold, e.g. 30m)
- [ ] Store breadcrumb trail in IndexedDB for persistence across sessions
- [ ] Minimal recording UI: show "Recording..." with elapsed time and distance walked
- [ ] Handle GPS permission request with clear, friendly prompt
- [ ] Handle GPS unavailable or denied gracefully with user-facing message
- [ ] Track total distance walked (sum of distances between consecutive breadcrumbs)

## Acceptance Criteria

- [ ] Opening the app immediately starts GPS recording without any taps
- [ ] Breadcrumbs appear in storage as the user walks
- [ ] Recording UI shows elapsed time and distance
- [ ] GPS permission denial shows a helpful message, not a crash
- [ ] Low-accuracy readings are silently filtered out
- [ ] Route data persists if the app is closed and reopened

## Technical Notes

- `GeolocationCoordinates.accuracy` reports 95% confidence radius in meters
- Typical phone GPS accuracy: ~3m outdoors with `enableHighAccuracy: true`
- Consider adaptive interval: closer breadcrumbs on turns, wider on straight paths (future enhancement)

## Out of Scope

- Background recording (app must be in foreground)
- Manual breadcrumb dropping (shake gesture, button)
- Street address announcements
