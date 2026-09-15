import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toTauriLocalImageSrc } from "../lib/localImageSrc";
import {
  isHtmlishTagText,
  isOfficeStyleDefinitionText,
  stripOfficePreviewNoise
} from "../lib/repairHtmlFragment";

const pickFirstSrcFromSrcset = (srcset?: string | null): string | null => {
  if (!srcset) return null;
  const first = srcset
    .split(",")
    .map((part) => part.trim())
    .find(Boolean);
  if (!first) return null;
  const url = first.split(/\s+/)[0]?.trim();
  return url || null;
};

/** Drop authoring font sizes so list/hover preview follows app typography. */
const stripFontSizeFromCssText = (cssText: string): string => {
  return cssText
    .replace(/font-size\s*:\s*[^;]+;?/gi, "")
    .replace(/;\s*;/g, ";")
    .replace(/^;+|;+$/g, "")
    .trim();
};

const stripUnsafeCssText = (cssText: string): string => {
  return cssText
    .replace(/@import\s+[^;]+;?/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/(^|[;{])\s*(?:position|z-index|inset|top|right|bottom|left)\s*:\s*[^;}]+;?/gi, "$1")
    .replace(
      /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi,
      (full, _quote: string, rawUrl: string) => {
        const url = rawUrl.trim();
        return /^(?:data:image\/|https?:\/\/asset\.localhost\/|asset:)/i.test(url)
          ? full
          : "none";
      }
    )
    .replace(/;\s*;/g, ";")
    .replace(/^;+|;+$/g, "")
    .trim();
};

const resolveImgSource = (el: Element): string | null => {
  const src = el.getAttribute("src")?.trim() || "";
  const lazyAttrs = [
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-actualsrc",
    "data-url"
  ];
  const lazySrc =
    lazyAttrs
      .map((name) => el.getAttribute(name)?.trim() || "")
      .find(Boolean) || "";
  const srcsetPrimary = pickFirstSrcFromSrcset(el.getAttribute("srcset"));
  const lazySrcsetPrimary = pickFirstSrcFromSrcset(el.getAttribute("data-srcset"));

  const isMissingOrPlaceholder =
    !src ||
    src === "about:blank" ||
    src === "#" ||
    src.toLowerCase().startsWith("blob:");

  if (isMissingOrPlaceholder) {
    return lazySrc || srcsetPrimary || lazySrcsetPrimary || null;
  }
  return src;
};

const SANITIZE_CACHE_LIMIT = 100;
const sanitizeCache = new Map<string, { html: string; hasRenderable: boolean }>();

const hashSanitizeKey = (html: string, preview?: boolean): string => {
  let hash = 2166136261;
  const str = (preview ? "p:" : "f:") + html;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16) + ":" + html.length;
};

