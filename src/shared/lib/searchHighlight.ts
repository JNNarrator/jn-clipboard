import type { ClipboardEntry } from "../types";
import type { ParsedSearchQuery } from "./searchQuery";

const TEXT_TYPES = new Set(["text", "code", "url", "rich_text"]);

/**
 * One contiguous run that matched, in character offsets relative to the text
 * being shown. Kept primitive so the renderer can slice however it wants.
 */
export interface HighlightRange {
  start: number;
  end: number;
}

/**
 * Find every case-insensitive occurrence of the term in a text.
 *
 * The search itself is `String.includes` semantics (see `entryMatchesSearch`),
 * so the highlight must use the exact same matching rule — a hit the filter
 * accepted but the renderer cannot see looks like a bug to the user.
 *
 * Quoted phrases come through `parseSearchQuery` verbatim; term is already
 * lowercased there.
 */
function rangesInText(text: string, term: string): HighlightRange[] {
  if (!term) return [];
  const haystack = text.toLowerCase();
  const ranges: HighlightRange[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at === -1) break;
    ranges.push({ start: at, end: at + term.length });
    from = at + term.length;
  }
  return ranges;
}

function dedupe(ranges: HighlightRange[]): HighlightRange[] {
  // A quoted multi-word phrase overlaps its own words' hits; the user needs
  // one mark, not nested marks. Sort and absorb overlaps.
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: HighlightRange[] = [{ ...sorted[0] }];
  for (const range of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      out.push({ ...range });
    }
  }
  return out;
}

/**
 * Where the current search's hits are in an entry's preview text — what the
 * list rows actually display. Note/tag/source-app matches highlight nothing
 * in the content: they did not hit the content.
 */
export function findHighlightRanges(
  item: ClipboardEntry,
  parsed: ParsedSearchQuery
): HighlightRange[] {
  const { term, tagOnly, noteOnly } = parsed;
  if (!term || tagOnly || noteOnly) return [];
  if (!TEXT_TYPES.has(item.content_type)) return [];
  const preview = item.preview ?? "";
  return dedupe(rangesInText(preview, term));
}

/**
 * Window a long text around its first hits, so the user sees why a row
 * matched without reading the whole preview. The highlight ranges are
 * translated into the sliced text's coordinate system.
 */
export function windowAroundRanges(
  text: string,
  ranges: HighlightRange[],
  context = 24
): { text: string; ranges: HighlightRange[] } {
  if (!ranges.length || !text) return { text, ranges };
  const first = ranges[0];
  const windowStart = Math.max(0, first.start - context);
  const sliced = text.slice(windowStart);
  const shifted = ranges
    .map((range) => ({ start: range.start - windowStart, end: range.end - windowStart }))
    .filter((range) => range.end > 0 && range.start < sliced.length);
  return { text: sliced, ranges: shifted };
}
