import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardPaste, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface WebCaptureBarProps {
  t: (key: string) => string;
}

/** Read the first image off a clipboard payload as a data URL, if there is one. */
function imageDataUrlFromClipboard(data: DataTransfer | null): Promise<string | null> {
  if (!data) return Promise.resolve(null);
  const file = Array.from(data.files).find((candidate) => candidate.type.startsWith("image/"));
  if (!file) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Entry point for the web build.
 *
 * A page cannot watch the clipboard the way the desktop app does, so capture is
 * explicit: type or paste here, or pull the current clipboard contents with one
 * click. Images pasted into the field are stored as data URLs, which the list
 * already knows how to render.
 */
export default function WebCaptureBar({ t }: WebCaptureBarProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to a ceiling, so long clips stay fully visible.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [value]);

  const capture = useCallback(
    async (content: string, contentType = "text") => {
      if (!content.trim()) {
        setError(t("capture_empty"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await invoke("web_capture_entry", { content, contentType });
        setValue("");
      } catch (err) {
        console.error("[web] capture failed", err);
        setError(t("capture_failed"));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const readClipboard = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Images first: `readText` succeeds on an image clipboard and returns "",
      // which would report "nothing to add" for a perfectly good screenshot.
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith("image/"));
          if (!imageType) continue;
          const blob = await item.getType(imageType);
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          await capture(dataUrl, "image");
          return;
        }
      }
      await capture(await navigator.clipboard.readText());
    } catch (err) {
      console.warn("[web] clipboard read rejected", err);
      setError(t("capture_empty"));
      setBusy(false);
    }
  }, [capture, t]);

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const image = await imageDataUrlFromClipboard(event.clipboardData);
      if (!image) return;
      event.preventDefault();
      await capture(image, "image");
    },
    [capture],
  );

  return (
    <section className="web-capture" aria-label={t("capture_title")}>
      <textarea
        ref={textareaRef}
        className="web-capture-input"
        value={value}
        rows={1}
        placeholder={t("capture_placeholder")}
        onChange={(event) => setValue(event.target.value)}
        onPaste={handlePaste}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void capture(value);
          }
        }}
      />
      <div className="web-capture-actions">
        <button
          type="button"
          className="web-capture-button"
          disabled={busy}
          onClick={() => void capture(value)}
        >
          <Plus size={15} />
          {t("capture_button")}
        </button>
        <button
          type="button"
          className="web-capture-button ghost"
          disabled={busy}
          onClick={() => void readClipboard()}
          title={t("capture_hint")}
        >
          <ClipboardPaste size={15} />
          {t("capture_from_clipboard")}
        </button>
      </div>
      {error && <p className="web-capture-error">{error}</p>}
    </section>
  );
}