const sanitizeHTML = (html: string, preview?: boolean) => {
  const cacheKey = hashSanitizeKey(html, preview);
  const cached = sanitizeCache.get(cacheKey);
  if (cached) return cached;

  const parser = new DOMParser();

  const stripLeadingPreviewNoise = (container: HTMLElement) => {
    if (!container.querySelector("table, p, div, img, ul, ol, blockquote, pre")) return;

    for (const node of Array.from(container.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim() || "";
        if (!text) {
          container.removeChild(node);
          continue;
        }
        if (isHtmlishTagText(text) || isOfficeStyleDefinitionText(text)) {
          container.removeChild(node);
          continue;
        }
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        const tagName = element.tagName.toLowerCase();
        if (tagName === "style" && isOfficeStyleDefinitionText(element.textContent || "")) {
          container.removeChild(node);
          continue;
        }
        if (tagName === "meta" || tagName === "link" || tagName === "xml") {
          container.removeChild(node);
          continue;
        }
      }

      break;
    }
  };

  // Heuristic: If it contains table elements but no <table> tag, wrap it.
  let processedHtml = stripOfficePreviewNoise(html);
  if ((processedHtml.includes("<tr") || processedHtml.includes("<td") || processedHtml.includes("<col"))
    && !processedHtml.toLowerCase().includes("<table")) {
    processedHtml = `<table style="border-collapse: collapse; min-width: 100%;">${processedHtml}</table>`;
  }

  const doc = parser.parseFromString(processedHtml, "text/html");

  // Keep formatting styles, but remove active/embedded content. Author styles are
  // rendered inside a ShadowRoot below, so their selectors cannot leak into TieZ.
  doc
    .querySelectorAll(
      "script, iframe, frame, object, embed, form, input, button, textarea, select, option, base, template, svg, math"
    )
    .forEach(el => el.remove());
  doc.querySelectorAll("style").forEach((style) => {
    if (isOfficeStyleDefinitionText(style.textContent || "")) {
      style.remove();
      return;
    }
    if (preview && style.textContent) {
      style.textContent = stripFontSizeFromCssText(style.textContent);
    }
    if (style.textContent) {
      style.textContent = stripUnsafeCssText(style.textContent);
    }
  });
  doc.querySelectorAll("meta, link, xml").forEach((el) => el.remove());

  // Truncate tables for preview to save performance & normalize widths
  if (preview) {
    doc.querySelectorAll("table").forEach((table) => {
      table.removeAttribute("width");
      table.removeAttribute("height");
      table.querySelectorAll("col, colgroup").forEach((col) => {
        col.removeAttribute("width");
        col.removeAttribute("style");
      });
      table.querySelectorAll("tr, th, td").forEach((cell) => {
        cell.removeAttribute("width");
        cell.removeAttribute("height");
      });

      const rows = table.querySelectorAll("tr");
      if (rows.length > 6) {
        // Keep first 5 rows for preview
        for (let i = 5; i < rows.length; i++) {
          rows[i].remove();
        }
      }
    });
  }

  // Move styles from head to body to ensure they are included in the final innerHTML
  doc.head.querySelectorAll("style").forEach(style => {
    doc.body.prepend(style);
  });
  stripLeadingPreviewNoise(doc.body);

  const all = doc.querySelectorAll("*");
  all.forEach(el => {
    // Basic sanitization of on* attributes and javascript: links
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      }
      if ((name === "href" || name === "src") && value.startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
      if (name === "style") {
        let cleanedStyle = attr.value
          .replace(/(?:^|;)\s*(?:transform|writing-mode|rotate|scale)\s*:[^;]*/gi, "")
          .trim()
          .replace(/^;+|;+$/g, "");
        cleanedStyle = stripUnsafeCssText(cleanedStyle);
        if (preview) {
          cleanedStyle = stripFontSizeFromCssText(cleanedStyle);
          cleanedStyle = cleanedStyle
            .replace(/(?:^|[;{])\s*(?:width|height|min-width|max-width)\s*:[^;}]+;?/gi, "")
            .replace(/;\s*;/g, ";")
            .trim();
        }
        if (cleanedStyle) {
          el.setAttribute("style", cleanedStyle);
        } else {
          el.removeAttribute("style");
        }
      }
      // Presentational <font size="..."> from older HTML / Office paste
      if (preview && el.tagName.toLowerCase() === "font" && name === "size") {
        el.removeAttribute(attr.name);
      }
    });

    // Handle local file images (including encoded file:// paths)
    if (el.tagName.toLowerCase() === 'img') {
      const resolvedSrc = resolveImgSource(el);
      if (resolvedSrc) {
        if (el.getAttribute("src") !== resolvedSrc) {
          el.setAttribute("src", resolvedSrc);
        }
        const normalizedSrc = resolvedSrc.startsWith("//") ? `https:${resolvedSrc}` : resolvedSrc;
        if (normalizedSrc !== resolvedSrc) {
          el.setAttribute("src", normalizedSrc);
        }

        const localSrc = toTauriLocalImageSrc(normalizedSrc);
        if (localSrc && localSrc !== normalizedSrc) {
          el.setAttribute("src", localSrc);
        }
      }
    }
  });

  const bodyHtml = (doc.body.innerHTML || "").trim();
  const textContent = (doc.body.textContent || "").trim();
  const hasRenderable = !!(
    doc.body.querySelector("img, video, audio, canvas, table, hr, blockquote, pre, code") ||
    textContent
  );

  const result = { html: bodyHtml, hasRenderable };
  if (sanitizeCache.size >= SANITIZE_CACHE_LIMIT) {
    const firstKey = sanitizeCache.keys().next().value;
    if (firstKey) sanitizeCache.delete(firstKey);
  }
  sanitizeCache.set(cacheKey, result);
  return result;
};

type HtmlContentProps = {
  htmlContent: string;
  fallbackText?: string;
  className?: string;
  style?: React.CSSProperties;
  preview?: boolean;
};

