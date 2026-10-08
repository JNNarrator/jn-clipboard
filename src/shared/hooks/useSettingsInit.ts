import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { DEFAULT_THEME, normalizeThemeId } from "../config/themes";
import type { Locale } from "../types";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { formatError } from "../lib/errorMessage";

interface UseSettingsInitOptions {
  setAppSettings: (settings: Record<string, string>) => void;
  setHotkey: (val: string) => void;
  setTheme: (val: string) => void;
  setColorMode: (val: string) => void;
  setCompactMode: (val: boolean) => void;
  setLanguage: (val: Locale) => void;
}

export const useSettingsInit = ({
  setAppSettings,
  setHotkey,
  setTheme,
  setColorMode,
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

          setAppSettings(result);
          if (result["app.hotkey"]) setHotkey(result["app.hotkey"]);

          const loadedTheme = normalizeThemeId(result["app.theme"] || DEFAULT_THEME);
          const loadedColorMode = result["app.color_mode"] || "system";
          console.log("[THEME DEBUG] loadedColorMode:", loadedColorMode);

          setTheme(loadedTheme);
          setColorMode(loadedColorMode);
          setCompactMode(result["app.compact_mode"] === "true");

          try {
            localStorage.setItem("tiez_theme", loadedTheme);
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

          setSettings(result);
        })
        .catch((error) => {
          if (disposed) return;
          console.error("Settings initialization failed", error);
          void message("无法读取设置。原始数据已保留，请检查原设备密钥或系统钥匙串权限，再重新启动。\n" + formatError(error), { title: "TieZ：设置读取失败", kind: "error" });
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
  }, [setAppSettings, setHotkey, setTheme, setColorMode, setCompactMode, setLanguage]);

  return settings;
};
