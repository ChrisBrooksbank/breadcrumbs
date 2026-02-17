# Trail View Navigation

## Overview

Replace compass-primary navigation with a Garmin-style trail view showing the recorded route as a line, the user's position on it, and off-route detection.

## Field Test Finding

Compass-only navigation is disorienting. A visual trail showing where you are on the route, with auto-zoom, would be a major UX improvement — similar to Garmin GPS watch trail view.

## User Stories

- As a walker, I want to see my route as a line on screen so I know where I've been and where I'm going
- As a tourist, I want to see if I've wandered off the path without interpreting a spinning compass
- As an elderly parent, I want a simple visual that shows my progress along the route

## Requirements

### Trail Rendering

- [ ] Render the breadcrumb trail as a smooth polyline on a `<canvas>` element (no map tiles)
- [ ] Show the full route as a line: walked portion in one color (e.g. grey/faded), remaining portion in another (e.g. blue/bright)
- [ ] Show the user's current position as a prominent dot/marker on or near the trail
- [ ] Show the next target breadcrumb as a highlighted waypoint
- [ ] Smooth the polyline using cardinal spline or Catmull-Rom interpolation for a natural "wiggly line" appearance
- [ ] Orient the view so the direction of travel is "up" (rotate canvas based on compass heading)

### Auto-Zoom

- [ ] Calculate bounding box of remaining route + current position
- [ ] Apply padding (15-20% of viewport) around the bounding box
- [ ] Zoom in as user gets closer to the end (fewer remaining breadcrumbs = tighter view)
- [ ] Zoom out if user strays far from the trail
- [ ] Smooth zoom transitions (no jarring jumps)
- [ ] Minimum zoom level: always show at least 3 upcoming breadcrumbs

### Off-Route Detection

- [ ] Calculate perpendicular distance from user's current position to the nearest trail segment
- [ ] If distance exceeds threshold (e.g. 30m), trigger off-route warning
- [ ] Voice announcement: "You're off the trail" (respects silent mode)
- [ ] Haptic alert: distinct pattern for off-route `[100, 50, 100, 50, 100]`
- [ ] Visual indicator: change position dot color to red/warning when off-route
- [ ] When user returns within threshold: "Back on track" announcement
- [ ] Debounce off-route detection to avoid flickering at the boundary (require 3+ consecutive off-route fixes)

### Layout

- [ ] Trail canvas takes up the primary screen area (where the large compass arrow used to be)
- [ ] Compass arrow becomes small (48x48px), positioned in a corner of the trail view
- [ ] Distance to next breadcrumb remains visible as overlay text
- [ ] Progress indicator ("Breadcrumb X of Y") remains visible

## Acceptance Criteria

- [ ] User sees their route as a smooth line on a plain background (no map)
- [ ] Current position dot moves along the trail as user walks
- [ ] View auto-zooms to show relevant portion of the route
- [ ] Off-route warning fires when user strays > 30m from the trail
- [ ] "Back on track" fires when user returns to within 30m
- [ ] Small compass arrow visible in corner, still functional
- [ ] Trail view works in both retrace and follow modes
- [ ] Performance: canvas redraws at 10+ fps on mid-range phones

## Technical Notes

- Canvas 2D API for rendering (lightweight, no dependencies)
- GPS coordinates → canvas pixel coordinates: project lat/lng to local x/y using equirectangular projection (sufficient for walking-scale distances)
- Catmull-Rom spline: for each segment, use previous and next points as control points
- Point-to-segment distance: standard perpendicular distance from point to line segment formula
- Heading-up rotation: rotate entire canvas by `-compassHeading` so travel direction is always up
- Consider `devicePixelRatio` for crisp rendering on high-DPI screens
- Throttle canvas redraws to requestAnimationFrame (~60fps cap, but can skip frames if no position/heading change)

## Out of Scope

- Map tiles or satellite imagery
- Elevation profile
- Route editing or waypoint manipulation
- Multiple trail colors for different route segments
