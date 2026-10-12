/**
 * WorkSphere — WCAG 2.1 Color Contrast & Relative Luminance Utility
 * Implements authoritative relative luminance and contrast ratio calculations
 * compliant with WCAG 2.1 AA (4.5:1 for normal text, 3:1 for large text / UI boundaries)
 * and AAA (7:1).
 */

import {
    ICompanyThemePalette,
    IContrastCheckResult,
    PaletteKey,
    ThemeMode,
} from './company-theme.types';

export interface RGB {
    r: number;
    g: number;
    b: number;
    a?: number;
}

/**
 * Parses HEX, RGB, or RGBA strings into numeric RGB values.
 * Returns opaque black if invalid or non-parsable.
 */
export function parseColorToRgb(color: string): RGB {
    if (!color) return { r: 0, g: 0, b: 0, a: 1 };
    const trimmed = color.trim().toLowerCase();

    // 1. Hex parsing (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)
    if (trimmed.startsWith('#')) {
        const hex = trimmed.substring(1);
        if (hex.length === 3) {
            return {
                r: parseInt(hex[0] + hex[0], 16),
                g: parseInt(hex[1] + hex[1], 16),
                b: parseInt(hex[2] + hex[2], 16),
                a: 1,
            };
        }
        if (hex.length === 4) {
            return {
                r: parseInt(hex[0] + hex[0], 16),
                g: parseInt(hex[1] + hex[1], 16),
                b: parseInt(hex[2] + hex[2], 16),
                a: parseInt(hex[3] + hex[3], 16) / 255,
            };
        }
        if (hex.length === 6) {
            return {
                r: parseInt(hex.substring(0, 2), 16),
                g: parseInt(hex.substring(2, 4), 16),
                b: parseInt(hex.substring(4, 6), 16),
                a: 1,
            };
        }
        if (hex.length === 8) {
            return {
                r: parseInt(hex.substring(0, 2), 16),
                g: parseInt(hex.substring(2, 4), 16),
                b: parseInt(hex.substring(4, 6), 16),
                a: parseInt(hex.substring(6, 8), 16) / 255,
            };
        }
    }

    // 2. rgb/rgba parsing
    const rgbMatch = trimmed.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)$/);
    if (rgbMatch) {
        const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10)));
        const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10)));
        const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10)));
        const a = rgbMatch[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(rgbMatch[4]))) : 1;
        return { r, g, b, a };
    }

    // 3. Fallback for transparent or basic named values
    if (trimmed === 'white') return { r: 255, g: 255, b: 255, a: 1 };
    if (trimmed === 'black') return { r: 0, g: 0, b: 0, a: 1 };
    if (trimmed === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

    return { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Blends an RGBA color over an opaque background to determine actual perceived sRGB.
 */
export function blendWithBackground(fg: RGB, bg: RGB = { r: 255, g: 255, b: 255 }): RGB {
    const alpha = fg.a !== undefined ? fg.a : 1;
    if (alpha >= 1) return fg;
    return {
        r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
        g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
        b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
        a: 1,
    };
}

/**
 * Converts RGB components to a standard 6-character uppercase HEX string.
 */
export function rgbToHex(r: number, g: number, b: number): string {
    const clamp = (val: number) => Math.min(255, Math.max(0, Math.round(val)));
    const toHex = (c: number) => clamp(c).toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Calculates WCAG 2.1 relative luminance for an sRGB color.
 * L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 * Formula: c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4
 */
export function getRelativeLuminance(color: string, fallbackBg?: RGB): number {
    const rawRgb = parseColorToRgb(color);
    const rgb = blendWithBackground(rawRgb, fallbackBg);

    const sR = rgb.r / 255;
    const sG = rgb.g / 255;
    const sB = rgb.b / 255;

    const transform = (val: number) =>
        val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);

    const rLinear = transform(sR);
    const gLinear = transform(sG);
    const bLinear = transform(sB);

    return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Calculates contrast ratio between two colors according to WCAG:
 * (L1 + 0.05) / (L2 + 0.05), where L1 is the lighter luminance.
 * Returns ratio from 1 to 21 rounded to 2 decimal places.
 */
export function getContrastRatio(foreground: string, background: string): number {
    const bgRgb = parseColorToRgb(background);
    const bgOpaque = blendWithBackground(bgRgb, { r: 255, g: 255, b: 255 });

    const l1 = getRelativeLuminance(foreground, bgOpaque);
    const l2 = getRelativeLuminance(background);

    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);

    const ratio = (lighter + 0.05) / (darker + 0.05);
    return Math.round(ratio * 100) / 100;
}

/**
 * Checks if a color pairing satisfies WCAG criteria.
 */
export function checkWCAG(
    foreground: string,
    background: string,
    requiredRatio: number = 4.5
): {
    ratio: number;
    passes: boolean;
    level: 'AAA' | 'AA' | 'Fail';
} {
    const ratio = getContrastRatio(foreground, background);
    let level: 'AAA' | 'AA' | 'Fail' = 'Fail';
    if (ratio >= 7.0) level = 'AAA';
    else if (ratio >= requiredRatio) level = 'AA';

    return {
        ratio,
        passes: ratio >= requiredRatio,
        level,
    };
}

/**
 * Suggests a readable foreground color (#FFFFFF or #0F172A) that
 * satisfies the required contrast ratio against the given background.
 */
export function suggestReadableForeground(background: string, targetRatio: number = 4.5): string {
    const whiteRatio = getContrastRatio('#FFFFFF', background);
    const darkRatio = getContrastRatio('#0F172A', background);

    if (whiteRatio >= targetRatio && whiteRatio >= darkRatio) {
        return '#FFFFFF';
    }
    if (darkRatio >= targetRatio) {
        return '#0F172A';
    }

    return whiteRatio > darkRatio ? '#FFFFFF' : '#0F172A';
}

/**
 * Authoritative contrast pairing definition for WCAG validation.
 */
export interface ContrastPairConfig {
    id: string;
    label: string;
    fgKey: PaletteKey;
    bgKey: PaletteKey;
    minRatio: number;
    description: string;
}

export const REQUIRED_CONTRAST_PAIRS: readonly ContrastPairConfig[] = [
    {
        id: 'text-app-bg',
        label: 'Primary Text on Main Background',
        fgKey: 'textPrimary',
        bgKey: 'appBackground',
        minRatio: 4.5,
        description: 'Ensures main body headings and text meet standard text readability (WCAG AA 4.5:1).',
    },
    {
        id: 'text-card-bg',
        label: 'Primary Text on Card Surfaces',
        fgKey: 'textPrimary',
        bgKey: 'cardBackground',
        minRatio: 4.5,
        description: 'Ensures card content, modals, and container text meet normal text accessibility (WCAG AA 4.5:1).',
    },
    {
        id: 'text-sec-card-bg',
        label: 'Secondary Text on Card Surfaces',
        fgKey: 'textSecondary',
        bgKey: 'cardBackground',
        minRatio: 4.5,
        description: 'Ensures descriptions, captions, and table metadata are comfortably legible (WCAG AA 4.5:1).',
    },
    {
        id: 'sidebar-text-bg',
        label: 'Sidebar Navigation Item Text',
        fgKey: 'sidebarText',
        bgKey: 'sidebarBackground',
        minRatio: 4.5,
        description: 'Ensures navigation links and company title can be clearly read against the sidebar background.',
    },
    {
        id: 'sidebar-muted-bg',
        label: 'Sidebar Section Headers & Muted Text',
        fgKey: 'sidebarMutedText',
        bgKey: 'sidebarBackground',
        minRatio: 3.0,
        description: 'Ensures section headers meet large/muted text contrast (WCAG AA 3:1).',
    },
    {
        id: 'sidebar-active-item',
        label: 'Sidebar Active Nav Item',
        fgKey: 'sidebarActiveForeground',
        bgKey: 'sidebarActiveBackground',
        minRatio: 4.5,
        description: 'Ensures active/selected navigation link text is clearly distinguishable.',
    },
    {
        id: 'sidebar-hover-item',
        label: 'Sidebar Hover Nav Item',
        fgKey: 'sidebarHoverForeground',
        bgKey: 'sidebarHoverBackground',
        minRatio: 4.5,
        description: 'Ensures hover navigation state text remains accessible.',
    },
    {
        id: 'brand-on-primary',
        label: 'Brand On Primary',
        fgKey: 'brandOnPrimary',
        bgKey: 'brandPrimary',
        minRatio: 3.0,
        description: 'Ensures text or icons on primary brand elements meet UI control readability (WCAG 3:1).',
    },
    {
        id: 'button-primary',
        label: 'Primary Button Text',
        fgKey: 'buttonPrimaryForeground',
        bgKey: 'buttonPrimaryBackground',
        minRatio: 3.0,
        description: 'Ensures primary call-to-action button labels meet UI control accessibility (WCAG 3:1).',
    },
    {
        id: 'button-secondary',
        label: 'Secondary Button Text',
        fgKey: 'buttonSecondaryForeground',
        bgKey: 'buttonSecondaryBackground',
        minRatio: 4.5,
        description: 'Ensures secondary button labels contrast with button background.',
    },
    {
        id: 'input-text',
        label: 'Input Field Text',
        fgKey: 'inputForeground',
        bgKey: 'inputBackground',
        minRatio: 4.5,
        description: 'Ensures user input in textboxes and search inputs is legible.',
    },
    {
        id: 'input-border',
        label: 'Input Boundary Border',
        fgKey: 'inputBorder',
        bgKey: 'inputBackground',
        minRatio: 1.2,
        description: 'Ensures input boundaries meet base surface differentiation.',
    },
    {
        id: 'focus-ring',
        label: 'Focus Indicator Ring',
        fgKey: 'focusRing',
        bgKey: 'inputBackground',
        minRatio: 3.0,
        description: 'Ensures interactive focus indicator rings are perceivable against input surfaces (WCAG 1.4.11 3:1).',
    },
    {
        id: 'link-app-bg',
        label: 'Interactive Links on Page',
        fgKey: 'linkColor',
        bgKey: 'appBackground',
        minRatio: 4.5,
        description: 'Ensures hyperlinks stand out distinctly from the page background (WCAG AA 4.5:1).',
    },
];

/**
 * Validates all key contrast pairings of an entire company theme palette.
 * Returns actionable feedback items with ratio and correction recommendations.
 */
export function validateThemePaletteContrast(
    palette: ICompanyThemePalette,
    mode: ThemeMode
): IContrastCheckResult[] {
    return REQUIRED_CONTRAST_PAIRS.map((c) => {
        const fg = palette[c.fgKey];
        let bg = palette[c.bgKey];

        // Composite translucent overlay backgrounds over parent canvas
        if (c.bgKey === 'sidebarActiveBackground' || c.bgKey === 'sidebarHoverBackground') {
            const baseBgRgb = parseColorToRgb(palette.sidebarBackground);
            const overlayRgb = parseColorToRgb(bg);
            const blended = blendWithBackground(overlayRgb, baseBgRgb);
            bg = rgbToHex(blended.r, blended.g, blended.b);
        } else if (c.bgKey === 'inputBorder') {
            const baseBgRgb = parseColorToRgb(palette.inputBackground);
            const overlayRgb = parseColorToRgb(bg);
            const blended = blendWithBackground(overlayRgb, baseBgRgb);
            bg = rgbToHex(blended.r, blended.g, blended.b);
        }

        const { ratio, passes, level } = checkWCAG(fg, bg, c.minRatio);
        const suggested = !passes ? suggestReadableForeground(bg, c.minRatio) : undefined;

        return {
            id: c.id,
            label: c.label,
            foregroundKey: c.fgKey,
            backgroundKey: c.bgKey,
            foreground: fg,
            background: bg,
            ratio,
            requiredRatio: c.minRatio,
            passes,
            level,
            mode,
            suggestedForeground: suggested,
            description: c.description,
        };
    });
}
