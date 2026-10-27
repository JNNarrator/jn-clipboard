import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { db } from "./db";
import {
  captureEntry,
  clearHistory,
  deleteEntry,
  listHistory,
  markUsed,
  searchHistory,
  setNote,
  setPinned,
  setTags,
} from "./history";

beforeEach(async () => {
  await db.entries.clear();
  await db.tags.clear();
});

describe("capture", () => {
  test("stores a text clip and lists it back in UI shape", async () => {
    const id = await captureEntry({ content: "hello world\n" });
    expect(id).toBeGreaterThan(0);

    const [entry] = await listHistory(10, 0);
    expect(entry.id).toBe(id);
    expect(entry.content_type).toBe("text");
    // Trailing whitespace is trimmed, exactly like the native capture pipeline.
    expect(entry.content).toBe("hello world");
    expect(entry.preview).toBe("hello world");
    expect(entry.source_app).toBe("Web");
    expect(entry.is_pinned).toBe(false);
    expect(entry.tags).toEqual([]);
    expect(entry.timestamp).toBe(entry.sort_at);
  });

  test("rejects blank captures", async () => {
    await expect(captureEntry({ content: "   \n\t " })).rejects.toThrow();
    expect(await db.entries.count()).toBe(0);
  });

  test("bumps an identical clip instead of duplicating it", async () => {
    const first = await captureEntry({ content: "same text" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await captureEntry({ content: "same text" });

    expect(second).toBe(first);
    expect(await db.entries.count()).toBe(1);
  });

  test("keeps a pinned copy and a fresh copy apart", async () => {
    const pinned = await captureEntry({ content: "keep me" });
    await setPinned(pinned, true);
    await captureEntry({ content: "keep me" });

    expect(await db.entries.count()).toBe(2);
  });

  test("long content is truncated into the preview but stored whole", async () => {
    const long = "x".repeat(1000);
    await captureEntry({ content: long });
    const [entry] = await listHistory(10, 0);
    expect(entry.content).toHaveLength(1000);
    expect(entry.preview).toHaveLength(401); // 400 chars + ellipsis
    expect(entry.preview.endsWith("…")).toBe(true);
  });
});

describe("ordering", () => {
  test("newest activity first", async () => {
    await captureEntry({ content: "older" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await captureEntry({ content: "newer" });

    const entries = await listHistory(10, 0);
    expect(entries.map((entry) => entry.content)).toEqual(["newer", "older"]);
  });

  test("pinned entries come first regardless of age", async () => {
    const old = await captureEntry({ content: "old" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await captureEntry({ content: "new" });
    await setPinned(old, true);

    const entries = await listHistory(10, 0);
    expect(entries.map((entry) => entry.content)).toEqual(["old", "new"]);
    expect(entries[0].is_pinned).toBe(true);
  });

  test("created sort ignores later activity", async () => {
    const first = await captureEntry({ content: "first" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await captureEntry({ content: "second" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Using the older entry moves it to the top of the activity order only.
    await markUsed(first);

    const byActivity = await listHistory(10, 0);
    expect(byActivity.map((entry) => entry.content)).toEqual(["first", "second"]);

    const byCreated = await listHistory(10, 0, undefined, "created");
    expect(byCreated.map((entry) => entry.content)).toEqual(["second", "first"]);
  });

  test("paging slices without overlap", async () => {
    for (const text of ["a", "b", "c", "d"]) {
      await captureEntry({ content: text });
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    const page1 = await listHistory(2, 0);
    const page2 = await listHistory(2, 2);
    expect(page1.map((entry) => entry.content)).toEqual(["d", "c"]);
    expect(page2.map((entry) => entry.content)).toEqual(["b", "a"]);
  });

  test("content type filter narrows the list", async () => {
    await captureEntry({ content: "text one" });
    await captureEntry({ content: "data:image/png;base64,AAA", content_type: "image" });

    const images = await listHistory(10, 0, "image");
    expect(images).toHaveLength(1);
    expect(images[0].content_type).toBe("image");
  });
});

describe("usage", () => {
  test("markUsed counts a paste and moves the entry up", async () => {
    const first = await captureEntry({ content: "first" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await captureEntry({ content: "second" });
    await markUsed(first);

    const entries = await listHistory(10, 0);
    expect(entries[0].content).toBe("first");
    expect(entries[0].use_count).toBe(1);
  });

  test("markUsed on a missing id is a no-op", async () => {
    await expect(markUsed(9999)).resolves.toBeUndefined();
  });
});

describe("search", () => {
  test("matches content, source app and tags case-insensitively", async () => {
    const note = await captureEntry({ content: "Meeting notes\nagenda" });
    await setTags(note, ["Work", "urgent"]);
    await captureEntry({ content: "unrelated", source_app: "Safari" });

    expect((await searchHistory({ searchTerm: "AGENDA", limit: 10 })).map((e) => e.id)).toEqual([note]);
    expect((await searchHistory({ searchTerm: "safari", limit: 10 })).map((e) => e.content)).toEqual(["unrelated"]);
    expect((await searchHistory({ searchTerm: "urgent", limit: 10 })).map((e) => e.id)).toEqual([note]);
  });

  test("tag-only and note-only modes look at one field", async () => {
    const tagged = await captureEntry({ content: "body says nothing useful" });
    await setTags(tagged, ["finance"]);
    const annotated = await captureEntry({ content: "another body" });
    await setNote(annotated, "remember the invoice");

    expect((await searchHistory({ searchTerm: "finance", limit: 10, tagOnly: true })).map((e) => e.id)).toEqual([
      tagged,
    ]);
    expect((await searchHistory({ searchTerm: "finance", limit: 10, noteOnly: true }))).toEqual([]);
    expect(
      (await searchHistory({ searchTerm: "invoice", limit: 10, noteOnly: true })).map((e) => e.id),
    ).toEqual([annotated]);
  });

  test("empty term returns nothing rather than everything", async () => {
    await captureEntry({ content: "something" });
    expect(await searchHistory({ searchTerm: "   ", limit: 10 })).toEqual([]);
  });

  test("respects the limit", async () => {
    for (const text of ["one", "two", "three"]) await captureEntry({ content: text });
    expect(await searchHistory({ searchTerm: "t", limit: 2 })).toHaveLength(2);
  });
});

describe("mutation", () => {
  test("tags are de-duplicated and trimmed", async () => {
    const id = await captureEntry({ content: "tag me" });
    await setTags(id, ["  a ", "a", "b", ""]);

    const [entry] = await listHistory(10, 0);
    expect(entry.tags).toEqual(["a", "b"]);
  });

  test("an empty note is stored as absent", async () => {
    const id = await captureEntry({ content: "note me" });
    await setNote(id, "   ");

    const [entry] = await listHistory(10, 0);
    expect(entry.note).toBeUndefined();
  });

  test("unpinning releases the entry back into the normal order", async () => {
    const id = await captureEntry({ content: "toggle" });
    await setPinned(id, true);
    expect((await listHistory(10, 0))[0].pinned_order).toBe(1);

    await setPinned(id, false);
    const [entry] = await listHistory(10, 0);
    expect(entry.is_pinned).toBe(false);
    // Rust resets the order to 0 rather than clearing it.
    expect(entry.pinned_order).toBe(0);
  });

  test("a second pin lands above the first", async () => {
    const first = await captureEntry({ content: "first" });
    const second = await captureEntry({ content: "second" });
    await setPinned(first, true);
    await setPinned(second, true);

    const entries = await listHistory(10, 0);
    expect(entries.map((entry) => entry.content)).toEqual(["second", "first"]);
    expect(entries.map((entry) => entry.pinned_order)).toEqual([2, 1]);
  });

  test("delete and clear remove rows", async () => {
    const id = await captureEntry({ content: "doomed" });
    await deleteEntry(id);
    expect(await db.entries.count()).toBe(0);

    await captureEntry({ content: "one" });
    await captureEntry({ content: "two" });
    await clearHistory();
    expect(await db.entries.count()).toBe(0);
  });
});
