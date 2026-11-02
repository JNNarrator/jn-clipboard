/**
 * Two-way sync between the browser store and `jnclub-module-clipboard`.
 *
 * The shape of the loop is fixed by the server:
 *
 * 1. **push** first — whatever this device changed since the last round trip.
 *    The server answers with the ids it accepted and, for anything it holds at
 *    an equal or newer `rev`, the version it kept.
 * 2. **pull** until `hasMore` is false — everything that moved since this
 *    device's `last_seq`, including its own accepted writes, so the local rows
 *    pick up the server-assigned ordering without a second round trip.
 *
 * Both directions are idempotent, so an interrupted run just resumes.
 */
import {
  db,
  newSyncId,
  setApplyingRemote,
  type MetaRow,
  type SettingRow,
  type StoredEntry,
} from "../backend/db";
import { SyncApi, type SyncConfig } from "./api";
import { dtoToEntry, entryToDto, settingToDto, type RecordDto, type SettingDto } from "./types";

/** Same rule as the desktop engine: only a lowercase hex digest names a blob. */
const BLOB_REF = /^[0-9a-f]{64}$/u;
const MAX_BLOB_BYTES = 20 * 1024 * 1024;

const META_KEY = "sync";

/** Largest page the server will return; asking for more is clamped anyway. */
const PULL_PAGE = 200;

export interface SyncOutcome {
  /** Entries and settings the server took from this device. */
  pushed: number;
  /** Entries the server already held at a newer revision. */
  conflicts: number;
  /** Rows written from the server into this profile. */
  pulled: number;
  /** Row at which this profile is now caught up. */
  lastSeq: number;
}

async function readMeta(): Promise<MetaRow> {
  return (await db.meta.get(META_KEY)) ?? { key: META_KEY, last_seq: 0 };
}

export async function lastSeq(): Promise<number> {
  return (await readMeta()).last_seq;
}

export async function lastSyncAt(): Promise<number | undefined> {
  return (await readMeta()).last_sync_at;
}

export async function lastSyncError(): Promise<string | undefined> {
  return (await readMeta()).last_error;
}

/**
 * A push sends every dirty row. Guarding on `rev` when clearing the flag means
 * a write that lands while the request is in flight stays dirty and goes out
 * again next time instead of being silently marked as acknowledged.
 */
async function push(api: SyncApi): Promise<{ pushed: number; conflicts: number }> {
  const pendingEntries = await db.entries.where("dirty").equals(1).toArray();
  const pendingSettings = await db.settings.where("dirty").equals(1).toArray();
  if (pendingEntries.length === 0 && pendingSettings.length === 0) {
    return { pushed: 0, conflicts: 0 };
  }

  // An image row holds a data URL here; the server stores bytes and the record
  // carries the digest. Uploading first means the row that goes out names
  // content the peer can actually fetch.
  const uploaded = new Map<number, string>();
  for (const row of pendingEntries) {
    if (row.content_type !== "image" || row.id === undefined) continue;
    if (BLOB_REF.test(row.content)) continue;
    const sha = await uploadImage(api, row.content);
    if (sha) uploaded.set(row.id, sha);
  }

  const dtos = pendingEntries.map((row) => {
    const dto = entryToDto(row);
    const sha = row.id === undefined ? undefined : uploaded.get(row.id);
    if (sha) {
      dto.content = sha;
      if (!dto.preview || !dto.preview.trim()) dto.preview = "图片";
    }
    return dto;
  });

  const response = await api.push(dtos, pendingSettings.map(settingToDto));

  const accepted = new Set(response.accepted ?? []);
  const rejected = new Set(response.rejectedSettings ?? []);

  setApplyingRemote(true);
  try {
    await db.transaction("rw", db.entries, db.settings, async () => {
      for (const row of pendingEntries) {
        if (!accepted.has(row.sync_id) || row.id === undefined) continue;
        const sha = uploaded.get(row.id);
        await db.entries.where(":id").equals(row.id).modify((current: StoredEntry) => {
          if (current.rev === row.rev) {
            current.dirty = 0;
            // Keep the digest so the next round does not re-upload the same
            // screenshot; the local row still renders from its data URL.
            if (sha) current.sync_blob = sha;
          }
        });
      }

      for (const row of pendingSettings) {
        // Settings are accepted under their key. A key the server refuses
        // (device-private) is settled too: leaving it dirty would re-upload it
        // on every sync forever.
        if (!accepted.has(row.key) && !rejected.has(row.key)) continue;
        await db.settings.where("key").equals(row.key).modify((current: SettingRow) => {
          if (current.rev === row.rev) current.dirty = 0;
        });
      }

      // Conflicts carry the server's version, which is authoritative by rev.
      for (const conflict of response.conflicts ?? []) {
        const local = await db.entries.where("sync_id").equals(conflict.syncId).first();
        if (local?.id === undefined) continue;
        await db.entries.update(local.id, dtoToEntry(conflict.serverRecord));
      }
    });
  } finally {
    setApplyingRemote(false);
  }

  return { pushed: accepted.size, conflicts: (response.conflicts ?? []).length };
}

/**
 * Copy the server's view of one entry into this profile.
 *
 * The caller has `applyingRemote` set, so the write does not bump `rev` and
 * does not re-queue the row for upload.
 */
async function applyRecord(dto: RecordDto): Promise<boolean> {
  const local = await db.entries.where("sync_id").equals(dto.syncId).first();

  if (!local) {
    // A tombstone for something this device never had needs no row: the seq is
    // already past it, so it will not be delivered again.
    if (dto.deletedAt) return false;
    await db.entries.add(dtoToEntry(dto) as StoredEntry);
    return true;
  }

  if ((dto.rev ?? 1) <= (local.rev ?? 0)) return false;
  if (local.id === undefined) return false;
  await db.entries.update(local.id, dtoToEntry(dto));
  return true;
}