const SHADOW_BASE_STYLE = `
  :host {
    display: block;
    color: var(--text-primary);
    font-family: var(--font-main);
    font-size: var(--clipboard-item-font-size);
    line-height: 1.4;
  }
  .tiez-rich-root {
    color: inherit;
    font: inherit;
    line-height: inherit;
    min-width: 0;
    width: 100%;
    overflow-wrap: anywhere;
    text-align: start;
  }
  .tiez-rich-root *:not(table):not(thead):not(tbody):not(tfoot):not(tr):not(th):not(td):not(colgroup):not(col) {
    box-sizing: border-box;
    max-width: 100%;
  }
  .tiez-rich-root img, .tiez-rich-root video { max-width: 100%; height: auto; }
  .tiez-rich-root table {
    border-collapse: collapse !important;
    border-spacing: 0;
    width: 100%;
    margin: var(--rich-preview-block-gap, 0.5em) 0;
    font-size: inherit;
    border: 1px solid var(--line-strong, var(--border-dark));
    border-radius: var(--rich-preview-radius, 6px);
    overflow: hidden;
  }
  .tiez-rich-root th, .tiez-rich-root td {
    border: 1px solid var(--line-soft, var(--border-dark));
    padding: 0.36em 0.55em;
    vertical-align: top;
    word-break: break-word;
    box-sizing: border-box;
  }
  .tiez-rich-root th {
    background-color: var(--bg-button, var(--bg-element));
    font-weight: 600;
  }
  .tiez-rich-root td {
    background-color: var(--bg-element, transparent);
  }
  .tiez-rich-root tr:nth-child(even) td {
    background-color: color-mix(in srgb, var(--bg-element) 60%, transparent);
  }
`;

