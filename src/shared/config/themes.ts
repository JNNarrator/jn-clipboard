import { isMacPlatform } from "../lib/platform";

export interface ThemeDefinition {
  id: string;
  labelKey: string;
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
    labelKey: "theme_name_mica",
    supportsCustomBackground: true,
    supportsSurfaceOpacity: true
  },
  {
    id: "macos",
    labelKey: "theme_name_macos",
    supportsCustomBackground: true,
    supportsSurfaceOpacity: true
  },
  {
    id: "acrylic",
    labelKey: "theme_name_acrylic",
    supportsCustomBackground: true,
    supportsSurfaceOpacity: true
  },
  {
    id: "retro",
    labelKey: "theme_name_retro"
  },
  {
    id: "sticky-note",
    labelKey: "theme_name_sticky_note"
  },
  {
    id: "paper",
    labelKey: "theme_name_paper"
  },
  {
    id: "sakura",
    labelKey: "theme_name_sakura",
    supportsCustomBackground: true,
    supportsSurfaceOpacity: true
  },
  {
    id: "terminal",
    labelKey: "theme_name_terminal"
  },
  {
    id: "receipt",
    labelKey: "theme_name_receipt"
  },
  {
    id: "ink",
    labelKey: "theme_name_ink"
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

export const getThemeLabel = (themeId: string, t: (key: string) => string): string =>
  t(getThemeDefinition(themeId).labelKey);

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
