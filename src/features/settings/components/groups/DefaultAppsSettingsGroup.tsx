import { ChevronDown, ChevronRight } from "lucide-react";
import type { DefaultAppsMap, InstalledAppOption } from "../../../app/types";

interface DefaultAppsSettingsGroupProps {
    t: (key: string) => string;
    collapsed: boolean;
    onToggle: () => void;
    installedApps: InstalledAppOption[];
    appSettings: Record<string, string>;
    defaultApps: DefaultAppsMap;
    setShowAppSelector: (val: string | null) => void;
}

const DefaultAppsSettingsGroup = ({
    t,
    collapsed,
    onToggle,
    installedApps,
    appSettings,
    defaultApps,
    setShowAppSelector
}: DefaultAppsSettingsGroupProps) => {
    const APP_TYPES = ['text', 'rich_text', 'image', 'video', 'code', 'url'] as const;
    const getAppDisplayName = (path: string) => {
        const filename = path.split(/[/\\]/).pop() || path;
        return filename.replace(/\.(exe|app)$/i, "");
    };

    const getTypeName = (type: string) => {
        switch (type) {
            case "code": return t('type_code');
            case "link":
            case "url": return t('type_url');
            case "file": return t('type_file');
            case "image": return t('type_image');
            case "video": return t('type_video');
            case "rich_text": return t('type_rich_text');
            default: return t('type_text');
        }
    };

    return (
        <div className={`settings-group ${collapsed ? 'collapsed' : ''}`}>
            <button type="button" className="group-header" aria-expanded={!collapsed} onClick={onToggle}>
                <h3>{t('default_apps')}</h3>
                {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
            {!collapsed && (
                <div className="group-content">
                    {APP_TYPES.map((type) => (
                        <div key={type} className="setting-item">
                            <div className="item-label-group">
                                <span className="item-label">{getTypeName(type)}</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowAppSelector(type)}
                                className="settings-picker-button"
                                title={t('change_app')}
                                aria-label={`${getTypeName(type)} · ${t('change_app')}`}
                            >
                                <span className="settings-picker-value">
                                {appSettings[`app.${type}`]
                                    ? (() => {
                                        const path = appSettings[`app.${type}`];
                                        // Try to find friendly name from installed apps list
                                        const found = installedApps.find(app => app.value === path);
                                        if (found) return found.label;
                                        // Fallback: extract a readable app name from the path
                                        return getAppDisplayName(path);
                                    })()
                                    : (defaultApps[type] ? `${t('system_default')} (${getAppDisplayName(defaultApps[type])})` : t('not_configured'))}
                                </span>
                                <ChevronRight size={14} aria-hidden="true" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default DefaultAppsSettingsGroup;
