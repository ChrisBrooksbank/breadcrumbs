# Breadcrumbs: GPS Route Recording & Retracing — Research

Research into phone-based software (ideally a PWA) that uses GPS — but no maps — to let users record walking routes and later retrace their steps.

## Existing Software

### LookTel Breadcrumbs GPS (iOS)

The closest match. A **map-free GPS app** designed for visually impaired users.

- Drops virtual "breadcrumbs" (GPS waypoints) along a walking route
- Shows **direction** (clock positions or compass degrees) and **distance** to each breadcrumb
- **Haptic vibration** when pointing toward a breadcrumb; **proximity alerts** when approaching one
- **Route reversal** to retrace steps
- **Hands-free / pocket mode** — uses walking direction instead of phone orientation
- Announces street addresses every 45 seconds during travel
- Works off-road (trails, parks, beaches) — no maps needed
- Routes can be shared/exported via email

**Adding breadcrumbs:** drop button, shake phone, from contacts/addresses, typed addresses, raw GPS coordinates, or imported routes.

**Direction display options:** clock positions (12 o'clock = straight ahead), compass degrees, or off.

**Audio feedback:** tones on breadcrumb drop, proximity alert tones, on-route street address announcements every 45 seconds, hands-free timed announcements, accuracy monitoring tones.

**Haptic feedback:** vibrates when breadcrumb is ahead, proximity vibration alerts (configurable 10–500 ft radius).

- Links: [Product page](https://www.looktel.com/breadcrumbs) · [Documentation](https://www.looktel.com/breadcrumbs-documentation)

### Apple Watch Backtrack (watchOS 9+)

Built into the Compass app on Apple Watch Series 6+.

- Records GPS breadcrumb trail as you walk
- Shows a **compass with a white line** indicating the path back
- Bouncing arrow points toward starting point
- Designed for remote/outdoor settings
- Uses a minimal map overlay within the compass view (not truly map-free)

- Links: [Apple Support](https://support.apple.com/guide/watch/use-backtrack-to-retrace-your-steps-apd25bfcec3f/watchos) · [Tom's Guide](https://www.tomsguide.com/how-to/how-to-use-apple-watch-backtrack)

### Clew (iOS, Open Source)

Indoor short-distance navigation using AR, not GPS.

- Uses **ARKit** (not GPS) to record a path through space
- Leaves virtual breadcrumbs, converts them to keypoints (turns, stairs)
- Guides back with **audio, haptic, and directional cues**
- No maps, no internet required
- Designed for finding your way back to a seat/table — best over short indoor distances

- Links: [GitHub](https://github.com/occamLab/Clew) · [Perkins Review](https://www.perkins.org/resource/clew-navigation-app-review/)

### GPS Watch Breadcrumbs (Garmin, Coros, Suunto)

Most modern GPS watches have breadcrumb navigation built in.

- Shows a line on the watch face representing your trail
- "Back to Start" retraces GPS points
- Minimal UI — no detailed maps

- Links: [Advnture overview](https://www.advnture.com/features/breadcrumb-navigation) · [Coros docs](https://support.coros.com/hc/en-us/articles/360039841072-Breadcrumb-navigation-tracking)

## Gap in the Market

**No PWA version of this concept exists.** All existing implementations are native iOS apps, watchOS features, or embedded watch firmware. A map-free GPS breadcrumb PWA is an open niche.

## PWA Feasibility

The Web Platform provides all necessary APIs:

| Capability | API | Notes |
|---|---|---|
| GPS tracking | `navigator.geolocation.watchPosition()` | ~3m accuracy on phones with `enableHighAccuracy: true` |
| Compass heading | `DeviceOrientationEvent` | Magnetic heading relative to north |
| Offline support | Service Workers + Cache API | Full offline operation after first load |
| Vibration / haptics | Vibration API | Supported on Android; **not supported on iOS Safari** |
| Local storage | IndexedDB | Persistent route storage across sessions |
| Install to home screen | Web App Manifest | Feels like a native app |

### Key Limitation: iOS Haptics

The Vibration API is not supported in Safari/WebKit. On iOS, **audio cues** would be the primary feedback mechanism. On Android, both vibration and audio are available.

### GPS Accuracy

With `enableHighAccuracy: true`, phones typically achieve ~3 meter accuracy outdoors. The `GeolocationCoordinates.accuracy` property reports the 95% confidence radius in meters, which can be used to filter out low-quality readings.

### Compass Heading

The `DeviceOrientationEvent` provides `alpha` (compass heading on Android) or `webkitCompassHeading` (on iOS). Combined with GPS coordinates of the target breadcrumb, the app can calculate and display the bearing to the next waypoint.

### References

- [MDN: watchPosition()](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)
- [MDN: GeolocationCoordinates.accuracy](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy)
- [Ubilabs: Geolocation and Compass Heading](https://ubilabs.com/en/insights/implement-geolocation-and-compass-heading)
- [Progressier: PWA Geolocation Demo](https://progressier.com/pwa-capabilities/geolocation)
- [What PWA Can Do Today](https://whatpwacando.today/geolocation/)
