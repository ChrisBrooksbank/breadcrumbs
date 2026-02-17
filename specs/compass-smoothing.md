# Compass Smoothing & Demotion

## Overview

Smooth the jittery compass arrow and demote it from primary to secondary navigation element.

## Field Test Finding

The compass arrow spins and jumps constantly, making it feel untrustworthy. Users cannot confidently follow a direction that changes every fraction of a second.

## User Stories

- As an elderly walker, I want the compass arrow to move smoothly so I can trust it
- As a tourist, I want a stable directional indicator that doesn't make me dizzy

## Requirements

- [ ] Apply low-pass filter or exponential moving average to compass heading (smooth out jitter from `DeviceOrientationEvent`)
- [ ] Tune smoothing factor so arrow feels responsive but stable (experiment: alpha ~0.15–0.3 for EMA)
- [ ] Reduce compass arrow size — it should no longer be the dominant UI element
- [ ] Move compass to a secondary position (e.g. smaller element above or beside the distance display)
- [ ] Add CSS transition to arrow rotation for visual smoothness (`transition: transform 300ms ease-out`)
- [ ] Ensure smoothing works on both iOS (`webkitCompassHeading`) and Android (`alpha`)

## Acceptance Criteria

- [ ] Compass arrow rotates smoothly without visible jitter when holding the phone steady
- [ ] Arrow still responds within ~500ms when user turns 90°
- [ ] Compass is visually smaller and secondary to the trail view (when implemented) or distance display
- [ ] No regression in bearing accuracy — smoothed heading stays within ±10° of raw heading during steady walking

## Technical Notes

- Current: raw `alpha` or `webkitCompassHeading` applied directly to SVG rotation each event
- EMA formula: `smoothed = alpha * raw + (1 - alpha) * previousSmoothed`
- Must handle the 0°/360° wraparound correctly (use circular mean or shortest-arc interpolation)
- CSS `transition` on `transform: rotate()` may conflict with JS updates — test both approaches
- Consider clamping update rate to ~10fps instead of every deviceorientation event

## Out of Scope

- Replacing compass with trail view (see trail-view.md)
- Magnetometer calibration improvements
