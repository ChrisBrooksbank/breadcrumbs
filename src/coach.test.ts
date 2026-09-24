import { describe, it, expect, beforeEach } from 'vitest';
import { createGuidanceCoach, spokenDistance, HAPTIC } from '@/coach';
import type { CoachState, CoachTurn, Cue, GuidanceCoach } from '@/coach';

function state(overrides: Partial<CoachState> = {}): CoachState {
    return {
        arrived: false,
        offRoute: false,
        distanceToRoute: 3,
        remainingMeters: 600,
        nextTurn: null,
        inGap: false,
        currentIndex: 1,
        accuracy: 5,
        ...overrides,
    };
}

function turn(meters: number, overrides: Partial<CoachTurn> = {}): CoachTurn {
    return { index: 7, direction: 'left', meters, angle: 90, ...overrides };
}

/** A state with nothing to announce: close to the end, so no "continue for..." or milestones. */
const quiet = (overrides: Partial<CoachState> = {}): CoachState =>
    state({ remainingMeters: 100, ...overrides });

const ids = (cues: Cue[]): string[] => cues.map(c => c.id);

describe('spokenDistance', () => {
    it('rounds to the nearest 10 m under 100 m, with a 10 m floor', () => {
        expect(spokenDistance(2)).toBe('10 metres');
        expect(spokenDistance(34)).toBe('30 metres');
        expect(spokenDistance(36)).toBe('40 metres');
        expect(spokenDistance(96)).toBe('100 metres');
    });

    it('rounds to the nearest 50 m from 100 m to a kilometre', () => {
        expect(spokenDistance(120)).toBe('100 metres');
        expect(spokenDistance(130)).toBe('150 metres');
        expect(spokenDistance(480)).toBe('500 metres');
    });

    it('switches to kilometres, never saying "1000 metres"', () => {
        expect(spokenDistance(980)).toBe('1 kilometre');
        expect(spokenDistance(1000)).toBe('1 kilometre');
        expect(spokenDistance(1250)).toBe('1.3 kilometres');
        expect(spokenDistance(2000)).toBe('2 kilometres');
    });

    it('copes with negative input', () => {
        expect(spokenDistance(-5)).toBe('10 metres');
    });
});

describe('GuidanceCoach – corners', () => {
    let coach: GuidanceCoach;
    beforeEach(() => {
        coach = createGuidanceCoach();
    });

    it('says nothing while the corner is far away', () => {
        expect(ids(coach.update(state({ nextTurn: turn(300) }), 0))).not.toContain('turn-7-far');
        expect(coach.update(state({ nextTurn: turn(150) }), 1000)).toEqual([]);
    });

    it('announces a corner in three stages as the walker approaches', () => {
        coach.update(state({ nextTurn: turn(300) }), 0);

        const far = coach.update(state({ nextTurn: turn(95) }), 1000);
        expect(far).toHaveLength(1);
        expect(far[0].speech).toBe('In 100 metres, turn left');
        expect(far[0].priority).toBe('normal');
        expect(far[0].haptic).toBeUndefined();

        const near = coach.update(state({ nextTurn: turn(32) }), 2000);
        expect(near[0].speech).toBe('Turn left in 30 metres');
        expect(near[0].priority).toBe('critical');
        expect(near[0].haptic).toEqual([...HAPTIC.left]);
        expect(near[0].tone).toBe('left');

        const now = coach.update(state({ nextTurn: turn(9) }), 3000);
        expect(now[0].speech).toBe('Turn left now');
        expect(now[0].haptic).toEqual([...HAPTIC.leftNow]);
    });

    it('gives each stage only once however many fixes arrive', () => {
        const cues: Cue[] = [];
        for (const m of [90, 80, 70, 60, 50, 40]) {
            cues.push(...coach.update(state({ nextTurn: turn(m) }), 1000));
        }
        expect(ids(cues).filter(id => id === 'turn-7-far')).toHaveLength(1);
    });

    it('skips earlier stages when the first sighting is already close', () => {
        const cues = coach.update(state({ nextTurn: turn(30) }), 0);
        expect(ids(cues)).toEqual(['turn-7-near']);
        // ...and the far stage is not given afterwards either
        expect(coach.update(state({ nextTurn: turn(28) }), 1000)).toEqual([]);
    });

    it('does not repeat a stage if the walker drifts back out', () => {
        coach.update(state({ nextTurn: turn(30) }), 0);
        coach.update(state({ nextTurn: turn(60) }), 1000);
        expect(coach.update(state({ nextTurn: turn(30) }), 2000)).toEqual([]);
    });

    it('uses a different buzz for right than for left', () => {
        const right = coach.update(state({ nextTurn: turn(30, { direction: 'right' }) }), 0);
        expect(right[0].speech).toBe('Turn right in 30 metres');
        expect(right[0].haptic).toEqual([...HAPTIC.right]);
        expect(right[0].tone).toBe('right');
        expect(HAPTIC.right).not.toEqual(HAPTIC.left);
        expect(HAPTIC.rightNow).not.toEqual(HAPTIC.leftNow);
    });

    it('calls a very sharp turn sharp', () => {
        const cues = coach.update(state({ nextTurn: turn(30, { angle: 150 }) }), 0);
        expect(cues[0].speech).toBe('Turn sharp left in 30 metres');
    });

    it('treats each corner separately', () => {
        coach.update(state({ nextTurn: turn(30, { index: 7 }) }), 0);
        const second = coach.update(
            state({ nextTurn: turn(30, { index: 12, direction: 'right' }) }),
            1000
        );
        expect(second[0].speech).toBe('Turn right in 30 metres');
    });
});

