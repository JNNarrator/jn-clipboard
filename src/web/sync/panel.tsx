import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { SettingSwitch } from "../../features/settings/components/SettingControls";
import { LabelWithHint } from "../../features/settings/components/SettingsHint";
import { formatError } from "../../shared/lib/errorMessage";
import { syncNow, type SyncOutcome } from "./engine";
import { notifyIfChanged } from "./notify";
import { readToken } from "./token";

/** Both keys are device-private, so the sync server rejects them on push. */
const ENABLED_KEY = "web.sync_enabled";
const SERVER_KEY = "web.sync_base_url";

interface WebSyncPanelProps {
  t: (key: string) => string;
  collapsed: boolean;
  onToggle: () => void;
}

function defaultBaseUrl(): string {
  if (typeof window === "undefined") return "";
  // JNClub serves the sync API (`/api/clipboard/...`) and the SSO client
  // endpoint (`/sso/login`) under one prefix, so a single base URL covers both.
  // Override at build time when the deployment mounts it elsewhere.
  return import.meta.env.VITE_JNCLUB_BASE_URL ?? `${window.location.origin}/jnclub`;
}

/**
 * Where this page lives, so the SSO client can send the browser back here
 * instead of to the JNClub app. `/clipboard/` when built with a base path.
 */
function selfPath(): string {
  return import.meta.env.BASE_URL || "/";
}

/**
 * Cross-device sync settings for the web build.
 *
 * The desktop app reaches WebDAV through Rust; a browser has no such layer, so
 * this talks to the JNClub sync API directly and authenticates with the
 * `jn-token` the surrounding site already put in localStorage.
 */
export default function WebSyncPanel({ t, collapsed, onToggle }: WebSyncPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl());
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const refreshToken = useCallback(() => setToken(readToken()), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = (await invoke("get_settings")) as Record<string, string>;
      if (cancelled) return;
      setEnabled(settings[ENABLED_KEY] === "true");
      setBaseUrl(settings[SERVER_KEY] || defaultBaseUrl());
      refreshToken();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  // Another tab may finish the SSO round trip while this one is sitting open.
  useEffect(() => {
    window.addEventListener("focus", refreshToken);
    return () => window.removeEventListener("focus", refreshToken);
  }, [refreshToken]);

  const save = (key: string, value: string) => {
    void invoke("save_setting", { key, value });
  };

  const runSync = async () => {
    const activeToken = readToken();
    setToken(activeToken);
    if (!activeToken) {
      setError(t("web_sync_sign_in_required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await syncNow({ baseUrl, token: activeToken });
      notifyIfChanged(result);
      setOutcome(result);
      setLastSyncAt(Date.now());
      if (result.conflicts > 0) setError(`${t("web_sync_conflicts")}: ${result.conflicts}`);
    } catch (syncError) {
      setError(formatError(syncError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`settings-group ${collapsed ? "collapsed" : ""}`}>
      <button type="button" className="group-header" aria-expanded={!collapsed} onClick={onToggle}>
        <div className="group-header-title">
          <h3>{t("web_sync_settings")}</h3>
        </div>
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
      </button>
      {!collapsed && (
        <div className="group-content">
          <div className="setting-item">
            <LabelWithHint
              label={t("web_sync_enable")}
              hint={t("web_sync_enable_hint")}
              hintKey="web_sync_enable"
            />
            <SettingSwitch
              checked={enabled}
              onChange={(event) => {
                const next = event.target.checked;
                setEnabled(next);
                save(ENABLED_KEY, String(next));
                if (next) void runSync();
              }}
            />
          </div>

          <div className="setting-item">
            <LabelWithHint
              label={t("web_sync_server")}
              hint={t("web_sync_server_hint")}
              hintKey="web_sync_server"
            />
            <input
              className="search-input settings-field"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              onBlur={() => save(SERVER_KEY, baseUrl.trim())}
              placeholder="https://example.com"
              spellCheck={false}
            />
          </div>

          <div className="setting-item">
            <LabelWithHint
              label={t("web_sync_account")}
              hint={t("web_sync_account_hint")}
              hintKey="web_sync_account"
            />
            {token ? (
              <span className="settings-badge">{t("web_sync_signed_in")}</span>
            ) : (
              <button
                type="button"
                className="settings-action-button"
                onClick={() =>
                  window.open(
                    `${baseUrl.replace(/\/+$/u, "")}/sso/login?web_path=${encodeURIComponent(selfPath())}`,
                    "_blank",
                    "noopener",
                  )
                }
              >
                {t("web_sync_sign_in")}
              </button>
            )}
          </div>

          <div className="setting-item">
            <div className="item-label-group">
              <span className="item-label">{t("web_sync_actions")}</span>
            </div>
            <button
              type="button"
              className="settings-action-button"
              disabled={busy}
              onClick={() => void runSync()}
            >
              {busy ? t("web_sync_syncing") : t("web_sync_now")}
            </button>
          </div>

          <h4 className="settings-section-title">{t("settings_section_status")}</h4>
          <div className="settings-panel">
            <div className="settings-panel-caption">{t("web_sync_status")}</div>
            <div className="settings-panel-row">
              <span>{enabled ? t("web_sync_on") : t("web_sync_off")}</span>
              <span>
                {t("web_sync_pushed")}: {outcome?.pushed ?? 0}
              </span>
              <span>
                {t("web_sync_pulled")}: {outcome?.pulled ?? 0}
              </span>
            </div>
            <div className="settings-panel-meta">
              {t("web_sync_last_sync")}:{" "}
              {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : t("web_sync_never")}
            </div>
            {error && <div className="settings-panel-meta is-error">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
