/**
 * Audio keepalive — plays a near-silent tone periodically to prevent
 * the browser from suspending the tab when the screen is off.
 */

interface AudioKeepAlive {
    start(): void;
    stop(): void;
    readonly active: boolean;
}

/** Interval between silent pings in milliseconds. */
const PING_INTERVAL_MS = 25_000;

/** Gain value for the silent tone (barely audible). */
const SILENT_GAIN = 0.001;

export function createAudioKeepAlive(): AudioKeepAlive {
    let audioCtx: AudioContext | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let active = false;

    function ping(): void {
        if (!audioCtx) return;
        try {
            // Resume context if suspended (needed after screen off)
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
            const oscillator = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            oscillator.connect(gain);
            gain.connect(audioCtx.destination);
            oscillator.frequency.setValueAtTime(200, audioCtx.currentTime);
            gain.gain.setValueAtTime(SILENT_GAIN, audioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.1);
        } catch {
            // AudioContext errors — silent fallback
        }
    }

    function start(): void {
        if (active) return;
        active = true;
        if (!audioCtx && typeof AudioContext !== 'undefined') {
            audioCtx = new AudioContext();
        }
        // Ping immediately to establish audio session
        ping();
        intervalId = setInterval(ping, PING_INTERVAL_MS);
    }

    function stop(): void {
        active = false;
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
        if (audioCtx) {
            audioCtx.close().catch(() => {});
            audioCtx = null;
        }
    }

    return {
        start,
        stop,
        get active() {
            return active;
        },
    };
}
