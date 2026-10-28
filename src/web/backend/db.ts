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
 * - `meta`     ← the single-row bookkeeping the desktop keeps in `settings`
 *
 * ## Sync columns
 *
 * Rows carry three extra columns that exist only to make sync possible; the UI
 * never reads them:
 *
 * - `sync_id`   identity that survives a round trip through the server, unlike
 *               the auto-increment `id`, which is per-profile
 * - `rev`       bumped on every local write; the server rejects a push whose rev
 *               is not greater than the stored one (optimistic lock)
 * - `dirty`     1 when the row has changes the server has not acknowledged yet,
 *               so a push only has to read the index instead of every row
 *
 * Deletions are tombstones rather than hard deletes: a row that vanished
 * locally has to reach the other devices somehow, and "absence" is not a
 * thing a delta protocol can send.
 */
import Dexie, { type Table, type Transaction } from "dexie";
import type { ClipboardEntry } from "../../shared/types";

/** Same rule the Rust side uses for generating ids; falls back when unavailable. */
export function newSyncId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  // Only reachable in insecure contexts, where `randomUUID` is not exposed.
  const bytes = new Uint8Array(16);
  if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Columns every syncable row needs, in both tables. */
export interface SyncColumns {
  sync_id: string;
  /** Version counter for the server's optimistic lock. */
  rev: number;
  /** 1 while the row holds changes the server has not seen. */
  dirty: number;
  /** Tombstone time; a non-null value means "deleted, tell the other devices". */
  deleted_at?: number;
}

/** Row as stored. `tags` is an array in IndexedDB, joined on read. */
export interface StoredEntry extends SyncColumns {
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

export interface SettingRow extends SyncColumns {
  key: string;
  value: string;
}

export interface TagColorRow {
  name: string;
  color: string;
}

/** Single-row bookkeeping table; `key` is always "sync". */
export interface MetaRow {
  key: string;
  /** Highest server seq this profile has applied. */
  last_seq: number;
  /** Unix ms of the last successful round trip, for the settings pane. */
  last_sync_at?: number;
  /** Last error text, cleared on the next success. */
  last_error?: string;
}

/**
 * Set while a remote batch is being written. The Dexie hooks below bump `rev`
 * and set `dirty` on local writes; a row that just arrived *from* the server
 * must be stored verbatim, or every pull would immediately queue itself for a
 * push back to where it came from.
 */
let applyingRemote = false;

export function setApplyingRemote(value: boolean): void {
  applyingRemote = value;
}

export function isApplyingRemote(): boolean {
  return applyingRemote;
}

/**
 * Insert shapes. The three sync columns are filled in by the hooks below, so a
 * write path neither has to invent a `sync_id` nor remember to set `dirty`
 * before it has any idea what those mean.
 */
export type EntryInsert = Omit<StoredEntry, keyof SyncColumns> & Partial<SyncColumns>;
export type SettingInsert = Omit<SettingRow, keyof SyncColumns> & Partial<SyncColumns>;

export class WebDatabase extends Dexie {
  entries!: Table<StoredEntry, number, EntryInsert>;
  settings!: Table<SettingRow, string, SettingInsert>;
  tags!: Table<TagColorRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("tiez-clipboard");
    this.version(1).stores({
      // `sort_at` and `created_at` are the two orderings the UI asks for;
      // `*tags` is a multi-entry index so tag filtering stays a single lookup.
      entries: "++id, sort_at, created_at, last_used_at, content_type, is_pinned, *tags",
      settings: "key",
      tags: "name",
    });
    this.version(2)
      .stores({
        entries:
          "++id, &sync_id, sort_at, created_at, last_used_at, content_type, is_pinned, *tags, dirty",
        settings: "key, dirty",
        tags: "name",
        meta: "key",
      })
      .upgrade((tx) => backfillSyncColumns(tx));

    this.registerSyncHooks();
  }

  /**
   * Every local insert/update has to advance the version and flip the dirty
   * flag. Doing it in hooks rather than in `history.ts` means no write path can
   * forget to, including ones added later.
   */
  private registerSyncHooks(): void {
    this.entries.hook("creating", (_primKey, obj) => {
      if (applyingRemote) return;
      const row = obj as StoredEntry;
      row.sync_id = row.sync_id || newSyncId();
      row.rev = row.rev ?? 1;
      row.dirty = 1;
    });

    this.entries.hook("updating", (mods, _primaryKey, existing) => {
      if (applyingRemote) return undefined;
      const row = existing as unknown as StoredEntry;
      // `mods` wins over the stored row, so a caller that explicitly clears a
      // tombstone (or sets one) keeps that decision; everything else is the
      // version bump.
      return {
        ...(mods as Record<string, unknown>),
        rev: (row.rev ?? 0) + 1,
        dirty: 1,
      };
    });

    this.settings.hook("creating", (_primKey, obj) => {
      if (applyingRemote) return;
      const row = obj as SettingRow;
      row.sync_id = row.sync_id || newSyncId();
      row.rev = row.rev ?? 1;
      row.dirty = 1;
    });

    this.settings.hook("updating", (mods, _primaryKey, existing) => {
      if (applyingRemote) return undefined;
      const row = existing as unknown as SettingRow;
      return {
        ...(mods as Record<string, unknown>),
        rev: (row.rev ?? 0) + 1,
        dirty: 1,
      };
    });
  }
}

/** Give pre-existing rows the columns the sync engine needs. */
async function backfillSyncColumns(tx: Transaction): Promise<void> {
  await tx
    .table("entries")
    .toCollection()
    .modify((row: Partial<StoredEntry>) => {
      row.sync_id = row.sync_id || newSyncId();
      row.rev = row.rev ?? 1;
      // Nothing has ever been uploaded from a v1 profile, so everything starts
      // dirty: the first sync after the upgrade is a full upload.
      row.dirty = 1;
    });
  await tx
    .table("settings")
    .toCollection()
    .modify((row: Partial<SettingRow>) => {
      row.sync_id = row.sync_id || newSyncId();
      row.rev = row.rev ?? 1;
      row.dirty = 1;
    });
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
