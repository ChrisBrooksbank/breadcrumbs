# Retrace Navigation

## Overview

Guide the user back to their exact starting point by retracing the recorded breadcrumb trail in reverse.

## User Stories

- As an elderly parent, I want to press one big button and be guided back to where I started
- As a tourist with ADHD, I want the app to guide me back to the tour bus pickup point without me having to remember the route
- As a person without glasses, I want a large compass arrow I can see at a glance

## Requirements

- [ ] "Take me back" button on main screen — large, obvious, impossible to miss
- [ ] Reverse the recorded breadcrumb trail to create a return path
- [ ] Navigate breadcrumb-by-breadcrumb back to the exact starting point
- [ ] Show a large compass arrow pointing toward the next breadcrumb
- [ ] Show distance to the next breadcrumb in large text
- [ ] Use `DeviceOrientationEvent` for compass heading (alpha on Android, webkitCompassHeading on iOS)
- [ ] Calculate bearing from current position to next breadcrumb
- [ ] Auto-advance to next breadcrumb when user is within proximity threshold (e.g. 15m)
- [ ] Show overall progress: "Breadcrumb 5 of 23" or distance remaining
- [ ] Show "You've arrived!" when user reaches the starting point
- [ ] Handle the final approach: guide to exact start point, not just "close enough"

## Acceptance Criteria

- [ ] User can tap "Take me back" and see a compass arrow pointing toward the return path
- [ ] Arrow updates in real-time as the user rotates their phone
- [ ] Breadcrumbs auto-advance as the user walks past them
- [ ] User is guided all the way to the exact starting point
- [ ] Navigation works without any map display

## Technical Notes

- Bearing calculation: `Math.atan2(sin(dLon)*cos(lat2), cos(lat1)*sin(lat2) - sin(lat1)*cos(lat2)*cos(dLon))`
- Compass heading sources: `DeviceOrientationEvent.alpha` (Android), `webkitCompassHeading` (iOS)
- Need to handle compass calibration prompt on some devices
- GPS accuracy of ~3-10m means "exact" start point guidance should include a proximity radius

## Out of Scope

- Turn-by-turn street directions
- Obstacle avoidance
- Path optimization (always retrace exact path walked)
