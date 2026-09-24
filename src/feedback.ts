/**
 * FeedbackService — spoken directions via Web Speech API.
 *
 * Direction classification thresholds (bearing delta from -180 to +180):
 *   straight ahead:     -30 to +30 degrees
 *   turn right:         +30 to +150 degrees
 *   turn left:          -150 to -30 degrees
 *   wrong way:          beyond ±150 degrees
 *
 * Throttling:
 *   - Minimum interval between any speech announcements: MIN_SPEECH_INTERVAL_MS
 *   - Direction (speak) calls are debounced: rapid heading changes coalesce
 *     into a single announcement fired after DIRECTION_DEBOUNCE_MS of quiet.
 */

import type { Cue, ToneName } from '@/coach';

export type Direction =
    | 'straight ahead'
    | 'turn right'
    | 'turn left'
    | "you're going the wrong way";

/**
 * Classify a bearing delta (target bearing minus compass heading, normalised
 * to -180..+180) into a spoken direction.
 */
export function classifyDirection(bearingDelta: number): Direction {
    // Normalise to -180..+180
    const delta = (((bearingDelta % 360) + 540) % 360) - 180;

    if (delta >= -30 && delta <= 30) {
        return 'straight ahead';
    }
    if (delta > 30 && delta <= 150) {
        return 'turn right';
    }
    if (delta < -30 && delta >= -150) {
        return 'turn left';
    }
    return "you're going the wrong way";
}

/**
 * Hysteresis band width in degrees.
 * Once classified, the delta must move beyond threshold ± HYSTERESIS_DEG
 * before the classification changes.
 */
const HYSTERESIS_DEG = 8;

/**
 * Classify a bearing delta with hysteresis to prevent flickering at
 * classification boundaries. Uses an 8° dead-zone band: once classified
 * as e.g. "straight ahead" (±30°), delta must exceed ±38° to switch away,
 * and must drop below ±22° to re-enter.
 *
 * @param bearingDelta - Target bearing minus compass heading
 * @param previousDirection - The previous classification, or null on first call
 * @returns The stable direction classification
 */
export function classifyDirectionWithHysteresis(
    bearingDelta: number,
    previousDirection: Direction | null
): Direction {
    // No previous state — use standard classifier
    if (previousDirection === null) {
        return classifyDirection(bearingDelta);
    }

    const delta = (((bearingDelta % 360) + 540) % 360) - 180;
    const absDelta = Math.abs(delta);

    // Check if the current delta still falls within the hysteresis band
    // of the previous classification
    switch (previousDirection) {
        case 'straight ahead':
            // Stay straight until delta exceeds 30 + 8 = 38°
            if (absDelta <= 30 + HYSTERESIS_DEG) return 'straight ahead';
            break;
        case 'turn right':
            // Stay turn right: must drop below 30 - 8 = 22° to go straight,
            // or exceed 150 + 8 = 158° to go wrong way
            if (delta > 30 - HYSTERESIS_DEG && delta <= 150 + HYSTERESIS_DEG) return 'turn right';
            break;
        case 'turn left':
            // Mirror of turn right
            if (delta < -(30 - HYSTERESIS_DEG) && delta >= -(150 + HYSTERESIS_DEG))
                return 'turn left';
            break;
        case "you're going the wrong way":
            // Stay wrong way until delta drops below 150 - 8 = 142°
            if (absDelta > 150 - HYSTERESIS_DEG) return "you're going the wrong way";
            break;
    }

    // Outside the hysteresis band — reclassify
    return classifyDirection(bearingDelta);
}

