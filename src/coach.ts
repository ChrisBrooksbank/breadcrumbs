/**
 * GuidanceCoach: decides WHAT to tell the walker and WHEN, like a sat-nav or a Garmin.
 *
 * It is pure logic: give it the navigation state on each GPS fix and it returns the cues
 * (speech, vibration pattern, tone) to deliver now, usually none. Delivery, throttling and
 * silent mode live in FeedbackService. Cues are rare and mean something:
 *   - a corner ahead, in stages ("In 100 metres, turn left" -> "Turn left in 30 metres" ->
 *     "Turn left now"), with a distinct buzz for left and right
 *   - how far to walk before the next corner, and remaining-distance milestones
 *   - off the route (and back), a stretch recorded without GPS, weak GPS, arrival
 */

export type TurnDirection = 'left' | 'right';

/** How urgent a cue is; decides whether it may be dropped when speech is busy. */
export type CuePriority = 'info' | 'normal' | 'critical';

/** Named tone patterns, played when vibration is unavailable (iOS) or in silent mode. */
export type ToneName = 'left' | 'right' | 'alert' | 'ok' | 'arrive';

export interface Cue {
    /** Stable id, for tests and de-duplication. */
    id: string;
    /** What to say (suppressed in silent mode). */
    speech?: string;
    /** Vibration pattern in ms (on, off, on, ...). */
    haptic?: number[];
    tone?: ToneName;
    priority: CuePriority;
}

export interface CoachTurn {
    /** Trail index of the corner; identifies it across updates. */
    index: number;
    direction: TurnDirection;
    /** Distance to the corner along the path, metres. */
    meters: number;
    /** Size of the turn, degrees. */
    angle: number;
}

export interface CoachState {
    arrived: boolean;
    offRoute: boolean;
    /** Distance from the walker to the nearest point of the route still to walk. */
    distanceToRoute: number | null;
    /** Path distance still to walk. */
    remainingMeters: number;
    nextTurn: CoachTurn | null;
    /** True while walking a stretch that was recorded without GPS. */
    inGap: boolean;
    /** Trail index of the crumb being walked towards. */
    currentIndex: number;
    /** Reported accuracy of the latest fix, metres. */
    accuracy: number;
}

/** Vibration patterns. Left and right are deliberately unlike each other. */
export const HAPTIC = {
    /** Two short pulses. */
    left: [120, 110, 120],
    /** One long pulse. */
    right: [450],
    /** "Turn now": the same shape as the turn, but firmer. */
    leftNow: [200, 100, 200, 100, 200],
    rightNow: [700],
    offRoute: [100, 50, 100, 50, 100],
    backOnRoute: [60, 60, 60],
    weakGps: [60, 60, 60],
    arrived: [200, 100, 200, 100, 200],
} as const;

/** A turn at or beyond this many degrees is described as sharp. */
const SHARP_TURN_DEGREES = 120;

/** Distances (metres) at which a corner is announced, nearest last. */
const FAR_METERS = 100;
const NEAR_METERS = 35;
const NOW_METERS = 12;

/** Only say how far to walk before the corner when it is at least this far off. */
const CONTINUE_MIN_METERS = 120;

/** Remaining-distance milestones (metres), largest first. */
const MILESTONES = [1000, 500, 250, 100];
/** Do not announce a milestone this close to the end: arrival is about to speak. */
const MILESTONE_MIN_REMAINING = 40;

/** A fix with worse accuracy than this is weak; it must persist to be worth mentioning. */
const WEAK_ACCURACY_METERS = 40;
const WEAK_PERSISTS_MS = 15_000;
const WEAK_REPEAT_MS = 60_000;

/** While still off the route, remind this often. */
const OFF_ROUTE_REMINDER_MS = 30_000;

/**
 * A distance the way people say it: nearest 10 m under 100, nearest 50 m under 1 km, then
 * kilometres to one decimal.
 */
export function spokenDistance(meters: number): string {
    const m = Math.max(0, meters);
    const rounded = m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50;
    if (rounded >= 1000) {
        const km = Math.round(m / 100) / 10;
        return km === 1 ? '1 kilometre' : `${String(km)} kilometres`;
    }
    return `${String(rounded)} metres`;
}

function turnWord(turn: CoachTurn): string {
    return turn.angle >= SHARP_TURN_DEGREES ? `sharp ${turn.direction}` : turn.direction;
}

type Stage = 'far' | 'near' | 'now';
const STAGE_ORDER: Stage[] = ['far', 'near', 'now'];

function stageFor(meters: number): Stage | null {
    if (meters <= NOW_METERS) return 'now';
    if (meters <= NEAR_METERS) return 'near';
    if (meters <= FAR_METERS) return 'far';
    return null;
}

export interface GuidanceCoach {
    /** Feed the latest navigation state; returns the cues to deliver now (usually none). */
    update(state: CoachState, now?: number): Cue[];
    /** Forget everything (a new navigation session). */
    reset(): void;
}

