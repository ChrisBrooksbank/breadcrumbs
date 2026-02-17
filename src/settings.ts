/**
 * Settings module — font size and theme persistence.
 *
 * Uses localStorage with `breadcrumbs:` key prefix and try-catch
 * for resilience (same pattern as feedback.ts).
 */

export const FONT_SIZES = [14, 16, 18, 20, 22] as const;
type FontSize = (typeof FONT_SIZES)[number];
export type ThemeMode = 'light' | 'dark' | 'system';

const FONT_SIZE_KEY = 'breadcrumbs:fontSize';
const THEME_MODE_KEY = 'breadcrumbs:themeMode';

const DEFAULT_FONT_SIZE: FontSize = 16;
const DEFAULT_THEME_MODE: ThemeMode = 'system';

const LIGHT_THEME_COLOR = '#1d4ed8';
const DARK_THEME_COLOR = '#1e3a5f';

let currentFontSize: FontSize = DEFAULT_FONT_SIZE;
let currentThemeMode: ThemeMode = DEFAULT_THEME_MODE;
let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function readStorage<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function writeStorage<T>(key: string, value: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage full or unavailable — silently ignore
    }
}

function isValidFontSize(value: unknown): value is FontSize {
    return typeof value === 'number' && (FONT_SIZES as readonly number[]).includes(value);
}

function isValidThemeMode(value: unknown): value is ThemeMode {
    return value === 'light' || value === 'dark' || value === 'system';
}

function applyFontSize(size: FontSize): void {
    document.documentElement.style.fontSize = `${size}px`;
}

function resolveEffectiveTheme(mode: ThemeMode): 'light' | 'dark' {
    if (mode === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
}

function applyTheme(mode: ThemeMode): void {
    const effective = resolveEffectiveTheme(mode);
    document.documentElement.dataset.theme = effective;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) {
        meta.content = effective === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
    }
}

export function getFontSize(): FontSize {
    return currentFontSize;
}

export function setFontSize(size: FontSize): void {
    if (!isValidFontSize(size)) return;
    currentFontSize = size;
    writeStorage(FONT_SIZE_KEY, size);
    applyFontSize(size);
}

export function increaseFontSize(): FontSize {
    const idx = FONT_SIZES.indexOf(currentFontSize);
    if (idx < FONT_SIZES.length - 1) {
        setFontSize(FONT_SIZES[idx + 1]);
    }
    return currentFontSize;
}

export function decreaseFontSize(): FontSize {
    const idx = FONT_SIZES.indexOf(currentFontSize);
    if (idx > 0) {
        setFontSize(FONT_SIZES[idx - 1]);
    }
    return currentFontSize;
}

export function getThemeMode(): ThemeMode {
    return currentThemeMode;
}

export function setThemeMode(mode: ThemeMode): void {
    if (!isValidThemeMode(mode)) return;
    currentThemeMode = mode;
    writeStorage(THEME_MODE_KEY, mode);
    applyTheme(mode);
}

export function initSettings(): void {
    const storedSize = readStorage<unknown>(FONT_SIZE_KEY, DEFAULT_FONT_SIZE);
    currentFontSize = isValidFontSize(storedSize) ? storedSize : DEFAULT_FONT_SIZE;
    applyFontSize(currentFontSize);

    const storedTheme = readStorage<unknown>(THEME_MODE_KEY, DEFAULT_THEME_MODE);
    currentThemeMode = isValidThemeMode(storedTheme) ? storedTheme : DEFAULT_THEME_MODE;
    applyTheme(currentThemeMode);

    // Clean up any previous listener
    if (mediaQuery && mediaListener) {
        mediaQuery.removeEventListener('change', mediaListener);
    }

    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaListener = () => {
        if (currentThemeMode === 'system') {
            applyTheme('system');
        }
    };
    mediaQuery.addEventListener('change', mediaListener);
}