const SHADOW_PREVIEW_STYLE = `
  .tiez-rich-root {
    color: var(--text-primary);
    line-height: var(--rich-preview-line-height, 1.5);
  }
  .tiez-rich-root *:not(style) {
    font-size: inherit !important;
  }
  .tiez-rich-root > :first-child,
  .tiez-rich-root > style:first-child + * {
    margin-block-start: 0 !important;
  }
  .tiez-rich-root > :last-child {
    margin-block-end: 0 !important;
  }
  .tiez-rich-root > :is(p, div):has(> br:only-child) {
    display: none !important;
  }
  .tiez-rich-root p {
    margin: 0 0 var(--rich-preview-block-gap, 0.5em) !important;
    padding: 0 !important;
    line-height: inherit;
    text-wrap: pretty;
  }
  .tiez-rich-root h1,
  .tiez-rich-root h2,
  .tiez-rich-root h3,
  .tiez-rich-root h4,
  .tiez-rich-root h5,
  .tiez-rich-root h6 {
    margin: 0.62em 0 0.28em !important;
    line-height: 1.22 !important;
    font-weight: 700 !important;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }
  .tiez-rich-root h1 { font-size: 1.28em !important; }
  .tiez-rich-root h2 { font-size: 1.18em !important; }
  .tiez-rich-root h3 { font-size: 1.1em !important; }
  .tiez-rich-root h4,
  .tiez-rich-root h5,
  .tiez-rich-root h6 { font-size: 1.03em !important; }
  .tiez-rich-root strong,
  .tiez-rich-root b {
    font-weight: 700;
  }
  .tiez-rich-root small {
    font-size: 0.92em !important;
  }
  .tiez-rich-root sub,
  .tiez-rich-root sup {
    font-size: 0.78em !important;
    line-height: 0;
  }
  .tiez-rich-root table {
    width: 100% !important;
    border-collapse: collapse !important;
    table-layout: auto;
    margin: var(--rich-preview-block-gap, 0.5em) 0 !important;
    border: 1px solid var(--line-strong, var(--border-dark)) !important;
    border-radius: var(--rich-preview-radius, 6px);
    overflow: hidden;
  }
  .tiez-rich-root td, .tiez-rich-root th {
    border: 1px solid var(--line-soft, var(--border-dark)) !important;
    padding: 0.36em 0.55em !important;
    font-size: 0.92em !important;
    line-height: 1.35 !important;
    word-break: break-word;
  }
  .tiez-rich-root th {
    background-color: var(--bg-button, var(--bg-element));
    font-weight: 600 !important;
  }
  .tiez-rich-root td {
    background-color: var(--bg-element, transparent);
  }
  .tiez-rich-root tr:nth-child(even) td:not([style*="background"]):not([bgcolor]) {
    background-color: color-mix(in srgb, var(--bg-element) 68%, transparent);
  }
  .tiez-rich-root ul,
  .tiez-rich-root ol {
    margin: 0.2em 0 var(--rich-preview-block-gap, 0.5em) !important;
    padding-inline-start: 1.45em !important;
  }
  .tiez-rich-root li {
    margin: 0.12em 0;
    padding-inline-start: 0.08em;
    line-height: inherit;
  }
  .tiez-rich-root blockquote {
    margin: 0.3em 0 var(--rich-preview-block-gap, 0.5em) !important;
    padding: 0.3em 0.68em !important;
    border-inline-start: 2px solid color-mix(in srgb, var(--accent-color) 72%, transparent);
    border-radius: 0 var(--rich-preview-radius, 6px) var(--rich-preview-radius, 6px) 0;
    background: color-mix(in srgb, var(--accent-color) 7%, transparent);
    color: var(--text-secondary);
  }
  .tiez-rich-root pre {
    margin: 0.35em 0 var(--rich-preview-block-gap, 0.5em) !important;
    padding: 0.55em 0.68em !important;
    overflow: hidden;
    border: 1px solid var(--line-soft, var(--border-dark));
    border-radius: var(--rich-preview-radius, 6px);
    background: color-mix(in srgb, var(--text-primary) 6%, transparent);
    font-family: var(--font-mono) !important;
    line-height: 1.45 !important;
    white-space: pre-wrap !important;
    tab-size: 4;
  }
  .tiez-rich-root code,
  .tiez-rich-root kbd,
  .tiez-rich-root samp {
    font-family: var(--font-mono) !important;
  }
  .tiez-rich-root :not(pre) > code,
  .tiez-rich-root kbd {
    padding: 0.08em 0.3em;
    border: 1px solid var(--line-soft, var(--border-dark));
    border-radius: 4px;
    background: color-mix(in srgb, var(--text-primary) 6%, transparent);
  }
  .tiez-rich-root hr {
    height: 1px;
    margin: 0.65em 0 !important;
    border: 0;
    background: var(--line-soft, var(--border-dark));
  }
  .tiez-rich-root mark {
    padding: 0 0.12em;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent-color) 18%, transparent);
    color: inherit;
  }
  .tiez-rich-root a {
    color: var(--accent-color) !important;
    text-decoration-line: underline;
    text-decoration-thickness: from-font;
    text-underline-offset: 0.14em;
    text-decoration-skip-ink: auto;
  }
  .tiez-rich-root figure {
    margin: 0.3em 0 var(--rich-preview-block-gap, 0.5em) !important;
  }
  .tiez-rich-root figcaption {
    margin-block-start: 0.25em;
    color: var(--text-secondary);
    font-size: 0.92em !important;
    line-height: 1.35 !important;
  }
  .tiez-rich-root img,
  .tiez-rich-root video {
    display: block;
    width: auto;
    max-width: 100% !important;
    max-height: var(--rich-preview-image-max-height, 96px) !important;
    margin: 0.25em 0;
    border-radius: var(--rich-preview-radius, 6px);
    object-fit: contain;
    object-position: top left;
  }
  .tiez-rich-root dl {
    margin: 0 0 var(--rich-preview-block-gap, 0.5em) !important;
  }
  .tiez-rich-root dt {
    font-weight: 700;
  }
  .tiez-rich-root dd {
    margin-inline-start: 1.25em;
  }
`;

type Rgba = { r: number; g: number; b: number; a: number };

const parseCssColor = (value: string): Rgba | null => {
  const match = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i
  );
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] == null ? 1 : Number(match[4])
  };
};

const compositeColor = (foreground: Rgba, background: Rgba): Rgba => {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha
  };
};

const relativeLuminance = ({ r, g, b }: Rgba) => {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};

const contrastRatio = (left: Rgba, right: Rgba) => {
  const light = Math.max(relativeLuminance(left), relativeLuminance(right));
  const dark = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (light + 0.05) / (dark + 0.05);
};

const READABLE_PREVIEW_CONTRAST = 3;
const DARK_READABLE_TEXT: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const LIGHT_READABLE_TEXT: Rgba = { r: 255, g: 255, b: 255, a: 1 };

