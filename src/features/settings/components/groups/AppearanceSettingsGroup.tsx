import { useEffect, useState, type ComponentType, type ReactNode, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, open, message } from "@tauri-apps/plugin-dialog";
import { withNativeDialog } from "../../../../shared/lib/focus";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import {
    getDefaultTheme,
    getSelectableThemes,
    getThemeLabel,
    normalizeThemeId,
    supportsCustomBackground,
    supportsSurfaceOpacity
} from "../../../../shared/config/themes";
import { isWindowsPlatform } from "../../../../shared/lib/platform";
import type { Locale } from "../../../../shared/types";
import {
    ensureInstalledThemeStyle,
    getInstalledThemeLabel,
    listInstalledThemes,
    removeInstalledThemeStyle,
    type InstalledThemeDefinition
} from "../../../../shared/lib/themePackages";
interface LabelWithHintProps {
    label: string;
    hint?: string | ReactNode;
    hintKey: string;
}

interface AppearanceSettingsGroupProps {
    t: (key: string) => string;
    collapsed: boolean;
    onToggle: () => void;
    LabelWithHint: ComponentType<LabelWithHintProps>;
    theme: string;
    setTheme: (val: string) => void;
    colorMode: string;
    setColorMode: (val: string) => void;
    language: Locale;
    setLanguage: (val: Locale) => void;
    showAppBorder: boolean;
    setShowAppBorder: (val: boolean) => void;
    showSourceAppIcon: boolean;
    setShowSourceAppIcon: (val: boolean) => void;
    hideUnselectedItemActions: boolean;
    setHideUnselectedItemActions: (val: boolean) => void;

    compactMode: boolean;
    setCompactMode: (val: boolean) => void;
    compactShowTime: boolean;
    setCompactShowTime: (val: boolean) => void;
    clipboardItemFontSize: number;
    setClipboardItemFontSize: (val: number) => void;
    clipboardTagFontSize: number;
    setClipboardTagFontSize: (val: number) => void;
    customBackground: string;
    setCustomBackground: (val: string) => void;
    customBackgroundOpacity: number;
    setCustomBackgroundOpacity: (val: number) => void;
    surfaceOpacity: number;
    setSurfaceOpacity: (val: number) => void;
    saveAppSetting: (key: string, val: string) => void;
}

const clampProgress = (value: number, min: number, max: number) => {
    if (max <= min) return "0%";
    const pct = ((value - min) / (max - min)) * 100;
    return `${Math.min(100, Math.max(0, pct))}%`;
};

const buildRangeStyle = (value: number, min: number, max: number) =>
    ({
        width: '100%',
        cursor: 'pointer',
        accentColor: 'var(--accent-color)',
        "--range-progress": clampProgress(value, min, max)
    }) as CSSProperties;