describe('GuidanceCoach – legs and milestones', () => {
    let coach: GuidanceCoach;
    beforeEach(() => {
        coach = createGuidanceCoach();
    });

    it('says how far to the first corner when it is a good way off, once', () => {
        const first = coach.update(state({ nextTurn: turn(260) }), 0);
        expect(first).toHaveLength(1);
        expect(first[0].speech).toBe('Continue for 250 metres');
        expect(first[0].priority).toBe('info');
        expect(coach.update(state({ nextTurn: turn(250) }), 1000)).toEqual([]);
    });

    it('describes the final leg when there are no more corners', () => {
        const cues = coach.update(state({ nextTurn: null, remainingMeters: 300 }), 0);
        expect(cues[0].speech).toBe('Continue for 300 metres');
    });

    it('does not describe a short leg', () => {
        expect(coach.update(state({ nextTurn: turn(110), remainingMeters: 200 }), 0)).toEqual([]);
    });

    it('announces remaining-distance milestones as they are passed, once each', () => {
        const spoken: string[] = [];
        for (const remaining of [1100, 990, 900, 600, 490, 480, 300, 240, 200, 99, 90]) {
            spoken.push(
                ...coach
                    .update(state({ remainingMeters: remaining, nextTurn: turn(500) }), 0)
                    .filter(c => c.id.startsWith('remaining'))
                    .map(c => c.speech ?? '')
            );
        }
        expect(spoken).toEqual([
            '1 kilometre to go',
            '500 metres to go',
            '250 metres to go',
            '100 metres to go',
        ]);
    });

    it('does not announce milestones already passed when navigation starts', () => {
        const cues = coach.update(state({ remainingMeters: 300, nextTurn: turn(500) }), 0);
        expect(ids(cues).filter(id => id.startsWith('remaining'))).toEqual([]);
        // ...but the next one down is still announced
        const next = coach.update(state({ remainingMeters: 240, nextTurn: turn(500) }), 1000);
        expect(ids(next)).toContain('remaining-250');
    });

    it('announces only once when several milestones are passed at once', () => {
        coach.update(state({ remainingMeters: 1200, nextTurn: turn(900) }), 0);
        const cues = coach.update(state({ remainingMeters: 200, nextTurn: turn(150) }), 1000);
        expect(ids(cues).filter(id => id.startsWith('remaining'))).toEqual(['remaining-250']);
    });

    it('keeps quiet about milestones right at the end, where arrival will speak', () => {
        coach.update(state({ remainingMeters: 300, nextTurn: null }), 0);
        const cues = coach.update(state({ remainingMeters: 30, nextTurn: null }), 1000);
        expect(ids(cues).filter(id => id.startsWith('remaining'))).toEqual([]);
    });
});