async function applySetting(dto: SettingDto): Promise<boolean> {
  const local = await db.settings.get(dto.key);
  if (!local) {
    if (dto.deletedAt) return false;
    await db.settings.add({
      key: dto.key,
      value: dto.value ?? "",
      sync_id: newSyncId(),
      rev: dto.rev ?? 1,
      dirty: 0,
      deleted_at: dto.deletedAt ?? undefined,
    });
    return true;
  }
  if ((dto.rev ?? 1) <= (local.rev ?? 0)) return false;
  await db.settings.update(dto.key, {
    value: dto.value ?? "",
    rev: dto.rev ?? 1,
    deleted_at: dto.deletedAt ?? undefined,
  });
  return true;
}

/**
 * Send one image and get back the name the server stored it under.
 *
 * Returns null when the data URL cannot be decoded or the bytes exceed the
 * server's ceiling; the row then goes out unchanged rather than blocking the
 * whole round trip on one screenshot.
 */
async function uploadImage(api: SyncApi, content: string): Promise<string | null> {
  const comma = content.indexOf(",");
  if (!content.startsWith("data:") || comma < 0) return null;
  let bytes: Blob;
  try {
    bytes = await (await fetch(content)).blob();
  } catch {
    return null;
  }
  if (bytes.size === 0 || bytes.size > MAX_BLOB_BYTES) return null;
  try {
    return await api.uploadBlob(bytes);
  } catch (error) {
    console.warn("clipboard sync: image upload failed", error);
    return null;
  }
}

/**
 * Turn a pulled image reference into something the list can render.
 *
 * The list builds `<img src>` straight from `content`, so a digest would render
 * as a broken image. A data URL rather than an object URL because the row is
 * persisted: an object URL dies with the page, and the row would come back from
 * IndexedDB as a dead reference on the next launch.
 *
 * Resolved data URLs are cached per digest for the session — one screenshot
 * often appears in several entries — while the row itself carries its own copy.
 */
const blobUrls = new Map<string, string>();
const blobInflight = new Map<string, Promise<string | null>>();

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function resolveBlob(api: SyncApi, sha: string): Promise<string | null> {
  const cached = blobUrls.get(sha);
  if (cached) return cached;
  let pending = blobInflight.get(sha);
  if (!pending) {
    pending = api
      .downloadBlob(sha)
      .then(async (blob) => {
        blobInflight.delete(sha);
        if (!blob) return null;
        const dataUrl = await toDataUrl(blob);
        if (blobUrls.size >= 200) {
          const oldest = blobUrls.keys().next().value;
          if (oldest !== undefined) blobUrls.delete(oldest);
        }
        blobUrls.set(sha, dataUrl);
        return dataUrl;
      })
      .catch(() => {
        blobInflight.delete(sha);
        return null;
      });
    blobInflight.set(sha, pending);
  }
  return pending;
}

/** Rewrite a pulled record's digest into a renderable data-carrying src. */
async function localiseRecord(api: SyncApi, dto: RecordDto): Promise<RecordDto> {
  if (dto.contentType !== "image" || dto.deletedAt || !BLOB_REF.test(dto.content)) {
    return dto;
  }
  const url = await resolveBlob(api, dto.content);
  if (!url) return dto;
  // The digest stays in sync_blob so the row can still be re-uploaded or
  // re-fetched later; `content` is what the UI consumes.
  return { ...dto, content: url };
}

/** Which half of a round trip to run; the header buttons ask for one at a time. */
export type SyncDirection = "both" | "push" | "pull";

export async function syncNow(
  config: SyncConfig,
  options: { fetchImpl?: typeof fetch; direction?: SyncDirection } = {},
): Promise<SyncOutcome> {
  const api = new SyncApi(config, options);
  const meta = await readMeta();
  const direction = options.direction ?? "both";

  try {
    const pushResult = direction === "pull" ? { pushed: 0, conflicts: 0 } : await push(api);
    if (direction === "push") {
      return { pushed: pushResult.pushed, conflicts: pushResult.conflicts, pulled: 0, lastSeq: meta.last_seq };
    }

    let pulled = 0;
    let since = meta.last_seq;
    // The server caps a page, so drain it in a loop rather than assuming one
    // response holds the whole backlog (a first sync can be thousands of rows).
    for (;;) {
      const page = await api.pull(since, PULL_PAGE);

      // Images are fetched before the transaction opens: Dexie commits a
      // transaction as soon as it sees a non-Dexie promise, so awaiting a
      // network call inside one silently loses the writes that follow it.
      const localised: RecordDto[] = [];
      for (const dto of page.records) {
        localised.push(await localiseRecord(api, dto));
      }

      setApplyingRemote(true);
      try {
        await db.transaction("rw", db.entries, db.settings, db.meta, async () => {
          for (const dto of localised) {
            if (await applyRecord(dto)) pulled += 1;
          }
          for (const dto of page.settings) {
            if (await applySetting(dto)) pulled += 1;
          }
          await db.meta.put({
            key: META_KEY,
            last_seq: page.nextSeq,
            last_sync_at: Date.now(),
          });
        });
      } finally {
        setApplyingRemote(false);
      }

      since = page.nextSeq;
      if (!page.hasMore) break;
    }

    return {
      pushed: pushResult.pushed,
      conflicts: pushResult.conflicts,
      pulled,
      lastSeq: since,
    };
  } catch (error) {
    await db.meta.put({
      key: META_KEY,
      last_seq: meta.last_seq,
      last_sync_at: meta.last_sync_at,
      last_error: (error as Error).message,
    });
    throw error;
  }
}
