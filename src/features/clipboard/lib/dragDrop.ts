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
  // encodeURI leaves "#" and "?" alone, which would cut the path short.
  const encoded = encodeURI(normalized).replace(/#/g, "%23").replace(/\?/g, "%3F");
  return `file://${normalized.startsWith("/") ? "" : "/"}${encoded}`;
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

const roundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
};

const drawDragIcon = (ctx: CanvasRenderingContext2D, type: string, centerY: number) => {
  const svg = new DOMParser().parseFromString(SVG_ICONS[type] || SVG_ICONS.text, "image/svg+xml");
  ctx.save();
  ctx.translate(12.5, centerY - 6.5);
  ctx.scale(13 / 24, 13 / 24);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const shape of svg.documentElement.children) {
    const number = (name: string) => Number(shape.getAttribute(name) || 0);
    if (shape.tagName === "path") {
      ctx.stroke(new Path2D(shape.getAttribute("d") || ""));
      continue;
    }
    ctx.beginPath();
    if (shape.tagName === "rect") {
      roundedRect(ctx, number("x"), number("y"), number("width"), number("height"), number("rx"));
    } else if (shape.tagName === "circle") {
      ctx.arc(number("cx"), number("cy"), number("r"), 0, Math.PI * 2);
    } else if (shape.tagName === "line") {
      ctx.moveTo(number("x1"), number("y1"));
      ctx.lineTo(number("x2"), number("y2"));
    } else if (shape.tagName === "polyline" || shape.tagName === "polygon") {
      const points = (shape.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i + 1 < points.length; i += 2) {
        if (i === 0) ctx.moveTo(points[i], points[i + 1]);
        else ctx.lineTo(points[i], points[i + 1]);
      }
      if (shape.tagName === "polygon") ctx.closePath();
    }
    ctx.stroke();
  }
  ctx.restore();
};

/** A transparent bitmap keeps the native drag preview free of a DOM backdrop. */
export const createDragGhostBadge = (
  item: ClipboardEntry,
  filePaths: string[],
  theme: string,
  t: (key: string) => string
): HTMLCanvasElement => {
  let labelText = "";
  if (item.content_type === "file") {
    const paths = filePaths.length > 0 ? filePaths : [item.content];
    const valid = paths.map((p) => p.trim()).filter(Boolean);
    if (valid.length > 1) {
      labelText = `${valid.length} ${t("items")}`;
    } else if (valid[0]) {
      labelText = valid[0].split(/[\\/]/).pop() || "File";
    } else {
      labelText = item.content.split(/[\\/]/).pop() || "File";
    }
  } else if (item.content_type === "image") {
    labelText = t("image");
  } else if (item.content_type === "url") {
    labelText = item.content.replace(/^https?:\/\//, "");
  } else {
    labelText = item.content.trim().replace(/\s+/g, " ");
  }
  const characters = Array.from(labelText);
  if (characters.length > 24) labelText = characters.slice(0, 22).join("") + "…";

  const badge = document.createElement("canvas");
  const ctx = badge.getContext("2d");
  if (!ctx) throw new Error("Unable to create drag preview");
  const font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.font = font;
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const textWidth = (text: string) => {
    const metrics = ctx.measureText(text);
    return Math.max(metrics.width, metrics.actualBoundingBoxRight) + Math.max(0, metrics.actualBoundingBoxLeft);
  };
  // Fit the actual glyph bounds, including emoji and font fallback, while
  // preserving whole Unicode code points when adding the ellipsis.
  while (textWidth(labelText) > 170) {
    labelText = Array.from(labelText.replace(/…$/, "")).slice(0, -1).join("") + "…";
  }
  const metrics = ctx.measureText(labelText);
  const labelLeft = 38;
  const labelWidth = Math.ceil(textWidth(labelText));
  const ascent = Math.max(0, metrics.actualBoundingBoxAscent);
  const descent = Math.max(0, metrics.actualBoundingBoxDescent);
  badge.width = labelLeft + labelWidth + 18;
  badge.height = Math.max(34, Math.ceil(ascent + descent) + 12);
  const centerY = badge.height / 2;
  badge.className = "drag-ghost-badge";
  Object.assign(badge.style, {
    position: "fixed",
    top: "0",
    left: "0",
    zIndex: "999999",
    pointerEvents: "none",
    background: "transparent",
    border: "none",
    boxShadow: "none",
    width: `${badge.width}px`,
    height: `${badge.height}px`
  });

  const isDark = theme === "dark" || document.documentElement.classList.contains("dark-mode");
  // Canvas starts transparent. Paint only the rounded pill; no outer shadow
  // or rectangular element background is included in the drag image.
  roundedRect(ctx, 0.5, 0.5, badge.width - 1, badge.height - 1, centerY - 0.5);
  ctx.fillStyle = isDark ? "#18181c" : "#ffffff";
  ctx.fill();
  ctx.strokeStyle = isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(19, centerY, 11, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim() || "#3b82f6";
  ctx.fill();
  drawDragIcon(ctx, item.content_type, centerY);
  // Resizing the canvas resets its context. Set the same font/alignment used
  // for measurement explicitly, then clip all text to the pill's safe area.
  ctx.save();
  roundedRect(ctx, 1, 1, badge.width - 2, badge.height - 2, centerY - 1);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(labelLeft, 6, labelWidth, badge.height - 12);
  ctx.clip();
  ctx.font = font;
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.fillStyle = isDark ? "#f4f4f5" : "#18181b";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(labelText, labelLeft + Math.max(0, metrics.actualBoundingBoxLeft), centerY + (ascent - descent) / 2);
  ctx.restore();
  return badge;
};