describe('GuidanceCoach – off the route', () => {
    let coach: GuidanceCoach;
    beforeEach(() => {
        coach = createGuidanceCoach();
    });

    it('says so once, with how far away the route is, with a distinct buzz', () => {
        const cues = coach.update(state({ offRoute: true, distanceToRoute: 62 }), 0);
        expect(cues).toHaveLength(1);
        expect(cues[0].speech).toBe('Off the trail. The route is 60 metres away.');
        expect(cues[0].haptic).toEqual([...HAPTIC.offRoute]);
        expect(cues[0].priority).toBe('critical');
        expect(coach.update(state({ offRoute: true, distanceToRoute: 60 }), 5000)).toEqual([]);
    });

    it('still works without a distance', () => {
        const cues = coach.update(state({ offRoute: true, distanceToRoute: null }), 0);
        expect(cues[0].speech).toBe('Off the trail.');
    });

    it('reminds every 30 seconds while still off, not before', () => {
        coach.update(state({ offRoute: true }), 0);
        expect(coach.update(state({ offRoute: true }), 29_000)).toEqual([]);
        const reminder = coach.update(state({ offRoute: true }), 31_000);
        expect(reminder[0].speech).toBe('Still off the trail. Head toward the route.');
        expect(coach.update(state({ offRoute: true }), 40_000)).toEqual([]);
    });

    it('says when back on the route', () => {
        coach.update(state({ offRoute: true }), 0);
        const back = coach.update(state({ offRoute: false }), 10_000);
        expect(ids(back)).toContain('back-on-route');
        expect(back.find(c => c.id === 'back-on-route')?.haptic).toEqual([...HAPTIC.backOnRoute]);
        expect(ids(coach.update(state({ offRoute: false }), 11_000))).not.toContain(
            'back-on-route'
        );
    });

    it('gives no corner or distance guidance while off the route', () => {
        coach.update(state({ offRoute: true }), 0);
        const cues = coach.update(state({ offRoute: true, nextTurn: turn(20) }), 1000);
        expect(cues).toEqual([]);
    });

    it('does not announce off-route for someone who was never off', () => {
        expect(ids(coach.update(state(), 0))).not.toContain('off-route');
    });
});

describe('GuidanceCoach – weak GPS and gaps', () => {
    let coach: GuidanceCoach;
    beforeEach(() => {
        coach = createGuidanceCoach();
    });

    it('ignores a brief bad fix but warns when weak GPS persists', () => {
        expect(coach.update(quiet({ accuracy: 70 }), 0)).toEqual([]);
        expect(coach.update(quiet({ accuracy: 70 }), 10_000)).toEqual([]);
        const warn = coach.update(quiet({ accuracy: 70 }), 16_000);
        expect(warn).toHaveLength(1);
        expect(warn[0].speech).toBe('GPS signal is weak. Directions may be less accurate.');
    });

    it('does not repeat the warning for a minute', () => {
        coach.update(quiet({ accuracy: 70 }), 0);
        coach.update(quiet({ accuracy: 70 }), 16_000);
        expect(coach.update(quiet({ accuracy: 70 }), 50_000)).toEqual([]);
        expect(ids(coach.update(quiet({ accuracy: 70 }), 80_000))).toContain('gps-weak');
    });

    it('a good fix resets the weak-GPS timer', () => {
        coach.update(quiet({ accuracy: 70 }), 0);
        coach.update(quiet({ accuracy: 8 }), 10_000);
        expect(coach.update(quiet({ accuracy: 70 }), 20_000)).toEqual([]);
        expect(coach.update(quiet({ accuracy: 70 }), 30_000)).toEqual([]);
        expect(ids(coach.update(quiet({ accuracy: 70 }), 36_000))).toContain('gps-weak');
    });

    it('warns about a stretch recorded without GPS, once per stretch', () => {
        const first = coach.update(quiet({ inGap: true, currentIndex: 5 }), 0);
        expect(first[0].speech).toBe(
            'GPS was lost along this stretch. Head straight for the next point.'
        );
        expect(coach.update(quiet({ inGap: true, currentIndex: 5 }), 1000)).toEqual([]);
        expect(ids(coach.update(quiet({ inGap: true, currentIndex: 20 }), 2000))).toContain('gap');
    });
});

describe('GuidanceCoach – arrival and reset', () => {
    it('announces arrival once, with the celebratory buzz, then stays quiet', () => {
        const coach = createGuidanceCoach();
        const cues = coach.update(state({ arrived: true, remainingMeters: 0 }), 0);
        expect(cues).toHaveLength(1);
        expect(cues[0].speech).toBe("You've arrived");
        expect(cues[0].haptic).toEqual([...HAPTIC.arrived]);
        expect(cues[0].tone).toBe('arrive');
        expect(coach.update(state({ arrived: true, remainingMeters: 0 }), 1000)).toEqual([]);
    });

    it('arrival takes over even when off the route', () => {
        const coach = createGuidanceCoach();
        coach.update(state({ offRoute: true }), 0);
        const cues = coach.update(state({ arrived: true, offRoute: true }), 1000);
        expect(ids(cues)).toEqual(['arrived']);
    });

    it('reset lets a new session hear everything again', () => {
        const coach = createGuidanceCoach();
        coach.update(state({ nextTurn: turn(30) }), 0);
        coach.update(state({ arrived: true }), 1000);
        coach.reset();
        expect(ids(coach.update(state({ nextTurn: turn(30) }), 2000))).toEqual(['turn-7-near']);
        expect(ids(coach.update(state({ arrived: true }), 3000))).toEqual(['arrived']);
    });
});