const AppearanceSettingsGroup = ({
    t,
    collapsed,
    onToggle,
    LabelWithHint,
    theme,
    setTheme,
    colorMode,
    setColorMode,
    language,
    setLanguage,
    showAppBorder,
    setShowAppBorder,
    showSourceAppIcon,
    setShowSourceAppIcon,
    hideUnselectedItemActions,
    setHideUnselectedItemActions,

    compactMode,
    setCompactMode,
    compactShowTime,
    setCompactShowTime,
    clipboardItemFontSize,
    setClipboardItemFontSize,
    clipboardTagFontSize,
    setClipboardTagFontSize,
    customBackground,
    setCustomBackground,
    customBackgroundOpacity,
    setCustomBackgroundOpacity,
    surfaceOpacity,
    setSurfaceOpacity,
    saveAppSetting
}: AppearanceSettingsGroupProps) => {
    const [installedThemes, setInstalledThemes] = useState<InstalledThemeDefinition[]>([]);
    const selectedInstalledTheme = installedThemes.find(item => item.id === theme);
    const showCustomBackgroundControls = selectedInstalledTheme
        ? selectedInstalledTheme.supportsCustomBackground
        : supportsCustomBackground(theme);
    const showSurfaceOpacityControls = selectedInstalledTheme
        ? selectedInstalledTheme.supportsSurfaceOpacity
        : supportsSurfaceOpacity(theme);

    useEffect(() => {
        let disposed = false;
        listInstalledThemes()
            .then(items => {
                if (!disposed) setInstalledThemes(items);
            })
            .catch(error => console.error("Failed to list installed themes:", error));
        return () => {
            disposed = true;
        };
    }, []);

    const installTheme = async () => {
        try {
            const selected = await withNativeDialog(async () => open({
                multiple: false,
                title: t('theme_package_import'),
                filters: [{
                    name: t('theme_package_file'),
                    extensions: ['zip', 'tiez-theme']
                }]
            }), "settings:import-theme");
            if (!selected || typeof selected !== 'string') return;

            const installed = await invoke<InstalledThemeDefinition>('install_theme_package', {
                packagePath: selected
            });
            const loaded = await ensureInstalledThemeStyle(installed.id, { force: true });
            if (!loaded) throw new Error(t('theme_package_load_failed'));

            setInstalledThemes(current => [
                ...current.filter(item => item.id !== installed.id),
                installed
            ].sort((a, b) => a.id.localeCompare(b.id)));
            setTheme(installed.id);
            saveAppSetting('theme', installed.id);
            await message(t('theme_package_install_success'), {
                title: t('visual_theme'),
                kind: 'info'
            });
        } catch (error) {
            console.error("Failed to install theme package:", error);
            await message(`${t('theme_package_install_failed')}\n${String(error)}`, {
                title: t('error'),
                kind: 'error'
            });
        }
    };

    const uninstallTheme = async (item: InstalledThemeDefinition) => {
        try {
            const confirmed = await withNativeDialog(async () => ask(
                t('theme_package_confirm_delete'),
                { title: t('theme_package_uninstall'), kind: 'warning' }
            ), "settings:uninstall-theme");
            if (!confirmed) return;

            await invoke('uninstall_theme_package', { themeId: item.id });
            removeInstalledThemeStyle(item.id);
            setInstalledThemes(current => current.filter(themeItem => themeItem.id !== item.id));
            if (theme === item.id) {
                const fallbackTheme = getDefaultTheme();
                setTheme(fallbackTheme);
                saveAppSetting('theme', fallbackTheme);
            }
        } catch (error) {
            console.error("Failed to uninstall theme package:", error);
            await message(`${t('theme_package_uninstall_failed')}\n${String(error)}`, {
                title: t('error'),
                kind: 'error'
            });
        }
    };

    return (
    <div className={`settings-group ${collapsed ? 'collapsed' : ''}`}>
        <button type="button" className="group-header" aria-expanded={!collapsed} onClick={onToggle}>
            <h3 style={{ margin: 0 }}>{t('appearance_settings')}</h3>
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        {!collapsed && (
            <div className="group-content">
                <div className="setting-item column">
                    <div className="item-label-group" style={{ marginBottom: '8px' }}>
                        <span className="item-label">{t('visual_theme')}</span>
                    </div>
                    <div className="settings-choice-grid theme-choice-grid">
                        {getSelectableThemes().map(themeItem => (
                            <button
                                key={themeItem.id}
                                onClick={() => {
                                    setTheme(themeItem.id);
                                    saveAppSetting('theme', themeItem.id);
                                }}
                                className={`btn-icon theme-choice-btn ${normalizeThemeId(theme) === themeItem.id ? 'active' : ''}`}
                                type="button"
                            >
                                <span className="theme-choice-title">
                                    {getThemeLabel(themeItem.id, t)}
                                </span>
                            </button>
                        ))}
                    </div>
                    {installedThemes.length > 0 && (
                        <>
                            <div className="item-label-group installed-theme-label">
                                <span className="item-label">{t('installed_themes')}</span>
                            </div>
                            <div className="settings-choice-grid theme-choice-grid">
                                {installedThemes.map(themeItem => (
                                    <div className="installed-theme-choice" key={themeItem.id}>
                                        <button
                                            onClick={() => {
                                                setTheme(themeItem.id);
                                                saveAppSetting('theme', themeItem.id);
                                            }}
                                            className={`btn-icon theme-choice-btn ${theme === themeItem.id ? 'active' : ''}`}
                                            type="button"
                                        >
                                            <span className="theme-choice-title">
                                                {getInstalledThemeLabel(themeItem, language)}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-icon installed-theme-remove"
                                            aria-label={t('delete')}
                                            title={t('delete')}
                                            onClick={() => void uninstallTheme(themeItem)}
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                    <button
                        type="button"
                        className="btn-icon theme-package-import-btn"
                        onClick={() => void installTheme()}
                    >
                        {t('theme_package_import')}
                    </button>
                </div>

                <div className="setting-item column">
                    <div className="item-label-group" style={{ marginBottom: '8px' }}>
                        <span className="item-label">{t('color_mode')}</span>
                    </div>
                    <div className="settings-inline-choice-row">
                        {[
                            { id: 'system', name: t('mode_system') },
                            { id: 'light', name: t('mode_light') },
                            { id: 'dark', name: t('mode_dark') }
                        ].map(modeItem => (
                            <button
                                key={modeItem.id}
                                onClick={() => {
                                    console.log('[THEME DEBUG] Saving color_mode:', modeItem.id);
                                    setColorMode(modeItem.id);
                                    saveAppSetting('color_mode', modeItem.id);
                                }}
                                className={`btn-icon settings-inline-choice-btn ${colorMode === modeItem.id ? 'active' : ''}`}
                            >
                                {modeItem.name}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="setting-item column no-border">
                    <div className="item-label-group" style={{ marginBottom: '8px' }}>
                        <span className="item-label">{t('language')}</span>
                    </div>
                    <div className="settings-inline-choice-row">
                        {[
                            { id: 'zh', name: '简体' },
                            { id: 'tw', name: '繁體' },
                            { id: 'en', name: 'English' }
                        ].map(lang => (
                            <button
                                key={lang.id}
                                onClick={() => {
                                    setLanguage(lang.id as Locale);
                                    saveAppSetting('language', lang.id);
                                }}
                                className={`btn-icon settings-inline-choice-btn ${language === lang.id ? 'active' : ''}`}
                            >
                                {lang.name}
                            </button>
                        ))}
                    </div>
                </div>



                {isWindowsPlatform() && (
                    <div className="setting-item">
                        <LabelWithHint
                            label={t('show_app_border')}
                            hint={t('show_app_border_hint')}
                            hintKey="show_app_border"
                        />
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={showAppBorder}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    setShowAppBorder(val);
                                    saveAppSetting('show_app_border', String(val));
                                }}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>
                )}

                <div className="setting-item">
                    <LabelWithHint
                        label={t('show_source_app_icon')}
                        hint={t('show_source_app_icon_hint')}
                        hintKey="show_source_app_icon"
                    />
                    <label className="switch">
                        <input
                            className="cb"
                            type="checkbox"
                            checked={showSourceAppIcon}
                            onChange={(e) => {
                                const val = e.target.checked;
                                setShowSourceAppIcon(val);
                                saveAppSetting('show_source_app_icon', String(val));
                            }}
                        />
                        <div className="toggle"><div className="left" /><div className="right" /></div>
                    </label>
                </div>

                <div className="setting-item">
                    <LabelWithHint
                        label={t('hide_unselected_item_actions')}
                        hint={t('hide_unselected_item_actions_hint')}
                        hintKey="hide_unselected_item_actions"
                    />
                    <label className="switch">
                        <input
                            className="cb"
                            type="checkbox"
                            checked={hideUnselectedItemActions}
                            onChange={(e) => {
                                const val = e.target.checked;
                                setHideUnselectedItemActions(val);
                                saveAppSetting('hide_unselected_item_actions', String(val));
                            }}
                        />
                        <div className="toggle"><div className="left" /><div className="right" /></div>
                    </label>
                </div>

                <div className="setting-item">
                    <LabelWithHint
                        label={t('compact_mode')}
                        hint={t('compact_mode_hint')}
                        hintKey="compact_mode"
                    />
                    <label className="switch">
                        <input
                            className="cb"
                            type="checkbox"
                            checked={compactMode}
                            onChange={(e) => {
                                const val = e.target.checked;
                                setCompactMode(val);
                                saveAppSetting('compact_mode', String(val));
                            }}
                        />
                        <div className="toggle"><div className="left" /><div className="right" /></div>
                    </label>
                </div>

                {compactMode && (
                    <div className="setting-item" style={{ paddingLeft: '16px' }}>
                        <div className="item-label-group">
                            <span className="item-label">{t('compact_show_time')}</span>
                        </div>
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={compactShowTime}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    setCompactShowTime(val);
                                    saveAppSetting('compact_show_time', String(val));
                                }}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>
                )}

                <div className="setting-item column">
                    <div className="setting-item-heading">
                        <LabelWithHint
                            label={t('clipboard_item_font_size')}
                            hint={t('clipboard_item_font_size_hint')}
                            hintKey="clipboard_item_font_size"
                        />
                        <span className="hint setting-value" style={{ fontSize: '10px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {clipboardItemFontSize}px
                        </span>
                    </div>
                    <input
                        type="range"
                        min="11"
                        max="18"
                        step="1"
                        value={clipboardItemFontSize}
                        onChange={(e) => {
                            const val = parseInt(e.target.value);
                            setClipboardItemFontSize(val);
                            saveAppSetting('clipboard_item_font_size', String(val));
                        }}
                        style={buildRangeStyle(clipboardItemFontSize, 11, 18)}
                    />
                </div>

                <div className="setting-item column">
                    <div className="setting-item-heading">
                        <LabelWithHint
                            label={t('clipboard_tag_font_size')}
                            hint={t('clipboard_tag_font_size_hint')}
                            hintKey="clipboard_tag_font_size"
                        />
                        <span className="hint setting-value" style={{ fontSize: '10px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {clipboardTagFontSize}px
                        </span>
                    </div>
                    <input
                        type="range"
                        min="8"
                        max="14"
                        step="1"
                        value={clipboardTagFontSize}
                        onChange={(e) => {
                            const val = parseInt(e.target.value);
                            setClipboardTagFontSize(val);
                            saveAppSetting('clipboard_tag_font_size', String(val));
                        }}
                        style={buildRangeStyle(clipboardTagFontSize, 8, 14)}
                    />
                </div>

                {(showCustomBackgroundControls || showSurfaceOpacityControls) && (
                    <>
                        {showCustomBackgroundControls && (
                        <div className="setting-item column no-border">
                            <div className="item-label-group" style={{ marginBottom: '8px' }}>
                                <span className="item-label">{t('custom_background')}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', width: '100%', alignItems: 'center' }}>
                                <button
                                    onClick={async () => {
                                        try {
                                            const selected = await withNativeDialog(async () => {
                                                const path = await open({
                                                    multiple: false,
                                                    title: t('choose_background'),
                                                    filters: [{
                                                        name: 'Image',
                                                        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
                                                    }]
                                                });
                                                if (!path || typeof path !== 'string') return null;

                                                try {
                                                    const stats = await invoke<{ size: number }>('get_file_size', { path });
                                                    const maxSize = 10 * 1024 * 1024;
                                                    if (stats.size > maxSize) {
                                                        await message(
                                                            t('background_size_error'),
                                                            { title: t('error'), kind: 'error' }
                                                        );
                                                        return null;
                                                    }
                                                } catch (e) { console.warn(e); }

                                                return path;
                                            }, "settings:choose-background");
                                            if (selected && typeof selected === 'string') {
                                                setCustomBackground(selected);
                                                saveAppSetting('custom_background', selected);
                                            }
                                        } catch (err) {
                                            console.error(err);
                                        }
                                    }}
                                    className="btn-icon"
                                    style={{ flex: 1, height: '36px', fontSize: '12px', fontWeight: 'bold' }}
                                >
                                    {customBackground ? t('change_background') : t('choose_background')}
                                </button>
                                {customBackground && (
                                    <button
                                        onClick={() => {
                                            setCustomBackground('');
                                            saveAppSetting('custom_background', '');
                                        }}
                                        className="btn-icon"
                                        style={{ height: '36px', fontSize: '12px', fontWeight: 'bold', padding: '0 12px' }}
                                        title={t('clear_background')}
                                    >
                                        <X size={16} />
                                    </button>
                                )}
                            </div>
                            {customBackground && (
                                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', wordBreak: 'break-all' }}>
                                    {customBackground.split(/[/\\]/).pop()}
                                </div>
                            )}

                            {customBackground && (
                                <div className="setting-item column no-border" style={{ marginTop: '12px' }}>
                                    <div className="item-label-group" style={{ marginBottom: '4px', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span className="item-label">{t('background_opacity')}</span>
                                        <span className="hint" style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{customBackgroundOpacity}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={customBackgroundOpacity}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            setCustomBackgroundOpacity(val);
                                            saveAppSetting('custom_background_opacity', String(val));
                                        }}
                                        style={buildRangeStyle(customBackgroundOpacity, 0, 100)}
                                    />
                                </div>
                            )}
                        </div>
                        )}

                        {showSurfaceOpacityControls && (
                        <div className="setting-item column">
                            <div className="item-label-group" style={{ marginBottom: '4px', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="item-label">{t('surface_opacity')}</span>
                                <span className="hint" style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{surfaceOpacity}%</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={surfaceOpacity}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value);
                                    setSurfaceOpacity(val);
                                    saveAppSetting('surface_opacity', String(val));
                                }}
                                style={buildRangeStyle(surfaceOpacity, 0, 100)}
                            />
                        </div>
                        )}
                    </>
                )}
            </div>
        )}
    </div>
    );
};

export default AppearanceSettingsGroup;
