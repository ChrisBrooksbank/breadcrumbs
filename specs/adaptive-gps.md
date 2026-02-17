# Adaptive GPS & Battery Optimization

## Overview

Make breadcrumb recording smarter by adapting to walking patterns, and reduce battery drain from continuous high-accuracy GPS polling.

## Field Test Finding

1. Fixed 10m breadcrumb interval drops too many points on straight stretches and too few on sharp turns.
2. Continuous `enableHighAccuracy: true` with no interval control drains battery quickly.

## User Stories

- As a walker on a long route, I want my phone battery to last the whole walk
- As a user retracing a winding path, I want accurate turn-by-turn breadcrumbs so I don't cut corners

## Requirements

### Adaptive Breadcrumb Frequency

- [ ] Detect direction changes: compare bearing of current movement vs. last recorded segment
- [ ] On turns (bearing change > 30°): drop breadcrumbs more frequently (reduce distance threshold to 5m)
- [ ] On straight stretches (bearing change < 15° for 3+ consecutive fixes): increase distance threshold to 20m
- [ ] Default distance threshold remains 10m when direction is moderately changing
- [ ] Ensure minimum breadcrumb density: never exceed 50m between consecutive breadcrumbs regardless of straight-line detection
- [ ] Store the adaptive threshold used with each breadcrumb for debugging

### Battery Optimization

- [ ] Detect stationary state: if GPS position hasn't changed by more than 5m for 30 seconds, switch to low-power polling
- [ ] Low-power mode: increase GPS polling interval (use `maximumAge` parameter in geolocation options, e.g. 10000ms)
- [ ] Resume high-accuracy polling when movement detected (position change > 5m from stationary point)
- [ ] Show battery-saving indicator in the UI when in low-power mode
- [ ] When recording stops (user is navigating or idle), stop GPS watcher entirely

### Recording Stats

- [ ] Track and display GPS fix rate (fixes per minute) for transparency
- [ ] Show estimated battery impact indicator (high/medium/low based on current polling mode)

## Acceptance Criteria

- [ ] Winding path produces more breadcrumbs at turns than straight sections
- [ ] Straight 200m stretch produces ~10 breadcrumbs (vs current ~20)
- [ ] Sharp U-turn captured with ≤5m resolution
- [ ] Stationary phone (e.g. during a coffee break) reduces GPS polling within 30 seconds
- [ ] Movement after stationary period resumes high-accuracy polling within 5 seconds
- [ ] No breadcrumb gaps larger than 50m on any terrain

## Technical Notes

- Current: `watchPosition({ enableHighAccuracy: true })` with no `maximumAge` or `timeout` options
- `maximumAge`: accepts cached position up to N ms old — setting to 10000 in low-power mode avoids redundant GPS hardware activation
- Bearing change detection: use `bearingDegrees()` from `geo.ts` between consecutive raw GPS fixes (not just accepted breadcrumbs)
- Must track raw fixes separately from accepted breadcrumbs to calculate movement bearing
- Stationary detection: compare haversine distance of last N fixes — if all within 5m radius, declare stationary
- Consider using `navigator.permissions.query({ name: 'geolocation' })` to check if background GPS is still permitted

## Out of Scope

- Using accelerometer/gyroscope for motion detection (future enhancement)
- Background GPS tracking when app is minimized (PWA limitation)
- Server-side route optimization or simplification
