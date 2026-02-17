import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyDirection, createFeedbackService } from '@/feedback';

describe('classifyDirection', () => {
    it('classifies 0° as straight ahead', () => {
        expect(classifyDirection(0)).toBe('straight ahead');
    });

    it('classifies +30° as straight ahead (boundary)', () => {
        expect(classifyDirection(30)).toBe('straight ahead');
    });

    it('classifies -30° as straight ahead (boundary)', () => {
        expect(classifyDirection(-30)).toBe('straight ahead');
    });

    it('classifies +31° as turn right', () => {
        expect(classifyDirection(31)).toBe('turn right');
    });

    it('classifies +90° (East) as turn right', () => {
        expect(classifyDirection(90)).toBe('turn right');
    });

    it('classifies +150° as turn right (boundary)', () => {
        expect(classifyDirection(150)).toBe('turn right');
    });

    it('classifies -31° as turn left', () => {
        expect(classifyDirection(-31)).toBe('turn left');
    });

    it('classifies -90° (West) as turn left', () => {
        expect(classifyDirection(-90)).toBe('turn left');
    });

    it('classifies -150° as turn left (boundary)', () => {
        expect(classifyDirection(-150)).toBe('turn left');
    });

    it('classifies +180° as wrong way', () => {
        expect(classifyDirection(180)).toBe("you're going the wrong way");
    });

    it('classifies -180° as wrong way', () => {
        expect(classifyDirection(-180)).toBe("you're going the wrong way");
    });

    it('classifies +151° as wrong way', () => {
        expect(classifyDirection(151)).toBe("you're going the wrong way");
    });

    it('classifies -151° as wrong way', () => {
        expect(classifyDirection(-151)).toBe("you're going the wrong way");
    });

    it('normalises values beyond 360° correctly', () => {
        // 360 + 0 = effectively 0 => straight ahead
        expect(classifyDirection(360)).toBe('straight ahead');
    });

    it('normalises negative values beyond -360° correctly', () => {
        // -360 + 0 = effectively 0 => straight ahead
        expect(classifyDirection(-360)).toBe('straight ahead');
    });
});

describe('FeedbackService – speech', () => {
    let speakMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        speakMock = vi.fn();
        vi.stubGlobal('speechSynthesis', { speak: speakMock });
        vi.stubGlobal('SpeechSynthesisUtterance', function (text: string) {
            return { text };
        });
    });

    afterEach(() => {
        vi.runAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('reports speechAvailable as true when speechSynthesis is present', () => {
        const service = createFeedbackService();
        expect(service.speechAvailable).toBe(true);
    });

    it('calls speechSynthesis.speak when speak() is called (after debounce)', () => {
        const service = createFeedbackService();
        service.speak('turn left');
        expect(speakMock).not.toHaveBeenCalled(); // not yet
        vi.runAllTimers();
        expect(speakMock).toHaveBeenCalledTimes(1);
    });

    it('creates SpeechSynthesisUtterance with the direction phrase', () => {
        const service = createFeedbackService();
        service.speak('turn right');
        vi.runAllTimers();
        const utterance = speakMock.mock.calls[0][0] as { text: string };
        expect(utterance.text).toBe('turn right');
    });

    it('announces straight ahead correctly', () => {
        const service = createFeedbackService();
        service.speak('straight ahead');
        vi.runAllTimers();
        const utterance = speakMock.mock.calls[0][0] as { text: string };
        expect(utterance.text).toBe('straight ahead');
    });

    it('announces wrong way correctly', () => {
        const service = createFeedbackService();
        service.speak("you're going the wrong way");
        vi.runAllTimers();
        const utterance = speakMock.mock.calls[0][0] as { text: string };
        expect(utterance.text).toBe("you're going the wrong way");
    });

    it('calls speechSynthesis.speak when announce() is called with arbitrary phrase', () => {
        const service = createFeedbackService();
        service.announce('50 metres');
        const utterance = speakMock.mock.calls[0][0] as { text: string };
        expect(utterance.text).toBe('50 metres');
    });
});

