import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFeedbackService } from '@/feedback';
import { HAPTIC } from '@/coach';
import type { Cue } from '@/coach';

/** A stand-in Web Audio API that just counts the tones started. */
function stubAudio(): { tones: () => number } {
    let started = 0;
    class FakeAudioContext {
        currentTime = 0;
        destination = {};
        createOscillator(): unknown {
            return {
                connect: vi.fn(),
                type: '',
                frequency: { setValueAtTime: vi.fn() },
                start: vi.fn(() => {
                    started++;
                }),
                stop: vi.fn(),
            };
        }
        createGain(): unknown {
            return {
                connect: vi.fn(),
                gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
            };
        }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    return { tones: () => started };
}

function stubSpeech(): { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
    const speak = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [] });
    vi.stubGlobal(
        'SpeechSynthesisUtterance',
        class {
            constructor(public text: string) {}
        }
    );
    // window.speechSynthesis is what the service reads
    Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: { speak, cancel, getVoices: () => [] },
    });
    return { speak, cancel };
}

const spoken = (speak: ReturnType<typeof vi.fn>): string[] =>
    speak.mock.calls.map(c => (c[0] as { text: string }).text);

describe('FeedbackService.cue', () => {
    let vibrate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        localStorage.clear();
        vibrate = vi.fn();
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        delete (navigator as unknown as Record<string, unknown>).vibrate;
        delete (window as unknown as Record<string, unknown>).speechSynthesis;
    });

    const turnNear: Cue = {
        id: 'turn-near',
        speech: 'Turn left in 30 metres',
        haptic: [...HAPTIC.left],
        tone: 'left',
        priority: 'critical',
    };

    describe('speech', () => {
        it('speaks the cue', () => {
            const { speak } = stubSpeech();
            createFeedbackService().cue(turnNear);
            expect(spoken(speak)).toEqual(['Turn left in 30 metres']);
        });

        it('is silent in silent mode but still vibrates', () => {
            const { speak } = stubSpeech();
            const service = createFeedbackService();
            service.silentMode = true;
            service.cue(turnNear);
            expect(speak).not.toHaveBeenCalled();
            expect(vibrate).toHaveBeenCalledWith([...HAPTIC.left]);
        });

        it('does nothing risky when speech is unavailable, and still vibrates', () => {
            createFeedbackService().cue(turnNear);
            expect(vibrate).toHaveBeenCalledWith([...HAPTIC.left]);
        });

        it('a critical cue interrupts speech already in progress', () => {
            const { speak, cancel } = stubSpeech();
            createFeedbackService().cue(turnNear);
            expect(cancel).toHaveBeenCalledTimes(1);
            expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
                speak.mock.invocationCallOrder[0]
            );
        });

        it('normal and info cues do not interrupt', () => {
            const { cancel } = stubSpeech();
            const service = createFeedbackService();
            service.cue({ id: 'a', speech: 'In 100 metres, turn left', priority: 'normal' });
            vi.advanceTimersByTime(10_000);
            service.cue({ id: 'b', speech: 'Continue for 250 metres', priority: 'info' });
            expect(cancel).not.toHaveBeenCalled();
        });
    });

    describe('throttling', () => {
        it('drops a normal cue that comes right after other speech, allows it later', () => {
            const { speak } = stubSpeech();
            const service = createFeedbackService();
            service.cue({ id: 'a', speech: 'first', priority: 'normal' });
            vi.advanceTimersByTime(1000);
            service.cue({ id: 'b', speech: 'too soon', priority: 'normal' });
            vi.advanceTimersByTime(2000);
            service.cue({ id: 'c', speech: 'later', priority: 'normal' });
            expect(spoken(speak)).toEqual(['first', 'later']);
        });

        it('drops an info cue for 8 seconds after other speech', () => {
            const { speak } = stubSpeech();
            const service = createFeedbackService();
            service.cue({ id: 'a', speech: 'first', priority: 'normal' });
            vi.advanceTimersByTime(7000);
            service.cue({ id: 'b', speech: 'chatter', priority: 'info' });
            vi.advanceTimersByTime(2000);
            service.cue({ id: 'c', speech: 'fine now', priority: 'info' });
            expect(spoken(speak)).toEqual(['first', 'fine now']);
        });

        it('never drops a critical cue, even straight after other speech', () => {
            const { speak } = stubSpeech();
            const service = createFeedbackService();
            service.cue({ id: 'a', speech: 'first', priority: 'critical' });
            service.cue({ id: 'b', speech: 'second', priority: 'critical' });
            expect(spoken(speak)).toEqual(['first', 'second']);
        });

        it('a dropped cue still vibrates', () => {
            stubSpeech();
            const service = createFeedbackService();
            service.cue({ id: 'a', speech: 'first', priority: 'normal' });
            service.cue({
                id: 'b',
                speech: 'dropped',
                haptic: [...HAPTIC.weakGps],
                priority: 'normal',
            });
            expect(vibrate).toHaveBeenCalledWith([...HAPTIC.weakGps]);
        });
    });

    describe('vibration and tones', () => {
        it('vibrates with the cue pattern, and plays no tone when vibration works', () => {
            stubSpeech();
            const audio = stubAudio();
            createFeedbackService().cue(turnNear);
            expect(vibrate).toHaveBeenCalledWith([...HAPTIC.left]);
            expect(audio.tones()).toBe(0);
        });

        it('plays the tone pattern in silent mode: two for left, one for right, three for alert', () => {
            const audio = stubAudio();
            const service = createFeedbackService();
            service.silentMode = true;

            service.cue({ id: 'l', tone: 'left', priority: 'critical' });
            vi.advanceTimersByTime(500);
            expect(audio.tones()).toBe(2);

            service.cue({ id: 'r', tone: 'right', priority: 'critical' });
            vi.advanceTimersByTime(500);
            expect(audio.tones()).toBe(3);

            service.cue({ id: 'a', tone: 'alert', priority: 'critical' });
            vi.advanceTimersByTime(1000);
            expect(audio.tones()).toBe(6);
        });

        it('plays tones instead when the browser cannot vibrate (iOS)', () => {
            delete (navigator as unknown as Record<string, unknown>).vibrate;
            const audio = stubAudio();
            createFeedbackService().cue({ id: 'r', tone: 'right', priority: 'critical' });
            expect(audio.tones()).toBe(1);
        });

        it('always plays the arrival tone, even when vibration works', () => {
            const audio = stubAudio();
            createFeedbackService().cue({
                id: 'arrived',
                tone: 'arrive',
                haptic: [...HAPTIC.arrived],
                priority: 'critical',
            });
            expect(audio.tones()).toBe(1);
            expect(vibrate).toHaveBeenCalledWith([...HAPTIC.arrived]);
        });

        it('left and right cues use different vibration patterns', () => {
            stubSpeech();
            const service = createFeedbackService();
            service.cue({ id: 'l', haptic: [...HAPTIC.left], priority: 'critical' });
            service.cue({ id: 'r', haptic: [...HAPTIC.right], priority: 'critical' });
            expect(vibrate.mock.calls[0][0]).not.toEqual(vibrate.mock.calls[1][0]);
        });
    });

    it('an empty cue is harmless', () => {
        stubSpeech();
        const audio = stubAudio();
        createFeedbackService().cue({ id: 'empty', priority: 'info' });
        expect(vibrate).not.toHaveBeenCalled();
        expect(audio.tones()).toBe(0);
    });
});
