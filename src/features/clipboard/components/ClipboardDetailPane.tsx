import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { EyeOff } from "lucide-react";
import type { ClipboardEntry } from "../../../shared/types";
import HtmlContent from "../../../shared/components/HtmlContent";
import { toTauriLocalImageSrc } from "../../../shared/lib/localImageSrc";
import { getSourceAppIcon, peekSourceAppIcon } from "../../../shared/lib/sourceAppIcon";
import { getTextStats } from "../../../shared/lib/textStats";
import { isTauriRuntime } from "../../../shared/lib/tauriRuntime";

interface ClipboardDetailPaneProps {
  item: ClipboardEntry | null;
  t: (key: string) => string;
  language: string;
  isSensitiveHidden: boolean;
  showSourceAppIcon: boolean;
}

// The list receives at most ~2000 characters per entry; the pane fetches the
// full text once and keeps a small cache so hovering back and forth is instant.
const LIST_CONTENT_LIMIT = 1990;
const MAX_DISPLAY_CHARS = 100_000;
const fullContentCache = new Map<number, string>();

const TEXT_TYPES = new Set(["text", "code", "url", "link"]);

const typeLabelKey = (type: string) => {
  switch (type) {
    case "code": return "type_code";
    case "link":
    case "url": return "type_url";
    case "file": return "type_file";
    case "image": return "type_image";
    case "video": return "type_video";
    case "rich_text": return "type_rich_text";
    default: return "type_text";
  }
};

const localeFor = (language: string) =>
  language === "en" ? "en-US" : language === "tw" ? "zh-TW" : "zh-CN";

const mediaSrc = (item: ClipboardEntry) =>
  item.content.startsWith("data:")
    ? item.content
    : toTauriLocalImageSrc(item.content) || (item.is_external ? convertFileSrc(item.content) : item.content);

const useFullContent = (item: ClipboardEntry | null, enabled: boolean) => {
  const [fetched, setFetched] = useState<{ id: number; text: string } | null>(null);
  const needsFetch = !!item && enabled && TEXT_TYPES.has(item.content_type)
    && item.content.length >= LIST_CONTENT_LIMIT && isTauriRuntime();

  useEffect(() => {
    if (!item || !needsFetch) return;
    const cached = fullContentCache.get(item.id);
    if (cached !== undefined) {
      setFetched({ id: item.id, text: cached });
      return;
    }
    let alive = true;
    invoke<string>("get_clipboard_content", { id: item.id })
      .then((text) => {
        if (fullContentCache.size >= 50) {
          const oldest = fullContentCache.keys().next().value;
          if (oldest !== undefined) fullContentCache.delete(oldest);
        }
        fullContentCache.set(item.id, text);
        if (alive) setFetched({ id: item.id, text });
      })
      .catch(() => { /* keep showing the list's copy */ });
    return () => {
      alive = false;
    };
  }, [item, needsFetch]);

  if (!item) return "";
  return fetched?.id === item.id ? fetched.text : item.content;
};

const InfoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="detail-info-row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

