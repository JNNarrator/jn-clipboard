/**
 * History operations for the web build.
 *
 * The desktop app learns about new clips from a native clipboard watcher. A web
 * page cannot watch the clipboard, so capture is explicit: the user pastes into
 * the capture bar (or presses Ctrl/Cmd+V while the app is focused) and
 * `captureEntry` stores the result. Everything downstream — list, search, tags,
 * pinning — reads the same table the watcher would have written.
 */
import { db, toEntry, type EntryInsert, type StoredEntry } from "./db";
import type { ClipboardEntry } from "../../shared/types";

export type SortMode = "activity" | "created" | "last_used" | "usage" | "manual" | "recent";

export interface CaptureInput {
  content: string;
  content_type?: string;
  html_content?: string;
  source_app?: string;
}

/** Same trimming rule as the capture pipeline: nothing blank gets stored. */
export function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\s+$/u, "");
}

function buildPreview(content: string, type: string): string {
  const flat = content.replace(/\s+/gu, " ").trim();
  if (type === "image") return flat || "Image";
  return flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
}

/**
 * Drop tombstones. A deleted entry stays in the table until the server has
 * acknowledged the deletion, so every read path has to filter on its own.
 */
function liveRows(rows: StoredEntry[]): StoredEntry[] {
  return rows.filter((row) => row.deleted_at === undefined || row.deleted_at === null);
}

function isLive(row: StoredEntry): boolean {
  return row.deleted_at === undefined || row.deleted_at === null;
}

/**
 * Store one clip. Returns the new id. An identical, unpinned text entry is
 * bumped to the top instead of being duplicated — the desktop side does the same
 * when deduplication is on (it is by default).
 */
export async function captureEntry(input: CaptureInput): Promise<number> {
  const content = normalizeContent(input.content);
  if (!content.trim()) throw new Error("Nothing to capture");

  const contentType = input.content_type ?? "text";
  const now = Date.now();

  const duplicate = await db.entries
    .filter(
      (row) =>
        row.content_type === contentType &&
        row.content === content &&
        !row.is_pinned &&
        isLive(row),
    )
    .first();

  if (duplicate?.id !== undefined) {
    await db.entries.update(duplicate.id, { sort_at: now, last_used_at: now });
    return duplicate.id;
  }

  // The sync columns are added by the Dexie hooks in db.ts.
  const row: EntryInsert = {
    content_type: contentType,
    content,
    html_content: input.html_content,
    source_app: input.source_app ?? "Web",
    preview: buildPreview(content, contentType),
    created_at: now,
    last_used_at: now,
    sort_at: now,
    is_pinned: false,
    tags: [],
    use_count: 0,
  };
  return db.entries.add(row);
}

function sortKey(row: StoredEntry, mode: SortMode): number {
  switch (mode) {
    case "created":
      return row.created_at;
    case "last_used":
      return row.last_used_at;
    case "usage":
      return row.use_count;
    case "manual":
      // Manual order is expressed by `sort_at` too: dragging rewrites it.
      return row.sort_at;
    default:
      return row.sort_at;
  }
}

/**
 * Pinned entries first (a higher `pinned_order` is further up), then the chosen
 * sort. The direction of every key is chosen to match the desktop SQL, so a list
 * exported from one build reads the same in the other.
 */
function compare(a: StoredEntry, b: StoredEntry, mode: SortMode): number {
  // "recent" is the plain-text paste order: newest copy wins even below a pin.
  if (mode === "recent") return b.sort_at - a.sort_at || (b.id ?? 0) - (a.id ?? 0);
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
  if (a.is_pinned && b.is_pinned) {
    return (b.pinned_order ?? 0) - (a.pinned_order ?? 0) || b.sort_at - a.sort_at || (b.id ?? 0) - (a.id ?? 0);
  }
  return sortKey(b, mode) - sortKey(a, mode) || (b.id ?? 0) - (a.id ?? 0);
}

export async function listHistory(
  limit: number,
  offset: number,
  contentType?: string,
  sortMode?: string,
): Promise<ClipboardEntry[]> {
  const mode = (sortMode ?? "manual") as SortMode;
  const rows = liveRows(await db.entries.toArray());
  const filtered = contentType ? rows.filter((row) => row.content_type === contentType) : rows;
  filtered.sort((a, b) => compare(a, b, mode));
  return filtered.slice(offset, offset + limit).map(toEntry);
}

