/**
 * WorkSphere — Centralized Company Theme Customization System Types
 * Defines the contract for company-wide light and dark mode color palettes,
 * semantic tokens, and accessibility feedback.
 */

import { Types } from 'mongoose';

export interface ICompanyThemePalette {
    // ── Sidebar Navigation ──
    sidebarBackground: string;
    sidebarText: string;
    sidebarMutedText: string;
    sidebarIcon: string;
    sidebarHoverBackground: string;
    sidebarHoverForeground: string;
    sidebarActiveBackground: string;
    sidebarActiveForeground: string;
    sidebarBorder: string;

    // ── Main Layout & Surfaces ──
    appBackground: string;
    cardBackground: string;
    cardForeground: string;

    // ── Brand & Buttons ──
    brandPrimary: string;
    brandOnPrimary: string;
    buttonPrimaryBackground: string;
    buttonPrimaryForeground: string;
    buttonSecondaryBackground: string;
    buttonSecondaryForeground: string;

    // ── Inputs & Form Controls ──
    inputBackground: string;
    inputForeground: string;
    inputBorder: string;
    focusRing: string;

    // ── Typography & Dividers ──
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    borderColor: string;
    dividerColor: string;
    linkColor: string;

    // ── Status Accents ──
    successColor: string;
    warningColor: string;
    errorColor: string;
    infoColor: string;
}

export type PaletteKey = keyof ICompanyThemePalette;

export interface ICompanyThemeConfig {
    version: number;
    light: ICompanyThemePalette;
    dark: ICompanyThemePalette;
    updatedAt?: Date;
    updatedBy?: Types.ObjectId | string | null;
    customThemeConfigured?: boolean;
    entitlement?: {
        isEntitled: boolean;
        isReadOnly: boolean;
        reasonCode: string;
        message: string;
        billingCycle?: string | null;
        planName?: string | null;
        status?: string | null;
    };
}

export type ThemeMode = 'light' | 'dark';

export interface UpdateThemeDto {
    light?: Partial<ICompanyThemePalette> | Record<string, string>;
    dark?: Partial<ICompanyThemePalette> | Record<string, string>;
    theme?: {
        light?: Partial<ICompanyThemePalette> | Record<string, string>;
        dark?: Partial<ICompanyThemePalette> | Record<string, string>;
    };
}

export interface IContrastCheckResult {
    id: string;
    label: string;
    foregroundKey: PaletteKey;
    backgroundKey: PaletteKey;
    foreground: string;
    background: string;
    ratio: number;
    requiredRatio: number;
    passes: boolean;
    level: 'AAA' | 'AA' | 'Fail';
    mode: ThemeMode;
    suggestedForeground?: string;
    description: string;
}

/**
 * Standard WorkSphere Light Mode Palette
 */
export const DEFAULT_LIGHT_PALETTE: ICompanyThemePalette = {
    // Sidebar
    sidebarBackground: '#1B4F8A',
    sidebarText: '#FFFFFF',
    sidebarMutedText: 'rgba(255, 255, 255, 0.65)',
    sidebarIcon: 'rgba(255, 255, 255, 0.70)',
    sidebarHoverBackground: 'rgba(255, 255, 255, 0.10)',
    sidebarHoverForeground: '#FFFFFF',
    sidebarActiveBackground: 'rgba(255, 255, 255, 0.18)',
    sidebarActiveForeground: '#FFFFFF',
    sidebarBorder: 'rgba(255, 255, 255, 0.12)',

    // Main App
    appBackground: '#F8FAFC',
    cardBackground: '#FFFFFF',
    cardForeground: '#0F172A',

    // Brand & Buttons
    brandPrimary: '#2563EB',
    brandOnPrimary: '#FFFFFF',
    buttonPrimaryBackground: '#2563EB',
    buttonPrimaryForeground: '#FFFFFF',
    buttonSecondaryBackground: '#F1F5F9',
    buttonSecondaryForeground: '#0F172A',

    // Inputs
    inputBackground: '#FFFFFF',
    inputForeground: '#0F172A',
    inputBorder: '#CBD5E1',
    focusRing: '#3B82F6',

    // Typography & Dividers
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#64748B',
    borderColor: '#E2E8F0',
    dividerColor: '#F1F5F9',
    linkColor: '#2563EB',

    // Status
    successColor: '#16A34A',
    warningColor: '#D97706',
    errorColor: '#DC2626',
    infoColor: '#0284C7',
};

/**
 * Standard WorkSphere Dark Mode Palette
 */
