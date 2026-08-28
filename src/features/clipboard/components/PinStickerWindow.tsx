import React, { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  Copy,
  Download,
  RotateCw,
  FlipHorizontal,
  Pin,
  PinOff,
  RotateCcw,
  X,
  Check,
} from "lucide-react";
import { translations } from "../../../locales";
import type { Locale } from "../../../shared/types";

export const PinStickerWindow: React.FC = () => {
  const language = (localStorage.getItem("tiez_language") || "zh") as Locale;
  const t = useCallback(
    (key: keyof (typeof translations)["zh"]) => {
      return (translations[language] && (translations[language] as any)[key]) || (translations.zh as any)[key] || key;
    },
    [language]
  );
  const params = new URLSearchParams(window.location.search);
  const rawSrc = params.get("src") || "";

  const [zoom, setZoom] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [flipped, setFlipped] = useState<boolean>(false);
  const [opacity, setOpacity] = useState<number>(1.0);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [imageError, setImageError] = useState<boolean>(false);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 1200);
  }, []);

  const handleClose = useCallback(async () => {
    try {
      const currentWindow = getCurrentWebviewWindow();
      await currentWindow.close();
    } catch (err) {
      console.error("Failed to close pin sticker window:", err);
    }
  }, []);

  const handleToggleAlwaysOnTop = useCallback(async () => {
    try {
      const currentWindow = getCurrentWebviewWindow();
      const nextState = !isAlwaysOnTop;
      await currentWindow.setAlwaysOnTop(nextState);
      setIsAlwaysOnTop(nextState);
      showToast(nextState ? "📌 Always On Top" : "📌 Normal Layer");
    } catch (err) {
      console.error("Failed to set always on top:", err);
    }
  }, [isAlwaysOnTop, showToast]);

  const handleReset = useCallback(() => {
    setZoom(1.0);
    setRotation(0);
    setFlipped(false);
    setOpacity(1.0);
    showToast("1:1 Reset");
  }, [showToast]);

  const handleCopyImage = useCallback(async () => {
    if (!imgRef.current) return;
    try {
      const canvas = document.createElement("canvas");
      const img = imgRef.current;
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(async (blob) => {
          if (blob) {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob }),
            ]);
            setCopied(true);
            showToast(t("sticker_copied") || "已复制图片到剪贴板");
            setTimeout(() => setCopied(false), 1500);
          }
        }, "image/png");
      }
    } catch (err) {
      console.error("Failed to copy image to clipboard:", err);
    }
  }, [showToast, t]);

  const handleSaveImage = useCallback(async () => {
    try {
      const defaultFileName = `sticker_${Date.now()}.png`;
      const targetPath = await saveDialog({
        defaultPath: defaultFileName,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });

      if (!targetPath) return;

      // If rawSrc is a local file path (asset:// or /...), copy the file
      if (rawSrc.startsWith("asset://") || rawSrc.startsWith("/")) {
        let cleanSource = rawSrc;
        if (cleanSource.startsWith("asset://localhost/")) {
          cleanSource = "/" + cleanSource.substring("asset://localhost/".length);
        } else if (cleanSource.startsWith("asset://")) {
          cleanSource = cleanSource.substring("asset://".length);
        }
        await invoke("save_file_copy", {
          sourcePath: decodeURIComponent(cleanSource),
          targetPath,
        });
        showToast(t("save_image_success") || "图片保存成功");
        return;
      }

      // If data URI or blob, write via canvas
      if (imgRef.current) {
        const canvas = document.createElement("canvas");
        const img = imgRef.current;
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(async (blob) => {
            if (blob) {
              const arrayBuffer = await blob.arrayBuffer();
              const bytes = Array.from(new Uint8Array(arrayBuffer));
              await invoke("write_binary_file", { path: targetPath, contents: bytes }).catch(async () => {
                // Fallback to fetch / standard write
                const a = document.createElement("a");
                a.href = canvas.toDataURL("image/png");
                a.download = defaultFileName;
                a.click();
              });
              showToast(t("save_image_success") || "图片保存成功");
            }
          });
        }
      }
    } catch (err) {
      console.error("Failed to save image:", err);
      showToast(t("save_image_failed") || "图片保存失败");
    }
  }, [rawSrc, showToast, t]);

  // Handle Wheel: Zoom or Opacity
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.shiftKey) {
      // Shift + Scroll: Opacity
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setOpacity((prev) => {
        const next = Math.min(Math.max(Number((prev + delta).toFixed(2)), 0.2), 1.0);
        showToast(`🌓 ${Math.round(next * 100)}%`);
        return next;
      });
    } else {
      // Normal Scroll: Zoom
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((prev) => {
        const next = Math.min(Math.max(Number((prev + delta).toFixed(2)), 0.2), 5.0);
        showToast(`🔍 ${Math.round(next * 100)}%`);
        return next;
      });
    }
  };

  // Window drag handler
  const handleMouseDown = async (e: React.MouseEvent) => {
    // Only drag on left click and not on interactive buttons
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest(".pin-sticker-toolbar")) {
      return;
    }
    try {
      const currentWindow = getCurrentWebviewWindow();
      await currentWindow.startDragging();
    } catch (err) {
      console.error("Failed to start dragging sticker:", err);
    }
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        handleReset();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleCopyImage();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveImage();
      } else if (e.key === "1") {
        setOpacity(0.25);
        showToast("🌓 25%");
      } else if (e.key === "2") {
        setOpacity(0.5);
        showToast("🌓 50%");
      } else if (e.key === "3") {
        setOpacity(0.75);
        showToast("🌓 75%");
      } else if (e.key === "4") {
        setOpacity(1.0);
        showToast("🌓 100%");
      } else if (e.key === "r" || e.key === "R") {
        setRotation((prev) => (prev + 90) % 360);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, handleCopyImage, handleReset, handleSaveImage, showToast]);

  return (
    <div
      className="pin-sticker-root"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest("button") && !target.closest(".pin-sticker-toolbar")) {
          handleClose();
        }
      }}
    >
      <div
        className={`pin-sticker-shell ${isAlwaysOnTop ? "always-on-top" : ""}`}
        style={{ opacity }}
      >
        {/* Floating Toast Notification */}
        {toastMessage && <div className="pin-sticker-toast">{toastMessage}</div>}

        {/* Sticker Image Viewport */}
        <div className="pin-sticker-image-wrapper">
          {imageError ? (
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "12px", textAlign: "center", padding: "16px" }}>
              图片无法加载
            </div>
          ) : (
            <img
              ref={imgRef}
              src={rawSrc}
              alt="Pinned Sticker"
              className="pin-sticker-img"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg) scaleX(${flipped ? -1 : 1})`,
              }}
              draggable={false}
              onError={() => setImageError(true)}
            />
          )}
        </div>

        {/* Floating Action Toolbar on Hover */}
        <div className="pin-sticker-toolbar" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="pin-sticker-btn"
            onClick={handleCopyImage}
            title={t("copy") || "复制图片 (Ctrl+C)"}
          >
            {copied ? <Check size={14} style={{ color: "#10b981" }} /> : <Copy size={14} />}
          </button>

          <button
            type="button"
            className="pin-sticker-btn"
            onClick={handleSaveImage}
            title={t("save_image") || "保存图片 (Ctrl+S)"}
          >
            <Download size={14} />
          </button>

          <div className="pin-sticker-divider" />

          <button
            type="button"
            className="pin-sticker-btn"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            title={t("rotate_image") || "顺时针旋转 90° (R)"}
          >
            <RotateCw size={14} />
          </button>

          <button
            type="button"
            className={`pin-sticker-btn ${flipped ? "active" : ""}`}
            onClick={() => setFlipped((f) => !f)}
            title={t("flip_image") || "水平镜像翻转"}
          >
            <FlipHorizontal size={14} />
          </button>

          <button
            type="button"
            className={`pin-sticker-btn ${isAlwaysOnTop ? "active" : ""}`}
            onClick={handleToggleAlwaysOnTop}
            title={t("always_on_top") || "切换始终置顶"}
          >
            {isAlwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
          </button>

          <button
            type="button"
            className="pin-sticker-btn"
            onClick={handleReset}
            title={t("reset_view") || "重置缩放与角度 (Space)"}
          >
            <RotateCcw size={14} />
          </button>

          <div className="pin-sticker-divider" />

          <button
            type="button"
            className="pin-sticker-btn danger"
            onClick={handleClose}
            title={t("close_sticker") || "关闭贴图 (Esc / 双击)"}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PinStickerWindow;