export interface SearchOptions {
  searchTerm: string;
  limit: number;
  tagOnly?: boolean;
  noteOnly?: boolean;
}

/**
 * Substring search over the fields a user is likely to remember. The desktop
 * version uses SQLite FTS; behaviour differs only in ranking, and the results
 * are re-filtered client-side anyway.
 */
export async function searchHistory(options: SearchOptions): Promise<ClipboardEntry[]> {
  const needle = options.searchTerm.trim().toLowerCase();
  if (!needle) return [];
  const rows = liveRows(await db.entries.toArray());
  const matches = rows.filter((row) => {
    if (options.tagOnly) {
      return (row.tags ?? []).some((tag) => tag.toLowerCase().includes(needle));
    }
    if (options.noteOnly) {
      return (row.note ?? "").toLowerCase().includes(needle);
    }
    return (
      row.content.toLowerCase().includes(needle) ||
      row.preview.toLowerCase().includes(needle) ||
      row.source_app.toLowerCase().includes(needle) ||
      (row.tags ?? []).some((tag) => tag.toLowerCase().includes(needle)) ||
      (row.note ?? "").toLowerCase().includes(needle)
    );
  });
  matches.sort((a, b) => a.sort_at - b.sort_at);
  return matches.slice(0, options.limit).map(toEntry);
}

/**
 * Tombstone rather than remove: the row has to reach the other devices, and a
 * delta protocol has no way to say "this is gone" without a body to carry it.
 * The sync engine drops tombstone bodies once every device has acknowledged.
 */
export async function deleteEntry(id: number): Promise<void> {
  await db.entries.update(id, { deleted_at: Date.now() });
}

export async function clearHistory(): Promise<void> {
  const now = Date.now();
  await db.transaction("rw", db.entries, async () => {
    const live = await db.entries.filter(isLive).primaryKeys();
    for (const id of live as number[]) {
      await db.entries.update(id, { deleted_at: now });
    }
  });
}

export async function setPinned(id: number, isPinned: boolean): Promise<void> {
  const now = Date.now();
  if (isPinned) {
    // max + 1: the newest pin sits above the existing ones (order sorts DESC).
    const pinned = await db.entries.filter((row) => row.is_pinned).toArray();
    const nextOrder = pinned.reduce((max, row) => Math.max(max, row.pinned_order ?? 0), 0) + 1;
    await db.entries.update(id, { is_pinned: true, pinned_order: nextOrder, sort_at: now });
  } else {
    await db.entries.update(id, { is_pinned: false, pinned_order: 0, sort_at: now });
  }
}

/** `orders` is `[id, position][]`, matching the Rust command's `Vec<(i64,i64)>`. */
export async function updatePinnedOrder(orders: [number, number][]): Promise<void> {
  await db.transaction("rw", db.entries, async () => {
    for (const [id, order] of orders) {
      await db.entries.update(id, { pinned_order: order });
    }
  });
}

export async function setTags(id: number, tags: string[]): Promise<void> {
  const cleaned = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  await db.entries.update(id, { tags: cleaned });
}

export async function setNote(id: number, note: string): Promise<void> {
  await db.entries.update(id, { note: note.trim() || undefined });
}

export async function setContent(id: number, content: string): Promise<void> {
  const row = await db.entries.get(id);
  if (!row) return;
  const normalized = normalizeContent(content);
  await db.entries.update(id, {
    content: normalized,
    preview: buildPreview(normalized, row.content_type),
  });
}

/** Records a paste: bumps usage counters so the "usage" sort means something. */
export async function markUsed(id: number): Promise<void> {
  const row = await db.entries.get(id);
  if (!row) return;
  const now = Date.now();
  await db.entries.update(id, {
    use_count: row.use_count + 1,
    last_used_at: now,
    sort_at: row.is_pinned ? row.sort_at : now,
  });
}

export async function tagColors(): Promise<Record<string, string>> {
  const rows = await db.tags.toArray();
  return Object.fromEntries(rows.map((row) => [row.name, row.color]));
}

export async function setTagColor(name: string, color: string): Promise<void> {
  await db.tags.put({ name, color });
}
