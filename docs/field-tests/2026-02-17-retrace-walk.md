# Field Test: Retrace Walk — 2026-02-17

## Setup

- **Device:** Pixel 7a
- **Duration:** Under 5 minutes
- **Feature tested:** Record a short walk, then immediately retrace it

## What Worked Well

- **Haptic feedback** — felt great, provided clear tactile confirmation
- **Breadcrumb countdown during retrace** — knowing how many breadcrumbs remain was reassuring and useful

## Issues Found

### 1. Compass Too Jittery

The compass arrow kept spinning and jumping around — it felt untrustworthy. You couldn't confidently follow it because the direction changed too rapidly.

**Recommendation:** Keep the compass but make it small and simple, as a secondary UI element. It should not be the primary navigation cue.

### 2. Voice Feedback Too Frequent

The app spoke at every breadcrumb, which was too chatty and not helpful. The constant announcements became noise rather than useful guidance.

**Recommendation:** Reduce voice frequency — announce only significant events (off-route, arriving, major turns) rather than every breadcrumb advance.

### 3. No "You've Arrived!" Announcement

When retrace completed, the UI updated but there was no voice announcement or haptic feedback to signal arrival. Easy to miss if you're not staring at the screen.

**Recommendation:** Add a clear voice announcement and a distinct haptic pattern when the user reaches the start point.

## Feature Request: Garmin-Style Trail View

Inspired by the Garmin GPS watch trail view:

- Show a **smooth wiggly line** representing the recorded route with the user's current position on it
- **Auto-zoom** in and out intelligently based on the remaining route and current position
- **Off-route detection**: alert the user when they've strayed from the path, and tell them when they're back on route
- The compass becomes a **small, simple arrow** — secondary to the trail view, not the main navigation element

This would be a major UX improvement over the current compass-only navigation.

## Technical Details (from code review)

| Parameter                 | Current Value                                   |
| ------------------------- | ----------------------------------------------- |
| GPS method                | `watchPosition` with `enableHighAccuracy: true` |
| GPS interval              | No explicit interval — OS default (~1–10s)      |
| Breadcrumb drop distance  | ≥10m from last accepted point                   |
| Accuracy gate             | Must be ≤30m accuracy                           |
| Retrace advance proximity | 15m                                             |
| Battery optimization      | None — continuous high-accuracy polling         |

## Future Considerations

### Adaptive Breadcrumb Frequency

Walking speed and direction changes should inform the breadcrumb drop rate:

- **More breadcrumbs on turns** — capture the shape of the route
- **Fewer on straight stretches** — avoid unnecessary clutter

This is similar to Garmin's adaptive sampling approach and would produce cleaner, more useful route data.

### Battery Optimization

Current continuous high-accuracy polling drains the battery. Ideas:

- Reduce GPS polling frequency when stationary
- Use adaptive polling intervals based on movement speed
- Leverage motion detection sensors to gate GPS activation
