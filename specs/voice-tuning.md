# Voice Feedback Tuning

## Overview

Reduce voice announcement frequency to significant events only, and add a clear arrival announcement with haptic feedback.

## Field Test Finding

1. Voice spoke at every breadcrumb advance — too chatty, became noise rather than guidance.
2. No voice or haptic announcement when retrace completed — easy to miss arrival if not watching the screen.

## User Stories

- As a walker, I want voice announcements only when something important happens so they don't become background noise
- As a person with low vision, I want a clear spoken and haptic signal when I've arrived back at my start point

## Requirements

### Reduce Voice Frequency

- [ ] Remove per-breadcrumb-advance voice announcements (currently speaks direction on every heading change within 5s throttle)
- [ ] Only speak direction announcements when the user is significantly off-course (bearing delta > 60° sustained for 3+ seconds)
- [ ] Keep distance milestone announcements (50m, 20m, "almost there") — these are useful
- [ ] Add announcement on major direction change: when the next target breadcrumb requires a turn > 90° compared to the previous leg
- [ ] Increase `MIN_SPEECH_INTERVAL_MS` from 5000ms to 10000ms to further reduce chattiness

### Arrival Announcement

- [ ] Add spoken "You've arrived!" announcement when navigation completes (retrace reaches start, or follow reaches end)
- [ ] Add distinct arrival haptic pattern: long vibration `[200, 100, 200, 100, 200]` (triple pulse, celebratory)
- [ ] Play arrival confirmation tone (distinct from breadcrumb-advance beep — lower pitch, longer duration)
- [ ] Ensure arrival feedback fires even in silent mode (haptic + tone, skip speech)

## Acceptance Criteria

- [ ] During a 20-breadcrumb retrace, voice speaks fewer than 8 times total (down from ~20+)
- [ ] User hears/feels a clear arrival signal without looking at the screen
- [ ] Off-course warning still fires promptly when user takes a wrong turn
- [ ] Distance milestones (50m, 20m, almost there) still announce correctly
- [ ] Silent mode: arrival haptic + tone fires, no speech

## Technical Notes

- Current throttle: `MIN_SPEECH_INTERVAL_MS = 5000`, `DIRECTION_DEBOUNCE_MS = 500`
- Current flow: every `compass.onHeadingChange` → `speak(classifyDirection(...))` with debounce+throttle
- New flow: only call `speak()` when off-course sustained, or on major turn between legs
- "Sustained off-course" detection: track bearing delta over time, trigger only if > 60° for 3+ consecutive GPS updates or 3+ seconds
- Arrival is currently handled in `switchToNavigationView` with UI update only — add feedback calls there

## Out of Scope

- Customizable voice frequency settings
- Multi-language announcements
- Custom announcement phrases
