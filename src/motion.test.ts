import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMotionDetector } from '@/motion';

function fireMotion(acceleration: { x: number; y: number; z: number }): void {
    const event = new Event('devicemotion') as DeviceMotionEvent;
    Object.defineProperty(event, 'acceleration', {
        value: acceleration,
        configurable: true,
    });
    Object.defineProperty(event, 'accelerationIncludingGravity', {
        value: null,
        configurable: true,
    });
    window.dispatchEvent(event);
}

function fireMotionGravity(accG: { x: number; y: number; z: number }): void {
    const event = new Event('devicemotion') as DeviceMotionEvent;
    Object.defineProperty(event, 'acceleration', {
        value: null,
        configurable: true,
    });
    Object.defineProperty(event, 'accelerationIncludingGravity', {
        value: accG,
        configurable: true,
    });
    window.dispatchEvent(event);
}

describe('MotionDetector', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Ensure DeviceMotionEvent exists
        if (!('DeviceMotionEvent' in window)) {
            vi.stubGlobal('DeviceMotionEvent', Event);
        }
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('available is true when DeviceMotionEvent exists', () => {
        const detector = createMotionDetector();
        expect(detector.available).toBe(true);
    });

    it('isMotionless is false initially', () => {
        const detector = createMotionDetector();
        detector.start();
        expect(detector.isMotionless).toBe(false);
        detector.stop();
    });

    it('becomes motionless after 60 seconds of sub-threshold acceleration', () => {
        const detector = createMotionDetector();
        const onChange = vi.fn();
        detector.onMotionlessChange = onChange;
        detector.start();

        // Fire 60 windows of sub-threshold motion (1 second each)
        for (let i = 0; i < 60; i++) {
            vi.advanceTimersByTime(1000);
            fireMotion({ x: 0.1, y: 0.1, z: 0.1 }); // mag ≈ 0.17
        }

        expect(detector.isMotionless).toBe(true);
        expect(onChange).toHaveBeenCalledWith(true);
        detector.stop();
    });

    it('does not become motionless before 60 seconds', () => {
        const detector = createMotionDetector();
        detector.start();

        for (let i = 0; i < 59; i++) {
            vi.advanceTimersByTime(1000);
            fireMotion({ x: 0.1, y: 0.1, z: 0.1 });
        }

        expect(detector.isMotionless).toBe(false);
        detector.stop();
    });

    it('resumes motion after 2 seconds of above-threshold acceleration', () => {
        const detector = createMotionDetector();
        const onChange = vi.fn();
        detector.onMotionlessChange = onChange;
        detector.start();

        // Go motionless
        for (let i = 0; i < 60; i++) {
            vi.advanceTimersByTime(1000);
            fireMotion({ x: 0.1, y: 0, z: 0 });
        }
        expect(detector.isMotionless).toBe(true);
        onChange.mockClear();

        // Resume motion with above-threshold acceleration
        for (let i = 0; i < 2; i++) {
            vi.advanceTimersByTime(1000);
            fireMotion({ x: 2.0, y: 0, z: 0 }); // mag = 2.0 > 0.5
        }

        expect(detector.isMotionless).toBe(false);
        expect(onChange).toHaveBeenCalledWith(false);
        detector.stop();
    });

    it('resets quiet count on above-threshold motion', () => {
        const detector = createMotionDetector();
        detector.start();

        // 30 seconds of quiet
        for (let i = 0; i < 30; i++) {
            vi.advanceTimersByTime(1000);
            fireMotion({ x: 0.1, y: 0, z: 0 });
        }

        // Interrupt with motion
        vi.advanceTimersByTime(1000);
        fireMotion({ x: 2.0, y: 0, z: 0 });

        // 30 more seconds of quiet — should not trigger (only 30, not 60)
        for (let i = 0; i < 30; i++) {
            vi.advanceTimersByTime(1000);
            fireMotion({ x: 0.1, y: 0, z: 0 });
        }

        expect(detector.isMotionless).toBe(false);
        detector.stop();
    });

    it('falls back to accelerationIncludingGravity when acceleration is null', () => {
        const detector = createMotionDetector();
        const onChange = vi.fn();
        detector.onMotionlessChange = onChange;
        detector.start();

        // Fire with gravity-included data (near ~9.81 so net ≈ 0)
        for (let i = 0; i < 60; i++) {
            vi.advanceTimersByTime(1000);
            fireMotionGravity({ x: 0, y: 0, z: 9.81 }); // net mag ≈ 0
        }

        expect(detector.isMotionless).toBe(true);
        detector.stop();
    });

    it('stop resets motionless state', () => {
        const detector = createMotionDetector();
        detector.start();

        for (let i = 0; i < 60; i++) {
            vi.advanceTimersByTime(1000);
            fireMotion({ x: 0.1, y: 0, z: 0 });
        }
        expect(detector.isMotionless).toBe(true);

        detector.stop();
        expect(detector.isMotionless).toBe(false);
    });

    it('does not listen for events before start()', () => {
        const detector = createMotionDetector();
        const onChange = vi.fn();
        detector.onMotionlessChange = onChange;

        // Fire events without starting
        for (let i = 0; i < 60; i++) {
            vi.advanceTimersByTime(1000);
            fireMotion({ x: 0.1, y: 0, z: 0 });
        }

        expect(detector.isMotionless).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });
});
