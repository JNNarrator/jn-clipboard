import { useEffect, useMemo, useState, useRef } from "react";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion } from "framer-motion";
import {
    FileText,
    Image as ImageIcon,
    Link as LinkIcon,
    Code,
    File,
    FileQuestion,
    Files,
    ImageOff,
    Video,
    AppWindow,
    Clock
} from "lucide-react";
import HtmlContent from "../../../shared/components/HtmlContent";
import {
    applyThemeClasses,
    DEFAULT_THEME,
    normalizeThemeId
} from "../../../shared/config/themes";
import { getConciseTime } from "../../../shared/lib/utils";
import type { Locale } from "../../../shared/types";
import { toTauriLocalImageSrc } from "../../../shared/lib/localImageSrc";
import { stripRichStorageMarkers } from "../../../shared/lib/repairHtmlFragment";
import { getRichTextSnapshotDataUrl } from "../../../shared/lib/richTextSnapshot";
import { ensureInstalledThemeStyle } from "../../../shared/lib/themePackages";

type PreviewPayload = {
    requestId: number;
    contentType: string;
    content: string;
    preview?: string;
    htmlContent?: string;
    filePreviewExists?: boolean;
    sourceApp?: string;
    timestamp?: number;
    language?: Locale;
    theme?: string;
    colorMode?: "light" | "dark";
    richTextSnapshotPreview?: boolean;
    clipboardItemFontSize?: number;
    clipboardTagFontSize?: number;
    maxWidth: number;
    maxHeight: number;
    mediaMaxWidth: number;
    mediaMaxHeight: number;
    minWidth: number;
};

type PreviewResizePayload = {
    requestId: number;
    width: number;
    height: number;
};

const RICH_IMAGE_FALLBACK_PREFIX = "<!--TIEZ_RICH_IMAGE:";
const RICH_IMAGE_FALLBACK_SUFFIX = "-->";

const extractRichImageFallback = (html?: string): { cleanHtml?: string; imagePayload?: string } => {
    if (!html) return {};
    const start = html.lastIndexOf(RICH_IMAGE_FALLBACK_PREFIX);
    if (start < 0) return { cleanHtml: html };

    const markerStart = start + RICH_IMAGE_FALLBACK_PREFIX.length;
    const endRel = html.slice(markerStart).indexOf(RICH_IMAGE_FALLBACK_SUFFIX);
    if (endRel < 0) return { cleanHtml: html };

    const markerEnd = markerStart + endRel;
    const payload = html.slice(markerStart, markerEnd).trim();
    const cleanHtml = `${html.slice(0, start)}${html.slice(markerEnd + RICH_IMAGE_FALLBACK_SUFFIX.length)}`.trim();
    return {
        cleanHtml: cleanHtml || html,
        imagePayload: payload || undefined
    };
};