describe('FeedbackService – distance announcements', () => {
    let speakMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        speakMock = vi.fn();
        vi.stubGlobal('speechSynthesis', { speak: speakMock });
        vi.stubGlobal('SpeechSynthesisUtterance', function (text: string) {
            return { text };
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('does not announce when distance is above all thresholds', () => {
        const service = createFeedbackService();
        service.announceDistance(100);
        expect(speakMock).not.toHaveBeenCalled();
    });

    it('announces "50 metres" when distance drops to 50m', () => {
        const service = createFeedbackService();
        service.announceDistance(50);
        const utterance = speakMock.mock.calls[0][0] as { text: string };
        expect(utterance.text).toBe('50 metres');
    });

    it('announces "50 metres" when distance drops below 50m', () => {
        const service = createFeedbackService();
        service.announceDistance(45);
        const utterance = speakMock.mock.calls[0][0] as { text: string };
        expect(utterance.text).toBe('50 metres');
    });

    it('announces "20 metres" when distance drops to 20m', () => {
        const service = createFeedbackService();
        service.announceDistance(20);
        expect(speakMock).toHaveBeenCalledTimes(2);
        const phrases = speakMock.mock.calls.map((c: unknown[]) => (c[0] as { text: string }).text);
        expect(phrases).toContain('50 metres');
        expect(phrases).toContain('20 metres');
    });

    it('announces "almost there" when distance drops to 5m', () => {
        const service = createFeedbackService();
        service.announceDistance(5);
        expect(speakMock).toHaveBeenCalledTimes(3);
        const phrases = speakMock.mock.calls.map((c: unknown[]) => (c[0] as { text: string }).text);
        expect(phrases).toContain('50 metres');
        expect(phrases).toContain('20 metres');
        expect(phrases).toContain('almost there');
    });

    it('does not repeat "50 metres" announcement on subsequent calls', () => {
        const service = createFeedbackService();
        service.announceDistance(50);
        service.announceDistance(48);
        service.announceDistance(46);
        const fiftyMCount = speakMock.mock.calls.filter(
            (c: unknown[]) => (c[0] as { text: string }).text === '50 metres'
        ).length;
        expect(fiftyMCount).toBe(1);
    });

    it('does not repeat "20 metres" announcement on subsequent calls', () => {
        const service = createFeedbackService();
        service.announceDistance(20);
        service.announceDistance(18);
        const twentyMCount = speakMock.mock.calls.filter(
            (c: unknown[]) => (c[0] as { text: string }).text === '20 metres'
        ).length;
        expect(twentyMCount).toBe(1);
    });

    it('resets announcements after resetDistanceAnnouncements()', () => {
        const service = createFeedbackService();
        service.announceDistance(50);
        expect(speakMock).toHaveBeenCalledTimes(1);
        service.resetDistanceAnnouncements();
        service.announceDistance(50);
        expect(speakMock).toHaveBeenCalledTimes(2);
    });

    it('does not announce when speech is unavailable', () => {
        vi.unstubAllGlobals();
        vi.stubGlobal('speechSynthesis', undefined);
        vi.stubGlobal('SpeechSynthesisUtterance', undefined);
        const service = createFeedbackService();
        expect(() => service.announceDistance(5)).not.toThrow();
        expect(speakMock).not.toHaveBeenCalled();
    });
});

describe('FeedbackService – audio tones', () => {
    let mockOscillator: {
        connect: ReturnType<typeof vi.fn>;
        type: string;
        frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
    };
    let mockGain: {
        connect: ReturnType<typeof vi.fn>;
        gain: {
            setValueAtTime: ReturnType<typeof vi.fn>;
            linearRampToValueAtTime: ReturnType<typeof vi.fn>;
        };
    };
    let mockDestination: object;
    let mockAudioContext: {
        currentTime: number;
        destination: object;
        createOscillator: ReturnType<typeof vi.fn>;
        createGain: ReturnType<typeof vi.fn>;
    };
    let AudioContextMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockOscillator = {
            connect: vi.fn(),
            type: 'sine',
            frequency: { setValueAtTime: vi.fn() },
            start: vi.fn(),
            stop: vi.fn(),
        };
        mockGain = {
            connect: vi.fn(),
            gain: {
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
            },
        };
        mockDestination = {};
        mockAudioContext = {
            currentTime: 0,
            destination: mockDestination,
            createOscillator: vi.fn(() => mockOscillator),
            createGain: vi.fn(() => mockGain),
        };
        AudioContextMock = vi.fn(() => mockAudioContext);
        vi.stubGlobal('AudioContext', AudioContextMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports audioAvailable as true when AudioContext is present', () => {
        const service = createFeedbackService();
        expect(service.audioAvailable).toBe(true);
    });

    it('reports audioAvailable as false when AudioContext is absent', () => {
        vi.unstubAllGlobals();
        vi.stubGlobal('AudioContext', undefined);
        const service = createFeedbackService();
        expect(service.audioAvailable).toBe(false);
    });

    it('creates AudioContext lazily on first playConfirmationBeep()', () => {
        const service = createFeedbackService();
        expect(AudioContextMock).not.toHaveBeenCalled();
        service.playConfirmationBeep();
        expect(AudioContextMock).toHaveBeenCalledTimes(1);
    });

    it('reuses the same AudioContext across multiple calls', () => {
        const service = createFeedbackService();
        service.playConfirmationBeep();
        service.playProximityAlert();
        expect(AudioContextMock).toHaveBeenCalledTimes(1);
    });

    it('playConfirmationBeep() creates an oscillator and gain node', () => {
        const service = createFeedbackService();
        service.playConfirmationBeep();
        expect(mockAudioContext.createOscillator).toHaveBeenCalled();
        expect(mockAudioContext.createGain).toHaveBeenCalled();
    });

    it('playConfirmationBeep() starts and stops the oscillator', () => {
        const service = createFeedbackService();
        service.playConfirmationBeep();
        expect(mockOscillator.start).toHaveBeenCalled();
        expect(mockOscillator.stop).toHaveBeenCalled();
    });

    it('playProximityAlert() creates an oscillator and gain node', () => {
        const service = createFeedbackService();
        service.playProximityAlert();
        expect(mockAudioContext.createOscillator).toHaveBeenCalled();
        expect(mockAudioContext.createGain).toHaveBeenCalled();
    });

    it('playProximityAlert() starts and stops the oscillator', () => {
        const service = createFeedbackService();
        service.playProximityAlert();
        expect(mockOscillator.start).toHaveBeenCalled();
        expect(mockOscillator.stop).toHaveBeenCalled();
    });

    it('does not throw when AudioContext is unavailable', () => {
        vi.unstubAllGlobals();
        vi.stubGlobal('AudioContext', undefined);
        const service = createFeedbackService();
        expect(() => service.playConfirmationBeep()).not.toThrow();
        expect(() => service.playProximityAlert()).not.toThrow();
    });
});

describe('FeedbackService – speech unavailable', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('reports speechAvailable as false when speechSynthesis is absent', () => {
        // Remove speechSynthesis from the environment
        vi.stubGlobal('speechSynthesis', undefined);
        vi.stubGlobal('SpeechSynthesisUtterance', undefined);
        const service = createFeedbackService();
        expect(service.speechAvailable).toBe(false);
    });

    it('does not throw when speak() is called without speech support (after debounce)', () => {
        vi.stubGlobal('speechSynthesis', undefined);
        vi.stubGlobal('SpeechSynthesisUtterance', undefined);
        const service = createFeedbackService();
        expect(() => {
            service.speak('turn left');
            vi.runAllTimers();
        }).not.toThrow();
    });
});

