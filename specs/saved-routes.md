# Saved Routes

## Overview

Save recorded routes for later re-use, enabling users to repeat favourite walks (dog walks, runs, regular routes).

## User Stories

- As a dog walker, I want to save my regular walking route so I can follow it again tomorrow
- As a runner, I want to save and replay my favourite running route
- As an elderly parent, I want to save the route to the shops so my carer can help me follow it

## Requirements

- [ ] "Save this route" button on main screen — large, obvious, next to "Take me back"
- [ ] Save current breadcrumb trail with a user-provided name
- [ ] Simple naming UI: large text input, keyboard-friendly
- [ ] List saved routes with name, date, distance, and breadcrumb count
- [ ] Load a saved route and navigate it (follow mode, not retrace)
- [ ] Delete saved routes
- [ ] Store saved routes in IndexedDB alongside active recording
- [ ] Saved routes persist across app restarts and cache clears (IndexedDB)

## Acceptance Criteria

- [ ] User can save the current route with a name
- [ ] Saved routes appear in a list
- [ ] User can tap a saved route and follow it
- [ ] User can delete a saved route
- [ ] Routes persist after closing and reopening the app

## Out of Scope

- Route sharing or export
- Route editing (trimming, combining)
- Route categories or folders
- Route statistics beyond basic distance/time
