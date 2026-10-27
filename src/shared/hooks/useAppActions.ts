import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface UseAppActionsOptions {
  t: (key: string) => string;
  cloudSyncEnabled: boolean;
  openConfirm: (opts: { title: string; message: string; danger?: boolean; onConfirm: () => void }) => void;
  closeConfirm: () => void;
  pushToast: (msg: string, duration?: number) => number;
  fetchHistory: (reset?: boolean) => Promise<void>;
}

export const useAppActions = ({
  t,
  cloudSyncEnabled,
  openConfirm,
  closeConfirm,
  pushToast,
  fetchHistory
}: UseAppActionsOptions) => {
  const clearHistory = useCallback(() => {
    openConfirm({
      title: t("clear_confirm_title"),
      message: t("clear_confirm_message"),
      danger: true,
      onConfirm: async () => {
        try {
          await invoke("clear_clipboard_history");
          fetchHistory(true);
        } catch (err) {
          console.error("清空失败", err);
          pushToast(t("clear_history_failed") + String(err), 4000);
        }
        closeConfirm();
      }
    });
  }, [closeConfirm, fetchHistory, openConfirm, pushToast, t]);

  const handleResetSettings = useCallback(() => {
    openConfirm({
      title: t("reset_defaults"),
      message: t("reset_confirm"),
      danger: true,
      onConfirm: async () => {
        try {
          await invoke("reset_settings");
          window.location.reload();
        } catch (err) {
          const errorMsg = t("reset_failed") + (err?.toString() || "");
          pushToast(errorMsg, 3000);
        }
        closeConfirm();
      }
    });
  }, [closeConfirm, openConfirm, pushToast, t]);

  const saveCloudSync = useCallback(
    async (key: string, value: string) => {
      try {
        if (key === "cloud_sync_enabled" && value === "false") {
          await invoke("stop_cloud_sync_client");
        }
        await invoke("save_setting", { key, value });
        const cloudKeys = [
          "cloud_sync_enabled",
          "cloud_sync_auto",
          "cloud_sync_provider",
          "cloud_sync_server",
          "cloud_sync_api_key",
          "cloud_sync_interval_sec",
          "cloud_sync_snapshot_interval_min",
          "cloud_sync_webdav_url",
          "cloud_sync_webdav_username",
          "cloud_sync_webdav_password",
          "cloud_sync_webdav_base_path",
          "cloud_sync_content_prefs"
        ];
        if (key === "cloud_sync_enabled") {
          if (value !== "false") {
            await invoke("restart_cloud_sync_client");
          }
        } else if (cloudKeys.includes(key) && cloudSyncEnabled) {
          await invoke("restart_cloud_sync_client");
        }
      } catch (err) {
        console.error("Cloud sync setting save failed", err);
      }
    },
    [cloudSyncEnabled]
  );

  return { saveCloudSync, clearHistory, handleResetSettings };
};
