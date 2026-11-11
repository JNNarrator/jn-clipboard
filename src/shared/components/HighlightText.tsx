import { memo } from "react";
import type { HighlightRange } from "../lib/searchHighlight";

interface HighlightTextProps {
  /** The plain text the row would otherwise render. */
  text: string;
  /** Matched ranges in `text`. Empty renders a plain string. */
  ranges: HighlightRange[];
  /** Leading marker when `text` is a window into a longer string. */
  ellipsisPrefix?: boolean;
  className?: string;
}

/**
 * Renders text with the search hits marked.
 *
 * A memo'd pure function of (text, ranges): the list renders hundreds of these
 * on scroll, so the slices are computed here once per props change rather than
 * re-parsed in an effect.
 */
export const HighlightText = memo(function HighlightText({
  text,
  ranges,
  ellipsisPrefix,
  className,
}: HighlightTextProps) {
  if (!ranges.length) {
    return (
      <span className={className}>
        {ellipsisPrefix ? "…" : ""}
        {text}
      </span>
    );
  }

  const parts: Array<string | { hit: string }> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start));
    }
    // A range may reach past the end when the text was truncated after the
    // ranges were computed; clamp instead of emitting undefined slices.
    parts.push({ hit: text.slice(range.start, Math.min(range.end, text.length)) });
    cursor = Math.min(range.end, text.length);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return (
    <span className={className}>
      {ellipsisPrefix ? "…" : ""}
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i}>{part}</span>
        ) : (
          <mark key={i} className="search-hit">
            {part.hit}
          </mark>
        )
      )}
    </span>
  );
});