describe('FeedbackService – haptic feedback', () => {
    let vibrateMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vibrateMock = vi.fn();
        // Stub navigator.vibrate to simulate Vibration API
        Object.defineProperty(navigator, 'vibrate', {
            value: vibrateMock,
            configurable: true,
            writable: true,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        // Remove the vibrate stub
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (navigator as any).vibrate;
    });

    it('reports vibrationAvailable as true when navigator.vibrate is present', () => {
        const service = createFeedbackService();
        expect(service.vibrationAvailable).toBe(true);
    });

    it('reports vibrationAvailable as false when navigator.vibrate is absent', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (navigator as any).vibrate;
        const service = createFeedbackService();
        expect(service.vibrationAvailable).toBe(false);
    });

    it('vibrateAlignment() calls navigator.vibrate with short pulse when aligned (0°)', () => {
        const service = createFeedbackService();
        service.vibrateAlignment(0);
        expect(vibrateMock).toHaveBeenCalledWith(50);
    });

    it('vibrateAlignment() calls navigator.vibrate when within ±30° (boundary)', () => {
        const service = createFeedbackService();
        service.vibrateAlignment(30);
        expect(vibrateMock).toHaveBeenCalledTimes(1);
        vibrateMock.mockClear();
        service.vibrateAlignment(-30);
        expect(vibrateMock).toHaveBeenCalledTimes(1);
    });

    it('vibrateAlignment() does NOT vibrate when turning right (+31°)', () => {
        const service = createFeedbackService();
        service.vibrateAlignment(31);
        expect(vibrateMock).not.toHaveBeenCalled();
    });

    it('vibrateAlignment() does NOT vibrate when turning left (-31°)', () => {
        const service = createFeedbackService();
        service.vibrateAlignment(-31);
        expect(vibrateMock).not.toHaveBeenCalled();
    });

    it('vibrateAlignment() does NOT vibrate when going wrong way (180°)', () => {
        const service = createFeedbackService();
        service.vibrateAlignment(180);
        expect(vibrateMock).not.toHaveBeenCalled();
    });

    it('vibrateProximity() produces rapid double pulse at ≤5m', () => {
        const service = createFeedbackService();
        service.vibrateProximity(5);
        expect(vibrateMock).toHaveBeenCalledWith([80, 40, 80]);
    });

    it('vibrateProximity() produces rapid double pulse at <5m', () => {
        const service = createFeedbackService();
        service.vibrateProximity(2);
        expect(vibrateMock).toHaveBeenCalledWith([80, 40, 80]);
    });

    it('vibrateProximity() produces medium pulse at ≤20m', () => {
        const service = createFeedbackService();
        service.vibrateProximity(20);
        expect(vibrateMock).toHaveBeenCalledWith([60, 0]);
    });

    it('vibrateProximity() produces medium pulse at 15m', () => {
        const service = createFeedbackService();
        service.vibrateProximity(15);
        expect(vibrateMock).toHaveBeenCalledWith([60, 0]);
    });

    it('vibrateProximity() produces short pulse at ≤50m', () => {
        const service = createFeedbackService();
        service.vibrateProximity(50);
        expect(vibrateMock).toHaveBeenCalledWith(30);
    });

    it('vibrateProximity() produces short pulse at 30m', () => {
        const service = createFeedbackService();
        service.vibrateProximity(30);
        expect(vibrateMock).toHaveBeenCalledWith(30);
    });

    it('vibrateProximity() does NOT vibrate beyond 50m', () => {
        const service = createFeedbackService();
        service.vibrateProximity(51);
        expect(vibrateMock).not.toHaveBeenCalled();
    });

    it('vibrateProximity() does NOT vibrate at 100m', () => {
        const service = createFeedbackService();
        service.vibrateProximity(100);
        expect(vibrateMock).not.toHaveBeenCalled();
    });

    it('vibrateAlignment() does not throw when Vibration API is absent', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (navigator as any).vibrate;
        const service = createFeedbackService();
        expect(() => service.vibrateAlignment(0)).not.toThrow();
    });

    it('vibrateProximity() does not throw when Vibration API is absent', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (navigator as any).vibrate;
        const service = createFeedbackService();
        expect(() => service.vibrateProximity(5)).not.toThrow();
    });
});

