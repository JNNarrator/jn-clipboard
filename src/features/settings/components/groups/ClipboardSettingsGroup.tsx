import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { withNativeDialog } from "../../../../shared/lib/focus";
import { ChevronDown, ChevronRight } from "lucide-react";
import { isWindowsPlatform } from "../../../../shared/lib/platform";

interface LabelWithHintProps {
    label: string;
    hint?: string | ReactNode;
    hintKey: string;
}

interface ClipboardSettingsGroupProps {
    t: (key: string) => string;
    collapsed: boolean;
    onToggle: () => void;
    LabelWithHint: ComponentType<LabelWithHintProps>;
    persistent: boolean;
    setPersistent: (val: boolean) => void;
    persistentLimitEnabled: boolean;
    setPersistentLimitEnabled: (val: boolean) => void;
    persistentLimit: number;
    setPersistentLimit: (val: number) => void;
    saveAppSetting: (key: string, val: string) => void;
    deduplicate: boolean;
    setDeduplicate: (val: boolean) => void;
    captureFiles: boolean;
    setCaptureFiles: (val: boolean) => void;
    captureRichText: boolean;
    setCaptureRichText: (val: boolean) => void;
    richTextSnapshotPreview: boolean;
    setRichTextSnapshotPreview: (val: boolean) => void;
    deleteAfterPaste: boolean;
    setDeleteAfterPaste: (val: boolean) => void;
    moveToTopAfterPaste: boolean;
    clickCopyOnly: boolean;
    setMoveToTopAfterPaste: (val: boolean) => void;
    setClickCopyOnly: (val: boolean) => void;
    pasteMethod: string;
    setPasteMethod: (val: string) => void;
    privacyProtection: boolean;
    setPrivacyProtection: (val: boolean) => void;
    privacyProtectionKinds: string[];
    setPrivacyProtectionKinds: (val: string[]) => void;
    privacyProtectionCustomRules: string;
    setPrivacyProtectionCustomRules: (val: string) => void;
    sensitiveMaskPrefixVisible: number;
    setSensitiveMaskPrefixVisible: (val: number) => void;
    sensitiveMaskSuffixVisible: number;
    setSensitiveMaskSuffixVisible: (val: number) => void;
    sensitiveMaskEmailDomain: boolean;
    setSensitiveMaskEmailDomain: (val: boolean) => void;
    privacyKindsOpen: boolean;
    setPrivacyKindsOpen: (val: boolean) => void;
    privacyRulesOpen: boolean;
    setPrivacyRulesOpen: (val: boolean) => void;
}

