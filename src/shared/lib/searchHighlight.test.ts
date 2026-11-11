import { describe, expect, test } from "vitest";
import type { ClipboardEntry } from "../types";
import { parseSearchQuery } from "./searchQuery";
import { findHighlightRanges, windowAroundRanges } from "./searchHighlight";

const entry = (preview: string, contentType = "text"): ClipboardEntry =>
  ({
    id: 1,
    content: preview,
    preview,
    content_type: contentType,
    source_app: "test",
    timestamp: 1,
  }) as unknown as ClipboardEntry;

describe("findHighlightRanges", () => {
  test("finds every case-insensitive hit in the preview", () => {
    const parsed = parseSearchQuery("ssh");
    const ranges = findHighlightRanges(
      entry("gm_ssh.88933.vip is ssh host SSH.com"),
      parsed
    );
    expect(ranges).toEqual([
      { start: 3, end: 6 },
      { start: 20, end: 23 },
      { start: 29, end: 32 },
    ]);
  });

  test("no term, scoped filters or non-text types highlight nothing", () => {
    expect(findHighlightRanges(entry("abc ssh"), parseSearchQuery(""))).toEqual([]);
    expect(findHighlightRanges(entry("abc ssh"), parseSearchQuery("tag:ssh"))).toEqual([]);
    expect(findHighlightRanges(entry("abc ssh"), parseSearchQuery("note:ssh"))).toEqual([]);
    expect(
      findHighlightRanges(entry("abc ssh", "image"), parseSearchQuery("ssh"))
    ).toEqual([]);
  });

  test("a hit in the note does not highlight the preview", () => {
    const item = entry("nothing here");
    item.note = "the ssh part is in the note";
    expect(findHighlightRanges(item, parseSearchQuery("ssh"))).toEqual([]);
  });

  test("a quoted phrase keeps its quotes as part of the term", () => {
    // parseSearchQuery keeps the quotes; the highlight uses the term verbatim,
    // the same rule the filter uses. A single term can never self-nest, so
    // dedupe stays a no-op here — it exists for future multi-term support.
    const ranges = findHighlightRanges(
      entry('say "hello" now "hello" again'),
      parseSearchQuery('"hello"')
    );
    expect(ranges).toEqual([
      { start: 4, end: 11 },
      { start: 16, end: 23 },
    ]);
  });

  test("no match yields empty ranges, not a crash", () => {
    expect(findHighlightRanges(entry("abc"), parseSearchQuery("zzz"))).toEqual([]);
  });
});

describe("windowAroundRanges", () => {
  const longText = "x".repeat(100) + "NEEDLE" + "y".repeat(100);

  test("keeps the hit with leading context and marks the ellipsis-free text", () => {
    const { text, ranges } = windowAroundRanges(longText, [{ start: 100, end: 106 }]);
    expect(text.startsWith("xxxx")).toBe(true);
    expect(text).toContain("NEEDLE");
    expect(ranges[0].end - ranges[0].start).toBe(6);
    // Shifted into the sliced coordinate system
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe("NEEDLE");
  });

  test("returns input untouched when there is nothing to window", () => {
    expect(windowAroundRanges("abc", [])).toEqual({ text: "abc", ranges: [] });
  });
});
