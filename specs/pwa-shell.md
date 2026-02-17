# PWA Shell

## Overview

Installable, offline-first Progressive Web App shell that works without internet after first load.

## User Stories

- As a user, I want to install the app to my home screen so it feels like a native app
- As a user, I want the app to work without internet so I can use it in areas with no signal
- As a user, I want the app to load fast on repeat visits

## Requirements

- [ ] Service Worker with workbox for asset caching (via vite-plugin-pwa)
- [ ] Web App Manifest with name, icons, theme color, standalone display
- [ ] App icons (192x192 and 512x512) — placeholder or generated
- [ ] Offline-first: all core functionality works without network
- [ ] Auto-update: new versions install automatically (registerType: autoUpdate)
- [ ] Responsive design: works on any phone screen size
- [ ] Large, high-contrast UI suitable for elderly and visually impaired users
- [ ] Touch-friendly: large tap targets (minimum 48x48px)

## Acceptance Criteria

- [ ] App can be installed to home screen on Android and iOS
- [ ] App loads and functions with airplane mode enabled (after first visit)
- [ ] Lighthouse PWA audit passes
- [ ] UI is legible at arm's length on a phone screen

## Out of Scope

- Map tiles or map rendering
- User accounts or authentication
- Server-side functionality