describe('FeedbackService – silent mode', () => {
    let speakMock: ReturnType<typeof vi.fn>;
    let localStorageMock: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.useFakeTimers();
        speakMock = vi.fn();
        vi.stubGlobal('speechSynthesis', { speak: speakMock });
        vi.stubGlobal('SpeechSynthesisUtterance', function (text: string) {
            return { text };
        });
        localStorageMock = { getItem: vi.fn(() => null), setItem: vi.fn() };
        vi.stubGlobal('localStorage', localStorageMock);
    });

    afterEach(() => {
        vi.runAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('silentMode defaults to false when localStorage has no value', () => {
        localStorageMock.getItem.mockReturnValue(null);
        const service = createFeedbackService();
        expect(service.silentMode).toBe(false);
    });

    it('silentMode defaults to true when localStorage has "true"', () => {
        localStorageMock.getItem.mockReturnValue('true');
        const service = createFeedbackService();
        expect(service.silentMode).toBe(true);
    });

    it('silentMode defaults to false when localStorage has "false"', () => {
        localStorageMock.getItem.mockReturnValue('false');
        const service = createFeedbackService();
        expect(service.silentMode).toBe(false);
    });

    it('setting silentMode to true suppresses speech (checked after debounce)', () => {
        const service = createFeedbackService();
        service.silentMode = true;
        service.speak('turn left');
        vi.runAllTimers();
        expect(speakMock).not.toHaveBeenCalled();
    });

    it('setting silentMode to true suppresses announce()', () => {
        const service = createFeedbackService();
        service.silentMode = true;
        service.announce('50 metres');
        expect(speakMock).not.toHaveBeenCalled();
    });

    it('setting silentMode to true suppresses announceDistance()', () => {
        const service = createFeedbackService();
        service.silentMode = true;
        service.announceDistance(50);
        expect(speakMock).not.toHaveBeenCalled();
    });

    it('toggling silentMode back to false re-enables speech (after debounce)', () => {
        const service = createFeedbackService();
        service.silentMode = true;
        service.silentMode = false;
        service.speak('straight ahead');
        vi.runAllTimers();
        expect(speakMock).toHaveBeenCalledTimes(1);
    });

    it('persists silentMode=true to localStorage', () => {
        const service = createFeedbackService();
        service.silentMode = true;
        expect(localStorageMock.setItem).toHaveBeenCalledWith('breadcrumbs:silentMode', 'true');
    });

    it('persists silentMode=false to localStorage', () => {
        const service = createFeedbackService();
        service.silentMode = false;
        expect(localStorageMock.setItem).toHaveBeenCalledWith('breadcrumbs:silentMode', 'false');
    });
});