export interface FeedbackService {
    /**
     * Speak a direction phrase with debouncing: rapid consecutive calls
     * within DIRECTION_DEBOUNCE_MS are coalesced — only the last one fires.
     * Also subject to the MIN_SPEECH_INTERVAL_MS throttle on announce().
     * No-ops when speech is unavailable or silent mode is on.
     */
    speak(direction: Direction): void;
    /** Speak an arbitrary phrase. */
    announce(phrase: string): void;
    /**
     * Deliver a guidance cue from the GuidanceCoach: speech, a vibration pattern and/or a tone.
     *  - Vibration always fires (also in silent mode) when the browser supports it.
     *  - Tones play when vibration is unavailable (iOS) or in silent mode, so tones + vibration
     *    are the language-free channel; the arrival tone always plays.
     *  - Speech is skipped in silent mode. A `critical` cue interrupts any speech in progress;
     *    `normal` and `info` cues are dropped if speech was very recent, so nothing piles up.
     */
    cue(cue: Cue): void;
    /** Whether the Web Speech API is available in this environment. */
    readonly speechAvailable: boolean;
    /** Play a short confirmation beep when the user advances to the next breadcrumb. */
    playConfirmationBeep(): void;
    /** Play a proximity alert tone as the user approaches the target breadcrumb. */
    playProximityAlert(): void;
    /** Whether the Web Audio API is available in this environment. */
    readonly audioAvailable: boolean;
    /**
     * Vibrate to indicate directional alignment. Call with the bearing delta
     * (target bearing minus compass heading, -180..+180). Produces a short
     * pulse when aligned (±30°), no vibration otherwise.
     * Uses hysteresis to prevent rapid toggling at the ±30° boundary.
     */
    vibrateAlignment(bearingDelta: number): void;
    /** Reset alignment hysteresis state (call when advancing to next breadcrumb). */
    resetAlignmentHysteresis(): void;
    /**
     * Vibrate based on proximity to the target breadcrumb. Closer distances
     * produce stronger/faster patterns. No-ops when Vibration API is absent.
     * @param distanceMeters Distance to target in metres
     */
    vibrateProximity(distanceMeters: number): void;
    /** Whether the Vibration API is available in this environment. */
    readonly vibrationAvailable: boolean;
    /**
     * Play brief tap feedback (30ms vibrate + quiet tone) so elderly users
     * know a button press registered, especially on bright outdoor screens.
     * Respects silent mode: skips tone but keeps haptic.
     */
    playButtonTap(): void;
    /**
     * Cancel any pending debounced direction announcement.
     * Call when stopping navigation to prevent stale speech firing.
     */
    cancelPending(): void;
    /**
     * Silent mode: when true, speech is suppressed (tones + vibration only).
     * Persisted in localStorage. Can be toggled live during navigation.
     */
    silentMode: boolean;
    /**
     * Timestamp (Date.now()) of the last speech announcement. Zero if none.
     * Exposed for testing throttle behaviour.
     */
    readonly lastSpeechTime: number;
}

const SILENT_MODE_KEY = 'breadcrumbs:silentMode';

/** Minimum milliseconds between any two speech announcements. */
const MIN_SPEECH_INTERVAL_MS = 10_000;

/**
 * Milliseconds of silence before a pending direction (speak) fires.
 * Rapid heading changes within this window are coalesced into one call.
 */
const DIRECTION_DEBOUNCE_MS = 500;