export const DEFAULT_DARK_PALETTE: ICompanyThemePalette = {
    // Sidebar
    sidebarBackground: '#0A1B30',
    sidebarText: '#F8FAFC',
    sidebarMutedText: 'rgba(248, 250, 252, 0.60)',
    sidebarIcon: 'rgba(248, 250, 252, 0.65)',
    sidebarHoverBackground: 'rgba(255, 255, 255, 0.08)',
    sidebarHoverForeground: '#FFFFFF',
    sidebarActiveBackground: 'rgba(59, 130, 246, 0.25)',
    sidebarActiveForeground: '#93C5FD',
    sidebarBorder: 'rgba(255, 255, 255, 0.08)',

    // Main App
    appBackground: '#020617',
    cardBackground: '#0F172A',
    cardForeground: '#F8FAFC',

    // Brand & Buttons
    brandPrimary: '#3B82F6',
    brandOnPrimary: '#FFFFFF',
    buttonPrimaryBackground: '#3B82F6',
    buttonPrimaryForeground: '#FFFFFF',
    buttonSecondaryBackground: '#1E293B',
    buttonSecondaryForeground: '#F8FAFC',

    // Inputs
    inputBackground: '#0F172A',
    inputForeground: '#F8FAFC',
    inputBorder: 'rgba(255, 255, 255, 0.12)',
    focusRing: '#60A5FA',

    // Typography & Dividers
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    dividerColor: 'rgba(255, 255, 255, 0.05)',
    linkColor: '#60A5FA',

    // Status
    successColor: '#22C55E',
    warningColor: '#F59E0B',
    errorColor: '#EF4444',
    infoColor: '#38BDF8',
};

export const DEFAULT_COMPANY_THEME: ICompanyThemeConfig = {
    version: 1,
    light: DEFAULT_LIGHT_PALETTE,
    dark: DEFAULT_DARK_PALETTE,
};

export const ALL_PALETTE_KEYS: readonly PaletteKey[] = [
    'sidebarBackground',
    'sidebarText',
    'sidebarMutedText',
    'sidebarIcon',
    'sidebarHoverBackground',
    'sidebarHoverForeground',
    'sidebarActiveBackground',
    'sidebarActiveForeground',
    'sidebarBorder',
    'appBackground',
    'cardBackground',
    'cardForeground',
    'brandPrimary',
    'brandOnPrimary',
    'buttonPrimaryBackground',
    'buttonPrimaryForeground',
    'buttonSecondaryBackground',
    'buttonSecondaryForeground',
    'inputBackground',
    'inputForeground',
    'inputBorder',
    'focusRing',
    'textPrimary',
    'textSecondary',
    'textMuted',
    'borderColor',
    'dividerColor',
    'linkColor',
    'successColor',
    'warningColor',
    'errorColor',
    'infoColor',
] as const;

export const PALETTE_KEY_SET = new Set<string>(ALL_PALETTE_KEYS);

/**
 * Maps kebab-case token names (e.g. "sidebar-background") to camelCase (e.g. "sidebarBackground").
 */
export const KEBAB_TO_CAMEL_MAP: Record<string, PaletteKey> = {
    'sidebar-background': 'sidebarBackground',
    'sidebar-text': 'sidebarText',
    'sidebar-muted-text': 'sidebarMutedText',
    'sidebar-icon': 'sidebarIcon',
    'sidebar-hover-background': 'sidebarHoverBackground',
    'sidebar-hover-foreground': 'sidebarHoverForeground',
    'sidebar-active-background': 'sidebarActiveBackground',
    'sidebar-active-foreground': 'sidebarActiveForeground',
    'sidebar-border': 'sidebarBorder',
    'app-background': 'appBackground',
    'card-background': 'cardBackground',
    'card-foreground': 'cardForeground',
    'brand-primary': 'brandPrimary',
    'brand-on-primary': 'brandOnPrimary',
    'button-primary-background': 'buttonPrimaryBackground',
    'button-primary-foreground': 'buttonPrimaryForeground',
    'button-secondary-background': 'buttonSecondaryBackground',
    'button-secondary-foreground': 'buttonSecondaryForeground',
    'input-background': 'inputBackground',
    'input-foreground': 'inputForeground',
    'input-border': 'inputBorder',
    'focus-ring': 'focusRing',
    'text-primary': 'textPrimary',
    'text-secondary': 'textSecondary',
    'text-muted': 'textMuted',
    'border-color': 'borderColor',
    'divider-color': 'dividerColor',
    'link-color': 'linkColor',
    'success-color': 'successColor',
    'warning-color': 'warningColor',
    'error-color': 'errorColor',
    'info-color': 'infoColor',
};