describe('FeedbackService – vibration audio fallback (iOS/unsupported)', () => {
    let mockOscillator: {
        connect: ReturnType<typeof vi.fn>;
        type: string;
        frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
    };
    let mockGain: {
        connect: ReturnType<typeof vi.fn>;
        gain: {
            setValueAtTime: ReturnType<typeof vi.fn>;
            linearRampToValueAtTime: ReturnType<typeof vi.fn>;
        };
    };
    let mockAudioContext: {
        currentTime: number;
        destination: object;
        createOscillator: ReturnType<typeof vi.fn>;
        createGain: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        // Remove Vibration API to simulate iOS
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (navigator as any).vibrate;

        // Set up AudioContext mock for audio fallback
        mockOscillator = {
            connect: vi.fn(),
            type: 'sine',
            frequency: { setValueAtTime: vi.fn() },
            start: vi.fn(),
            stop: vi.fn(),
        };
        mockGain = {
            connect: vi.fn(),
            gain: {
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
            },
        };
        mockAudioContext = {
            currentTime: 0,
            destination: {},
            createOscillator: vi.fn(() => mockOscillator),
            createGain: vi.fn(() => mockGain),
        };
        vi.stubGlobal(
            'AudioContext',
            vi.fn(() => mockAudioContext)
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (navigator as any).vibrate;
    });

    it('vibrateAlignment() plays audio tone when aligned and vibration unavailable', () => {
        const service = createFeedbackService();
        expect(service.vibrationAvailable).toBe(false);
        service.vibrateAlignment(0);
        // Audio fallback: oscillator should be created and started
        expect(mockAudioContext.createOscillator).toHaveBeenCalled();
        expect(mockOscillator.start).toHaveBeenCalled();
    });

    it('vibrateAlignment() plays no audio when not aligned and vibration unavailable', () => {
        const service = createFeedbackService();
        service.vibrateAlignment(90); // turning right — no feedback
        expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });

    it('vibrateProximity() plays audio tone at ≤20m when vibration unavailable', () => {
        const service = createFeedbackService();
        service.vibrateProximity(20);
        expect(mockAudioContext.createOscillator).toHaveBeenCalled();
        expect(mockOscillator.start).toHaveBeenCalled();
    });

    it('vibrateProximity() plays audio tone at ≤5m when vibration unavailable', () => {
        const service = createFeedbackService();
        service.vibrateProximity(5);
        expect(mockAudioContext.createOscillator).toHaveBeenCalled();
        expect(mockOscillator.start).toHaveBeenCalled();
    });

    it('vibrateProximity() plays no audio beyond 20m when vibration unavailable', () => {
        const service = createFeedbackService();
        service.vibrateProximity(50);
        expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });

    it('vibrateProximity() plays no audio at 100m when vibration unavailable', () => {
        const service = createFeedbackService();
        service.vibrateProximity(100);
        expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });
});

