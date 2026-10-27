import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  ClipboardPaste,
  ExternalLink,
  Eye,
  EyeOff,
  MoreHorizontal,
  PictureInPicture2,
  Pin,
  PinOff,
  StickyNote,
  Tag,
  Trash2,
  ImageOff,
} from "lucide-react";
import type { ClipboardEntry } from "../../../shared/types";
import HtmlContent from "../../../shared/components/HtmlContent";
import { toTauriLocalImageSrc } from "../../../shared/lib/localImageSrc";
import { getSourceAppIcon, peekSourceAppIcon } from "../../../shared/lib/sourceAppIcon";
import { isTauriRuntime } from "../../../shared/lib/tauriRuntime";
import { openPinStickerWindow } from "../lib/pinStickerControls";
import TextFilePreview, { isTextPreviewable } from "./TextFilePreview";
import DetailAnnotationEditor from "./DetailAnnotationEditor";

export interface DetailPaneActions {
  paste: (item: ClipboardEntry) => void;
  togglePin: (event: MouseEvent, item: ClipboardEntry) => void;
  setTagEditor: (item: ClipboardEntry, open: boolean) => void;
  setNoteEditor: (item: ClipboardEntry, open: boolean) => void;
  saveNote: (item: ClipboardEntry, note: string) => void;
  addTag: (item: ClipboardEntry, tag: string) => void;
  deleteTag: (item: ClipboardEntry, tag: string) => void;
  open: (item: ClipboardEntry) => void;
  toggleReveal: (item: ClipboardEntry) => void;
  remove: (event: MouseEvent, item: ClipboardEntry) => void;
}

interface ClipboardDetailPaneProps {
  item: ClipboardEntry | null;
  t: (key: string) => string;
  language: string;
  actions: DetailPaneActions;
  canReveal: boolean;
  isSensitiveHidden: boolean;
  isRevealed: boolean;
  isEditingTags: boolean;
  isEditingNote: boolean;
  showSourceAppIcon: boolean;
  tagInput: string;
  tagSuggestions: string[];
  onTagInput: (value: string) => void;
  noteDraft?: string;
  onNoteDraftChange: (value: string) => void;
}

// The list receives at most ~2000 characters per entry; the pane fetches the
// full text once and keeps a small cache so hovering back and forth is instant.
const LIST_CONTENT_LIMIT = 1990;
const MAX_DISPLAY_CHARS = 100_000;
/** Files listed in the detail pane; the rest are summarised. */
const MAX_LISTED_FILES = 200;
// Keyed by id but checked against the list copy, which changes when an AI
// action rewrites the entry in place.
const fullContentCache = new Map<number, { source: string; text: string }>();

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
  const [fetched, setFetched] = useState<{ id: number; source: string; text: string } | null>(null);
  const needsFetch = !!item && enabled && TEXT_TYPES.has(item.content_type)
    && item.content.length >= LIST_CONTENT_LIMIT && isTauriRuntime();

  useEffect(() => {
    if (!item || !needsFetch) return;
    const source = item.content;
    const cached = fullContentCache.get(item.id);
    if (cached?.source === source) {
      setFetched({ id: item.id, source, text: cached.text });
      return;
    }
    let alive = true;
    invoke<string>("get_clipboard_content", { id: item.id })
      .then((text) => {
        if (fullContentCache.size >= 50) {
          const oldest = fullContentCache.keys().next().value;
          if (oldest !== undefined) fullContentCache.delete(oldest);
        }
        fullContentCache.set(item.id, { source, text });
        if (alive) setFetched({ id: item.id, source, text });
      })
      .catch(() => { /* keep showing the list's copy */ });
    return () => {
      alive = false;
    };
  }, [item, needsFetch]);

  if (!item) return "";
  return fetched?.id === item.id && fetched.source === item.content ? fetched.text : item.content;
};

type IconActionProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean };

const IconAction = ({ label, active, className, children, ...rest }: IconActionProps) => (
  <button
    type="button"
    className={`btn-icon detail-action${active ? " active" : ""}${className ? ` ${className}` : ""}`}
    title={label}
    aria-label={label}
    {...rest}
  >
    {children}
  </button>
);

type DetailActionBarProps = Omit<ClipboardDetailPaneProps, "item" | "language" | "isSensitiveHidden" | "showSourceAppIcon" | "tagInput" | "tagSuggestions" | "onTagInput" | "noteDraft" | "onNoteDraftChange"> & {
  item: ClipboardEntry;
};

