# Multi-Modal Feedback

## Overview

Layer visual, audio, and haptic feedback so users can navigate without staring at their phone screen.

## User Stories

- As a person without glasses, I want audio directions so I don't have to squint at my phone
- As an elderly parent, I want the phone to vibrate when I'm facing the right direction
- As a tourist, I want to choose between spoken directions and silent mode (tones + vibration only)

## Requirements

### Visual Feedback

- [ ] Large compass arrow pointing toward the next breadcrumb (primary visual)
- [ ] Distance to next breadcrumb in large, high-contrast text
- [ ] High contrast colors suitable for bright sunlight and low vision

### Audio Feedback

- [ ] Spoken directions: "turn left", "turn right", "straight ahead", "you're going the wrong way"
- [ ] Distance announcements: "50 metres", "20 metres", "almost there"
- [ ] Use Web Speech API (`SpeechSynthesis`) for spoken directions
- [ ] Audio tones: confirmation beep on breadcrumb advance, proximity alert tone
- [ ] Use Web Audio API or `<audio>` elements for tones

### Haptic Feedback

- [ ] Vibration intensity/pattern indicates alignment with target direction
- [ ] Use Vibration API (`navigator.vibrate()`) on Android
- [ ] Detect Vibration API support; fall back to audio-only on iOS/unsupported browsers
- [ ] Proximity vibration: stronger/faster vibration as user approaches breadcrumb

### Communication Mode

- [ ] Default mode: spoken language directions + visual + haptic
- [ ] Silent mode: tones + vibration only — no spoken words, language-free
- [ ] User can toggle between modes during navigation
- [ ] Persist mode preference across sessions

## Acceptance Criteria

- [ ] User hears spoken direction when they need to turn
- [ ] Phone vibrates when user faces toward the next breadcrumb (Android)
- [ ] On iOS, audio cues substitute for vibration
- [ ] User can switch to silent mode and back during navigation
- [ ] Feedback works even when phone is in pocket (audio/haptic only)

## Technical Notes

- Vibration API: not supported in Safari/WebKit (iOS). Must detect and fall back.
- Web Speech API: `window.speechSynthesis.speak(new SpeechSynthesisUtterance('turn left'))`
- Direction calculation: compare compass heading to bearing-to-target
- Consider throttling feedback updates to avoid overwhelming the user

## Out of Scope

- Localisation / multi-language spoken directions (future)
- Custom voice selection
- Bluetooth speaker/headphone integration
