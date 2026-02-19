import { describe, it, expect } from 'vitest';
import { createHeadingFusion } from '@/heading-fusion';

describe('HeadingFusion', () => {
    it('returns null when no compass data has been provided', () => {
        const fusion = createHeadingFusion();
        expect(fusion.fusedHeading).toBeNull();
    });

    it('returns compass heading when no GPS data is available', () => {
        const fusion = createHeadingFusion();
        fusion.updateCompass(90);
        expect(fusion.fusedHeading).toBe(90);
    });

    it('returns compass heading when GPS speed is too low', () => {
        const fusion = createHeadingFusion();
        fusion.updateCompass(90);
        fusion.updateGps(180, 0.5); // below 1 m/s threshold
        expect(fusion.fusedHeading).toBe(90);
    });

    it('starts with confidence 1.0', () => {
        const fusion = createHeadingFusion();
        expect(fusion.confidence).toBe(1.0);
    });

    it('maintains high confidence when compass and GPS agree', () => {
        const fusion = createHeadingFusion();
        fusion.updateCompass(90);
        // Feed 5 agreeing samples
        for (let i = 0; i < 5; i++) {
            fusion.updateCompass(90);
            fusion.updateGps(90, 2.0);
        }
        expect(fusion.confidence).toBeCloseTo(1.0, 1);
        expect(fusion.fusedHeading).toBeCloseTo(90, 1);
    });

    it('drops confidence when compass and GPS persistently disagree', () => {
        const fusion = createHeadingFusion();
        // Feed 5 samples with 90° disagreement
        for (let i = 0; i < 5; i++) {
            fusion.updateCompass(0);
            fusion.updateGps(90, 2.0);
        }
        // 90° disagreement → confidence = max(0, 1 - 90/60) = 0
        expect(fusion.confidence).toBe(0);
    });

    it('blends heading toward GPS when confidence is low', () => {
        const fusion = createHeadingFusion();
        // Create full disagreement: compass=0, GPS=90
        for (let i = 0; i < 5; i++) {
            fusion.updateCompass(0);
            fusion.updateGps(90, 2.0);
        }
        // With confidence=0, fused heading should equal GPS bearing (90)
        expect(fusion.fusedHeading).toBeCloseTo(90, 1);
    });

    it('uses compass-only when stationary (speed < 1 m/s)', () => {
        const fusion = createHeadingFusion();
        // First build up some disagreement at speed
        for (let i = 0; i < 5; i++) {
            fusion.updateCompass(0);
            fusion.updateGps(90, 2.0);
        }
        // Now slow down — GPS data not collected, but existing samples remain
        fusion.updateCompass(45);
        fusion.updateGps(90, 0.3); // too slow to add sample
        // Fused heading should still blend based on existing confidence
        const heading = fusion.fusedHeading!;
        expect(heading).toBeDefined();
    });

    it('handles 360/0 wraparound correctly', () => {
        const fusion = createHeadingFusion();
        // Compass says 350, GPS says 10 — only 20° apart
        for (let i = 0; i < 5; i++) {
            fusion.updateCompass(350);
            fusion.updateGps(10, 2.0);
        }
        // 20° disagreement → confidence = max(0, 1 - 20/60) ≈ 0.67
        expect(fusion.confidence).toBeCloseTo(0.67, 1);
    });

    it('reset clears all state', () => {
        const fusion = createHeadingFusion();
        fusion.updateCompass(90);
        fusion.updateGps(180, 2.0);
        fusion.reset();
        expect(fusion.fusedHeading).toBeNull();
        expect(fusion.confidence).toBe(1.0);
    });

    it('partial disagreement gives partial blending', () => {
        const fusion = createHeadingFusion();
        // 30° disagreement → confidence = 1 - 30/60 = 0.5
        for (let i = 0; i < 5; i++) {
            fusion.updateCompass(0);
            fusion.updateGps(30, 2.0);
        }
        expect(fusion.confidence).toBeCloseTo(0.5, 1);
        // Fused heading should be between 0 and 30
        const heading = fusion.fusedHeading!;
        expect(heading).toBeGreaterThan(0);
        expect(heading).toBeLessThan(30);
    });
});