export function createFeedbackService(): FeedbackService {
    const speechAvailable =
        typeof window !== 'undefined' &&
        'speechSynthesis' in window &&
        typeof SpeechSynthesisUtterance !== 'undefined';

    const audioAvailable = typeof window !== 'undefined' && typeof AudioContext !== 'undefined';

    const vibrationAvailable = typeof navigator !== 'undefined' && 'vibrate' in navigator;

    // Silent mode: persisted in localStorage; suppresses speech when true
    let _silentMode: boolean =
        typeof localStorage !== 'undefined' && localStorage.getItem(SILENT_MODE_KEY) === 'true';

    // Lazily create AudioContext on first use to satisfy browser autoplay policy
    let audioCtx: AudioContext | null = null;

    function getAudioContext(): AudioContext | null {
        if (!audioAvailable) return null;
        if (!audioCtx) {
            audioCtx = new AudioContext();
        }
        return audioCtx;
    }

    /**
     * Play a pure tone using the Web Audio API.
     * @param frequency  Frequency in Hz
     * @param duration   Duration in seconds
     * @param gainValue  Peak gain (0–1)
     */
    function playTone(frequency: number, duration: number, gainValue: number): void {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;

            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

            // Simple envelope: ramp up then down to avoid clicks
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(gainValue, ctx.currentTime + 0.01);
            gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + duration);
        } catch {
            // AudioContext may throw on restricted/suspended contexts — silent fallback
        }
    }

    function playConfirmationBeep(): void {
        // Two-tone ascending beep — pleasant "advance" sound
        playTone(880, 0.15, 0.4);
        const ctx = getAudioContext();
        if (ctx) {
            setTimeout(() => playTone(1108, 0.15, 0.4), 160);
        }
    }

    /** Language-free tone patterns matching the vibration patterns. */
    function playToneName(name: ToneName): void {
        switch (name) {
            case 'left': // two short low tones
                playTone(520, 0.1, 0.4);
                setTimeout(() => playTone(520, 0.1, 0.4), 160);
                break;
            case 'right': // one long high tone
                playTone(740, 0.4, 0.4);
                break;
            case 'alert': // three quick lower tones
                for (let i = 0; i < 3; i++) setTimeout(() => playTone(400, 0.12, 0.4), i * 180);
                break;
            case 'ok':
                playTone(880, 0.12, 0.35);
                break;
            case 'arrive':
                playTone(440, 0.6, 0.5);
                break;
        }
    }

    // When any cue last spoke, for dropping low-priority speech that would pile up
    let lastCueSpeechTime = -Infinity;
    const NORMAL_SPEECH_GAP_MS = 2500;
    const INFO_SPEECH_GAP_MS = 8000;

    function cue(c: Cue): void {
        if (c.haptic) vibrate(c.haptic);

        if (c.tone && (c.tone === 'arrive' || !vibrationAvailable || _silentMode)) {
            playToneName(c.tone);
        }

        if (!c.speech || _silentMode || !speechAvailable) return;
        const now = Date.now();
        const sinceLast = now - lastCueSpeechTime;
        if (c.priority === 'info' && sinceLast < INFO_SPEECH_GAP_MS) return;
        if (c.priority === 'normal' && sinceLast < NORMAL_SPEECH_GAP_MS) return;
        if (c.priority === 'critical') window.speechSynthesis.cancel();
        lastCueSpeechTime = now;
        announce(c.speech);
    }

    function playProximityAlert(): void {
        // Single mid-range tone — indicates proximity
        playTone(660, 0.1, 0.3);
    }

    // Throttle state for direction (speak) announcements
    // Distance and one-off announcements (announce/announceDistance) are
    // already deduplicated at the call site and do not need throttling.
    let lastSpeechTime = 0;

    // Debounce: pending timer id for coalescing rapid direction calls
    let directionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    /** Immediately enqueue speech synthesis for an arbitrary phrase. */
    function announce(phrase: string): void {
        if (!speechAvailable || _silentMode) return;
        const utterance = new SpeechSynthesisUtterance(phrase);
        window.speechSynthesis.speak(utterance);
    }

    /**
     * Speak a direction with debounce + throttle:
     *  1. Debounce: rapid heading changes within DIRECTION_DEBOUNCE_MS are
     *     coalesced — only the last direction fires.
     *  2. Throttle: even after debounce, a direction is only spoken if at
     *     least MIN_SPEECH_INTERVAL_MS has elapsed since the last direction.
     */
    function speak(direction: Direction): void {
        if (directionDebounceTimer !== null) {
            clearTimeout(directionDebounceTimer);
        }
        directionDebounceTimer = setTimeout(() => {
            directionDebounceTimer = null;
            const now = Date.now();
            if (now - lastSpeechTime < MIN_SPEECH_INTERVAL_MS) {
                // Too soon since last direction announcement — skip
                return;
            }
            lastSpeechTime = now;
            announce(direction);
        }, DIRECTION_DEBOUNCE_MS);
    }

    function playButtonTap(): void {
        vibrate(30);
        if (!_silentMode) {
            playTone(600, 0.05, 0.15);
        }
    }

    function cancelPending(): void {
        if (directionDebounceTimer !== null) {
            clearTimeout(directionDebounceTimer);
            directionDebounceTimer = null;
        }
    }

    /**
     * Vibrate a pattern using the Vibration API.
     * No-ops silently when the API is unavailable.
     */
    function vibrate(pattern: number | number[]): void {
        if (!vibrationAvailable) return;
        navigator.vibrate(pattern);
    }

    // Alignment hysteresis state to prevent vibration flickering at ±30° boundary
    let lastAlignmentDir: Direction | null = null;

    function vibrateAlignment(bearingDelta: number): void {
        const direction = classifyDirectionWithHysteresis(bearingDelta, lastAlignmentDir);
        lastAlignmentDir = direction;
        if (direction === 'straight ahead') {
            if (vibrationAvailable) {
                // Single short pulse: user is aligned with target
                vibrate(50);
            } else {
                // Audio fallback for iOS/unsupported browsers: brief proximity tone
                playProximityAlert();
            }
        }
        // No feedback for other directions — avoid confusion with directional cues
    }

    function resetAlignmentHysteresis(): void {
        lastAlignmentDir = null;
    }

    function vibrateProximity(distanceMeters: number): void {
        if (vibrationAvailable) {
            if (distanceMeters <= 5) {
                // Very close: rapid double pulse
                vibrate([80, 40, 80]);
            } else if (distanceMeters <= 20) {
                // Close: medium pulse
                vibrate([60, 0]);
            } else if (distanceMeters <= 50) {
                // Approaching: short single pulse
                vibrate(30);
            }
            // Beyond 50m: no proximity vibration
        } else {
            // Audio fallback for iOS/unsupported browsers: play proximity tone at close range
            if (distanceMeters <= 20) {
                playProximityAlert();
            }
        }
    }

    return {
        speak,
        announce,
        cue,
        playButtonTap,
        cancelPending,
        playConfirmationBeep,
        playProximityAlert,
        vibrateAlignment,
        resetAlignmentHysteresis,
        vibrateProximity,
        get speechAvailable() {
            return speechAvailable;
        },
        get audioAvailable() {
            return audioAvailable;
        },
        get vibrationAvailable() {
            return vibrationAvailable;
        },
        get silentMode() {
            return _silentMode;
        },
        set silentMode(value: boolean) {
            _silentMode = value;
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(SILENT_MODE_KEY, String(value));
                }
            } catch {
                // QuotaExceededError — silent mode still works in memory
            }
        },
        get lastSpeechTime() {
            return lastSpeechTime;
        },
    };
}
