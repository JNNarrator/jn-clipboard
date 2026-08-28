import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./styles/components/index.css";
import "./styles/themes/load";

const params = new URLSearchParams(window.location.search);
const isCompactPreview = params.get("window") === "compact-preview";
const isAdvancedSettingsWindow = params.get("window") === "advanced-settings";
const isPinSticker = params.get("window") === "pin-sticker";
const RootComponent = isCompactPreview
  ? lazy(() => import("./features/clipboard/components/CompactPreviewWindow"))
  : isAdvancedSettingsWindow
    ? lazy(() => import("./features/settings/components/AdvancedSettingsWindow"))
    : isPinSticker
      ? lazy(() => import("./features/clipboard/components/PinStickerWindow"))
      : lazy(() => import("./App"));
const isMacPlatform =
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform);

if (isMacPlatform) {
  document.documentElement.classList.add("platform-macos");
  document.body.classList.add("platform-macos");
} else {
  document.documentElement.classList.add("platform-windows");
  document.body.classList.add("platform-windows");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <RootComponent />
    </Suspense>
  </React.StrictMode>,
);