const resolveRichImageSrc = (payload: string): string | null => {
    const value = payload.trim();
    if (!value) return null;
    if (value.startsWith("data:image/")) return value;
    if (/^https?:\/\/asset\.localhost\//i.test(value)) return value;
    return toTauriLocalImageSrc(value);
};

const COMPACT_PREVIEW_DEBUG = false;
const RICH_PREVIEW_DEBUG = import.meta.env.DEV;
const compactPreviewLog = (...args: unknown[]) => {
    if (!COMPACT_PREVIEW_DEBUG) return;
    const ts = new Date().toISOString();
    console.log(`[CompactPreview][Preview][${ts}]`, ...args);
};
const richPreviewFailureLog = (stage: string, detail?: Record<string, unknown>) => {
    if (!RICH_PREVIEW_DEBUG) return;
    console.warn("[RichTextPreview][CompactWindow]", stage, detail || {});
};

const getIcon = (type: string) => {
    switch (type) {
        case "text": return <FileText size={14} />;
        case "image": return <ImageIcon size={14} />;
        case "url": return <LinkIcon size={14} />;
        case "code": return <Code size={14} />;
        case "file": return <File size={14} />;
        case "video": return <Video size={14} />;
        default: return <FileText size={14} />;
    }
};

const seekVideoPreviewFrame = (video: HTMLVideoElement | null) => {
    if (!video) return;
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const maxSeek = Math.max(duration - 0.05, 0);
    if (maxSeek <= 0) return;
    const preferred = Math.min(duration * 0.1, 2);
    const target = Math.min(Math.max(preferred, 0.1), maxSeek);
    if (target <= 0) return;
    try {
        video.currentTime = target;
    } catch {
        // Ignore seek errors; fallback will just show the first frame.
    }
};

const applyTheme = async (payload: PreviewPayload) => {
    const theme = normalizeThemeId(payload.theme || DEFAULT_THEME);
    const colorMode = payload.colorMode || "light";

    const root = document.documentElement;
    const body = document.body;

    const installedThemeReady = await ensureInstalledThemeStyle(theme);
    applyThemeClasses(installedThemeReady ? theme : DEFAULT_THEME, root, body);

    root.classList.remove("light-mode", "dark-mode");
    body.classList.remove("light-mode", "dark-mode");
    if (colorMode === "dark") {
        root.classList.add("dark-mode");
        body.classList.add("dark-mode");
    } else {
        root.classList.add("light-mode");
        body.classList.add("light-mode");
    }

    body.classList.add("compact-preview");

    if (payload.clipboardItemFontSize) {
        root.style.setProperty("--clipboard-item-font-size", `${payload.clipboardItemFontSize}px`);
    }
    if (payload.clipboardTagFontSize) {
        root.style.setProperty("--clipboard-tag-font-size", `${payload.clipboardTagFontSize}px`);
    }

    compactPreviewLog("theme applied", {
        theme,
        colorMode,
        itemFontSize: payload.clipboardItemFontSize,
        tagFontSize: payload.clipboardTagFontSize
    });
};

const applyPreviewBounds = (payload: PreviewPayload) => {
    const root = document.documentElement;
    root.style.setProperty("--preview-max-width", `${payload.maxWidth}px`);
    root.style.setProperty("--preview-max-height", `${payload.maxHeight}px`);
    root.style.setProperty("--preview-media-max-width", `${payload.mediaMaxWidth}px`);
    root.style.setProperty("--preview-media-max-height", `${payload.mediaMaxHeight}px`);
    root.style.setProperty("--preview-min-width", `${payload.minWidth}px`);
};

const CompactPreviewWindow = () => {
    const [payload, setPayload] = useState<PreviewPayload | null>(null);
    const [snapshotFailedRequestId, setSnapshotFailedRequestId] = useState<number | null>(null);
    const [richImageFallbackFailedRequestId, setRichImageFallbackFailedRequestId] = useState<number | null>(null);
    const [mediaFailedRequestId, setMediaFailedRequestId] = useState<number | null>(null);
    const richSnapshotImgRef = useRef<HTMLImageElement | null>(null);
    const richSnapshotFallbackTimerRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const metaRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const dividerRef = useRef<HTMLDivElement | null>(null);
    const requestResizeRef = useRef<() => void>(() => {});
    const previewBoundsRef = useRef({ width: 560, height: 560, mediaWidth: 520, mediaHeight: 360 });
    const latestRequestIdRef = useRef(0);
    const lastSentSizeRef = useRef<PreviewResizePayload | null>(null);
    const richImageFallbackSrc = useMemo(() => {
        if (!payload || payload.contentType !== "rich_text" || !payload.htmlContent) return null;
        const { imagePayload } = extractRichImageFallback(payload.htmlContent);
        if (!imagePayload) return null;
        const src = resolveRichImageSrc(imagePayload);
        if (!src) return null;
        return src;
    }, [payload]);
    const richTextSnapshotSrc = useMemo(() => {
        if (!payload || payload.contentType !== "rich_text" || !payload.htmlContent) return null;
        if (!payload.richTextSnapshotPreview) return null;
        const { cleanHtml } = extractRichImageFallback(payload.htmlContent);
        const htmlForSnapshot = stripRichStorageMarkers(cleanHtml || payload.htmlContent);
        return getRichTextSnapshotDataUrl(htmlForSnapshot, {
            width: payload.maxWidth,
            maxHeight: Math.max(payload.maxHeight * 2, 720)
        });
    }, [payload]);
    const snapshotFailed = !!payload && snapshotFailedRequestId === payload.requestId;
    const richImageFallbackFailed = !!payload && richImageFallbackFailedRequestId === payload.requestId;
    const mediaFailed = !!payload && mediaFailedRequestId === payload.requestId;
    const effectiveRichTextSnapshotSrc = snapshotFailed ? null : richTextSnapshotSrc;
    const effectiveRichImageFallbackSrc = richImageFallbackFailed ? null : richImageFallbackSrc;
    const useSnapshotPreviewImage = !effectiveRichImageFallbackSrc && !!effectiveRichTextSnapshotSrc;

    useEffect(() => {
        compactPreviewLog("window mounted", { label: getCurrentWindow().label });
        let disposed = false;
        let stopUpdate: (() => void) | null = null;
        let stopReadyQuery: (() => void) | null = null;

        void (async () => {
            try {
                await Promise.allSettled([
                    getCurrentWindow().setFocusable(false),
                    getCurrentWindow().setIgnoreCursorEvents(true)
                ]);
                if (disposed) return;

                stopUpdate = await listen<PreviewPayload>("compact-preview-update", (event) => {
                    const next = event.payload;
                    if (latestRequestIdRef.current === next.requestId) {
                        requestResizeRef.current?.();
                        return;
                    }
                    latestRequestIdRef.current = next.requestId;
                    lastSentSizeRef.current = null;
                    applyPreviewBounds(next);
                    previewBoundsRef.current = {
                        width: next.maxWidth,
                        height: next.maxHeight,
                        mediaWidth: next.mediaMaxWidth,
                        mediaHeight: next.mediaMaxHeight
                    };
                    compactPreviewLog("received compact-preview-update", {
                        requestId: next.requestId,
                        contentType: next.contentType,
                        contentLength: next.content?.length ?? 0,
                        previewLength: next.preview?.length ?? 0,
                        hasHtml: !!next.htmlContent,
                        sourceApp: next.sourceApp
                    });

                    if (disposed) return;
                    setPayload(next);
                    void applyTheme(next).then(() => {
                        if (!disposed && latestRequestIdRef.current === next.requestId) {
                            requestResizeRef.current?.();
                        }
                    }).catch((err) => {
                        console.error("Failed to apply compact preview theme:", err);
                    });
                });
                if (disposed) {
                    stopUpdate();
                    stopUpdate = null;
                    return;
                }

                stopReadyQuery = await listen("compact-preview-ready-query", () => {
                    void emitTo("main", "compact-preview-ready", true);
                });
                if (disposed) {
                    stopReadyQuery();
                    stopReadyQuery = null;
                    return;
                }

                if (!disposed) {
                    await emitTo("main", "compact-preview-ready", true);
                    compactPreviewLog("compact preview listeners ready");
                }
            } catch (err) {
                console.error("Failed to initialize compact preview window:", err);
                compactPreviewLog("compact preview initialization failed", err);
            }
        })();

        return () => {
            disposed = true;
            compactPreviewLog("window unmount cleanup");
            stopUpdate?.();
            stopReadyQuery?.();
        };
    }, []);

    useEffect(() => {
        if (!payload) {
            compactPreviewLog("skip resize effect: payload empty");
            return;
        }
        let raf = 0;
        let timerA: number | null = null;
        let timerB: number | null = null;
        let timerC: number | null = null;
const calculateStandardCardDimensions = (
    payload: PreviewPayload,
    bounds: { width: number; height: number; mediaWidth: number; mediaHeight: number },
    chromeWidth: number,
    chromeHeight: number,
    container: HTMLElement,
    contentEl: HTMLElement | null,
    metaEl: HTMLElement | null
): { width: number; height: number } => {
    const maxW = Math.min(bounds.width, 540);
    const maxH = bounds.height;
    const metaWidth = metaEl ? Math.ceil(metaEl.scrollWidth + chromeWidth) : 240;
    const baseMinW = Math.max(260, Math.min(320, metaWidth));

    // 1. Media Preview (Images, Videos, Fallback snapshots)
    const isMedia = payload.contentType === "image" || payload.contentType === "video";
    if (isMedia) {
        const standardMediaWidth = Math.min(maxW, 460);
        const availableMediaHeight = Math.max(120, Math.floor(maxH - chromeHeight - 8));
        const availableMediaWidth = Math.max(160, Math.floor(standardMediaWidth - chromeWidth));

        container.style.setProperty("--preview-media-fit-height", `${availableMediaHeight}px`);
        container.style.setProperty("--preview-media-fit-width", `${availableMediaWidth}px`);

        const mediaEl = contentEl?.querySelector<HTMLImageElement | HTMLVideoElement>("img, video");
        if (mediaEl instanceof HTMLImageElement && mediaEl.naturalWidth > 0 && mediaEl.naturalHeight > 0) {
            const nw = mediaEl.naturalWidth;
            const nh = mediaEl.naturalHeight;
            // Vertical phone screenshot (aspect ratio < 0.68) -> slightly narrower card 360px
            const isTallPortrait = nw / nh < 0.68;
            const chosenTargetWidth = isTallPortrait ? Math.min(maxW, 360) : standardMediaWidth;
            const availW = chosenTargetWidth - chromeWidth;
            const scale = Math.min(1, availW / nw, availableMediaHeight / nh);
            const fitW = Math.round(nw * scale);
            const fitH = Math.round(nh * scale);
            const finalW = Math.min(maxW, Math.max(baseMinW, fitW + chromeWidth));
            const finalH = Math.min(maxH, Math.max(80, fitH + chromeHeight));
            container.style.width = `${finalW}px`;
            return { width: finalW, height: finalH };
        } else if (mediaEl && mediaEl.getBoundingClientRect().height > 0) {
            const r = mediaEl.getBoundingClientRect();
            container.style.width = `${standardMediaWidth}px`;
            return {
                width: standardMediaWidth,
                height: Math.min(maxH, Math.max(80, Math.ceil(r.height + chromeHeight)))
            };
        }
        container.style.width = `${standardMediaWidth}px`;
        return {
            width: standardMediaWidth,
            height: Math.min(maxH, Math.max(160, Math.floor(availableMediaHeight * 0.7) + chromeHeight))
        };
    }

    // 2. Code Preview
    if (payload.contentType === "code") {
        const standardCodeWidth = Math.min(maxW, 480);
        container.style.width = `${standardCodeWidth}px`;
        const measuredHeight = Math.ceil(container.scrollHeight || container.offsetHeight || container.getBoundingClientRect().height);
        return {
            width: standardCodeWidth,
            height: Math.min(maxH, Math.max(80, measuredHeight))
        };
    }

    // 3. File List Preview
    if (payload.contentType === "file") {
        const standardFileWidth = Math.min(maxW, 380);
        container.style.width = `${standardFileWidth}px`;
        const measuredHeight = Math.ceil(container.scrollHeight || container.offsetHeight || container.getBoundingClientRect().height);
        return {
            width: standardFileWidth,
            height: Math.min(maxH, Math.max(80, measuredHeight))
        };
    }

    // 4. Rich Text Preview
    if (payload.contentType === "rich_text") {
        const standardRichWidth = Math.min(maxW, 420);
        container.style.width = `${standardRichWidth}px`;
        const measuredHeight = Math.ceil(container.scrollHeight || container.offsetHeight || container.getBoundingClientRect().height);
        return {
            width: standardRichWidth,
            height: Math.min(maxH, Math.max(80, measuredHeight))
        };
    }

    // 5. Plain Text Preview
    const text = (payload.content || payload.preview || "").trim();
    const hasLineBreak = text.includes("\n");
    const charCount = text.length;

    let targetWidth: number;
    if (!hasLineBreak && charCount <= 28) {
        // Micro/Short tier: tightly wrap short strings, no huge empty space
        const approxCharWidth = 8.2;
        const textWidth = Math.ceil(charCount * approxCharWidth + chromeWidth + 24);
        targetWidth = Math.max(baseMinW, Math.min(320, Math.min(maxW, textWidth)));
    } else if (charCount <= 140 && (!hasLineBreak || text.split("\n").length <= 4)) {
        // Standard reading tier: ideal line length (25-35 CJK chars / 60-70 Latin chars)
        targetWidth = Math.min(maxW, 380);
    } else {
        // Expanded reading tier for long prose and multi-line content
        targetWidth = Math.min(maxW, 420);
    }

    container.style.width = `${targetWidth}px`;
    const measuredHeight = Math.ceil(container.scrollHeight || container.offsetHeight || container.getBoundingClientRect().height);
    return {
        width: targetWidth,
        height: Math.min(maxH, Math.max(80, measuredHeight))
    };
};

        const updateSize = () => {
            raf = window.requestAnimationFrame(() => {
                const container = containerRef.current;
                if (!container) {
                    compactPreviewLog("skip measure: container missing");
                    return;
                }

                const bounds = previewBoundsRef.current;
                const style = getComputedStyle(container);
                const pixels = (value: string) => Number.parseFloat(value) || 0;
                const outerHeight = (element: HTMLElement | null) => {
                    if (!element || getComputedStyle(element).display === "none") return 0;
                    const elementStyle = getComputedStyle(element);
                    return element.getBoundingClientRect().height
                        + pixels(elementStyle.marginTop) + pixels(elementStyle.marginBottom);
                };
                const chromeHeight = pixels(style.paddingTop) + pixels(style.paddingBottom)
                    + pixels(style.borderTopWidth) + pixels(style.borderBottomWidth)
                    + outerHeight(metaRef.current) + outerHeight(dividerRef.current);
                const chromeWidth = pixels(style.paddingLeft) + pixels(style.paddingRight)
                    + pixels(style.borderLeftWidth) + pixels(style.borderRightWidth);

                const { width, height } = calculateStandardCardDimensions(
                    payload,
                    bounds,
                    chromeWidth,
                    chromeHeight,
                    container,
                    contentRef.current,
                    metaRef.current
                );

                if (width < 40 || height < 40) {
                    compactPreviewLog("skip emit: measured size too small", {
                        width,
                        height
                    });
                    return;
                }

                const requestId = payload.requestId;
                if (latestRequestIdRef.current !== requestId) return;
                const last = lastSentSizeRef.current;
                if (
                    last &&
                    last.requestId === requestId &&
                    Math.abs(last.width - width) <= 1 &&
                    Math.abs(last.height - height) <= 1
                ) {
                    return;
                }
                lastSentSizeRef.current = { requestId, width, height };
                compactPreviewLog("emit compact-preview-resize", {
                    requestId,
                    width,
                    height
                });

                emit("compact-preview-resize", { requestId, width, height }).catch(() => {});
                emitTo("main", "compact-preview-resize", { requestId, width, height }).catch((err) => {
                    console.error(err);
                    compactPreviewLog("emit compact-preview-resize failed", err);
                });
            });
        };

        requestResizeRef.current = updateSize;
        compactPreviewLog("resize effect start", { contentType: payload.contentType });
        updateSize();
        const observer = new ResizeObserver(updateSize);
        if (containerRef.current) observer.observe(containerRef.current);
        if (contentRef.current) observer.observe(contentRef.current);
        if (metaRef.current) observer.observe(metaRef.current);
        if (dividerRef.current) observer.observe(dividerRef.current);
        compactPreviewLog("ResizeObserver attached");

        // Async render safety net: rich text/media/font loading may settle later.
        timerA = window.setTimeout(updateSize, 50);
        timerB = window.setTimeout(updateSize, 180);
        timerC = window.setTimeout(updateSize, 420);

        return () => {
            if (raf) cancelAnimationFrame(raf);
            if (timerA) window.clearTimeout(timerA);
            if (timerB) window.clearTimeout(timerB);
            if (timerC) window.clearTimeout(timerC);
            observer.disconnect();
            compactPreviewLog("resize effect cleanup");
        };
    }, [payload]);

    useEffect(() => {
        if (richSnapshotFallbackTimerRef.current) {
            window.clearTimeout(richSnapshotFallbackTimerRef.current);
            richSnapshotFallbackTimerRef.current = null;
        }
        if (!useSnapshotPreviewImage) return;

        // Safety net: in some environments broken SVG data urls don't always emit onError.
        richSnapshotFallbackTimerRef.current = window.setTimeout(() => {
            const img = richSnapshotImgRef.current;
            if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
                richPreviewFailureLog("snapshot image timeout -> fallback to html", {
                    hasImageElement: !!img,
                    complete: img?.complete ?? false,
                    naturalWidth: img?.naturalWidth ?? 0,
                    naturalHeight: img?.naturalHeight ?? 0,
                    sourceApp: payload?.sourceApp || ""
                });
                if (payload) setSnapshotFailedRequestId(payload.requestId);
            }
        }, 700);

        return () => {
            if (richSnapshotFallbackTimerRef.current) {
                window.clearTimeout(richSnapshotFallbackTimerRef.current);
                richSnapshotFallbackTimerRef.current = null;
            }
        };
    }, [useSnapshotPreviewImage, effectiveRichTextSnapshotSrc, payload?.requestId, payload?.content, payload?.htmlContent]);

    const content = useMemo(() => {
        if (!payload) return null;
        if (payload.contentType === "image") {
            if (payload.filePreviewExists === false || mediaFailed) {
                return (
                    <div className="compact-preview-unavailable">
                        <ImageOff size={22} />
                        <span>Preview unavailable</span>
                    </div>
                );
            }
            const src = payload.content.startsWith("data:")
                ? payload.content
                : (toTauriLocalImageSrc(payload.content) || payload.content);
            return (
                <img
                    src={src}
                    alt="preview"
                    onLoad={() => {
                        compactPreviewLog("image loaded, request resize");
                        requestResizeRef.current?.();
                    }}
                    onError={() => setMediaFailedRequestId(payload.requestId)}
                    style={{
                        maxWidth: "100%",
                        maxHeight: "var(--preview-media-fit-height, 460px)",
                        width: "auto",
                        height: "auto",
                        objectFit: "contain",
                        display: "block",
                        borderRadius: "4px"
                    }}
                />
            );
        }
        if (payload.contentType === "video") {
            if (payload.filePreviewExists === false || mediaFailed) {
                return (
                    <div className="compact-preview-unavailable">
                        <Video size={22} />
                        <span>Preview unavailable</span>
                    </div>
                );
            }
            const src = payload.content.startsWith("data:")
                ? payload.content
                : (toTauriLocalImageSrc(payload.content) || payload.content);
            return (
                <video
                    src={src}
                    preload="metadata"
                    muted
                    playsInline
                    onLoadedMetadata={(e) => {
                        compactPreviewLog("video metadata loaded", {
                            duration: e.currentTarget.duration
                        });
                        seekVideoPreviewFrame(e.currentTarget);
                        requestResizeRef.current?.();
                    }}
                    onError={() => setMediaFailedRequestId(payload.requestId)}
                    style={{
                        maxWidth: "100%",
                        maxHeight: "var(--preview-media-fit-height, 460px)",
                        width: "auto",
                        height: "auto",
                        objectFit: "contain",
                        display: "block",
                        borderRadius: "4px",
                        background: "#000"
                    }}
                />
            );
        }
        if (payload.contentType === "file") {
            if (payload.filePreviewExists === false) {
                return (
                    <div className="compact-preview-unavailable">
                        <FileQuestion size={22} />
                        <span>File unavailable</span>
                    </div>
                );
            }
            const paths = payload.content
                .split(/\r?\n/)
                .map((path) => path.trim())
                .filter(Boolean);
            return (
                <div className="compact-preview-file-list">
                    {paths.length > 1 && (
                        <div className="compact-preview-file-count">
                            <Files size={16} />
                            <span>{paths.length} items</span>
                        </div>
                    )}
                    {(paths.length > 0 ? paths : [payload.preview || payload.content]).slice(0, 12).map((path, index) => (
                        <div className="compact-preview-file-row" key={`${path}-${index}`}>
                            <File size={14} />
                            <span title={path}>{path.split(/[\\/]/).pop() || path}</span>
                        </div>
                    ))}
                    {paths.length > 12 && (
                        <div className="compact-preview-file-more">+{paths.length - 12}</div>
                    )}
                </div>
            );
        }
        if (payload.contentType === "rich_text" && payload.htmlContent) {
            if (effectiveRichImageFallbackSrc) {
                compactPreviewLog("render rich_text as fallback image");
                return (
                    <img
                        src={effectiveRichImageFallbackSrc}
                        alt="rich text preview"
                        onLoad={() => {
                            compactPreviewLog("rich fallback image loaded, request resize");
                            requestResizeRef.current?.();
                        }}
                        onError={() => {
                            richPreviewFailureLog("fallback image load error -> switch to snapshot", {
                                srcLength: (effectiveRichImageFallbackSrc || "").length,
                                srcSample: (effectiveRichImageFallbackSrc || "").slice(0, 140),
                                sourceApp: payload.sourceApp || ""
                            });
                            setRichImageFallbackFailedRequestId(payload.requestId);
                        }}
                        style={{
                            maxWidth: "100%",
                            maxHeight: "var(--preview-media-fit-height, 460px)",
                            width: "auto",
                            height: "auto",
                            objectFit: "contain",
                            display: "block",
                            borderRadius: "4px"
                        }}
                    />
                );
            }
            if (effectiveRichTextSnapshotSrc) {
                compactPreviewLog("render rich_text as html snapshot image");
                return (
                    <img
                        ref={richSnapshotImgRef}
                        src={effectiveRichTextSnapshotSrc}
                        alt="rich text snapshot preview"
                        onLoad={() => {
                            if (richSnapshotFallbackTimerRef.current) {
                                window.clearTimeout(richSnapshotFallbackTimerRef.current);
                                richSnapshotFallbackTimerRef.current = null;
                            }
                            compactPreviewLog("rich snapshot image loaded, request resize");
                            requestResizeRef.current?.();
                        }}
                        onError={() => {
                            if (richSnapshotFallbackTimerRef.current) {
                                window.clearTimeout(richSnapshotFallbackTimerRef.current);
                                richSnapshotFallbackTimerRef.current = null;
                            }
                            richPreviewFailureLog("snapshot image load error -> fallback to html", {
                                srcLength: (effectiveRichTextSnapshotSrc || "").length,
                                srcSample: (effectiveRichTextSnapshotSrc || "").slice(0, 140),
                                sourceApp: payload.sourceApp || ""
                            });
                            setSnapshotFailedRequestId(payload.requestId);
                        }}
                        style={{
                            maxWidth: "100%",
                            maxHeight: "var(--preview-media-fit-height, 460px)",
                            width: "auto",
                            height: "auto",
                            objectFit: "contain",
                            display: "block",
                            borderRadius: "4px"
                        }}
                    />
                );
            }
            const { cleanHtml } = extractRichImageFallback(payload.htmlContent);
            return (
                <HtmlContent
                    className="rich-text-preview"
                    htmlContent={cleanHtml || payload.htmlContent}
                    fallbackText={payload.preview || payload.content}
                    preview={true}
                    style={{
                        // Keep a single scrollbar on .popover-content to avoid nested scrollbars.
                        maxHeight: "none",
                        overflow: "visible",
                        fontSize: "var(--clipboard-item-font-size)",
                        lineHeight: "1.5"
                    }}
                />
            );
        }
        return payload.content || payload.preview || "";
    }, [payload, effectiveRichImageFallbackSrc, effectiveRichTextSnapshotSrc, mediaFailed]);

    return (
        <div className="compact-preview-root">
            <motion.div
                ref={containerRef}
                className={`compact-popover-portal compact-preview-window theme-${normalizeThemeId(payload?.theme || DEFAULT_THEME)} ${payload?.contentType === "image" ? "compact-preview-image" : ""} ${payload?.contentType === "image" || payload?.contentType === "video" || !!effectiveRichImageFallbackSrc || useSnapshotPreviewImage ? "compact-preview-media" : ""} ${payload?.colorMode === "dark" ? "dark-mode" : ""}`}
                initial={{ opacity: 0, scale: 0.95, y: 3 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{
                    type: "spring",
                    damping: 26,
                    stiffness: 360,
                    mass: 0.8
                }}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    transformOrigin: "center center"
                }}
            >
                <div ref={metaRef} className="popover-meta">
                    <div className="meta-row">
                        {getIcon(payload?.contentType || "text")}
                        <span>{payload?.contentType || "text"}</span>
                    </div>
                    <div className="meta-dot">•</div>
                    <div className="meta-row">
                        <AppWindow size={14} />
                        <span>{payload?.sourceApp || "Unknown"}</span>
                    </div>
                    <div className="meta-dot">•</div>
                    <div className="meta-row">
                        <Clock size={14} />
                        <span>
                            {payload?.timestamp && payload?.language
                                ? getConciseTime(payload.timestamp, payload.language)
                                : "-"}
                        </span>
                    </div>
                </div>
                <div ref={dividerRef} className="popover-divider" />
                <motion.div
                    key={payload?.requestId}
                    ref={contentRef}
                    initial={{ opacity: 0.4 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                    className={`popover-content${payload?.contentType === "code" ? " compact-preview-code" : ""}`}
                >
                    {content}
                </motion.div>
            </motion.div>
        </div>
    );
};

export default CompactPreviewWindow;