const ClipboardSettingsGroup = (props: ClipboardSettingsGroupProps) => {
    const isWindows = isWindowsPlatform();
    const [persistentLimitDraft, setPersistentLimitDraft] = useState(
        props.persistentLimit.toString()
    );
    const [maskSettingsOpen, setMaskSettingsOpen] = useState(false);

    useEffect(() => {
        setPersistentLimitDraft(props.persistentLimit.toString());
    }, [props.persistentLimit, props.persistentLimitEnabled]);

    const commitPersistentLimit = (rawValue?: string) => {
        const source = rawValue ?? persistentLimitDraft;
        const parsed = parseInt(source, 10);
        if (!Number.isFinite(parsed)) {
            setPersistentLimitDraft(props.persistentLimit.toString());
            return;
        }
        const clamped = Math.max(50, Math.min(99999, parsed));
        props.setPersistentLimit(clamped);
        props.saveAppSetting('persistent_limit', clamped.toString());
        if (clamped.toString() !== source) {
            setPersistentLimitDraft(clamped.toString());
        }
    };

    return (
        <div className={`settings-group ${props.collapsed ? 'collapsed' : ''}`}>
            <button type="button" className="group-header" aria-expanded={!props.collapsed} onClick={props.onToggle}>
                <h3>{props.t('clipboard_settings')}</h3>
                {props.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
            {!props.collapsed && (
                <div className="group-content">
                    <h4 className="settings-section-title">{props.t('settings_section_history')}</h4>
                    <div className="setting-item">
                        <props.LabelWithHint
                            label={props.t('persistent_storage')}
                            hint={props.t('persistent_hint')}
                            hintKey="persistent_storage"
                        />
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={props.persistent}
                                onChange={(e) => props.setPersistent(e.target.checked)}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>
                    {props.persistent && (
                        <>
                            <div className="setting-item is-child">
                                <props.LabelWithHint
                                    label={props.t('persistent_limit_enabled')}
                                    hint={props.t('persistent_limit_enabled_hint')}
                                    hintKey="persistent_limit_enabled"
                                />
                                <label className="switch">
                                    <input
                                        className="cb"
                                        type="checkbox"
                                        checked={props.persistentLimitEnabled}
                                        onChange={(e) => {
                                            props.setPersistentLimitEnabled(e.target.checked);
                                            props.saveAppSetting('persistent_limit_enabled', e.target.checked.toString());
                                        }}
                                    />
                                    <div className="toggle"><div className="left" /><div className="right" /></div>
                                </label>
                            </div>
                            {props.persistentLimitEnabled && (
                                <div className="setting-item is-child">
                                    <props.LabelWithHint
                                        label={props.t('persistent_limit')}
                                        hint={props.t('persistent_limit_hint')}
                                        hintKey="persistent_limit"
                                    />
                                    <input
                                        className="search-input settings-field settings-field--sm"
                                        type="number"
                                        value={persistentLimitDraft}
                                        onFocus={(e) => {
                                            e.target.select();
                                        }}
                                        onChange={(e) => {
                                            const next = e.target.value;
                                            if (next === "") {
                                                setPersistentLimitDraft("");
                                                return;
                                            }
                                            if (!/^\d+$/.test(next)) return;
                                            setPersistentLimitDraft(next);
                                        }}
                                        onBlur={() => {
                                            commitPersistentLimit();
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                commitPersistentLimit(e.currentTarget.value);
                                                e.currentTarget.blur();
                                            }
                                        }}
                                    />
                                </div>
                            )}
                        </>
                    )}
                    <div className="setting-item">
                        <props.LabelWithHint
                            label={props.t('merge_duplicates')}
                            hint={props.t('merge_duplicates_hint')}
                            hintKey="merge_duplicates"
                        />
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={props.deduplicate}
                                onChange={(e) => props.setDeduplicate(e.target.checked)}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>
                    <div className="setting-item">
                        <div className="item-label-group">
                            <span className="item-label">{props.t('capture_files')}</span>
                            <span className="hint">{props.t('capture_files_hint')}</span>
                        </div>
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={props.captureFiles}
                                onChange={(e) => props.setCaptureFiles(e.target.checked)}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>
                    <div className="setting-item">
                        <props.LabelWithHint
                            label={props.t('capture_rich_text')}
                            hint={props.t('capture_rich_text_hint')}
                            hintKey="capture_rich_text"
                        />
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={props.captureRichText}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    props.setCaptureRichText(val);
                                }}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>
                    <div className="setting-item">
                        <props.LabelWithHint
                            label={props.t('rich_text_snapshot_preview')}
                            hint={props.t('rich_text_snapshot_preview_hint')}
                            hintKey="rich_text_snapshot_preview"
                        />
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={props.richTextSnapshotPreview}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    props.setRichTextSnapshotPreview(val);
                                    props.saveAppSetting('rich_text_snapshot_preview', String(val));
                                }}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>


                    <h4 className="settings-section-title">{props.t('settings_section_paste')}</h4>
                    <div className="setting-item">
                        <props.LabelWithHint
                            label={props.t('delete_after_paste')}
                            hint={props.t('delete_after_paste_hint')}
                            hintKey="delete_after_paste"
                        />
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={props.deleteAfterPaste}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    props.setDeleteAfterPaste(val);
                                    props.saveAppSetting('delete_after_paste', String(val));
                                }}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>
                    <div className="setting-item">
                        <props.LabelWithHint
                            label={props.t('move_to_top_after_paste')}
                            hint={props.t('move_to_top_after_paste_hint')}
                            hintKey="move_to_top_after_paste"
                        />
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={props.moveToTopAfterPaste}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    props.setMoveToTopAfterPaste(val);
                                    props.saveAppSetting('move_to_top_after_paste', String(val));
                                }}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>
                    <div className="setting-item">
                        <props.LabelWithHint
                            label={props.t('click_copy_only')}
                            hint={props.t('click_copy_only_hint')}
                            hintKey="click_copy_only"
                        />
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={props.clickCopyOnly}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    props.setClickCopyOnly(val);
                                    props.saveAppSetting('click_copy_only', String(val));
                                }}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>
                    {isWindows && (
                        <div className="setting-item">
                            <props.LabelWithHint
                                label={props.t('paste_method')}
                                hint={props.t(`paste_method_${props.pasteMethod}_hint`)}
                                hintKey="paste_method"
                            />
                            <select
                                className="search-input settings-field settings-field--md"
                                value={props.pasteMethod}
                                onChange={async (e) => {
                                    const val = e.target.value;

                                    if (val === 'game_mode') {
                                        try {
                                            const isAdmin = await invoke<boolean>("check_is_admin");
                                            if (!isAdmin) {
                                                const confirmed = await withNativeDialog(() => ask(
                                                    props.t('game_mode_admin_required'),
                                                    {
                                                        title: props.t('admin_required'),
                                                        kind: 'warning'
                                                    }
                                                ), "settings:game-mode-admin");

                                                if (confirmed) {
                                                    await invoke("save_setting", { key: 'app.paste_method', value: 'game_mode' });
                                                    await invoke("restart_as_admin");
                                                    return;
                                                } else {
                                                    return;
                                                }
                                            }
                                        } catch (err) {
                                            console.error("Failed to check admin status:", err);
                                        }
                                    }

                                    props.setPasteMethod(val);
                                    invoke("save_setting", { key: 'app.paste_method', value: val }).catch(console.error);
                                }}
                            >
                                <option value="auto">{props.t('paste_method_auto')}</option>
                                <option value="shift_insert">{props.t('paste_method_shift_insert')}</option>
                                <option value="ctrl_v">{props.t('paste_method_ctrl_v')}</option>
                                <option value="game_mode">{props.t('paste_method_game_mode')}</option>
                            </select>
                        </div>
                    )}
                    {/* macOS cleanup: Removed Paste Method selection */}
                    <h4 className="settings-section-title">{props.t('settings_section_privacy')}</h4>
                    <div className="setting-item">
                        <props.LabelWithHint
                            label={props.t('privacy_protection')}
                            hint={props.t('privacy_protection_hint')}
                            hintKey="privacy_protection"
                        />
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={props.privacyProtection}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    props.setPrivacyProtection(val);
                                    invoke('set_privacy_protection', { enabled: val }).catch(console.error);
                                }}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>

                    <div className="setting-item column is-child">
                        <div className="setting-disclosure-row">
                            <button
                                type="button"
                                className="setting-disclosure-toggle"
                                aria-expanded={props.privacyKindsOpen}
                                onClick={() => props.setPrivacyKindsOpen(!props.privacyKindsOpen)}
                            >
                                {props.privacyKindsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                            <props.LabelWithHint
                                label={props.t('privacy_protection_kinds')}
                                hint={props.t('privacy_protection_kinds_hint')}
                                hintKey="privacy_protection_kinds"
                            />
                        </div>
                        {props.privacyKindsOpen && (
                            <div className="setting-disclosure-body settings-checkbox-list">
                                {[
                                    { id: 'url', label: props.t('privacy_kind_url') },
                                    { id: 'phone', label: props.t('privacy_kind_phone') },
                                    { id: 'idcard', label: props.t('privacy_kind_idcard') },
                                    { id: 'email', label: props.t('privacy_kind_email') },
                                    { id: 'secret', label: props.t('privacy_kind_secret') },
                                    { id: 'password', label: props.t('privacy_kind_password') },
                                ].map(opt => {
                                    const checked = props.privacyProtectionKinds.includes(opt.id);
                                    return (
                                        <label key={opt.id} className="settings-checkbox" title={opt.id === 'secret' ? props.t('privacy_kind_secret_hint') : undefined}>
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(e) => {
                                                    const next = e.target.checked
                                                        ? [...props.privacyProtectionKinds, opt.id]
                                                        : props.privacyProtectionKinds.filter(t => t !== opt.id);
                                                    props.setPrivacyProtectionKinds(next);
                                                    invoke('set_privacy_protection_kinds', { kinds: next }).catch(console.error);
                                                }}
                                            />
                                            <span>{opt.label}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="setting-item column is-child">
                        <div className="setting-disclosure-row">
                            <button
                                type="button"
                                className="setting-disclosure-toggle"
                                aria-expanded={props.privacyRulesOpen}
                                onClick={() => props.setPrivacyRulesOpen(!props.privacyRulesOpen)}
                            >
                                {props.privacyRulesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                            <props.LabelWithHint
                                label={props.t('privacy_protection_custom_rules')}
                                hint={props.t('privacy_protection_custom_rules_hint')}
                                hintKey="privacy_protection_custom_rules"
                            />
                        </div>
                        {props.privacyRulesOpen && (
                            <textarea
                                className="search-input setting-disclosure-body settings-textarea"
                                placeholder={props.t('privacy_protection_custom_rules_placeholder')}
                                value={props.privacyProtectionCustomRules}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    props.setPrivacyProtectionCustomRules(val);
                                    invoke('set_privacy_protection_custom_rules', { rules: val }).catch(console.error);
                                }}
                            />
                        )}
                    </div>

                    <div className="setting-item column is-child">
                        <div className="setting-disclosure-row">
                            <button
                                type="button"
                                className="setting-disclosure-toggle"
                                aria-expanded={maskSettingsOpen}
                                onClick={() => setMaskSettingsOpen(!maskSettingsOpen)}
                            >
                                {maskSettingsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                            <div className="item-label-group"><span className="item-label">{props.t('sensitive_mask_settings')}</span></div>
                        </div>
                        {maskSettingsOpen && (
                            <div className="setting-disclosure-body">
                                <div className="setting-item">
                                    <div className="item-label-group"><span className="item-label">{props.t('sensitive_mask_prefix_visible')}</span></div>
                                    <input
                                        type="number"
                                        className="search-input settings-field settings-field--xs"
                                        min={0}
                                        max={20}
                                        value={props.sensitiveMaskPrefixVisible}
                                        onChange={(e) => {
                                            const val = Math.min(20, Math.max(0, parseInt(e.target.value) || 0));
                                            props.setSensitiveMaskPrefixVisible(val);
                                            invoke('save_setting', { key: 'app.sensitive_mask_prefix_visible', value: val.toString() }).catch(console.error);
                                        }}
                                    />
                                </div>
                                <div className="setting-item">
                                    <div className="item-label-group"><span className="item-label">{props.t('sensitive_mask_suffix_visible')}</span></div>
                                    <input
                                        type="number"
                                        className="search-input settings-field settings-field--xs"
                                        min={0}
                                        max={20}
                                        value={props.sensitiveMaskSuffixVisible}
                                        onChange={(e) => {
                                            const val = Math.min(20, Math.max(0, parseInt(e.target.value) || 0));
                                            props.setSensitiveMaskSuffixVisible(val);
                                            invoke('save_setting', { key: 'app.sensitive_mask_suffix_visible', value: val.toString() }).catch(console.error);
                                        }}
                                    />
                                </div>
                                <div className="setting-item">
                                    <props.LabelWithHint
                                        label={props.t('sensitive_mask_email_domain')}
                                        hint={props.t('sensitive_mask_email_domain_hint')}
                                        hintKey="sensitive_mask_email_domain"
                                    />
                                    <label className="switch">
                                        <input
                                            className="cb"
                                            type="checkbox"
                                            checked={props.sensitiveMaskEmailDomain}
                                            onChange={(e) => {
                                                props.setSensitiveMaskEmailDomain(e.target.checked);
                                                invoke('save_setting', { key: 'app.sensitive_mask_email_domain', value: e.target.checked.toString() }).catch(console.error);
                                            }}
                                        />
                                        <div className="toggle"><div className="left" /><div className="right" /></div>
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            )}
        </div>
    );
};

export default ClipboardSettingsGroup;
