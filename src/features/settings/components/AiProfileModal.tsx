import AppModal from "../../../shared/components/AppModal";
import type { EditableAiProfile } from "../types";

interface AiProfileModalProps {
    editingProfile: EditableAiProfile | null;
    t: (key: string) => string;
    onClose: () => void;
    onSave: (profile: EditableAiProfile) => void;
    setEditingProfile: (val: EditableAiProfile) => void;
}

const AiProfileModal = ({ editingProfile, t, onClose, onSave, setEditingProfile }: AiProfileModalProps) => (
    <AppModal
        open={Boolean(editingProfile)}
        onClose={onClose}
        panelClassName="modal-panel modal-form-dialog ai-profile-dialog"
        ariaLabel={editingProfile?.isNew ? t("ai_add_model") : t("ai_edit_model")}
    >
        {editingProfile && (
            <>
                <div className="modal-form-heading">
                    <h3 className="modal-form-title">{editingProfile.isNew ? t("ai_add_model") : t("ai_edit_model")}</h3>
                </div>

                <div className="modal-form-fields">
                    <label className="modal-form-field">
                        <span className="modal-field-label">{t("ai_base_url")}</span>
                        <input
                            className="search-input modal-form-control"
                            value={editingProfile.baseUrl}
                            onChange={(e) => setEditingProfile({ ...editingProfile, baseUrl: e.target.value })}
                        />
                    </label>
                    <label className="modal-form-field">
                        <span className="modal-field-label">{t("ai_api_key")}</span>
                        <input
                            className="search-input modal-form-control"
                            type="password"
                            value={editingProfile.apiKey}
                            onChange={(e) => setEditingProfile({ ...editingProfile, apiKey: e.target.value })}
                        />
                    </label>
                    <label className="modal-form-field">
                        <span className="modal-field-label">{t("ai_model_id")}</span>
                        <input
                            className="search-input modal-form-control"
                            value={editingProfile.model}
                            onChange={(e) => setEditingProfile({ ...editingProfile, model: e.target.value })}
                            placeholder="gpt-4o"
                        />
                    </label>
                </div>
                <div className="modal-field-row modal-form-toggle-row">
                    <span style={{ fontSize: 'var(--font-size-base)', fontWeight: 600 }}>{t("ai_thinking_enabled")}</span>
                    <label className="switch">
                        <input
                            className="cb"
                            type="checkbox"
                            checked={editingProfile.enableThinking}
                            onChange={(e) => setEditingProfile({ ...editingProfile, enableThinking: e.target.checked })}
                        />
                        <div className="toggle"><div className="left" /><div className="right" /></div>
                    </label>
                </div>
                <div className="modal-form-actions split">
                    <button type="button" className="modal-button" onClick={onClose}>{t("cancel")}</button>
                    <button type="button" className="modal-button primary" onClick={() => onSave(editingProfile)}>
                        {t("ai_save_profile")}
                    </button>
                </div>
            </>
        )}
    </AppModal>
);

export default AiProfileModal;