const ClipboardDetailPane = ({ item, t, language, isSensitiveHidden, showSourceAppIcon }: ClipboardDetailPaneProps) => {
  const text = useFullContent(item, !isSensitiveHidden);
  const [imageSize, setImageSize] = useState<{ id: number; w: number; h: number } | null>(null);
  const [appIcon, setAppIcon] = useState<string | null>(null);

  const sourcePath = item?.source_app_path?.trim() || null;
  useEffect(() => {
    if (!showSourceAppIcon || !sourcePath) {
      setAppIcon(null);
      return;
    }
    const cached = peekSourceAppIcon(sourcePath);
    if (cached !== undefined) {
      setAppIcon(cached ?? null);
      return;
    }
    let alive = true;
    setAppIcon(null);
    void getSourceAppIcon(sourcePath).then((icon) => {
      if (alive) setAppIcon(icon);
    });
    return () => {
      alive = false;
    };
  }, [sourcePath, showSourceAppIcon]);

  const isText = !!item && (TEXT_TYPES.has(item.content_type) || item.content_type === "rich_text");
  const stats = useMemo(() => (isText && !isSensitiveHidden ? getTextStats(text) : null), [isText, isSensitiveHidden, text]);
  const filePaths = useMemo(
    () => (item?.content_type === "file" ? item.content.split("\n").map((p) => p.trim()).filter(Boolean) : []),
    [item]
  );

  if (!item) {
    return <div className="detail-empty">{t("detail_empty")}</div>;
  }

  const locale = localeFor(language);
  const formatTime = (ms?: number) => (ms ? new Date(ms).toLocaleString(locale) : "");
  const copiedAt = item.created_at || item.timestamp;
  const displayText = text.length > MAX_DISPLAY_CHARS ? text.slice(0, MAX_DISPLAY_CHARS) : text;

  let preview: ReactNode;
  if (isSensitiveHidden) {
    preview = (
      <div className="detail-sensitive">
        <EyeOff size={20} />
        <span>{t("detail_sensitive_hidden")}</span>
      </div>
    );
  } else if (item.content_type === "image") {
    preview = (
      <img
        className="detail-image"
        src={mediaSrc(item)}
        alt={t("image_preview")}
        draggable={false}
        decoding="async"
        onLoad={(e) => setImageSize({ id: item.id, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
    );
  } else if (item.content_type === "video") {
    preview = <video className="detail-image" src={mediaSrc(item)} controls muted preload="metadata" />;
  } else if (item.content_type === "file") {
    preview = (
      <ul className="detail-files">
        {filePaths.map((path) => (
          <li key={path}>
            <strong>{path.split(/[\\/]/).pop() || path}</strong>
            <span>{path}</span>
          </li>
        ))}
      </ul>
    );
  } else if (item.content_type === "rich_text" && item.html_content) {
    preview = <HtmlContent htmlContent={item.html_content} fallbackText={item.content} className="detail-rich" />;
  } else {
    preview = (
      <pre className={`detail-text${item.content_type === "code" ? " is-code" : ""}`}>
        {displayText}
        {text.length > MAX_DISPLAY_CHARS && (
          <span className="detail-truncated">{t("detail_truncated").replace("{n}", MAX_DISPLAY_CHARS.toLocaleString(locale))}</span>
        )}
      </pre>
    );
  }

  return (
    <>
      {/* Keyed by id so switching entries resets scroll and replays the fade. */}
      <div className="detail-preview" key={item.id}>{preview}</div>
      <section className="detail-info" aria-label={t("detail_information")}>
        <h3>{t("detail_information")}</h3>
        <dl>
          <InfoRow label={t("detail_source")}>
            {appIcon && <img className="detail-app-icon" src={appIcon} alt="" />}
            {item.source_app || "—"}
          </InfoRow>
          <InfoRow label={t("detail_content_type")}>{t(typeLabelKey(item.content_type))}</InfoRow>
          {stats && (
            <>
              <InfoRow label={t("detail_characters")}>{stats.characters.toLocaleString(locale)}</InfoRow>
              <InfoRow label={t("detail_words")}>{stats.words.toLocaleString(locale)}</InfoRow>
              {stats.lines > 1 && <InfoRow label={t("detail_lines")}>{stats.lines.toLocaleString(locale)}</InfoRow>}
            </>
          )}
          {imageSize?.id === item.id && (
            <InfoRow label={t("detail_dimensions")}>{`${imageSize.w} × ${imageSize.h}`}</InfoRow>
          )}
          {filePaths.length > 1 && <InfoRow label={t("detail_files")}>{filePaths.length}</InfoRow>}
          {copiedAt ? <InfoRow label={t("detail_copied_at")}>{formatTime(copiedAt)}</InfoRow> : null}
          {item.last_used_at ? <InfoRow label={t("detail_last_used")}>{formatTime(item.last_used_at)}</InfoRow> : null}
          {item.use_count ? <InfoRow label={t("detail_use_count")}>{item.use_count}</InfoRow> : null}
          {item.tags?.length ? <InfoRow label={t("detail_tags")}>{item.tags.join(", ")}</InfoRow> : null}
        </dl>
      </section>
    </>
  );
};

export default memo(ClipboardDetailPane);
