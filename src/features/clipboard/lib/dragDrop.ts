import type { ClipboardEntry } from "../../../shared/types";
import { stripRichStorageMarkers } from "../../../shared/lib/repairHtmlFragment";

const SVG_ICONS: Record<string, string> = {
  file: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  image: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  video: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
  code: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  url: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  rich_text: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
  text: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>`
};

const normalizeFileUri = (rawPath: string): string => {
  const p = rawPath.trim();
  if (p.startsWith("file://")) return p;
  const normalized = p.replace(/\\/g, "/");
  return `file://${normalized.startsWith("/") ? "" : "/"}${encodeURI(normalized)}`;
};

/**
 * Configure standard dataTransfer payload for dragging items to external windows.
 */
export const setupDragDataTransfer = (
  dt: DataTransfer,
  item: ClipboardEntry,
  filePaths: string[]
): void => {
  dt.effectAllowed = "copyMove";

  if (item.content_type === "file") {
    const paths = filePaths.length > 0 ? filePaths : [item.content];
    const validPaths = paths.map((p) => p.trim()).filter(Boolean);
    const uris = validPaths.map(normalizeFileUri).join("\r\n");
    const plainList = validPaths.join("\n");

    dt.setData("text/uri-list", uris);
    dt.setData("text/plain", plainList);

    const first = validPaths[0];
    if (first) {
      const fileName = first.split(/[\\/]/).pop() || "file";
      const uri = normalizeFileUri(first);
      try {
        dt.setData("DownloadURL", `application/octet-stream:${fileName}:${uri}`);
      } catch {}
    }
  } else if (item.content_type === "url") {
    const trimmed = item.content.trim();
    dt.setData("text/uri-list", trimmed);
    dt.setData("text/plain", trimmed);
    dt.setData("text/html", `<a href="${trimmed}">${trimmed}</a>`);
  } else if (item.content_type === "image") {
    if (item.content.startsWith("data:")) {
      dt.setData("text/html", `<img src="${item.content}" />`);
      dt.setData("text/plain", "[Image]");
    } else {
      const trimmed = item.content.trim();
      const uri = normalizeFileUri(trimmed);
      dt.setData("text/uri-list", uri);
      dt.setData("text/plain", trimmed);
      dt.setData("text/html", `<img src="${uri}" />`);
      const fileName = trimmed.split(/[\\/]/).pop() || "image.png";
      try {
        dt.setData("DownloadURL", `application/octet-stream:${fileName}:${uri}`);
      } catch {}
    }
  } else if (item.content_type === "rich_text") {
    if (item.html_content) {
      dt.setData("text/html", stripRichStorageMarkers(item.html_content));
    }
    dt.setData("text/plain", item.content);
  } else if (item.content_type === "code") {
    dt.setData("text/plain", item.content);
    const escaped = item.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    dt.setData("text/html", `<pre><code>${escaped}</code></pre>`);
  } else {
    dt.setData("text/plain", item.content);
  }
};

/**
 * Creates an elegant floating glassmorphic pill badge for setDragImage.
 */
export const createDragGhostBadge = (
  item: ClipboardEntry,
  filePaths: string[],
  theme: string,
  t: (key: string) => string
): HTMLElement => {
  const badge = document.createElement("div");
  badge.className = "drag-ghost-badge";

  const isDark =
    theme === "dark" ||
    (typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark-mode"));

  Object.assign(badge.style, {
    position: "fixed",
    top: "-9999px",
    left: "-9999px",
    zIndex: "999999",
    pointerEvents: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 14px 6px 8px",
    borderRadius: "9999px",
    background: isDark ? "rgba(24, 24, 28, 0.94)" : "rgba(255, 255, 255, 0.96)",
    border: isDark
      ? "1px solid rgba(255, 255, 255, 0.16)"
      : "1px solid rgba(0, 0, 0, 0.12)",
    boxShadow: isDark
      ? "0 10px 30px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35)"
      : "0 10px 30px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08)",
    color: isDark ? "#f4f4f5" : "#18181b",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    fontSize: "12px",
    fontWeight: "500",
    maxWidth: "280px",
    whiteSpace: "nowrap",
    boxSizing: "border-box",
  });

  // Icon container
  const iconWrapper = document.createElement("div");
  Object.assign(iconWrapper.style, {
    width: "22px",
    height: "22px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: "0",
    background: "var(--accent-color, #3b82f6)",
    color: "#ffffff",
  });
  iconWrapper.innerHTML = SVG_ICONS[item.content_type] || SVG_ICONS.text;
  badge.appendChild(iconWrapper);

  // Label
  const labelSpan = document.createElement("span");
  Object.assign(labelSpan.style, {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "170px",
    lineHeight: "1.2",
  });

  let labelText = "";
  if (item.content_type === "file") {
    const paths = filePaths.length > 0 ? filePaths : [item.content];
    const valid = paths.map((p) => p.trim()).filter(Boolean);
    if (valid.length > 1) {
      labelText = `${valid.length} ${t("items") || "项"}`;
    } else if (valid[0]) {
      labelText = valid[0].split(/[\\/]/).pop() || "File";
    } else {
      labelText = item.content.split(/[\\/]/).pop() || "File";
    }
  } else if (item.content_type === "image") {
    labelText = t("image") || "图片";
  } else if (item.content_type === "url") {
    labelText = item.content.replace(/^https?:\/\//, "");
  } else {
    labelText = item.content.trim().replace(/\s+/g, " ");
  }

  if (labelText.length > 24) {
    labelText = labelText.slice(0, 22) + "…";
  }
  labelSpan.textContent = labelText;
  badge.appendChild(labelSpan);

  return badge;
};
