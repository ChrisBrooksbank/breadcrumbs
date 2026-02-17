/** Acceleration magnitude below this (m/s²) is considered motionless. */
const MOTIONLESS_THRESHOLD = 0.5;

/** Seconds of sub-threshold acceleration before declaring motionless. */
const MOTIONLESS_DELAY_S = 60;

/** Seconds of above-threshold acceleration before resuming motion. */
const RESUME_DELAY_S = 2;

/** Sampling window in milliseconds for peak-acceleration tracking. */
const WINDOW_MS = 1000;

interface MotionDetector {
    readonly available: boolean;
    readonly isMotionless: boolean;
    start(): void;
    stop(): void;
    onMotionlessChange: ((motionless: boolean) => void) | null;
}

export function createMotionDetector(): MotionDetector {
    const available = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;

    let motionless = false;
    let listening = false;
    let onMotionlessChange: ((motionless: boolean) => void) | null = null;

    // Peak acceleration in the current 1-second window
    let windowPeak = 0;
    let windowStart = 0;

    // Consecutive seconds below/above threshold
    let quietSeconds = 0;
    let activeSeconds = 0;

    function handleMotion(event: DeviceMotionEvent): void {
        let mag: number;
        const acc = event.acceleration;
        const accG = event.accelerationIncludingGravity;

        if (acc && acc.x != null && acc.y != null && acc.z != null) {
            mag = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
        } else if (accG && accG.x != null && accG.y != null && accG.z != null) {
            const raw = Math.sqrt(accG.x ** 2 + accG.y ** 2 + accG.z ** 2);
            mag = Math.abs(raw - 9.81);
        } else {
            return;
        }

        const now = Date.now();

        if (windowPeak < mag) windowPeak = mag;

        if (now - windowStart >= WINDOW_MS) {
            const peak = windowPeak;
            windowPeak = 0;
            windowStart = now;

            if (peak < MOTIONLESS_THRESHOLD) {
                quietSeconds++;
                activeSeconds = 0;
                if (!motionless && quietSeconds >= MOTIONLESS_DELAY_S) {
                    motionless = true;
                    onMotionlessChange?.(true);
                }
            } else {
                activeSeconds++;
                quietSeconds = 0;
                if (motionless && activeSeconds >= RESUME_DELAY_S) {
                    motionless = false;
                    onMotionlessChange?.(false);
                }
            }
        }
    }

    function start(): void {
        if (listening || !available) return;
        listening = true;
        motionless = false;
        quietSeconds = 0;
        activeSeconds = 0;
        windowPeak = 0;
        windowStart = Date.now();
        window.addEventListener('devicemotion', handleMotion);
    }

    function stop(): void {
        if (!listening) return;
        listening = false;
        window.removeEventListener('devicemotion', handleMotion);
        motionless = false;
        quietSeconds = 0;
        activeSeconds = 0;
    }

    return {
        get available() {
            return available;
        },
        get isMotionless() {
            return motionless;
        },
        start,
        stop,
        get onMotionlessChange() {
            return onMotionlessChange;
        },
        set onMotionlessChange(cb: ((motionless: boolean) => void) | null) {
            onMotionlessChange = cb;
        },
    };
}
