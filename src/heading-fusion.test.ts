import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHeadingFusion } from '@/heading-fusion';

describe('HeadingFusion', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** Feed n walking-speed samples where compass and GPS differ by `gps - compass`. */
    function walk(
        fusion: ReturnType<typeof createHeadingFusion>,
        compass: number,
        gps: number,
        n = 5
    ): void {
        for (let i = 0; i < n; i++) {
            fusion.updateCompass(compass);
            fusion.updateGps(gps, 1.4);
            vi.advanceTimersByTime(1000);
        }
    }

    /** Let the walking-course hold expire, as when the user stops. */
    const stopWalking = (): void => {
        vi.advanceTimersByTime(6000);
    };

    describe('with nothing known', () => {
        it('has no heading, source or offset', () => {
            const fusion = createHeadingFusion();
            expect(fusion.fusedHeading).toBeNull();
            expect(fusion.source).toBeNull();
            expect(fusion.offset).toBeNull();
        });

        it('trusts an absolute compass until proven otherwise', () => {
            const fusion = createHeadingFusion();
            expect(fusion.compassReliable).toBe(true);
            expect(fusion.confidence).toBe(1);
        });
    });

    describe('compass only', () => {
        it('uses the compass heading before any GPS course exists', () => {
            const fusion = createHeadingFusion();
            fusion.updateCompass(90);
            expect(fusion.fusedHeading).toBe(90);
            expect(fusion.source).toBe('compass');
        });

        it('refuses a relative compass until an offset is learned', () => {
            const fusion = createHeadingFusion();
            fusion.updateCompass(200, false);
            expect(fusion.fusedHeading).toBeNull();
            expect(fusion.compassReliable).toBe(false);
        });

        it('ignores GPS bearings below walking speed', () => {
            const fusion = createHeadingFusion();
            fusion.updateCompass(90);
            fusion.updateGps(180, 0.5);
            expect(fusion.fusedHeading).toBe(90);
            expect(fusion.source).toBe('compass');
        });
    });

    describe('while walking', () => {
        it('uses the GPS course even with no compass at all', () => {
            const fusion = createHeadingFusion();
            fusion.updateGps(45, 1.4);
            expect(fusion.fusedHeading).toBe(45);
            expect(fusion.source).toBe('gps');
        });

        it('prefers GPS course over a disagreeing compass', () => {
            const fusion = createHeadingFusion();
            walk(fusion, 0, 90);
            expect(fusion.fusedHeading).toBeCloseTo(90, 0);
            expect(fusion.source).toBe('gps');
        });

        it('smooths successive bearings along the shortest arc', () => {
            const fusion = createHeadingFusion();
            fusion.updateGps(350, 1.4);
            fusion.updateGps(10, 1.4);
            expect(fusion.fusedHeading).toBeCloseTo(0, 5);
        });

        it('keeps the course for a few seconds after the last fix, then falls back', () => {
            const fusion = createHeadingFusion();
            fusion.updateCompass(10);
            fusion.updateGps(90, 1.4);
            vi.advanceTimersByTime(3000);
            expect(fusion.source).toBe('gps');
            vi.advanceTimersByTime(2000);
            expect(fusion.source).toBe('compass');
        });

        it('starts a fresh course after a long stop instead of blending with the old one', () => {
            const fusion = createHeadingFusion();
            fusion.updateGps(0, 1.4);
            vi.advanceTimersByTime(30_000);
            fusion.updateGps(180, 1.4);
            expect(fusion.fusedHeading).toBe(180);
        });
    });

    describe('learning the compass offset', () => {
        it('needs a few samples before applying an offset', () => {
            const fusion = createHeadingFusion();
            walk(fusion, 60, 90, 2);
            stopWalking();
            expect(fusion.offset).toBeNull();
            expect(fusion.fusedHeading).toBe(60);
        });

        it('corrects the compass by the learned offset once stopped', () => {
            const fusion = createHeadingFusion();
            walk(fusion, 60, 90);
            stopWalking();
            fusion.updateCompass(60);
            expect(fusion.offset).toBeCloseTo(30, 1);
            expect(fusion.fusedHeading).toBeCloseTo(90, 1);
            expect(fusion.source).toBe('compass+offset');
        });

        it('applies the offset to a turn made while stopped', () => {
            const fusion = createHeadingFusion();
            walk(fusion, 60, 90);
            stopWalking();
            fusion.updateCompass(150); // turned 90 degrees on the spot
            expect(fusion.fusedHeading).toBeCloseTo(180, 1);
        });

        it('handles the offset across the 0/360 boundary', () => {
            const fusion = createHeadingFusion();
            walk(fusion, 350, 10);
            stopWalking();
            fusion.updateCompass(350);
            expect(fusion.offset).toBeCloseTo(20, 1);
            expect(fusion.fusedHeading).toBeCloseTo(10, 1);
        });

        it('makes a relative compass usable once its offset is learned', () => {
            const fusion = createHeadingFusion();
            for (let i = 0; i < 5; i++) {
                fusion.updateCompass(200, false);
                fusion.updateGps(90, 1.4);
                vi.advanceTimersByTime(1000);
            }
            stopWalking();
            fusion.updateCompass(200, false);
            expect(fusion.fusedHeading).toBeCloseTo(90, 1);
            expect(fusion.source).toBe('compass+offset');
            expect(fusion.compassReliable).toBe(true);
        });

        it('forgets old samples so a changed offset is relearned', () => {
            const fusion = createHeadingFusion();
            walk(fusion, 90, 90, 10);
            walk(fusion, 50, 90, 10); // compass now 40 degrees off
            stopWalking();
            expect(fusion.offset).toBeCloseTo(40, 1);
        });
    });

    describe('when the compass is unreliable', () => {
        function interfere(fusion: ReturnType<typeof createHeadingFusion>, absolute = true): void {
            // Compass jumps around while GPS is steady
            const compassReadings = [0, 200, 90, 300, 20, 250];
            for (const compass of compassReadings) {
                fusion.updateCompass(compass, absolute);
                fusion.updateGps(90, 1.4);
                vi.advanceTimersByTime(1000);
            }
        }

        it('reports low confidence and an unreliable compass', () => {
            const fusion = createHeadingFusion();
            interfere(fusion);
            expect(fusion.compassReliable).toBe(false);
            expect(fusion.confidence).toBeLessThan(0.3);
            expect(fusion.offset).toBeNull();
        });

        it('falls back to the raw absolute compass when stopped rather than a bad offset', () => {
            const fusion = createHeadingFusion();
            interfere(fusion);
            stopWalking();
            fusion.updateCompass(123);
            expect(fusion.fusedHeading).toBe(123);
            expect(fusion.source).toBe('compass');
        });

        it('has no heading when stopped with an unreliable relative compass', () => {
            const fusion = createHeadingFusion();
            interfere(fusion, false);
            stopWalking();
            expect(fusion.fusedHeading).toBeNull();
        });

        it('recovers once compass and GPS agree consistently again', () => {
            const fusion = createHeadingFusion();
            interfere(fusion);
            walk(fusion, 80, 90, 12);
            expect(fusion.compassReliable).toBe(true);
            expect(fusion.offset).toBeCloseTo(10, 0);
        });
    });

    describe('reset', () => {
        it('clears everything', () => {
            const fusion = createHeadingFusion();
            walk(fusion, 60, 90);
            fusion.reset();
            expect(fusion.fusedHeading).toBeNull();
            expect(fusion.offset).toBeNull();
            expect(fusion.confidence).toBe(1);
        });
    });
});
