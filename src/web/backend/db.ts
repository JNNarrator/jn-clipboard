/**
 * IndexedDB schema for the web build, standing in for the SQLite database the
 * desktop app keeps in `src-tauri/src/database.rs`.
 *
 * The shapes mirror the Rust tables (and therefore the `ClipboardEntry` the UI
 * already renders) so no component needs a web-specific branch:
 *
 * - `entries`  ← `clipboard_history`
 * - `settings` ← `settings` (a flat key/value map, same keys, same defaults)
 * - `tags`     ← `tag_colors`
 */
import Dexie, { type Table } from "dexie";
import type { ClipboardEntry } from "../../shared/types";

/** Row as stored. `tags` is an array in IndexedDB, joined on read. */
export interface StoredEntry {
  id?: number;
  content_type: string;
  content: string;
  html_content?: string;
  source_app: string;
  preview: string;
  /** First capture time; never changes. */
  created_at: number;
  /** Most recent paste/open time. */
  last_used_at: number;
  /** List ordering key: bumped on paste unless the entry is pinned. */
  sort_at: number;
  is_pinned: boolean;
  pinned_order?: number;
  tags: string[];
  note?: string;
  use_count: number;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface TagColorRow {
  name: string;
  color: string;
}

export class WebDatabase extends Dexie {
  entries!: Table<StoredEntry, number>;
  settings!: Table<SettingRow, string>;
  tags!: Table<TagColorRow, string>;

  constructor() {
    super("tiez-clipboard");
    this.version(1).stores({
      // `sort_at` and `created_at` are the two orderings the UI asks for;
      // `*tags` is a multi-entry index so tag filtering stays a single lookup.
      entries: "++id, sort_at, created_at, last_used_at, content_type, is_pinned, *tags",
      settings: "key",
      tags: "name",
    });
  }
}

export const db = new WebDatabase();

/** Convert a stored row into the shape the UI consumes. */
export function toEntry(row: StoredEntry): ClipboardEntry {
  return {
    id: row.id!,
    content_type: row.content_type,
    content: row.content,
    html_content: row.html_content,
    source_app: row.source_app,
    preview: row.preview,
    timestamp: row.sort_at,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    sort_at: row.sort_at,
    is_pinned: row.is_pinned,
    pinned_order: row.pinned_order,
    tags: row.tags ?? [],
    note: row.note,
    use_count: row.use_count,
  };
}
