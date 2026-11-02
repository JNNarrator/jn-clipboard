import { useEffect, useState } from "react";
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { withNativeDialog } from "../../../../shared/lib/focus";
import { getHotkeyDisplayTokens } from "../../../../shared/lib/hotkeyDisplay";
import { hotkeyKeyFromEvent } from "../../../../shared/lib/hotkeyKey";
import { isMacPlatform, isWindowsPlatform } from "../../../../shared/lib/platform";
import type { QuickPasteModifier } from "../../../app/types";

interface LabelWithHintProps {
    label: string;
    hint?: string | ReactNode;
    hintKey: string;
}

interface HotkeySettingsGroupProps {
    t: (key: string) => string;
    collapsed: boolean;
    onToggle: () => void;
    LabelWithHint: ComponentType<LabelWithHintProps>;
    saveAppSetting: (key: string, val: string) => void;

    hotkey: string;
    isRecording: boolean;
    setIsRecording: (val: boolean) => void;
    updateHotkey: (key: string) => void;

    plainPasteHotkey: string;
    isRecordingPlain: boolean;
    setIsRecordingPlain: (val: boolean) => void;
    updatePlainPasteHotkey: (key: string) => void;

    searchHotkey: string;
    isRecordingSearch: boolean;
    setIsRecordingSearch: (val: boolean) => void;
    updateSearchHotkey: (key: string) => void;

    sequentialMode: boolean;
    setSequentialModeState: (val: boolean) => void;
    sequentialHotkey: string;
    isRecordingSequential: boolean;
    setIsRecordingSequential: (val: boolean) => void;
    updateSequentialHotkey: (key: string) => void;
    checkHotkeyConflict: (newHotkey: string, mode: 'main' | 'sequential' | 'plain' | 'search') => boolean;

    quickPasteModifier: QuickPasteModifier;
    setQuickPasteModifier: (val: QuickPasteModifier) => void;

    registryWinVEnabled: boolean;
    setRegistryWinVEnabled: (val: boolean) => void;
    appSettings: Record<string, string>;
    theme: string;
    colorMode: string;
}

/**
 * The shortcuts the window itself handles once it is open.
 *
 * These are not settings — nothing here can be rebound — so they belong in a
 * reference table rather than in more recorders. Before this existed the only
 * way to find them was to notice one of them scroll past in a hint.
 */
const BUILTIN_SHORTCUTS: Array<{ keys: string; labelKey: string }> = [
    { keys: '↑ / ↓', labelKey: 'shortcut_builtin_navigate' },
    { keys: 'Enter', labelKey: 'shortcut_builtin_paste' },
    { keys: 'Shift+Enter', labelKey: 'shortcut_builtin_copy_only' },
    { keys: 'Esc', labelKey: 'shortcut_builtin_close' },
    { keys: 'Tab', labelKey: 'shortcut_builtin_cycle_type' },
    { keys: 'Delete', labelKey: 'shortcut_builtin_delete' },
    { keys: '⌘F / Ctrl+F', labelKey: 'shortcut_builtin_search' },
    { keys: '⌘, / Ctrl+,', labelKey: 'shortcut_builtin_settings' }
];

