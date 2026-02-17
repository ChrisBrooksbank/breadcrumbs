# Breadcrumbs: Product Vision

A map-free GPS breadcrumb PWA for recording walking routes and retracing your steps.

## User Personas

### 1. Elderly Parent

An older person (e.g. the developer's mum) who needs a simple, large, clear interface. Not tech-savvy — the app must be obvious and forgiving.

### 2. Person Without Glasses

Someone who can't see their screen clearly. Needs big, high-contrast UI and non-visual feedback (audio, haptics) so they don't have to squint at the phone.

### 3. Tourist with ADHD

Dropped off by a tour bus, explores on foot, can't focus or remember the route walked. Needs to get back to the pickup point without having paid close attention on the way out.

**Common thread:** All three personas converge on the same requirements — dead simple, big and clear, works without looking closely at the screen.

## Core Scenarios (Priority Order)

1. **Explore & return** — Walk somewhere new, then retrace your exact steps back to the start. _This is the primary scenario. Build this first._
2. **Record & repeat** — Save favourite routes (dog walks, runs) and follow them again later. _Secondary — add after core is solid._
3. **Safety net** — Always-on recording so you can retrace if you get lost. _Supported by auto-record on open._
4. ~~Share routes~~ — _Not a priority. Excluded by user._

## Design Principles

- **Simplicity** — No maps, minimal UI, minimal cognitive load. The app does one thing well.
- **Offline-first** — GPS coordinates work anywhere. No map tile downloads, no internet dependency.
- **Accessible** — Multi-modal feedback (visual, audio, haptic) so the app works for people who can't see the screen well.

## UX Decisions

### Main Screen: Two Buttons

The main screen has exactly two big, obvious buttons:

1. **"Take me back"** — starts retracing to the exact starting point
2. **"Save this route"** — saves the recorded route for later re-use

Everything else is buried in settings or secondary screens.

### Recording UI: Minimal

While recording, the screen just shows "Recording..." with elapsed time and distance. Stay out of the way — the user is walking, not staring at their phone.

### Auto-Record on Open

Recording starts automatically when the app opens. Zero friction — the user cannot forget to start recording. This directly supports the safety net scenario.

### Navigation Feedback: All Modes

The app layers all feedback modes. The user picks what works for them:

- **Visual** — A large compass arrow pointing toward the next breadcrumb, with distance in big text
- **Audio** — Spoken instructions like "turn left, 50 metres"
- **Haptic** — Phone vibrates faster/stronger as you face the right direction (Android only; audio fallback on iOS due to Vibration API limitation in Safari)

### Communication Mode: User Chooses

Default to spoken language directions. Offer a "silent mode" that uses only tones and vibration — language-free and discreet.

### Navigation Target: Exact Start Point

The app guides all the way back to the exact starting point — the parked car, the hotel entrance. Not just "approximately nearby."

## Key Features

| Feature                | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| Auto-record on open    | App starts recording GPS breadcrumbs immediately — zero friction |
| Retrace path           | Primary feature — guides user back to exact starting point       |
| Multi-modal feedback   | Visual arrow, spoken audio, haptic vibration (Android)           |
| Save route             | Save a recorded route for later re-use                           |
| Minimal recording UI   | "Recording..." with time/distance — stays out of the way         |
| Two-button main screen | "Take me back" and "Save this route" — nothing else              |
| Silent mode            | Tones + vibration only — no spoken words                         |
| Offline-first          | Works without internet after first load (Service Workers)        |
| PWA                    | Installable on any phone via the web — cross-platform            |

## Open Questions

- **Breadcrumb drop interval** — Time-based, distance-based, or adaptive?
- **GPS accuracy handling** — How to handle the 3–10m error when guiding to an "exact" start point?
- **Path following vs. beeline** — Current decision is "exact start point", but should the app retrace the actual path walked (important when there are obstacles, roads, fences)?
- **Hands-free / pocket mode** — LookTel uses walking direction instead of phone orientation. Do we need this?
- **Battery management** — Continuous GPS recording drains battery. What mitigations?
- **Poor/lost GPS signal** — What happens indoors or in urban canyons?
- **Save route flow** — How does naming, organizing, and replaying saved routes work?
- **Localisation** — Strategy for spoken directions in multiple languages?

## Future Ideas

- Record & repeat with named/organised route library
- Background recording (true safety net — app doesn't need to be in foreground)
- Route sharing (not currently prioritised but could be added)
- Configurable proximity alerts (like LookTel's 10–500 ft radius)
- Street address announcements during travel
- Shake-to-drop-breadcrumb gesture

## Product Name

**Breadcrumbs** — classic, evocative, matches the repo name.
