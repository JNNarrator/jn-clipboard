import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ComponentType, ReactNode } from "react";
import { openedSettingsFromHere, requestMacAccessibility } from "../../../../shared/lib/macAccessibility";

interface LabelWithHintProps {
  label: string;
  hint?: string | ReactNode;
  hintKey: string;
}

interface MacAccessibilityPermissionProps {
  t: (key: string) => string;
  LabelWithHint: ComponentType<LabelWithHintProps>;
}

const MacAccessibilityPermission = ({ t, LabelWithHint }: MacAccessibilityPermissionProps) => {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  // Flips once the user has been to System Settings and come back, so the row
  // can point at the usual cause instead of repeating the same warning.
  const [needsReset, setNeedsReset] = useState(false);
  const [binaryPath, setBinaryPath] = useState("");

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const [ok, path] = await Promise.all([
        // settle: re-read the grant after System Settings rather than trust an
        // answer captured before the user flipped the switch.
        invoke<boolean>("check_macos_permissions", { settle: true }),
        invoke<string>("get_macos_accessibility_binary_path")
      ]);
      setGranted(ok);
      setBinaryPath(path);
      setNeedsReset(!ok && openedSettingsFromHere());
    } catch {
      setGranted(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);

    let disposeFocus: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) void refresh();
      })
      .then((unlisten) => {
        disposeFocus = unlisten;
      })
      .catch(() => undefined);

    return () => {
      window.clearInterval(interval);
      disposeFocus?.();
    };
  }, [refresh]);

  const openSettings = async () => {
    await requestMacAccessibility().catch(console.error);
    await refresh();
  };

  const copyBinaryPath = async () => {
    if (!binaryPath) return;
    try {
      await navigator.clipboard.writeText(binaryPath);
    } catch {
      console.error("Failed to copy accessibility binary path");
    }
  };

  return (
    <div className="setting-item column">
      <div className="setting-item-heading">
        <LabelWithHint
          label={t("accessibility_permission")}
          hint={t("accessibility_permission_hint")}
          hintKey="accessibility_permission"
        />
        {checking ? (
          <span className="settings-permission-state">
            {t("accessibility_permission_checking")}
          </span>
        ) : granted ? (
          <span className="settings-permission-state is-granted">
            {t("accessibility_permission_granted")}
          </span>
        ) : (
          <button
            type="button"
            className="settings-action-button settings-action-button--small"
            onClick={() => {
              void openSettings();
            }}
          >
            {t("accessibility_go_authorize")}
          </button>
        )}
      </div>

      {!checking && !granted && (
        <div className="settings-permission-steps">
          <div>{t("accessibility_permission_steps")}</div>
          {needsReset && (
            <div className="settings-permission-warning">
              {t("accessibility_reset_hint")}
            </div>
          )}
          {binaryPath && (
            <div className="settings-permission-binary">
              <span>{t("accessibility_permission_binary")}</span>
              <code>{binaryPath}</code>
              <button
                type="button"
                className="settings-link-button"
                onClick={() => {
                  void copyBinaryPath();
                }}
              >
                {t("accessibility_copy_binary")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MacAccessibilityPermission;