const DetailActionBar = ({
  item,
  t,
  actions,
  canReveal,
  isRevealed,
  isEditingTags,
  isEditingNote
}: DetailActionBarProps) => {
  const [popover, setPopover] = useState<{ id: number; type: "more" } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  // Pressing a pane button already closes an open editor before `click`
  // (outside-click cancel for tags, blur-save for notes), so toggle on the
  // state at press time. Keyboard activation has no press and reads it live.
  const pressedRef = useRef<{ tags: boolean; note: boolean } | null>(null);
  const wasOpen = (key: "tags" | "note", current: boolean) => {
    const pressed = pressedRef.current;
    pressedRef.current = null;
    return pressed ? pressed[key] : current;
  };

  const closeAndRun = (action: () => void) => {
    setPopover(null);
    action();
  };
  const openType = popover?.id === item.id ? popover.type : null;

  const toolbarActions: Array<IconActionProps & { id: string; icon: ReactNode }> = [
    ...(canReveal ? [{
      id: "reveal",
      label: isRevealed ? t("hide") : t("reveal"),
      active: isRevealed,
      icon: isRevealed ? <EyeOff size={14} /> : <Eye size={14} />,
      onClick: () => closeAndRun(() => actions.toggleReveal(item))
    }] : []),
    {
      id: "pin",
      label: item.is_pinned ? t("unpin") : t("pin"),
      active: item.is_pinned,
      "aria-pressed": item.is_pinned,
      icon: item.is_pinned ? <PinOff size={14} /> : <Pin size={14} />,
      onClick: (e) => closeAndRun(() => actions.togglePin(e, item))
    },
    {
      id: "tags",
      label: t("edit_tags"),
      active: isEditingTags,
      "aria-pressed": isEditingTags,
      icon: <Tag size={14} />,
      onClick: () => closeAndRun(() => actions.setTagEditor(item, !wasOpen("tags", isEditingTags)))
    },
    {
      id: "note",
      label: item.note ? t("edit_note") : t("add_note"),
      active: isEditingNote,
      "aria-pressed": isEditingNote,
      icon: <StickyNote size={14} />,
      onClick: () => closeAndRun(() => actions.setNoteEditor(item, !wasOpen("note", isEditingNote)))
    },
    {
      id: "open",
      label: t("open"),
      icon: <ExternalLink size={14} />,
      onClick: () => closeAndRun(() => actions.open(item))
    },
    ...(item.content_type === "image" ? [{
      id: "sticker",
      label: t("pin_sticker"),
      icon: <PictureInPicture2 size={14} />,
      onClick: () => closeAndRun(() => void openPinStickerWindow(item))
    }] : []),
    {
      id: "delete",
      label: t("delete"),
      className: "is-danger",
      icon: <Trash2 size={14} />,
      onClick: (e) => closeAndRun(() => actions.remove(e, item))
    }
  ];
  const [visibleCount, setVisibleCount] = useState(toolbarActions.length);
  const actionCount = toolbarActions.length;
  const pasteLabel = t("detail_paste");

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current?.querySelector<HTMLElement>(".detail-actions");
    const paste = toolbar?.querySelector<HTMLElement>(".is-primary");
    if (!toolbar || !paste) return;

    const measure = () => {
      const width = toolbar.getBoundingClientRect().width;
      const pasteWidth = paste.getBoundingClientRect().width;
      const iconWidth = toolbar.querySelector<HTMLElement>(".detail-action:not(.is-primary)")?.getBoundingClientRect().width || 0;
      const gap = parseFloat(getComputedStyle(toolbar).columnGap) || 0;
      if (!width || !iconWidth) return;
      // Every icon has the same width. Reserve a slot for More only if the
      // complete row does not fit; Paste always stays directly available.
      const fitsAll = pasteWidth + actionCount * (iconWidth + gap) <= width;
      const slots = Math.floor((width - pasteWidth) / (iconWidth + gap));
      setVisibleCount(fitsAll ? actionCount : Math.max(0, slots - 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    observer.observe(paste);
    return () => observer.disconnect();
  }, [actionCount, pasteLabel]);

  const visibleActions = toolbarActions.slice(0, visibleCount);
  const overflowActions = toolbarActions.slice(visibleCount);
  const moreOpen = overflowActions.length > 0 && openType === "more";

  useEffect(() => {
    if (openType === "more" && overflowActions.length === 0) setPopover(null);
  }, [openType, overflowActions.length]);

  useEffect(() => {
    if (!openType) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setPopover(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPopover(null);
      toolbarRef.current?.querySelector<HTMLButtonElement>(`[data-detail-popup="${openType}"]`)?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openType]);

  return (
    <div className="detail-actions-wrap" ref={toolbarRef}>
      <div
        className="detail-actions"
        role="toolbar"
        aria-label={t("detail_actions")}
        onPointerDownCapture={() => {
          pressedRef.current = { tags: isEditingTags, note: isEditingNote };
        }}
      >
        {visibleActions.map(({ id, icon, ...props }) => (
          <IconAction key={id} {...props}>{icon}</IconAction>
        ))}
        {overflowActions.length > 0 && (
          <div className="detail-action-disclosure">
            <IconAction
              label={t("more_actions")}
              active={moreOpen}
              aria-expanded={moreOpen}
              aria-controls={moreOpen ? `${popoverId}-more` : undefined}
              data-detail-popup="more"
              onClick={() => setPopover(moreOpen ? null : { id: item.id, type: "more" })}
            >
              <MoreHorizontal size={16} />
            </IconAction>
            {moreOpen && (
              <div id={`${popoverId}-more`} className="detail-action-popover" role="group" aria-label={t("more_actions")}>
                {overflowActions.map(({ id, label, icon, active: _active, ...props }) => (
                  <button key={id} type="button" {...props}>
                    {icon}<span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button type="button" className="btn-icon detail-action is-primary" onClick={() => closeAndRun(() => actions.paste(item))}>
          <ClipboardPaste size={14} />
          <span>{pasteLabel}</span>
        </button>
      </div>
    </div>
  );
};

const ClipboardDetailPane = ({
  item,
  t,
  language,
  actions,
  canReveal,
  isSensitiveHidden,
  isRevealed,
  isEditingTags,
  isEditingNote,
  showSourceAppIcon,
  tagInput,
  tagSuggestions,
  onTagInput,
  noteDraft,
  onNoteDraftChange
}: ClipboardDetailPaneProps) => {
  const originalItem = item;
  const fetchedText = useFullContent(originalItem, !isSensitiveHidden);
  const text = fetchedText;
  const [imageSize, setImageSize] = useState<{ id: number; w: number; h: number } | null>(null);
  const [imageFailedId, setImageFailedId] = useState<number | null>(null);
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

  const filePaths = useMemo(
    () => (item?.content_type === "file" ? item.content.split("\n").map((p) => p.trim()).filter(Boolean) : []),
    [item]
  );
  // The file shown below the list; the first previewable one until another is picked.
  const [pickedFile, setPickedFile] = useState<{ id: number; path: string } | null>(null);
  const previewPath = (pickedFile?.id === item?.id ? pickedFile?.path : undefined)
    ?? filePaths.find(isTextPreviewable);

  if (!item) {
    return <div className="detail-empty">{t("detail_empty")}</div>;
  }

  const locale = localeFor(language);
  const originalType = originalItem?.content_type ?? item.content_type;
  const formatTime = (ms?: number) => (ms
    ? new Date(ms).toLocaleString(locale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "");
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
    // The list row and compact preview already show a placeholder for a
    // missing image; the detail pane showed the browser's broken-image icon.
    preview = (item.is_external && item.file_preview_exists === false) || imageFailedId === item.id ? (
      <div className="detail-sensitive">
        <ImageOff size={20} />
        <span>{t("image_deleted")}</span>
      </div>
    ) : (
      <img
        className="detail-image"
        src={mediaSrc(item)}
        alt={t("image_preview")}
        draggable={false}
        decoding="async"
        onLoad={(e) => setImageSize({ id: item.id, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        onError={() => setImageFailedId(item.id)}
      />
    );
  } else if (item.content_type === "video") {
    preview = <video className="detail-image" src={mediaSrc(item)} controls muted preload="metadata" />;
  } else if (item.content_type === "file") {
    // With several files, the list comes first and each previewable one can be
    // picked; the preview used to sit on top showing only the first file.
    const choosable = filePaths.length > 1;
    preview = (
      <>
      <ul className={`detail-files${choosable && previewPath ? " has-preview" : ""}`}>
        {/* Capped: a list of thousands of files mounted thousands of rows. */}
        {filePaths.slice(0, MAX_LISTED_FILES).map((path) => {
          const name = (
            <>
              <strong>{path.split(/[\\/]/).pop() || path}</strong>
              <span>{path}</span>
            </>
          );
          return (
            <li key={path}>
              {!choosable ? name : isTextPreviewable(path) ? (
                <button
                  type="button"
                  className="detail-file-row"
                  aria-pressed={path === previewPath}
                  onClick={() => setPickedFile({ id: item.id, path })}
                >
                  {name}
                </button>
              ) : (
                <div className="detail-file-row">{name}</div>
              )}
            </li>
          );
        })}
        {filePaths.length > MAX_LISTED_FILES && (
          <li className="detail-files-more">
            {t("detail_more_files").replace("{count}", String(filePaths.length - MAX_LISTED_FILES))}
          </li>
        )}
      </ul>
      <TextFilePreview path={previewPath} language={language} />
      </>
    );
  } else if (originalItem?.content_type === "rich_text" && originalItem.html_content) {
    preview = <HtmlContent htmlContent={originalItem.html_content} fallbackText={text} className="detail-rich" eager />;
  } else {
    preview = (
      <pre className={`detail-text${originalItem?.content_type === "code" ? " is-code" : ""}`}>
        {displayText}
        {text.length > MAX_DISPLAY_CHARS && (
          <span className="detail-truncated">{t("detail_truncated").replace("{n}", MAX_DISPLAY_CHARS.toLocaleString(locale))}</span>
        )}
      </pre>
    );
  }

  return (
    <>
      <div className="detail-header">
        <div className="detail-context">
          {showSourceAppIcon && appIcon && <img className="detail-app-icon" src={appIcon} alt="" />}
          <span
            className="detail-source-name"
            title={item.source_app || undefined}
            aria-label={`${t("detail_source")}: ${item.source_app || "—"}`}
          >
            {item.source_app || t(typeLabelKey(originalType))}
          </span>
          {item.source_app && <span className="detail-content-type">{t(typeLabelKey(originalType))}</span>}
          {item.content_type === "image" && imageSize?.id === item.id && (
            <span className="detail-media-info">{`${imageSize.w} × ${imageSize.h}`}</span>
          )}
          {filePaths.length > 1 && <span className="detail-media-info">{t("detail_files")}: {filePaths.length}</span>}
        </div>
        {!!copiedAt && (
          <time
            className="detail-timestamp"
            dateTime={new Date(copiedAt).toISOString()}
            title={`${t("detail_copied_at")}: ${new Date(copiedAt).toLocaleString(locale)}`}
          >
            {formatTime(copiedAt)}
          </time>
        )}
      </div>
      {/* Keyed by id so switching entries resets scroll. */}
      <div className="detail-preview" key={`preview-${item.id}`}>
        {preview}
        {!!(item.tags?.length || item.note || isEditingTags || isEditingNote) && (
          <section className="detail-annotations" aria-label={t("detail_information")}>
            {!!item.tags?.length && !isEditingTags && (
              <div className="detail-tags" aria-label={t("detail_tags")}>
                {item.tags.map((tag) => <span className="detail-tag" key={tag}>#{tag}</span>)}
              </div>
            )}
            {item.note && !isEditingNote && (
              <div className="detail-note" aria-label={t("detail_note")}>
                <StickyNote size={13} aria-hidden="true" />
                <p>{item.note}</p>
              </div>
            )}
            {(isEditingTags || isEditingNote) && (
              <DetailAnnotationEditor
                item={item}
                t={t}
                actions={actions}
                isEditingTags={isEditingTags}
                tagInput={tagInput}
                tagSuggestions={tagSuggestions}
                onTagInput={onTagInput}
                noteDraft={noteDraft}
                onNoteDraftChange={onNoteDraftChange}
              />
            )}
          </section>
        )}
      </div>
      <DetailActionBar
        key={`actions-${item.id}`}
        item={item}
        t={t}
        actions={actions}
        canReveal={canReveal}
        isRevealed={isRevealed}
        isEditingTags={isEditingTags}
        isEditingNote={isEditingNote}
      />
    </>
  );
};

export default memo(ClipboardDetailPane);