const colorToCss = ({ r, g, b }: Rgba) =>
  `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;

const effectiveBackground = (element: Element, host: HTMLElement): Rgba => {
  let background: Rgba = { r: 0, g: 0, b: 0, a: 0 };
  let current: Element | null = element;

  while (current) {
    const parsed = parseCssColor(getComputedStyle(current).backgroundColor);
    if (parsed && parsed.a > 0) {
      background = compositeColor(background, parsed);
      if (background.a >= 0.99) return background;
    }
    current = current.parentElement;
  }

  current = host;
  while (current) {
    const parsed = parseCssColor(getComputedStyle(current).backgroundColor);
    if (parsed && parsed.a > 0) {
      background = compositeColor(background, parsed);
      if (background.a >= 0.99) return background;
    }
    current = current.parentElement;
  }

  const fallback = parseCssColor(
    getComputedStyle(host).getPropertyValue("--bg-element").trim()
  );
  return fallback ?? { r: 255, g: 255, b: 255, a: 1 };
};

const repairUnreadableSourceColors = (root: ShadowRoot, host: HTMLElement) => {
  const themedForeground = parseCssColor(
    getComputedStyle(host).getPropertyValue("--text-primary").trim()
  );

  root.querySelectorAll<HTMLElement>(".tiez-rich-root *").forEach((element) => {
    if (!(element.textContent || "").trim()) return;
    const foreground = parseCssColor(getComputedStyle(element).color);
    if (!foreground) return;
    const background = effectiveBackground(element, host);
    const opaqueForeground = compositeColor(foreground, background);
    if (contrastRatio(opaqueForeground, background) >= READABLE_PREVIEW_CONTRAST) return;

    const candidates = [
      ...(themedForeground ? [themedForeground] : []),
      DARK_READABLE_TEXT,
      LIGHT_READABLE_TEXT
    ];
    const readable = candidates.reduce((best, candidate) =>
      contrastRatio(candidate, background) > contrastRatio(best, background)
        ? candidate
        : best
    );
    element.style.setProperty("color", colorToCss(readable), "important");
  });
};

const HtmlContent = ({ htmlContent, fallbackText, className, style, preview }: HtmlContentProps) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const processedRef = useRef<{ htmlContent: string; preview?: boolean; fallbackText?: string } | null>(null);
  const [isVisible, setIsVisible] = useState(!!preview);
  const previewPlaceholderMinHeight = (() => {
    const maxH = style?.maxHeight;
    if (typeof maxH === "number" && Number.isFinite(maxH)) return `${maxH}px`;
    if (typeof maxH === "string" && maxH.trim()) return maxH;
    return "40px";
  })();

  useEffect(() => {
    if (preview) return;
    if (!contentRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" } // Load slightly before coming into view
    );

    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [preview]);

  useLayoutEffect(() => {
    if (!isVisible || !contentRef.current) return;
    const prev = processedRef.current;
    if (prev && prev.htmlContent === htmlContent && prev.preview === preview && prev.fallbackText === fallbackText) {
      return;
    }
    processedRef.current = { htmlContent, preview, fallbackText };
    const { html: cleanHTML, hasRenderable } = sanitizeHTML(htmlContent, preview);
    const host = contentRef.current;
    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const renderedContent = !hasRenderable && fallbackText
      ? `<div class="tiez-rich-root" dir="auto"></div>`
      : `<div class="tiez-rich-root" dir="auto">${cleanHTML}</div>`;
    shadowRoot.innerHTML = `<style>${SHADOW_BASE_STYLE}${preview ? SHADOW_PREVIEW_STYLE : ""}</style>${renderedContent}`;

    if (!hasRenderable && fallbackText) {
      const fallbackRoot = shadowRoot.querySelector(".tiez-rich-root");
      if (fallbackRoot) fallbackRoot.textContent = fallbackText;
    } else {
      const repairFrame = requestAnimationFrame(() => repairUnreadableSourceColors(shadowRoot, host));
      return () => cancelAnimationFrame(repairFrame);
    }
  }, [htmlContent, fallbackText, isVisible, preview]);

  return (
    <div
      ref={contentRef}
      className={className}
      style={{
        minHeight: isVisible ? undefined : (preview ? previewPlaceholderMinHeight : '100px'),
        ...style
      }}
    />
  );
};

export default HtmlContent;
