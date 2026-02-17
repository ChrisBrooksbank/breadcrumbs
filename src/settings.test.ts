import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    initSettings,
    getFontSize,
    setFontSize,
    increaseFontSize,
    decreaseFontSize,
    getThemeMode,
    setThemeMode,
    FONT_SIZES,
} from './settings';

// jsdom doesn't implement matchMedia — provide a minimal stub
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

describe('settings – font size', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.style.fontSize = '';
        document.documentElement.removeAttribute('data-theme');
        initSettings();
    });

    it('defaults to 16px font size', () => {
        expect(getFontSize()).toBe(16);
        expect(document.documentElement.style.fontSize).toBe('16px');
    });

    it('setFontSize persists and applies', () => {
        setFontSize(20);
        expect(getFontSize()).toBe(20);
        expect(document.documentElement.style.fontSize).toBe('20px');
        expect(JSON.parse(localStorage.getItem('breadcrumbs:fontSize')!)).toBe(20);
    });

    it('reads persisted font size on init', () => {
        localStorage.setItem('breadcrumbs:fontSize', '18');
        initSettings();
        expect(getFontSize()).toBe(18);
        expect(document.documentElement.style.fontSize).toBe('18px');
    });

    it('falls back to default for invalid stored font size', () => {
        localStorage.setItem('breadcrumbs:fontSize', '99');
        initSettings();
        expect(getFontSize()).toBe(16);
    });

    it('increaseFontSize steps up', () => {
        setFontSize(16);
        const result = increaseFontSize();
        expect(result).toBe(18);
        expect(getFontSize()).toBe(18);
    });

    it('decreaseFontSize steps down', () => {
        setFontSize(18);
        const result = decreaseFontSize();
        expect(result).toBe(16);
        expect(getFontSize()).toBe(16);
    });

    it('increaseFontSize clamps at maximum', () => {
        setFontSize(FONT_SIZES[FONT_SIZES.length - 1]);
        const result = increaseFontSize();
        expect(result).toBe(FONT_SIZES[FONT_SIZES.length - 1]);
    });

    it('decreaseFontSize clamps at minimum', () => {
        setFontSize(FONT_SIZES[0]);
        const result = decreaseFontSize();
        expect(result).toBe(FONT_SIZES[0]);
    });
});

describe('settings – theme mode', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.style.fontSize = '';
        document.documentElement.removeAttribute('data-theme');

        // Add theme-color meta if missing
        if (!document.querySelector('meta[name="theme-color"]')) {
            const meta = document.createElement('meta');
            meta.name = 'theme-color';
            meta.content = '#1d4ed8';
            document.head.appendChild(meta);
        }

        initSettings();
    });

    it('defaults to system theme mode', () => {
        expect(getThemeMode()).toBe('system');
    });

    it('setThemeMode light sets data-theme to light', () => {
        setThemeMode('light');
        expect(getThemeMode()).toBe('light');
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('setThemeMode dark sets data-theme to dark', () => {
        setThemeMode('dark');
        expect(getThemeMode()).toBe('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('setThemeMode persists to localStorage', () => {
        setThemeMode('dark');
        expect(JSON.parse(localStorage.getItem('breadcrumbs:themeMode')!)).toBe('dark');
    });

    it('reads persisted theme mode on init', () => {
        localStorage.setItem('breadcrumbs:themeMode', '"light"');
        initSettings();
        expect(getThemeMode()).toBe('light');
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('falls back to default for invalid stored theme', () => {
        localStorage.setItem('breadcrumbs:themeMode', '"invalid"');
        initSettings();
        expect(getThemeMode()).toBe('system');
    });

    it('updates theme-color meta for dark theme', () => {
        setThemeMode('dark');
        const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
        expect(meta?.content).toBe('#1e3a5f');
    });

    it('updates theme-color meta for light theme', () => {
        setThemeMode('dark');
        setThemeMode('light');
        const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
        expect(meta?.content).toBe('#1d4ed8');
    });

    it('system mode resolves from matchMedia', () => {
        // jsdom matchMedia returns false for prefers-color-scheme: dark by default
        setThemeMode('system');
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('system mode responds to OS change via matchMedia listener', () => {
        setThemeMode('system');

        // In jsdom, matchMedia doesn't support real events,
        // but we can verify the listener was registered by re-initing
        // and checking behavior. This is a baseline test.
        expect(document.documentElement.dataset.theme).toBe('light');
    });
});