export function createGuidanceCoach(): GuidanceCoach {
    let arrivedCued = false;
    let wasOffRoute = false;
    let lastOffRouteCue = 0;
    let weakSince: number | null = null;
    let lastWeakCue = -Infinity;
    let started = false;

    /** Stages already delivered for each corner, by trail index. */
    const turnStages = new Map<number, Set<Stage>>();
    /** Legs (identified by the corner they end at, or 'end') already described. */
    const legsDescribed = new Set<string>();
    const milestonesDone = new Set<number>();
    const gapsAnnounced = new Set<number>();

    function turnCue(turn: CoachTurn, stage: Stage): Cue {
        const left = turn.direction === 'left';
        const word = turnWord(turn);
        if (stage === 'far') {
            return {
                id: `turn-${String(turn.index)}-far`,
                speech: `In ${spokenDistance(turn.meters)}, turn ${word}`,
                priority: 'normal',
            };
        }
        if (stage === 'near') {
            return {
                id: `turn-${String(turn.index)}-near`,
                speech: `Turn ${word} in ${spokenDistance(turn.meters)}`,
                haptic: [...(left ? HAPTIC.left : HAPTIC.right)],
                tone: left ? 'left' : 'right',
                priority: 'critical',
            };
        }
        return {
            id: `turn-${String(turn.index)}-now`,
            speech: `Turn ${word} now`,
            haptic: [...(left ? HAPTIC.leftNow : HAPTIC.rightNow)],
            tone: left ? 'left' : 'right',
            priority: 'critical',
        };
    }

    function update(state: CoachState, now = Date.now()): Cue[] {
        const cues: Cue[] = [];

        // First look: milestones already passed are not news
        if (!started) {
            started = true;
            for (const m of MILESTONES) {
                if (state.remainingMeters <= m) milestonesDone.add(m);
            }
        }

        // ---- Arrival ends everything
        if (state.arrived) {
            if (!arrivedCued) {
                arrivedCued = true;
                cues.push({
                    id: 'arrived',
                    speech: "You've arrived",
                    haptic: [...HAPTIC.arrived],
                    tone: 'arrive',
                    priority: 'critical',
                });
            }
            return cues;
        }

        // ---- Off the route: say so, remind, and say when back; nothing else meanwhile
        if (state.offRoute) {
            if (!wasOffRoute) {
                wasOffRoute = true;
                lastOffRouteCue = now;
                const away =
                    state.distanceToRoute !== null
                        ? ` The route is ${spokenDistance(state.distanceToRoute)} away.`
                        : '';
                cues.push({
                    id: 'off-route',
                    speech: `Off the trail.${away}`,
                    haptic: [...HAPTIC.offRoute],
                    tone: 'alert',
                    priority: 'critical',
                });
            } else if (now - lastOffRouteCue >= OFF_ROUTE_REMINDER_MS) {
                lastOffRouteCue = now;
                cues.push({
                    id: 'off-route-reminder',
                    speech: 'Still off the trail. Head toward the route.',
                    priority: 'normal',
                });
            }
            return cues;
        }
        if (wasOffRoute) {
            wasOffRoute = false;
            cues.push({
                id: 'back-on-route',
                speech: 'Back on the route',
                haptic: [...HAPTIC.backOnRoute],
                tone: 'ok',
                priority: 'critical',
            });
        }

        // ---- Weak GPS, but only once it has persisted
        if (state.accuracy > WEAK_ACCURACY_METERS) {
            weakSince ??= now;
            if (now - weakSince >= WEAK_PERSISTS_MS && now - lastWeakCue >= WEAK_REPEAT_MS) {
                lastWeakCue = now;
                cues.push({
                    id: 'gps-weak',
                    speech: 'GPS signal is weak. Directions may be less accurate.',
                    haptic: [...HAPTIC.weakGps],
                    tone: 'alert',
                    priority: 'normal',
                });
            }
        } else {
            weakSince = null;
        }

        // ---- A stretch recorded without GPS
        if (state.inGap && !gapsAnnounced.has(state.currentIndex)) {
            gapsAnnounced.add(state.currentIndex);
            cues.push({
                id: 'gap',
                speech: 'GPS was lost along this stretch. Head straight for the next point.',
                priority: 'normal',
            });
        }

        // ---- The next corner, in stages; the most urgent stage not yet given
        const turn = state.nextTurn;
        let turnCued = false;
        if (turn) {
            const stage = stageFor(turn.meters);
            if (stage) {
                let done = turnStages.get(turn.index);
                if (!done) {
                    done = new Set();
                    turnStages.set(turn.index, done);
                }
                if (!done.has(stage)) {
                    // Reaching a later stage first (a corner right after another) skips earlier ones
                    for (const s of STAGE_ORDER) {
                        done.add(s);
                        if (s === stage) break;
                    }
                    cues.push(turnCue(turn, stage));
                    turnCued = true;
                }
            }
        }

        // ---- How far to the next corner (or the end), once per leg
        if (!turnCued && !cues.some(c => c.id === 'gap')) {
            const legKey = turn ? String(turn.index) : 'end';
            const legMeters = turn ? turn.meters : state.remainingMeters;
            if (!legsDescribed.has(legKey) && legMeters >= CONTINUE_MIN_METERS) {
                legsDescribed.add(legKey);
                cues.push({
                    id: `continue-${legKey}`,
                    speech: `Continue for ${spokenDistance(legMeters)}`,
                    priority: 'info',
                });
            }
        }

        // ---- Remaining-distance milestones: announce the nearest one reached, once
        if (state.remainingMeters > MILESTONE_MIN_REMAINING) {
            const reached = MILESTONES.filter(m => state.remainingMeters <= m);
            if (reached.length > 0 && reached.some(m => !milestonesDone.has(m))) {
                // Passing several at once (a shortcut) announces once and retires them all
                for (const m of reached) milestonesDone.add(m);
                cues.push({
                    id: `remaining-${String(Math.min(...reached))}`,
                    speech: `${spokenDistance(state.remainingMeters)} to go`,
                    priority: 'info',
                });
            }
        }

        return cues;
    }

    function reset(): void {
        arrivedCued = false;
        wasOffRoute = false;
        lastOffRouteCue = 0;
        weakSince = null;
        lastWeakCue = -Infinity;
        started = false;
        turnStages.clear();
        legsDescribed.clear();
        milestonesDone.clear();
        gapsAnnounced.clear();
    }

    return { update, reset };
}
