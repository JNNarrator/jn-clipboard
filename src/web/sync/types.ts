/**
 * Wire shapes for the clipboard sync endpoint.
 *
 * These mirror `jnclub-module-clipboard`'s DTOs one for one. Field names are
 * camelCase on the wire because the server serialises the Java beans directly,
 * while the IndexedDB rows stay snake_case like the rest of the web backend; the
 * engine owns the translation so neither side has to bend.
 */
import type { StoredEntry, SettingRow } from "../backend/db";

export interface RecordDto {
  syncId: string;
  contentType: string;
  content: string;
  contentHash?: number | null;
  htmlContent?: string | null;
  preview?: string | null;
  sourceApp?: string | null;
  isPinned?: boolean | null;
  pinnedOrder?: number | null;
  tags?: string[] | null;
  note?: string | null;
  useCount?: number | null;
  createdAt?: number | null;
  lastUsedAt?: number | null;
  sortAt?: number | null;
  deletedAt?: number | null;
  rev?: number | null;
  seq?: number | null;
}

export interface SettingDto {
  key: string;
  value?: string | null;
  deletedAt?: number | null;
  rev?: number | null;
  seq?: number | null;
}

export interface BlobRefDto {
  sha256: string;
  byteSize: number;
  mime?: string | null;
}

export interface PullResponse {
  records: RecordDto[];
  settings: SettingDto[];
  nextSeq: number;
  hasMore: boolean;
}

export interface ConflictDto {
  syncId: string;
  serverRev: number;
  serverRecord: RecordDto;
}

export interface PushResponse {
  accepted: string[];
  conflicts: ConflictDto[];
  rejectedSettings: string[];
  nextSeq: number;
}

/** What the server keeps per record; the local row keeps the rest. */
export function entryToDto(row: StoredEntry): RecordDto {
  return {
    syncId: row.sync_id,
    contentType: row.content_type,
    content: row.content,
    htmlContent: row.html_content ?? null,
    preview: row.preview,
    sourceApp: row.source_app,
    isPinned: row.is_pinned,
    pinnedOrder: row.pinned_order ?? null,
    tags: row.tags ?? [],
    note: row.note ?? null,
    useCount: row.use_count,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    sortAt: row.sort_at,
    deletedAt: row.deleted_at ?? null,
    rev: row.rev,
  };
}

export function settingToDto(row: SettingRow): SettingDto {
  return {
    key: row.key,
    value: row.value,
    deletedAt: row.deleted_at ?? null,
    rev: row.rev,
  };
}

/**
 * Server record → local columns. `dirty` is deliberately not part of the DTO:
 * a row that just arrived is by definition in sync with the server.
 */
export function dtoToEntry(dto: RecordDto): Omit<StoredEntry, "id"> {
  return {
    sync_id: dto.syncId,
    rev: dto.rev ?? 1,
    dirty: 0,
    deleted_at: dto.deletedAt ?? undefined,
    content_type: dto.contentType,
    content: dto.content ?? "",
    html_content: dto.htmlContent ?? undefined,
    preview: dto.preview ?? "",
    source_app: dto.sourceApp ?? "",
    is_pinned: dto.isPinned ?? false,
    pinned_order: dto.pinnedOrder ?? undefined,
    tags: dto.tags ?? [],
    note: dto.note ?? undefined,
    use_count: dto.useCount ?? 0,
    created_at: dto.createdAt ?? Date.now(),
    last_used_at: dto.lastUsedAt ?? Date.now(),
    sort_at: dto.sortAt ?? Date.now(),
  };
}