const HotkeySettingsGroup = (props: HotkeySettingsGroupProps) => {
    const isMac = isMacPlatform();
    const isWindows = isWindowsPlatform();
    const isWinVManaged = isWindows && props.registryWinVEnabled;
    const sequentialHotkeyLabel = getHotkeyDisplayTokens(props.sequentialHotkey, { preferMacSymbols: isMac })
        .map((token) => token.label).join(isMac ? "" : " + ") || props.t('not_set');
    const quickPasteOptions: Array<{ value: QuickPasteModifier; label: string }> = isMac
        ? [
            { value: "disabled", label: props.t("quick_paste_modifier_disabled") },
            { value: "ctrl", label: "Control (⌃)" },
            { value: "alt", label: "Option (⌥)" },
            { value: "shift", label: "Shift (⇧)" },
            { value: "win", label: "Command (⌘)" }
        ]
        : [
            { value: "disabled", label: props.t("quick_paste_modifier_disabled") },
            { value: "ctrl", label: props.t("quick_paste_modifier_ctrl") },
            { value: "alt", label: props.t("quick_paste_modifier_alt") },
            { value: "shift", label: props.t("quick_paste_modifier_shift") },
            { value: "win", label: props.t("quick_paste_modifier_win") }
        ];
    // Shift+digit typed globally swallows !@#… in every app; no longer offered.
    // Kept in the list only for a setup that already uses it.
    const visibleQuickPasteOptions = quickPasteOptions.filter(
        (option) => option.value !== "shift" || props.quickPasteModifier === "shift"
    );
    const [mainHotkeyHintOpen, setMainHotkeyHintOpen] = useState(false);

    // Recording pauses capture and, on Windows, takes every key press: it
    // ends with its field (blur covers the window hiding; this, settings closing).
    const { setIsRecording, setIsRecordingPlain, setIsRecordingSearch, setIsRecordingSequential } = props;
    useEffect(() => () => {
        setIsRecording(false);
        setIsRecordingPlain(false);
        setIsRecordingSearch(false);
        setIsRecordingSequential(false);
    }, [setIsRecording, setIsRecordingPlain, setIsRecordingSearch, setIsRecordingSequential]);

    const renderHotkeyCaps = (hotkey: string) => {
        const tokens = getHotkeyDisplayTokens(hotkey, { preferMacSymbols: isMac });
        if (tokens.length === 0) {
            return <div className="key-cap key-cap-empty">{props.t('not_set')}</div>;
        }

        if (isMac) {
            const compactLabel = tokens.map((token) => token.label).join("");
            return <div className="key-cap key-cap-chord">{compactLabel}</div>;
        }

        return tokens.map((token, index) => (
            <div className="key-cap" key={`${token.raw}-${index}`}>
                {token.label}
            </div>
        ));
    };

    const renderHotkeyHint = (recording: boolean, idleHint?: string) => {
        if (!recording) return idleHint || props.t('hotkey_click_hint');

        return (
            <>
                {isWindows && <span className="hotkey-warning">{props.t('win_key_not_recommended')}</span>}
                <span>{props.t('hotkey_recording_esc')}</span>
            </>
        );
    };

    const handleHotkeyKeyDown = (
        event: ReactKeyboardEvent<HTMLDivElement>,
        recording: boolean,
        setRecording: (recording: boolean) => void,
        updateHotkey: (hotkey: string) => void
    ) => {
        if (!recording) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.key === 'Escape') {
            setRecording(false);
            return;
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
            updateHotkey('');
            setRecording(false);
            return;
        }

        const modifiers: string[] = [];
        if (event.ctrlKey) modifiers.push('Ctrl');
        if (event.shiftKey) modifiers.push('Shift');
        if (event.altKey) modifiers.push('Alt');
        if (event.metaKey) modifiers.push(isMac ? 'Command' : 'Win');

        const key = hotkeyKeyFromEvent(event);
        if (!key) return;

        updateHotkey([...modifiers, key].join('+'));
    };

    return (
        <div className={`settings-group ${props.collapsed ? 'collapsed' : ''}`}>
            <button type="button" className="group-header" aria-expanded={!props.collapsed} onClick={props.onToggle}>
                <h3>{props.t('hotkey_settings')}</h3>
                {props.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
            {!props.collapsed && (
                <div className="group-content">
                    <h4 className="settings-section-title">{props.t('settings_section_global_hotkeys')}</h4>
                    <div className="setting-item">
                        <div className="item-label-group">
                            <div className="item-label-row">
                                <span className="item-label">{props.t('global_hotkey')}</span>
                                {!isWinVManaged && (
                                    <button
                                        type="button"
                                        className="hint-icon-btn"
                                        title={`${props.t('main_hotkey_hint')} ${props.t('hotkey_click_hint')}`}
                                        aria-label={props.t('main_hotkey_hint')}
                                        aria-expanded={mainHotkeyHintOpen}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setMainHotkeyHintOpen((open) => !open);
                                        }}
                                    >
                                        <HelpCircle size={13} />
                                    </button>
                                )}
                            </div>
                            {isWinVManaged ? (
                                <span className="hint hotkey-hint">{props.t('main_hotkey_managed_by_win_v')}</span>
                            ) : props.isRecording ? (
                                <span className="hint hotkey-hint">{renderHotkeyHint(true)}</span>
                            ) : null}
                        </div>
                        {!isWinVManaged && !props.isRecording && mainHotkeyHintOpen && (
                            <div className="setting-hint-panel">
                                <span className="hint">{props.t('main_hotkey_hint')} {props.t('hotkey_click_hint')}</span>
                            </div>
                        )}

                        <div
                            className={`key-group ${props.isRecording ? 'recording' : ''} ${isWinVManaged ? 'is-disabled' : ''}`}
                            role="button"
                            aria-label={props.t('global_hotkey')}
                            aria-disabled={isWinVManaged}
                            onClick={(event) => {
                                if (isWinVManaged) return;
                                props.setIsRecording(true);
                                event.currentTarget.focus();
                            }}
                            tabIndex={isWinVManaged ? -1 : 0}
                            onKeyDown={(event) => handleHotkeyKeyDown(
                                event,
                                props.isRecording && !isWinVManaged,
                                props.setIsRecording,
                                props.updateHotkey
                            )}
                            onBlur={() => props.setIsRecording(false)}
                        >
                            {props.isRecording ? (
                                <div className="key-cap key-cap-recording">{props.t('waiting_for_input')}</div>
                            ) : (
                                renderHotkeyCaps(props.hotkey)
                            )}
                        </div>
                    </div>

                    {isWindows && (
                        <div className="setting-item">
                            <props.LabelWithHint
                                label={props.t('use_win_v_shortcut')}
                                hint={props.t('use_win_v_shortcut_hint')}
                                hintKey="use_win_v_shortcut"
                            />
                            <label className="switch">
                                <input
                                    className="cb"
                                    type="checkbox"
                                    checked={props.registryWinVEnabled}
                                    onChange={async (e) => {
                                        const enabled = e.target.checked;
                                        const previousEnabled = props.registryWinVEnabled;
                                        const previousHotkey = props.hotkey;
                                        props.setRegistryWinVEnabled(enabled);
                                        if (enabled) {
                                            props.setIsRecording(false);
                                        }
                                        try {
                                            const changed = await invoke<boolean>("trigger_registry_win_v_optimization", { enable: enabled });
                                            await invoke("save_setting", { key: 'app.use_win_v_shortcut', value: String(enabled) });
                                            let targetHotkey = "Alt+C";
                                            if (enabled) {
                                                if (props.hotkey && props.hotkey !== "Win+V") {
                                                    props.saveAppSetting('pre_win_v_hotkey', props.hotkey);
                                                }
                                                targetHotkey = "Win+V";
                                            } else {
                                                const savedPreHotkey = props.appSettings['app.pre_win_v_hotkey'];
                                                if (savedPreHotkey && savedPreHotkey !== "Win+V") {
                                                    targetHotkey = savedPreHotkey;
                                                }
                                            }

                                            if (!enabled) {
                                                await props.updateHotkey(targetHotkey);
                                            } else if (!changed) {
                                                props.updateHotkey(targetHotkey);
                                            }

                                            if (changed) {
                                                const confirmed = await withNativeDialog(() => ask(
                                                    props.t('restart_explorer_confirm'),
                                                    { title: props.t('restart_explorer_title'), kind: 'warning' }
                                                ), "settings:restart-explorer");
                                                if (confirmed) {
                                                    await invoke("restart_explorer");
                                                    if (enabled) {
                                                        setTimeout(() => {
                                                            props.updateHotkey(targetHotkey);
                                                        }, 1500);
                                                    }

                                                    setTimeout(() => {
                                                        invoke("set_theme", {
                                                            theme: props.theme,
                                                            colorMode: props.colorMode,
                                                            showAppBorder: props.appSettings["app.show_app_border"] !== "false"
                                                        }).catch(console.error);
                                                    }, 2500);
                                                } else {
                                                    props.updateHotkey(targetHotkey);
                                                }
                                            }
                                        } catch (err) {
                                            console.error("Failed to configure Win+V shortcut:", err);
                                            props.setRegistryWinVEnabled(previousEnabled);
                                            await invoke("trigger_registry_win_v_optimization", {
                                                enable: previousEnabled
                                            }).catch(console.error);
                                            await invoke("save_setting", {
                                                key: 'app.use_win_v_shortcut',
                                                value: String(previousEnabled)
                                            }).catch(console.error);
                                            if (previousHotkey) {
                                                await props.updateHotkey(previousHotkey);
                                            }
                                        }
                                    }}
                                />
                                <div className="toggle"><div className="left" /><div className="right" /></div>
                            </label>
                        </div>
                    )}

                    <div className="setting-item">
                        <div className="item-label-group">
                            <span className="item-label">{props.t('plain_paste_hotkey_label')}</span>
                            <span className="hint hotkey-hint">{renderHotkeyHint(props.isRecordingPlain, props.t('plain_paste_hotkey_hint'))}</span>
                        </div>
                        <div
                            className={`key-group ${props.isRecordingPlain ? 'recording' : ''}`}
                            role="button"
                            aria-label={props.t('plain_paste_hotkey_label')}
                            onClick={(event) => {
                                props.setIsRecordingPlain(true);
                                event.currentTarget.focus();
                            }}
                            tabIndex={0}
                            onKeyDown={(event) => handleHotkeyKeyDown(
                                event,
                                props.isRecordingPlain,
                                props.setIsRecordingPlain,
                                props.updatePlainPasteHotkey
                            )}
                            onBlur={() => props.setIsRecordingPlain(false)}
                        >
                            {props.isRecordingPlain ? (
                                <div className="key-cap key-cap-recording">{props.t('waiting_for_input')}</div>
                            ) : (
                                renderHotkeyCaps(props.plainPasteHotkey)
                            )}
                        </div>
                    </div>

                    <div className="setting-item">
                        <div className="item-label-group">
                            <span className="item-label">{props.t('search_hotkey_label')}</span>
                            <span className="hint hotkey-hint">{renderHotkeyHint(props.isRecordingSearch)}</span>
                        </div>
                        <div
                            className={`key-group ${props.isRecordingSearch ? 'recording' : ''}`}
                            role="button"
                            aria-label={props.t('search_hotkey_label')}
                            onClick={(event) => {
                                props.setIsRecordingSearch(true);
                                event.currentTarget.focus();
                            }}
                            tabIndex={0}
                            onKeyDown={(event) => handleHotkeyKeyDown(
                                event,
                                props.isRecordingSearch,
                                props.setIsRecordingSearch,
                                props.updateSearchHotkey
                            )}
                            onBlur={() => props.setIsRecordingSearch(false)}
                        >
                            {props.isRecordingSearch ? (
                                <div className="key-cap key-cap-recording">{props.t('waiting_for_input')}</div>
                            ) : (
                                renderHotkeyCaps(props.searchHotkey)
                            )}
                        </div>
                    </div>

                    <div className="setting-item">
                        <props.LabelWithHint
                            label={props.t('quick_paste_modifier')}
                            hint={props.t('quick_paste_modifier_hint')}
                            hintKey="quick_paste_modifier"
                        />
                        <select
                            className="search-input settings-field settings-field--sm quick-paste-select"
                            value={props.quickPasteModifier}
                            onChange={(e) => {
                                const value = e.target.value as QuickPasteModifier;
                                props.setQuickPasteModifier(value);
                                invoke("set_quick_paste_modifier", { modifier: value }).catch(console.error);
                            }}
                        >
                            {visibleQuickPasteOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <h4 className="settings-section-title">{props.t('settings_section_sequential_paste')}</h4>
                    <div className="setting-item">
                        <props.LabelWithHint
                            label={props.t('sequential_paste_mode')}
                            hint={props.t('sequential_paste_hint').replace('{hotkey}', sequentialHotkeyLabel)}
                            hintKey="sequential_paste_mode"
                        />
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={props.sequentialMode}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    props.setSequentialModeState(val);
                                    invoke('set_sequential_mode', { enabled: val }).catch(console.error);
                                    if (val) {
                                        if (props.checkHotkeyConflict(props.sequentialHotkey, 'sequential')) {
                                            props.updateSequentialHotkey("");
                                        }
                                    }
                                }}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>

                    <div className="setting-item is-child">
                        <div className="item-label-group">
                            <span className="item-label">{props.t('sequential_paste_hotkey_label')}</span>
                            <span className="hint hotkey-hint">
                                {renderHotkeyHint(
                                    props.isRecordingSequential,
                                    props.sequentialMode
                                        ? props.t('hotkey_click_hint')
                                        : props.t('sequential_paste_hotkey_inactive_hint')
                                )}
                            </span>
                        </div>
                        <div
                            className={`key-group ${props.isRecordingSequential ? 'recording' : ''}`}
                            role="button"
                            aria-label={props.t('sequential_paste_hotkey_label')}
                            onClick={(event) => {
                                props.setIsRecordingSequential(true);
                                event.currentTarget.focus();
                            }}
                            tabIndex={0}
                            onKeyDown={(event) => handleHotkeyKeyDown(
                                event,
                                props.isRecordingSequential,
                                props.setIsRecordingSequential,
                                props.updateSequentialHotkey
                            )}
                            onBlur={() => props.setIsRecordingSequential(false)}
                        >
                            {props.isRecordingSequential ? (
                                <div className="key-cap key-cap-recording">{props.t('waiting_for_input')}</div>
                            ) : (
                                renderHotkeyCaps(props.sequentialHotkey)
                            )}
                        </div>
                    </div>

                    <h4 className="settings-section-title">{props.t('settings_section_builtin')}</h4>
                    <p className="hint shortcut-table-hint">{props.t('shortcut_builtin_hint')}</p>
                    <div className="shortcut-table">
                        {BUILTIN_SHORTCUTS.map((row) => (
                            <div className="shortcut-table-row" key={row.labelKey}>
                                <span className="shortcut-table-label">{props.t(row.labelKey)}</span>
                                <span className="shortcut-table-keys">{row.keys}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default HotkeySettingsGroup;
