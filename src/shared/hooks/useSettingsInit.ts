import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { DEFAULT_THEME, migrateThemeSettings, resolveThemeAppearance } from "../config/themes";
import type { Locale } from "../types";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { formatError } from "../lib/errorMessage";

// Secrets this device can't decrypt (another Windows account or computer, a
// missing key file). They no longer block every setting; say once per run
// which ones to re-enter. Keys from database::SENSITIVE_KEYS.
const SECRET_LABELS: Record<Locale, Record<string, string>> = {
  zh: {
    mqtt_password: "验证码同步的账号和密码",
    mqtt_username: "验证码同步的账号和密码",
    cloud_sync_webdav_password: "云端同步的 WebDAV 密码",
    cloud_sync_api_key: "云端同步的 API 密钥",
    ai_profiles: "AI 助手的服务配置",
    e2e_key: "端到端加密密钥",
  },
  tw: {
    mqtt_password: "驗證碼同步的帳號和密碼",
    mqtt_username: "驗證碼同步的帳號和密碼",
    cloud_sync_webdav_password: "雲端同步的 WebDAV 密碼",
    cloud_sync_api_key: "雲端同步的 API 金鑰",
    ai_profiles: "AI 助手的服務設定",
    e2e_key: "端對端加密金鑰",
  },
  en: {
    mqtt_password: "the verification-code sync account and password",
    mqtt_username: "the verification-code sync account and password",
    cloud_sync_webdav_password: "the cloud sync WebDAV password",
    cloud_sync_api_key: "the cloud sync API key",
    ai_profiles: "the AI assistant providers",
    e2e_key: "the end-to-end encryption key",
  },
};
let undecryptableNoticeShown = false;

const noticeUndecryptableSecrets = async (language: Locale) => {
  if (undecryptableNoticeShown) return;
  const keys = await invoke<string[]>("get_undecryptable_settings").catch(() => [] as string[]);
  if (keys.length === 0) return;
  undecryptableNoticeShown = true;
  const labels = SECRET_LABELS[language] ?? SECRET_LABELS.zh;
  const items = [...new Set(keys.map((key) => labels[key] ?? key))];
  const text = language === "en"
    ? `This computer can't read ${items.join(", ")}. Please enter it again in Settings. Everything else is unaffected.`
    : language === "tw"
      ? `這台電腦無法讀取${items.join("、")}，請在設定中重新填寫。其他設定不受影響。`
      : `这台电脑无法读取${items.join("、")}，请在设置中重新填写。其他设置不受影响。`;
  const title = language === "en" ? "Re-enter a password" : language === "tw" ? "需要重新填寫" : "需要重新填写";
  await message(text, { title, kind: "warning" });
};

interface UseSettingsInitOptions {
  setAppSettings: (settings: Record<string, string>) => void;
  setHotkey: (val: string) => void;
  setTheme: (val: string) => void;
  setColorMode: (val: string) => void;
  setNativePalette: (val: string) => void;
  setCompactMode: (val: boolean) => void;
  setLanguage: (val: Locale) => void;
}

export const useSettingsInit = ({
  setAppSettings,
  setHotkey,
  setTheme,
  setColorMode,
  setNativePalette,
  setCompactMode,
  setLanguage
}: UseSettingsInitOptions) => {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const settingsEffectCount = useRef(0);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;

    const loadSettings = () => {
      settingsEffectCount.current++;
      console.log(`[THEME DEBUG] Settings useEffect run #${settingsEffectCount.current}`);

      invoke<Record<string, string>>("get_settings")
        .then((result) => {
          if (disposed) return;

          console.log("[THEME DEBUG] app.color_mode from DB:", result["app.color_mode"]);

          const migrated = migrateThemeSettings(result);
          if (migrated !== result) {
            // Save the palette first so an interrupted migration can safely retry.
            void invoke("save_setting", { key: "app.native_palette", value: "sakura" })
              .then(() => invoke("save_setting", { key: "app.theme", value: migrated["app.theme"] }))
              .catch(error => console.error("Theme migration failed", error));
          }
          setAppSettings(migrated);
          void noticeUndecryptableSecrets((result["app.language"] as Locale) || "zh");
          if (result["app.hotkey"]) setHotkey(result["app.hotkey"]);

          const { theme: loadedTheme, nativePalette } = resolveThemeAppearance(migrated["app.theme"] || DEFAULT_THEME, migrated["app.native_palette"]);
          const loadedColorMode = result["app.color_mode"] || "system";
          console.log("[THEME DEBUG] loadedColorMode:", loadedColorMode);

          setTheme(loadedTheme);
          setNativePalette(nativePalette);
          setColorMode(loadedColorMode);
          setCompactMode(result["app.compact_mode"] === "true");

          try {
            localStorage.setItem("tiez_theme", loadedTheme);
            localStorage.setItem("tiez_native_palette", nativePalette);
            localStorage.setItem("tiez_color_mode", loadedColorMode);
            localStorage.setItem(
              "tiez_compact_mode",
              result["app.compact_mode"] === "true" ? "true" : "false"
            );
          } catch {
            // Ignore localStorage errors
          }

          if (result["app.language"]) {
            setLanguage(result["app.language"] as Locale);
            try {
              localStorage.setItem("tiez_language", result["app.language"]);
            } catch {
              // Ignore localStorage errors
            }
          }

          setSettings(migrated);
        })
        .catch((error) => {
          if (disposed) return;
          console.error("Settings initialization failed", error);
          void message("设置读取失败，原数据已保留。\n请检查原设备密钥或钥匙串权限。\n然后重新启动应用。\n" + formatError(error), { title: "设置异常", kind: "error" });
        });
    };

    loadSettings();

    const unlisten = listen("settings-changed", () => {
      loadSettings();
    });

    return () => {
      disposed = true;
      unlisten.then((off) => off());
    };
  }, [setAppSettings, setHotkey, setTheme, setColorMode, setNativePalette, setCompactMode, setLanguage]);

  return settings;
};