describe('FeedbackService – direction debounce', () => {
    let speakMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        speakMock = vi.fn();
        vi.stubGlobal('speechSynthesis', { speak: speakMock });
        vi.stubGlobal('SpeechSynthesisUtterance', function (text: string) {
            return { text };
        });
    });

    afterEach(() => {
        vi.runAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('does not speak immediately on speak() — waits for debounce', () => {
        const service = createFeedbackService();
        service.speak('turn left');
        expect(speakMock).not.toHaveBeenCalled();
    });

    it('speaks once after debounce period elapses', () => {
        const service = createFeedbackService();
        service.speak('turn left');
        vi.runAllTimers();
        expect(speakMock).toHaveBeenCalledTimes(1);
    });

    it('coalesces rapid direction changes — only last direction fires', () => {
        const service = createFeedbackService();
        service.speak('turn left');
        service.speak('straight ahead');
        service.speak('turn right');
        vi.runAllTimers();
        expect(speakMock).toHaveBeenCalledTimes(1);
        const utterance = speakMock.mock.calls[0][0] as { text: string };
        expect(utterance.text).toBe('turn right');
    });

    it('allows a second direction announcement after debounce resets', () => {
        const service = createFeedbackService();
        service.speak('turn left');
        vi.runAllTimers();
        // Advance past the MIN_SPEECH_INTERVAL_MS throttle (5 seconds)
        vi.advanceTimersByTime(6_000);
        service.speak('straight ahead');
        vi.runAllTimers();
        expect(speakMock).toHaveBeenCalledTimes(2);
    });
});

describe('FeedbackService – direction throttle', () => {
    let speakMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        speakMock = vi.fn();
        vi.stubGlobal('speechSynthesis', { speak: speakMock });
        vi.stubGlobal('SpeechSynthesisUtterance', function (text: string) {
            return { text };
        });
    });

    afterEach(() => {
        vi.runAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('throttles: second speak() call within 5s is suppressed', () => {
        const service = createFeedbackService();
        service.speak('turn left');
        vi.runAllTimers(); // fires debounce; first direction spoken
        expect(speakMock).toHaveBeenCalledTimes(1);

        // Wait 2 seconds (still within 5s throttle window)
        vi.advanceTimersByTime(2_000);
        service.speak('turn right');
        vi.runAllTimers(); // fires debounce but throttle blocks it
        expect(speakMock).toHaveBeenCalledTimes(1); // no additional call
    });

    it('throttle resets after 5s — next speak() fires', () => {
        const service = createFeedbackService();
        service.speak('turn left');
        vi.runAllTimers();
        expect(speakMock).toHaveBeenCalledTimes(1);

        // Advance past throttle window
        vi.advanceTimersByTime(5_001);
        service.speak('turn right');
        vi.runAllTimers();
        expect(speakMock).toHaveBeenCalledTimes(2);
    });

    it('lastSpeechTime is 0 before any direction announcement', () => {
        const service = createFeedbackService();
        expect(service.lastSpeechTime).toBe(0);
    });

    it('lastSpeechTime is updated after a direction is spoken', () => {
        const service = createFeedbackService();
        const before = Date.now();
        service.speak('turn left');
        vi.runAllTimers();
        expect(service.lastSpeechTime).toBeGreaterThanOrEqual(before);
        expect(service.lastSpeechTime).toBeLessThanOrEqual(Date.now());
    });

    it('announce() is NOT throttled by direction throttle', () => {
        const service = createFeedbackService();
        // Fire the first direction to set lastSpeechTime
        service.speak('turn left');
        vi.runAllTimers();
        expect(speakMock).toHaveBeenCalledTimes(1);

        // announce() is independent and should still fire within throttle window
        service.announce('50 metres');
        expect(speakMock).toHaveBeenCalledTimes(2);
    });
});
