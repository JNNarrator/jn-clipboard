import type { Locale } from "../types";
import { isMacPlatform } from "../lib/platform";

export interface ThemeDefinition {
  id: string;
  labels: Record<Locale, string>;
  supportsCustomBackground?: boolean;
  supportsSurfaceOpacity?: boolean;
}

export const WINDOWS_THEME_ID = "mica";
export const MACOS_THEME_ID = "macos";

export const getDefaultTheme = (): string =>
  isMacPlatform() ? MACOS_THEME_ID : WINDOWS_THEME_ID;

export const DEFAULT_THEME = getDefaultTheme();

export const isThemeSelectable = (themeId: string): boolean => {
  if (themeId === MACOS_THEME_ID) return isMacPlatform();
  if (themeId === WINDOWS_THEME_ID) return !isMacPlatform();
  return true;
};

export const getSelectableThemes = (): ThemeDefinition[] =>
  THEMES.filter((theme) => isThemeSelectable(theme.id));

export const THEMES: ThemeDefinition[] = [
  {
    id: "mica",
    labels: {
      zh: "Windows 系统",
      en: "Windows",
      tw: "Windows 系統"
    },
    supportsCustomBackground: true,
    supportsSurfaceOpacity: true
  },
  {
    id: "macos",
    labels: {
      zh: "macOS 系统",
      en: "macOS",
      tw: "macOS 系統"
    },
    supportsCustomBackground: true,
    supportsSurfaceOpacity: true
  },
  {
    id: "acrylic",
    labels: {
      zh: "毛玻璃",
      en: "Acrylic",
      tw: "毛玻璃"
    },
    supportsCustomBackground: true,
    supportsSurfaceOpacity: true
  },
  {
    id: "retro",
    labels: {
      zh: "3D复古",
      en: "Retro 3D",
      tw: "3D復古"
    }
  },
  {
    id: "sticky-note",
    labels: {
      zh: "便利贴",
      en: "Sticky Note",
      tw: "便利貼"
    }
  },
  {
    id: "paper",
    labels: {
      zh: "纸质书感",
      en: "Paper & Quill",
      tw: "紙質書感"
    }
  },
  {
    id: "sakura",
    labels: {
      zh: "樱花",
      en: "Sakura",
      tw: "櫻花"
    },
    supportsCustomBackground: true,
    supportsSurfaceOpacity: true
  },
  {
    id: "terminal",
    labels: {
      zh: "终端",
      en: "Terminal",
      tw: "終端"
    }
  },
  {
    id: "receipt",
    labels: {
      zh: "收据小票",
      en: "Receipt",
      tw: "收據小票"
    }
  },
  {
    id: "ink",
    labels: {
      zh: "水墨",
      en: "Ink Wash",
      tw: "水墨"
    }
  }
];

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export const THEME_CLASS_NAMES = THEMES.map((theme) => `theme-${theme.id}`);

export const getThemeDefinition = (themeId: string): ThemeDefinition =>
  THEME_BY_ID.get(themeId) ?? THEME_BY_ID.get(getDefaultTheme())!;

export const normalizeThemeId = (themeId: string): string => {
  if (/^store-[a-z0-9-]{3,50}$/.test(themeId)) return themeId;
  if (themeId === MACOS_THEME_ID && !isMacPlatform()) return WINDOWS_THEME_ID;
  if (themeId === WINDOWS_THEME_ID && isMacPlatform()) return MACOS_THEME_ID;
  return getThemeDefinition(themeId).id;
};

export const getThemeLabel = (themeId: string, locale: Locale): string =>
  getThemeDefinition(themeId).labels[locale];

export const supportsCustomBackground = (themeId: string): boolean =>
  Boolean(getThemeDefinition(themeId).supportsCustomBackground);

export const supportsSurfaceOpacity = (themeId: string): boolean =>
  Boolean(getThemeDefinition(themeId).supportsSurfaceOpacity);

export const clearThemeClasses = (...targets: Array<Element | null | undefined>) => {
  for (const target of targets) {
    if (!target) continue;
    target.classList.remove(...THEME_CLASS_NAMES);
    // Also remove store theme classes
    const toRemove = [...target.classList].filter((c) =>
      c.startsWith("theme-store-")
    );
    if (toRemove.length > 0) target.classList.remove(...toRemove);
  }
};

export const applyThemeClasses = (
  themeId: string,
  ...targets: Array<Element | null | undefined>
) => {
  const normalizedTheme = normalizeThemeId(themeId);
  clearThemeClasses(...targets);
  for (const target of targets) {
    if (!target) continue;
    target.classList.add(`theme-${normalizedTheme}`);
  }
};
