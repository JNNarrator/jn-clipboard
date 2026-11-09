//! Cross-device sync against the JNClub clipboard API.
//!
//! This is the desktop counterpart of `src/web/sync/` and speaks the same
//! protocol as `jnclub-module-clipboard`: `seq` is allocated by the server (a
//! client clock is not trustworthy enough to order devices), `rev` is the
//! optimistic lock, and a deletion travels as a tombstone because "row is
//! absent" is not something a delta protocol can express.
//!
//! Nothing here is wired into the WebDAV engine: that one keeps working
//! unchanged, and a user may run both. The only shared piece is the database.
//!
//! ## Why there is no dirty flag
//!
//! Instead of hooking every write path, `jnclub_sync_index.digest` stores the
//! snapshot of the fields we last sent. At sync time the engine recomputes the
//! digest of each row and pushes the ones that differ. A pin, a note edit, a
//! tag rename and a bulk cleanup therefore all become "dirty" without any of
//! them knowing this module exists.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::database::DbState;
use crate::error::{AppError, AppResult};
use crate::infrastructure::repository::settings_repo::{SettingsRepository, SqliteSettingsRepository};

/// Where the JNClub origin and the Sa-Token live in the settings table.
pub const BASE_URL_KEY: &str = "jnclub.sync_base_url";
pub const TOKEN_KEY: &str = "jnclub.sync_token";
pub const LAST_SEQ_KEY: &str = "jnclub.sync_last_seq";
pub const LAST_AT_KEY: &str = "jnclub.sync_last_at";
/// The last failure, cleared by the next success. Stored rather than kept in
/// memory so the settings row can explain itself right after a restart.
pub const LAST_ERROR_KEY: &str = "jnclub.sync_last_error";
/// Development escape hatch: point a debug build at another server without
/// having to write the setting into the database first.
const BASE_URL_ENV: &str = "JNCLUB_SYNC_BASE_URL";

const DEFAULT_LIMIT: u32 = 200;
/// Mirrors `ClipboardBlobService.MAX_BLOB_BYTES` on the server.
const MAX_BLOB_BYTES: usize = 20 * 1024 * 1024;
/// A pull that never reports `hasMore == false` must not spin forever.
const MAX_PAGES: usize = 500;
/// Records per push request: a first sync of a full history must not have to
/// land as one body, or a large library will keep timing out and retrying.
const PUSH_BATCH: usize = 100;

/// Which half of a round trip to run.
///
/// The background loop always does both; the two buttons on the header let a
/// user ask for one direction only when they are chasing a specific record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncDirection {
    Both,
    Push,
    Pull,
}

impl SyncDirection {
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("push") => Self::Push,
            Some("pull") => Self::Pull,
            _ => Self::Both,
        }
    }

    fn pushes(self) -> bool {
        matches!(self, Self::Both | Self::Push)
    }

    fn pulls(self) -> bool {
        matches!(self, Self::Both | Self::Pull)
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub pushed: usize,
    pub pulled: usize,
    pub conflicts: usize,
    pub tombstones: usize,
    pub next_seq: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub configured: bool,
    pub last_seq: i64,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
}

// ---------------------------------------------------------------------------
// Wire shapes — mirror the server DTOs one for one.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordDto {
    sync_id: String,
    content_type: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_hash: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    html_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pinned_order: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    use_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_used_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    deleted_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rev: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seq: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConflictDto {
    server_rev: Option<i64>,
    server_record: Option<RecordDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PushRequest {
    records: Vec<RecordDto>,
    settings: Vec<serde_json::Value>,
    blobs: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushResponse {
    accepted: Option<Vec<String>>,
    conflicts: Option<Vec<ConflictDto>>,
    /// The server's *global* cursor after this push. Kept on the struct so
    /// the trap stays visible and testable, but deliberately never written to
    /// LAST_SEQ: it includes other devices' records this device has not
    /// pulled yet, so adopting it would skip them forever.
    #[allow(dead_code)]
    next_seq: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullResponse {
    records: Option<Vec<RecordDto>>,
    next_seq: Option<i64>,
    has_more: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct Envelope<T> {
    code: Option<i64>,
    message: Option<String>,
    data: Option<T>,
}

// ---------------------------------------------------------------------------
// Local rows
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct LocalRow {
    id: i64,
    content_type: String,
    content: String,
    preview: String,
    source_app: String,
    html_content: Option<String>,
    is_pinned: bool,
    pinned_order: i64,
    tags: Vec<String>,
    note: String,
    use_count: i64,
    created_at: i64,
    last_used_at: i64,
    sort_at: i64,
    content_hash: i64,
}

impl LocalRow {
    fn digest(&self) -> String {
        // `use_count` / `last_used_at` / `sort_at` are deliberately absent:
        // they change on every paste, would re-ship the whole record (image
        // bytes included) each time, and would fight the other devices'
        // counters forever. They still travel with a record the first time
        // it is created or genuinely edited.
        [
            self.content_type.clone(),
            self.content.clone(),
            self.preview.clone(),
            self.source_app.clone(),
            self.html_content.clone().unwrap_or_default(),
            i64::from(self.is_pinned).to_string(),
            self.pinned_order.to_string(),
            self.tags.join("\u{1e}"),
            self.note.clone(),
            self.content_hash.to_string(),
        ]
        .join("\u{1f}")
    }

    fn to_dto(&self, sync_id: &str, rev: i64) -> RecordDto {
        RecordDto {
            sync_id: sync_id.to_string(),
            content_type: self.content_type.clone(),
            content: self.content.clone(),
            content_hash: Some(self.content_hash),
            html_content: self.html_content.clone(),
            preview: Some(self.preview.clone()),
            source_app: Some(self.source_app.clone()),
            is_pinned: Some(self.is_pinned),
            pinned_order: Some(self.pinned_order),
            tags: Some(self.tags.clone()),
            note: Some(self.note.clone()),
            use_count: Some(self.use_count),
            created_at: Some(self.created_at),
            last_used_at: Some(self.last_used_at),
            sort_at: Some(self.sort_at),
            deleted_at: None,
            rev: Some(rev),
            seq: None,
        }
    }
}

/// The local half of the index: which server record a row corresponds to,
/// and — for images — which server blob its bytes were last uploaded as.
#[derive(Debug, Clone)]
struct IndexRow {
    local_id: i64,
    sync_id: String,
    rev: i64,
    digest: String,
    blob_sha: Option<String>,
    /// The row's `content` at upload time; when it changes (a data URL being
    /// externalised to a file, say), the reference is stale and the bytes
    /// travel once more.
    blob_source: Option<String>,
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

/// Read through the settings repository so a sensitive value is decrypted.
/// A raw `SELECT` would hand back the ciphertext of the token.
fn read_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    SqliteSettingsRepository::get_raw(conn, key).ok().flatten()
}

fn write_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Borrow the connection with the app's lifetime.
///
/// `State::inner` is what makes this work: `deref` would return a reference
/// tied to this function's local, and the guard has to outlive it so the
/// callers can hold it across a statement.
fn lock_db<'a>(app: &'a AppHandle) -> AppResult<std::sync::MutexGuard<'a, rusqlite::Connection>> {
    let state = app
        .try_state::<DbState>()
        .ok_or_else(|| AppError::Internal("DB state unavailable".into()))?;
    state
        .inner()
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))
}

#[derive(Debug, Clone)]
struct Config {
    base_url: String,
    token: String,
}

fn read_config(app: &AppHandle) -> AppResult<Option<Config>> {
    let conn = lock_db(app)?;
    let base_url = base_url(&conn);
    let token = read_setting(&conn, TOKEN_KEY).unwrap_or_default().trim().to_string();
    if base_url.is_empty() || token.is_empty() {
        return Ok(None);
    }
    Ok(Some(Config { base_url, token }))
}

/// The origin to talk to, preferring `JNCLUB_SYNC_BASE_URL` when it is set.
///
/// Without it there is no way to point a development build at a server other
/// than the shipped one: the address is not editable in the UI (it is fixed by
/// design), so the only other route would be writing the row into the database
/// by hand.
fn base_url(conn: &rusqlite::Connection) -> String {
    if let Ok(value) = std::env::var(BASE_URL_ENV) {
        let trimmed = value.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    read_setting(conn, BASE_URL_KEY)
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/')
        .to_string()
}

/// The stored origin, if one was ever saved. The login flow needs it before a
/// token exists, which is why it cannot go through `read_config`.
pub fn stored_base_url(app: &AppHandle) -> AppResult<Option<String>> {
    let conn = lock_db(app)?;
    Ok(Some(base_url(&conn)).filter(|v| !v.is_empty()))
}

pub fn status(app: &AppHandle) -> AppResult<SyncStatus> {
    let conn = lock_db(app)?;
    let configured = read_setting(&conn, BASE_URL_KEY).is_some_and(|v| !v.trim().is_empty())
        && read_setting(&conn, TOKEN_KEY).is_some_and(|v| !v.trim().is_empty());
    let last_seq = read_setting(&conn, LAST_SEQ_KEY)
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let last_sync_at = read_setting(&conn, LAST_AT_KEY).and_then(|v| v.parse::<i64>().ok());
    let last_error = read_setting(&conn, LAST_ERROR_KEY).filter(|v| !v.trim().is_empty());
    Ok(SyncStatus { configured, last_seq, last_sync_at, last_error })
}

/// Store the origin and token. An empty pair clears them, which is how the UI
/// turns sync off without deleting the data that already travelled.
pub fn set_credentials(app: &AppHandle, base_url: &str, token: &str) -> AppResult<SyncStatus> {
    {
        let conn = lock_db(app)?;
        write_setting(&conn, BASE_URL_KEY, base_url.trim().trim_end_matches('/'))?;
        // The guard is released before the repository takes the same lock: a
        // std mutex is not reentrant, so holding it here would deadlock.
    }
    let state = app
        .try_state::<DbState>()
        .ok_or_else(|| AppError::Internal("DB state unavailable".into()))?;
    state
        .settings_repo
        .set(TOKEN_KEY, token.trim())
        .map_err(|e| AppError::Database(e.to_string()))?;
    status(app)
}

// ---------------------------------------------------------------------------
// Database reads/writes
// ---------------------------------------------------------------------------

fn map_local_row(row: &rusqlite::Row) -> rusqlite::Result<LocalRow> {
    let tags_raw: String = row.get(8)?;
    Ok(LocalRow {
        id: row.get(0)?,
        content_type: row.get(1)?,
        content: row.get(2)?,
        preview: row.get(3)?,
        source_app: row.get(4)?,
        html_content: row.get(5)?,
        is_pinned: row.get::<_, i64>(6)? != 0,
        pinned_order: row.get(7)?,
        tags: serde_json::from_str::<Vec<String>>(&tags_raw).unwrap_or_default(),
        note: row.get(9)?,
        use_count: row.get(10)?,
        created_at: row.get(11)?,
        last_used_at: row.get(12)?,
        sort_at: row.get(13)?,
        content_hash: row.get(14)?,
    })
}

const LOCAL_ROW_COLUMNS: &str = "id, content_type, content, preview, source_app, html_content, is_pinned,
         pinned_order, tags, note, use_count, created_at, last_used_at, sort_at, content_hash";

/// Rows the dirty triggers flagged since the last acknowledged state. The
/// write triggers keep this set at "what changed", so a tick reads a handful
/// of rows instead of the whole library.
fn load_flagged_rows(conn: &rusqlite::Connection) -> AppResult<Vec<LocalRow>> {
    let sql = format!(
        "SELECT {LOCAL_ROW_COLUMNS} FROM clipboard_history c
         JOIN jnclub_dirty d ON d.local_id = c.id
         ORDER BY c.id ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([], map_local_row)
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| AppError::Database(e.to_string()))?);
    }
    Ok(out)
}

/// Index rows whose local row vanished — user deletions plus the negative-id
/// tombstone queue (see `queue_tombstone`). No full history load required.
fn load_vanished_index_rows(
    conn: &rusqlite::Connection,
) -> AppResult<Vec<(i64, String, i64)>> {
    let mut stmt = conn
        .prepare(
            "SELECT i.local_id, i.sync_id, i.rev FROM jnclub_sync_index i
             WHERE NOT EXISTS (SELECT 1 FROM clipboard_history c WHERE c.id = i.local_id)",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| AppError::Database(e.to_string()))?);
    }
    Ok(out)
}

fn clear_dirty_flag(conn: &rusqlite::Connection, local_id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM jnclub_dirty WHERE local_id = ?1", [local_id])
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

fn load_index(conn: &rusqlite::Connection) -> AppResult<Vec<IndexRow>> {
    let mut stmt = conn
        .prepare("SELECT local_id, sync_id, rev, digest, blob_sha, blob_source FROM jnclub_sync_index")
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(IndexRow {
                local_id: row.get(0)?,
                sync_id: row.get(1)?,
                rev: row.get(2)?,
                digest: row.get(3)?,
                blob_sha: row.get(4)?,
                blob_source: row.get(5)?,
            })
        })
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| AppError::Database(e.to_string()))?);
    }
    Ok(out)
}

fn upsert_index(
    conn: &rusqlite::Connection,
    local_id: i64,
    sync_id: &str,
    rev: i64,
    digest: &str,
    blob: Option<(&str, &str)>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO jnclub_sync_index (local_id, sync_id, rev, digest, blob_sha, blob_source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(local_id) DO UPDATE SET sync_id = excluded.sync_id,
                                              rev = excluded.rev,
                                              digest = excluded.digest,
                                              blob_sha = COALESCE(excluded.blob_sha, jnclub_sync_index.blob_sha),
                                              blob_source = COALESCE(excluded.blob_source, jnclub_sync_index.blob_source)",
        rusqlite::params![
            local_id,
            sync_id,
            rev,
            digest,
            blob.map(|(sha, _)| sha),
            blob.map(|(_, source)| source)
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

fn delete_index(conn: &rusqlite::Connection, local_id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM jnclub_sync_index WHERE local_id = ?1", [local_id])
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

fn delete_history(conn: &rusqlite::Connection, local_id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM clipboard_history WHERE id = ?1", [local_id])
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

fn insert_remote(conn: &rusqlite::Connection, dto: &RecordDto) -> AppResult<i64> {
    let created_at = dto.created_at.unwrap_or_else(now_ms);
    let tags = serde_json::to_string(&dto.tags.clone().unwrap_or_default()).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO clipboard_history
            (content_type, content, source_app, timestamp, preview, is_pinned, tags, use_count,
             pinned_order, content_hash, html_content, note, created_at, last_used_at, sort_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        rusqlite::params![
            dto.content_type,
            dto.content,
            dto.source_app.clone().unwrap_or_default(),
            created_at,
            dto.preview.clone().unwrap_or_default(),
            i64::from(dto.is_pinned.unwrap_or(false)),
            tags,
            dto.use_count.unwrap_or(0),
            dto.pinned_order.unwrap_or(0),
            dto.content_hash.unwrap_or(0),
            dto.html_content,
            dto.note.clone().unwrap_or_default(),
            created_at,
            dto.last_used_at.unwrap_or(created_at),
            dto.sort_at.unwrap_or(created_at),
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(conn.last_insert_rowid())
}

fn update_remote(conn: &rusqlite::Connection, local_id: i64, dto: &RecordDto) -> AppResult<()> {
    let tags = serde_json::to_string(&dto.tags.clone().unwrap_or_default()).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "UPDATE clipboard_history SET
            content_type = ?2, content = ?3, source_app = ?4, preview = ?5, is_pinned = ?6,
            tags = ?7, use_count = ?8, pinned_order = ?9, content_hash = ?10, html_content = ?11,
            note = ?12, created_at = ?13, last_used_at = ?14, sort_at = ?15
         WHERE id = ?1",
        rusqlite::params![
            local_id,
            dto.content_type,
            dto.content,
            dto.source_app.clone().unwrap_or_default(),
            dto.preview.clone().unwrap_or_default(),
            i64::from(dto.is_pinned.unwrap_or(false)),
            tags,
            dto.use_count.unwrap_or(0),
            dto.pinned_order.unwrap_or(0),
            dto.content_hash.unwrap_or(0),
            dto.html_content,
            dto.note.clone().unwrap_or_default(),
            dto.created_at.unwrap_or_else(now_ms),
            dto.last_used_at.unwrap_or_else(now_ms),
            dto.sort_at.unwrap_or_else(now_ms),
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Re-read one row so the index digest matches what was just written.
fn digest_of(conn: &rusqlite::Connection, local_id: i64) -> AppResult<Option<String>> {
    let row = conn.query_row(
        "SELECT id, content_type, content, preview, source_app, html_content, is_pinned,
                pinned_order, tags, note, use_count, created_at, last_used_at, sort_at, content_hash
         FROM clipboard_history WHERE id = ?1",
        [local_id],
        |row| {
            let tags_raw: String = row.get(8)?;
            Ok(LocalRow {
                id: row.get(0)?,
                content_type: row.get(1)?,
                content: row.get(2)?,
                preview: row.get(3)?,
                source_app: row.get(4)?,
                html_content: row.get(5)?,
                is_pinned: row.get::<_, i64>(6)? != 0,
                pinned_order: row.get(7)?,
                tags: serde_json::from_str::<Vec<String>>(&tags_raw).unwrap_or_default(),
                note: row.get(9)?,
                use_count: row.get(10)?,
                created_at: row.get(11)?,
                last_used_at: row.get(12)?,
                sort_at: row.get(13)?,
                content_hash: row.get(14)?,
            })
        },
    );
    match row {
        Ok(row) => Ok(Some(row.digest())),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e.to_string())),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

fn http_client() -> AppResult<reqwest::Client> {
    // reqwest is built with `rustls-no-provider`, and a client built without a
    // registered provider panics. Installing it here rather than relying on the
    // app entry point keeps the module usable from tests and background jobs.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        // The PWA and the desktop build talk to the same deployment; a desktop
        // app has no browser origin, so no CORS negotiation happens here.
        .build()
        .map_err(|e| AppError::Network(e.to_string()))
}

async fn push(client: &reqwest::Client, config: &Config, records: Vec<RecordDto>) -> AppResult<PushResponse> {
    let url = format!("{}/api/clipboard/sync/push", config.base_url);
    let body = PushRequest {
        records,
        settings: Vec::new(),
        blobs: Vec::new(),
    };
    let response = client
        .post(&url)
        .header("jn-token", &config.token)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    decode_envelope::<PushResponse>(response).await
}

async fn pull_page(
    client: &reqwest::Client,
    config: &Config,
    since: i64,
    limit: u32,
) -> AppResult<PullResponse> {
    let url = format!(
        "{}/api/clipboard/sync/pull?since={}&limit={}",
        config.base_url, since, limit
    );
    let response = client
        .get(&url)
        .header("jn-token", &config.token)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    decode_envelope::<PullResponse>(response).await
}

/// Unwrap the JNClub `R<T>` envelope.
///
/// A rejected request still arrives as HTTP 200 with a business `code`, so the
/// status alone would make a refused push look like an empty one.
async fn decode_envelope<T: for<'de> Deserialize<'de>>(response: reqwest::Response) -> AppResult<T> {
    if response.status().as_u16() == 401 {
        return Err(AppError::Auth("token expired".into()));
    }
    let status = response.status();
    let body = response
        .json::<Envelope<T>>()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    match body.code {
        Some(200) => body.data.ok_or_else(|| AppError::Network("empty payload".into())),
        Some(code) => Err(AppError::Network(format!(
            "{} ({})",
            body.message.unwrap_or_else(|| "sync failed".into()),
            code
        ))),
        None => Err(AppError::Network(format!("unexpected reply ({})", status))),
    }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/// A pulled image carries a sha256 where a local row carries a file path: the
/// peer that made it has no such file. Anything else would be a path we cannot
/// resolve, so only a well-formed digest is treated as a reference.
fn is_blob_ref(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn app_data_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let state = app.try_state::<crate::app_state::AppDataDir>()?;
    let guard = state.0.lock().ok()?;
    Some(guard.clone())
}

/// Bytes and mime for one local image, whether it is still a data URL or has
/// already been externalised to a file under `attachments/`.
fn read_local_image(content: &str) -> Option<(Vec<u8>, String)> {
    use base64::Engine;
    let trimmed = content.trim();
    if let Some((_, payload)) = trimmed.split_once(',') {
        if trimmed.starts_with("data:") {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(payload.replace(['\r', '\n'], ""))
                .ok()?;
            let ext = crate::database::image_extension_from_magic(&bytes)
                .unwrap_or("png");
            return Some((bytes, format!("image/{}", if ext == "jpg" { "jpeg" } else { ext })));
        }
    }
    let path = std::path::Path::new(trimmed);
    if !path.is_file() {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let ext = crate::database::image_extension_from_magic(&bytes).unwrap_or("png");
    Some((bytes, format!("image/{}", if ext == "jpg" { "jpeg" } else { ext })))
}

/// Hand the bytes to the server and use the digest it answers with.
///
/// Hashing locally would be wrong: the stored bytes are the ones the server
/// received, and only its digest names them.
async fn upload_blob(
    client: &reqwest::Client,
    config: &Config,
    bytes: Vec<u8>,
    mime: &str,
) -> AppResult<String> {
    if bytes.len() > MAX_BLOB_BYTES {
        return Err(AppError::Validation(format!(
            "image is larger than {}MB",
            MAX_BLOB_BYTES / 1024 / 1024
        )));
    }
    let url = format!("{}/api/clipboard/blob", config.base_url);
    let response = client
        .post(&url)
        .header("jn-token", &config.token)
        .header("Content-Type", mime)
        .body(bytes)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    decode_envelope::<String>(response).await
}

async fn download_blob(
    client: &reqwest::Client,
    config: &Config,
    sha: &str,
) -> AppResult<Option<Vec<u8>>> {
    let url = format!("{}/api/clipboard/blob/{}", config.base_url, sha);
    let response = client
        .get(&url)
        .header("jn-token", &config.token)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "attachment fetch failed ({})",
            response.status()
        )));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    Ok(Some(bytes.to_vec()))
}

/// Write a downloaded image under `attachments/` and return its path.
fn store_downloaded_image(app: &AppHandle, bytes: &[u8]) -> Option<String> {
    let dir = app_data_dir(app)?;
    crate::database::save_image_bytes_to_file_with_extension(bytes, &dir, "png")
}

/// Turn a pulled record into one a local row can hold.
///
/// Downloads happen here rather than inside `apply_remote` because that one
/// holds the database guard: waiting on the network with a `MutexGuard` alive
/// makes the whole sync future `!Send`, which the runtime refuses to spawn.
async fn localise_record(
    app: &AppHandle,
    client: &reqwest::Client,
    config: &Config,
    record: &RecordDto,
) -> AppResult<RecordDto> {
    let mut out = record.clone();
    if out.content_type != "image" || out.deleted_at.is_some() || !is_blob_ref(&out.content) {
        return Ok(out);
    }
    match download_blob(client, config, &out.content).await? {
        Some(bytes) => match store_downloaded_image(app, &bytes) {
            Some(path) => out.content = path,
            None => crate::logger::log("jnclub sync: could not store a pulled image"),
        },
        // The blob is gone (garbage collected, or the upload never finished).
        // Keeping the digest leaves the row diagnosable instead of pretending
        // it has content, and the next push will re-upload it.
        None => crate::logger::log(&format!(
            "jnclub sync: attachment {} is missing on the server",
            out.content
        )),
    }
    Ok(out)
}

/// One pending row, ready for the push loop.
///
/// `raw_content` is the row's `content` exactly as stored (a file path,
/// possibly an encrypted one). The index compares it against
/// `blob_source` to know whether this image still needs its bytes uploaded
/// or can be referenced by digest.
#[derive(Debug, Clone)]
struct PushItem {
    local_id: i64,
    dto: RecordDto,
    raw_content: String,
}

/// A pending image resolved to a server blob, plus what the index should
/// remember about it when the server accepts the record.
#[derive(Debug)]
struct PreparedItem {
    local_id: i64,
    dto: RecordDto,
    /// `(sha, raw_content)` when this round sent fresh bytes; `None` when
    /// the reference was reused (the index already knows it) or the row is
    /// not an image.
    blob: Option<(String, String)>,
}

/// Everything the push loop needs for one round of `collect_changes`.
#[derive(Default)]
struct PendingPush {
    items: Vec<PushItem>,
    /// Sync ids whose local row vanished; they ride along as tombstones.
    tombstone_sync_ids: HashSet<String>,
    /// The index as of collection time, for blob-reference reuse.
    index_by_local: HashMap<i64, IndexRow>,
}

/// Everything that has to travel: new rows, edited rows, deleted rows.
///
/// Only rows the `jnclub_dirty` triggers flagged are examined — a tick costs
/// a handful of rows instead of the whole library. A flag whose row turns out
/// to match the acknowledged digest is absorbed here (the engine's own writes
/// — pull-apply, merge, re-encryption — trigger flags too, and this is how
/// they settle).
///
/// DTOs are produced here already decrypted: sensitive rows are encrypted at
/// rest with this device's Keychain/DPAPI key, an envelope no other device
/// can open. A row whose stored value fails to decrypt (key access denied on
/// macOS, a migrated DPAPI blob on the wrong OS) is dropped from this round
/// rather than sent as ciphertext the peer would render as noise.
fn collect_changes(conn: &rusqlite::Connection) -> AppResult<PendingPush> {
    let index = load_index(conn)?;
    let by_local: HashMap<i64, IndexRow> = index.iter().cloned().map(|r| (r.local_id, r)).collect();

    let mut items: Vec<PushItem> = Vec::new();
    // Rows that vanished locally: push a tombstone, then forget them.
    let mut tombstone_sync_ids: HashSet<String> = HashSet::new();
    let now = now_ms();

    for row in load_flagged_rows(conn)? {
        let (sync_id, rev) = match by_local.get(&row.id) {
            Some(entry) => {
                if entry.digest == row.digest() {
                    // Back to the acknowledged state: absorb the flag.
                    clear_dirty_flag(conn, row.id)?;
                    continue;
                }
                (entry.sync_id.clone(), entry.rev + 1)
            }
            None => (Uuid::new_v4().to_string(), 1),
        };
        let Some(dto) = decrypted_dto(&row, &sync_id, rev) else {
            crate::logger::log(&format!(
                "jnclub sync: row {} stays local this round: its stored value cannot be decrypted on this device",
                row.id
            ));
            continue;
        };
        items.push(PushItem {
            local_id: row.id,
            dto,
            raw_content: row.content.clone(),
        });
    }

    // Tombstones: index rows with no local row — user deletions plus the
    // negative-id queue written by the pull-side duplicate merge.
    for (local_id, sync_id, rev) in load_vanished_index_rows(conn)? {
        tombstone_sync_ids.insert(sync_id.clone());
        items.push(PushItem {
            local_id,
            dto: RecordDto {
                sync_id,
                content_type: "text".into(),
                content: String::new(),
                content_hash: None,
                html_content: None,
                preview: None,
                source_app: None,
                is_pinned: None,
                pinned_order: None,
                tags: None,
                note: None,
                use_count: None,
                created_at: None,
                last_used_at: None,
                sort_at: None,
                deleted_at: Some(now),
                rev: Some(rev + 1),
                seq: None,
            },
            raw_content: String::new(),
        });
    }

    Ok(PendingPush {
        items,
        tombstone_sync_ids,
        index_by_local: by_local,
    })
}

/// `to_dto` plus decryption of the three fields the capture pipeline may have
/// encrypted. Returns `None` when any of them cannot be opened here.
fn decrypted_dto(row: &LocalRow, sync_id: &str, rev: i64) -> Option<RecordDto> {
    let mut dto = row.to_dto(sync_id, rev);
    let content = crate::infrastructure::encryption::decrypt_stored_value(&row.content).ok()?;
    let preview = crate::infrastructure::encryption::decrypt_stored_value(&row.preview).ok()?;
    let html = match &row.html_content {
        Some(value) => {
            Some(crate::infrastructure::encryption::decrypt_stored_value(value).ok()?)
        }
        None => None,
    };
    dto.content = content;
    dto.preview = Some(preview);
    dto.html_content = html;
    Some(dto)
}

/// Guard against two round trips racing each other (the background loop and
/// the header buttons both call here). Both apply and index records, so an
/// overlap could insert the same `sync_id` twice; a second caller just sees
/// an empty outcome and the next tick continues.
static SYNC_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

pub async fn sync_now(app: &AppHandle, direction: SyncDirection) -> AppResult<SyncOutcome> {
    if SYNC_IN_FLIGHT.swap(true, Ordering::Relaxed) {
        return Ok(SyncOutcome::default());
    }
    let result = sync_inner(app, direction).await;
    SYNC_IN_FLIGHT.store(false, Ordering::Relaxed);
    // Record the failure where the UI can read it. Without this the row would
    // say "已同步" right up until the token expired, and then silently stop.
    {
        let message = match &result {
            Ok(_) => String::new(),
            Err(err) => err.to_string(),
        };
        if let Ok(conn) = lock_db(app) {
            let _ = write_setting(&conn, LAST_ERROR_KEY, &message);
        }
    }
    // The list is rendered from the database, so a pull that changed anything
    // has to tell the UI to re-read it. Reusing the capture event means the
    // existing listeners refresh without knowing sync exists.
    if result.as_ref().is_ok_and(|outcome| outcome.pulled > 0) {
        let _ = app.emit("clipboard-changed", ());
    }
    emit_status(app);
    result
}

fn emit_status(app: &AppHandle) {
    if let Ok(status) = status(app) {
        let _ = app.emit("jnclub-sync-status", status);
    }
}

/// How often a logged-in app pushes what it has and pulls what others sent.
///
/// Thirty seconds is the interval the browser build uses. There is no user
/// setting: the only knob anyone asked for was "just keep it in sync", and a
/// second one would need explaining.
const TICK: Duration = Duration::from_secs(30);

/// Wake the loop early, e.g. right after the user signs in.
fn wake() {
    if let Some(signal) = SYNC_WAKE.get() {
        signal.notify_one();
    }
}

static SYNC_WAKE: OnceLock<tokio::sync::Notify> = OnceLock::new();
static SYNC_STARTED: AtomicBool = AtomicBool::new(false);

/// Start the background sync loop. Safe to call twice: the second call is a
/// no-op, which matters because both setup and the login command reach here.
pub fn start_sync_loop(app: AppHandle) {
    if SYNC_STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    let signal = SYNC_WAKE.get_or_init(tokio::sync::Notify::new);
    // The change stream turns "wait out a tick" into "wake up now". A broken
    // or missing stream never blocks correctness: the 30-second loop above is
    // the floor, the stream only accelerates it.
    let stream_app = app.clone();

    tauri::async_runtime::spawn(async move {
        loop {
            // A not-logged-in app has nothing to do; waking on login keeps the
            // first sync immediate instead of waiting out a tick.
            let configured = status(&app).map(|s| s.configured).unwrap_or(false);
            if configured {
                if let Err(err) = sync_now(&app, SyncDirection::Both).await {
                    crate::logger::log(&format!("jnclub sync tick failed: {err}"));
                }
            }
            let _ = tokio::time::timeout(TICK, signal.notified()).await;
        }
    });

    tauri::async_runtime::spawn(async move {
        run_stream(stream_app).await;
    });
}

/// A client without the ordinary 30-second total timeout: an SSE connection's
/// lifetime is the stream's lifetime, and the server heartbeats every 30s.
fn stream_client() -> AppResult<reqwest::Client> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        // 不设总超时（reqwest 默认无）：流的生命周期就是请求的生命周期
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))
}

/// Stay subscribed to the server's change stream; every `sync` event wakes
/// the loop for an immediate round trip. Reconnects with exponential backoff
/// — the loop keeps its own cadence the whole time, so this task failing is
/// invisible except to latency.
async fn run_stream(app: AppHandle) {
    use futures::StreamExt;

    let mut backoff_secs: u64 = 5;
    loop {
        let Some(config) = read_config(&app).ok().flatten() else {
            tokio::time::sleep(Duration::from_secs(60)).await;
            continue;
        };
        let Ok(client) = stream_client() else {
            tokio::time::sleep(Duration::from_secs(60)).await;
            continue;
        };
        let url = format!("{}/api/clipboard/sync/stream", config.base_url);

        let response = client
            .get(&url)
            .header("jn-token", &config.token)
            .send()
            .await;

        let mut event_name = String::new();
        let mut buffer = String::new();
        match response {
            Ok(response) if response.status().is_success() => {
                backoff_secs = 5;
                // Reconnecting means events may have been missed: catch up
                // before consuming anything the stream says.
                wake();
                let mut stream = response.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let Ok(bytes) = chunk else { break };
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    // Consume complete lines; an empty line closes an SSE event.
                    while let Some(pos) = buffer.find('\n') {
                        let line: String = buffer[..pos].trim_end_matches('\r').to_string();
                        buffer.drain(..pos + 1);
                        if line.is_empty() {
                            if event_name == "sync" {
                                wake();
                            }
                            event_name.clear();
                        } else if let Some(value) = line.strip_prefix("event:") {
                            event_name = value.trim().to_string();
                        }
                    }
                }
                crate::logger::log("jnclub sync: change stream ended; reconnecting");
            }
            Ok(response) if response.status().as_u16() == 401 => {
                // Not signed in (or expired): sync_now records the reason where
                // the UI can read it; retry slowly rather than hammering.
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            }
            _ => {}
        }

        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
        backoff_secs = (backoff_secs * 2).min(60);
    }
}

/// Called by the login and sign-out commands so the loop reacts immediately.
pub fn nudge(app: &AppHandle) {
    start_sync_loop(app.clone());
    wake();
    emit_status(app);
}

async fn sync_inner(app: &AppHandle, direction: SyncDirection) -> AppResult<SyncOutcome> {
    let config = match read_config(app)? {
        Some(config) => config,
        None => return Err(AppError::Validation("sync is not configured".into())),
    };
    let client = http_client()?;
    let mut outcome = SyncOutcome::default();

    // 1. Push, in batches. The connection guard is dropped before any await.
    //
    // The response's `next_seq` is deliberately *not* adopted here: it is the
    // server's global maximum, which includes other devices' records this
    // device has not pulled yet. Writing it to LAST_SEQ would skip them
    // forever — the pull would resume from the new cursor while those rows
    // keep their lower, already-passed seq. The cursor only ever advances
    // through pulls; our own accepted writes therefore come back on the next
    // round trip and are skipped there by the rev gate below.
    if direction.pushes() {
        let pending = {
            let conn = lock_db(app)?;
            collect_changes(&conn)?
        };

        for chunk in pending.items.chunks(PUSH_BATCH) {
            // Blob references are resolved (and bytes uploaded) outside the
            // database lock.
            let mut prepared: Vec<PreparedItem> = Vec::with_capacity(chunk.len());
            for item in chunk {
                if let Some(item) =
                    prepare_item(&client, &config, &pending.index_by_local, item.clone()).await
                {
                    prepared.push(item);
                }
            }
            if prepared.is_empty() {
                continue;
            }

            let payload: Vec<RecordDto> = prepared.iter().map(|item| item.dto.clone()).collect();
            let response = push(&client, &config, payload).await?;

            // A conflict carries the server's copy, whose image content is a
            // digest — localise it before the lock so the adopted row keeps a
            // usable local path instead of a 64-char string.
            let mut localised_conflicts: Vec<ConflictDto> = Vec::new();
            for conflict in response.conflicts.clone().unwrap_or_default() {
                let mut conflict = conflict;
                if let Some(record) = conflict.server_record.as_ref() {
                    conflict.server_record =
                        Some(localise_record(app, &client, &config, record).await?);
                }
                localised_conflicts.push(conflict);
            }

            {
                let conn = lock_db(app)?;
                apply_push_response(
                    &conn,
                    &prepared,
                    &pending.tombstone_sync_ids,
                    &response,
                    &localised_conflicts,
                )?;
            }
            outcome.pushed += response.accepted.as_ref().map(|a| a.len()).unwrap_or(0);
            outcome.conflicts += localised_conflicts.len();
        }
        outcome.tombstones = pending.tombstone_sync_ids.len();
    }

    // 2. Pull until the server says there is nothing left.
    if !direction.pulls() {
        return Ok(outcome);
    }
    let mut since = {
        let conn = lock_db(app)?;
        read_setting(&conn, LAST_SEQ_KEY)
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0)
    };

    // Cheap probe first: most ticks have nothing new on the server, and one
    // number beats pulling an empty page. When the probe cannot be reached,
    // fall through and pull anyway — the probe is an optimisation, not a
    // gate.
    if let Ok(state) = remote_state(&client, &config).await {
        if state <= since {
            let conn = lock_db(app)?;
            write_setting(&conn, LAST_AT_KEY, &now_ms().to_string())?;
            outcome.next_seq = since;
            return Ok(outcome);
        }
    }

    for _ in 0..MAX_PAGES {
        let page = pull_page(&client, &config, since, DEFAULT_LIMIT).await?;
        let records = page.records.unwrap_or_default();
        let next_seq = page.next_seq.unwrap_or(since);
        let has_more = page.has_more.unwrap_or(false);

        if !records.is_empty() {
            // Skip records this device already knows: our own accepted writes
            // come back through the pull, and re-applying them would rewrite
            // the row (and re-download an image) for nothing. Records that
            // duplicate a local row by content merge into it instead of
            // landing a second copy (see `absorb_duplicate`).
            let (to_merge, to_apply): (Vec<(RecordDto, DuplicateRow)>, Vec<RecordDto>) = {
                let conn = lock_db(app)?;
                let by_sync: HashMap<String, IndexRow> = load_index(&conn)?
                    .into_iter()
                    .map(|entry| (entry.sync_id.clone(), entry))
                    .collect();
                let mut to_merge: Vec<(RecordDto, DuplicateRow)> = Vec::new();
                let mut to_apply: Vec<RecordDto> = Vec::new();
                for record in &records {
                    match by_sync.get(&record.sync_id) {
                        // Known and already at this revision: our own echo.
                        Some(entry) if entry.rev >= record.rev.unwrap_or(1) => continue,
                        _ => {}
                    }
                    match find_duplicate(&conn, record)? {
                        Some(dup) => to_merge.push((record.clone(), dup)),
                        None => to_apply.push(record.clone()),
                    }
                }
                (to_merge, to_apply)
            };

            if !to_merge.is_empty() {
                // Merging is pure bookkeeping — even an image duplicate needs
                // no download, the digest already names the bytes — so it runs
                // under the same guard it was found with.
                let conn = lock_db(app)?;
                for (record, dup) in &to_merge {
                    absorb_duplicate(&conn, record, dup)?;
                    outcome.pulled += 1;
                }
            }

            if !to_apply.is_empty() {
                // Fetch any images before taking the database guard: awaiting
                // under a `MutexGuard` would make this future `!Send`.
                let mut localised: Vec<RecordDto> = Vec::with_capacity(to_apply.len());
                for record in &to_apply {
                    localised.push(localise_record(app, &client, &config, record).await?);
                }

                let conn = lock_db(app)?;
                let by_sync: HashMap<String, IndexRow> = load_index(&conn)?
                    .into_iter()
                    .map(|entry| (entry.sync_id.clone(), entry))
                    .collect();
                for (record, localised_record) in to_apply.iter().zip(&localised) {
                    let blob = image_blob_link(record, localised_record);
                    let blob = blob.as_ref().map(|(sha, source)| (sha.as_str(), source.as_str()));
                    apply_remote(&conn, localised_record, &by_sync, blob)?;
                    outcome.pulled += 1;
                }
            }
        }

        since = next_seq.max(since);
        if !has_more {
            break;
        }
    }

    {
        let conn = lock_db(app)?;
        write_setting(&conn, LAST_SEQ_KEY, &since.to_string())?;
        write_setting(&conn, LAST_AT_KEY, &now_ms().to_string())?;
    }
    outcome.next_seq = since;
    Ok(outcome)
}

/// The `(sha, content)` pair a pulled image row should be indexed with: the
/// digest names the bytes on the server, the localised content is the file
/// path that digest resolved to. `None` for everything else.
fn image_blob_link(original: &RecordDto, localised: &RecordDto) -> Option<(String, String)> {
    let is_fresh_image = localised.content_type == "image"
        && localised.deleted_at.is_none()
        && is_blob_ref(&original.content)
        && original.content != localised.content;
    is_fresh_image.then(|| (original.content.clone(), localised.content.clone()))
}

// ---------------------------------------------------------------------------
// Pull-side duplicate merge
// ---------------------------------------------------------------------------

/// How far apart two copies of the same content can have been captured and
/// still merge. Both platforms must use the same value: the merge decision is
/// a pure function of the two records' created_at, so a scope mismatch would
/// have one device merging while the other keeps both.
const DEDUPE_WINDOW_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// A local row that says the same thing as a record coming off the wire.
#[derive(Debug, Clone)]
struct DuplicateRow {
    local_id: i64,
    /// The row's index sync_id when it ever travelled; `None` for a local row
    /// the server has never seen.
    sync_id: Option<String>,
    /// The index rev of `sync_id` (0 when untracked).
    rev: i64,
    created_at: i64,
    use_count: i64,
    last_used_at: i64,
}

/// Look for a live local row with the same content as an incoming record.
///
/// Text rows match by exact content or by `content_hash` (a locally stored
/// sensitive row is ciphertext, so only its plaintext hash can be compared).
/// Image rows match by the blob digest both identities were uploaded under —
/// no bytes are read or downloaded to make the comparison.
fn find_duplicate(
    conn: &rusqlite::Connection,
    dto: &RecordDto,
) -> AppResult<Option<DuplicateRow>> {
    if dto.deleted_at.is_some() || dto.content_type.is_empty() {
        return Ok(None);
    }
    let anchor = dto.created_at.unwrap_or_else(now_ms);
    let mut dup: Option<DuplicateRow> = None;

    if dto.content_type == "image" {
        if !is_blob_ref(&dto.content) {
            return Ok(None);
        }
        let mut stmt = conn
            .prepare(
                "SELECT i.local_id, i.sync_id, i.rev, c.created_at, c.use_count, c.last_used_at
                 FROM jnclub_sync_index i
                 JOIN clipboard_history c ON c.id = i.local_id
                 WHERE i.local_id > 0
                   AND i.blob_sha = ?1
                   AND ABS(c.created_at - ?2) <= ?3
                 LIMIT 1",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let row = stmt
            .query_row(
                rusqlite::params![dto.content, anchor, DEDUPE_WINDOW_MS],
                |row| {
                    Ok(DuplicateRow {
                        local_id: row.get(0)?,
                        sync_id: row.get(1)?,
                        rev: row.get(2)?,
                        created_at: row.get(3)?,
                        use_count: row.get(4)?,
                        last_used_at: row.get(5)?,
                    })
                },
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(AppError::Database(other.to_string())),
            })?;
        dup = row;
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT c.id, i.sync_id, COALESCE(i.rev, 0), c.created_at, c.use_count, c.last_used_at
                 FROM clipboard_history c
                 LEFT JOIN jnclub_sync_index i ON i.local_id = c.id
                 WHERE c.content_type = ?1
                   AND ABS(c.created_at - ?2) <= ?3
                   AND ((?4 <> 0 AND c.content_hash = ?4) OR c.content = ?5)",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut rows = stmt
            .query_map(
                rusqlite::params![
                    dto.content_type,
                    anchor,
                    DEDUPE_WINDOW_MS,
                    dto.content_hash.unwrap_or(0),
                    dto.content
                ],
                |row| {
                    Ok(DuplicateRow {
                        local_id: row.get(0)?,
                        sync_id: row.get(1)?,
                        rev: row.get(2)?,
                        created_at: row.get(3)?,
                        use_count: row.get(4)?,
                        last_used_at: row.get(5)?,
                    })
                },
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        for candidate in rows {
            let candidate = candidate.map_err(|e| AppError::Database(e.to_string()))?;
            // The row the record already refers to is not a duplicate — it is
            // the same record, arriving at a higher rev.
            if candidate.sync_id.as_deref() == Some(dto.sync_id.as_str()) {
                continue;
            }
            dup = Some(candidate);
            break;
        }
    }

    Ok(dup)
}

/// Merge an incoming record into the local row that already holds its
/// content. Both platforms decide the survivor with the same rule — earlier
/// `created_at` wins, ties broken by the smaller `sync_id` — so every device
/// reaches the same single record without coordination. The loser's server
/// identity is queued as a tombstone (a negative-id index row that
/// `collect_changes` picks up as "vanished locally").
fn absorb_duplicate(
    conn: &rusqlite::Connection,
    dto: &RecordDto,
    dup: &DuplicateRow,
) -> AppResult<()> {
    let remote_created = dto.created_at.unwrap_or_else(now_ms);
    let survivor_remote = match &dup.sync_id {
        None => true, // the local row never travelled: let the remote identity take over
        Some(local_sync_id) => (remote_created, dto.sync_id.as_str()) < (dup.created_at, local_sync_id.as_str()),
    };

    // Stats fold into the surviving row: the earlier capture time keeps "first
    // copy" semantics, counters take the max of both. None of this affects
    // the digest (batch 1 removed the volatile fields from it).
    conn.execute(
        "UPDATE clipboard_history SET
            created_at = MIN(created_at, ?2),
            use_count = MAX(use_count, ?3),
            last_used_at = MAX(last_used_at, ?4)
         WHERE id = ?1",
        rusqlite::params![
            dup.local_id,
            remote_created,
            dto.use_count.unwrap_or(0),
            dto.last_used_at.unwrap_or(0)
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;

    if survivor_remote {
        let digest = digest_of(conn, dup.local_id)?;
        if let Some(digest) = digest {
            // The image row keeps its local file; the index just learns the
            // digest the server already has, so future pushes reference it.
            let blob = if dto.content_type == "image" && is_blob_ref(&dto.content) {
                let local_content: String = conn
                    .query_row("SELECT content FROM clipboard_history WHERE id = ?1", [dup.local_id], |row| row.get(0))
                    .map_err(|e| AppError::Database(e.to_string()))?;
                Some((dto.content.clone(), local_content))
            } else {
                None
            };
            upsert_index(
                conn,
                dup.local_id,
                &dto.sync_id,
                dto.rev.unwrap_or(1),
                &digest,
                blob.as_ref().map(|(sha, source)| (sha.as_str(), source.as_str())),
            )?;
        }
        if let Some(old_sync_id) = &dup.sync_id {
            if old_sync_id != &dto.sync_id {
                queue_tombstone(conn, old_sync_id, dup.rev)?;
            }
        }
    } else {
        // The local row keeps its identity; the remote record's identity dies
        // on the server, and the other devices drop their copies on the next
        // pull — leaving one copy everywhere.
        queue_tombstone(conn, &dto.sync_id, dto.rev.unwrap_or(1))?;
    }
    Ok(())
}

/// Queue a tombstone for a server identity this device no longer wants. The
/// row is keyed by a negative `local_id`, which matches no clipboard_history
/// row, so `collect_changes` reports it as vanished and pushes a tombstone;
/// the queue row is deleted once the server accepts.
fn queue_tombstone(conn: &rusqlite::Connection, sync_id: &str, rev: i64) -> AppResult<()> {
    let next: i64 = conn
        .query_row(
            "SELECT COALESCE(MIN(local_id), 0) - 1 FROM jnclub_sync_index",
            [],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    conn.execute(
        "INSERT OR IGNORE INTO jnclub_sync_index (local_id, sync_id, rev, digest)
         VALUES (?1, ?2, ?3, '')",
        rusqlite::params![next, sync_id, rev.max(1)],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Land the server's answer to one push batch: index the accepted records,
/// adopt the server's version for anything it refused.
///
/// Note what is *not* here: no write to LAST_SEQ. See `sync_inner`.
fn apply_push_response(
    conn: &rusqlite::Connection,
    prepared: &[PreparedItem],
    tombstone_sync_ids: &HashSet<String>,
    response: &PushResponse,
    conflicts: &[ConflictDto],
) -> AppResult<()> {
    let by_sync_id: HashMap<String, &PreparedItem> = prepared
        .iter()
        .map(|item| (item.dto.sync_id.clone(), item))
        .collect();

    for sync_id in response.accepted.clone().unwrap_or_default() {
        let Some(item) = by_sync_id.get(&sync_id) else { continue };
        if tombstone_sync_ids.contains(&sync_id) {
            delete_index(conn, item.local_id)?;
            continue;
        }
        if let Some(digest) = digest_of(conn, item.local_id)? {
            upsert_index(
                conn,
                item.local_id,
                &sync_id,
                item.dto.rev.unwrap_or(1),
                &digest,
                item.blob.as_ref().map(|(sha, source)| (sha.as_str(), source.as_str())),
            )?;
            // Acknowledged: absorb the dirty flag the write path raised. Safe
            // under the connection lock — no other writer can slip in between
            // the digest check and the delete.
            clear_dirty_flag(conn, item.local_id)?;
        }
    }

    // A conflict means the server version is newer; adopt it so the next pull
    // converges instead of pushing the same row forever.
    for conflict in conflicts {
        let Some(server) = conflict.server_record.as_ref() else { continue };
        let Some(item) = by_sync_id.get(&server.sync_id) else { continue };
        if server.deleted_at.is_some() {
            delete_history(conn, item.local_id)?;
            delete_index(conn, item.local_id)?;
        } else {
            update_remote(conn, item.local_id, server)?;
            apply_local_encryption_policy(conn, item.local_id, server);
            if let Some(digest) = digest_of(conn, item.local_id)? {
                upsert_index(
                    conn,
                    item.local_id,
                    &server.sync_id,
                    conflict.server_rev.or(server.rev).unwrap_or(1),
                    &digest,
                    None,
                )?;
                clear_dirty_flag(conn, item.local_id)?;
            }
        }
    }
    Ok(())
}

/// Turn one pending item into something the wire can carry: image bytes are
/// uploaded (or referenced by digest when they already have been), everything
/// else passes through. An item whose image cannot be read or uploaded is
/// dropped from this round rather than pushed as a content string the peer
/// cannot render.
async fn prepare_item(
    client: &reqwest::Client,
    config: &Config,
    index_by_local: &HashMap<i64, IndexRow>,
    item: PushItem,
) -> Option<PreparedItem> {
    let PushItem { local_id, mut dto, raw_content } = item;

    let needs_upload = dto.content_type == "image"
        && dto.deleted_at.is_none()
        && !is_blob_ref(&dto.content);

    let mut blob: Option<(String, String)> = None;

    if needs_upload {
        // A pin, a tag edit or a note on an image row must not ship the
        // screenshot again: if the bytes (and their storage slot) have not
        // moved since the last acknowledged upload, reference the digest.
        let reused = index_by_local
            .get(&local_id)
            .filter(|entry| {
                entry
                    .blob_sha
                    .as_deref()
                    .is_some_and(|sha| !sha.is_empty())
                    && entry.blob_source.as_deref() == Some(raw_content.as_str())
            })
            .and_then(|entry| entry.blob_sha.clone());

        match reused {
            Some(sha) => {
                dto.content = sha;
            }
            None => {
                let Some((bytes, mime)) = read_local_image(&dto.content) else {
                    crate::logger::log(&format!(
                        "jnclub sync: skipping image {local_id} because its bytes are unreadable"
                    ));
                    return None;
                };
                match upload_blob(client, config, bytes, &mime).await {
                    Ok(sha) => {
                        dto.content = sha.clone();
                        blob = Some((sha, raw_content));
                    }
                    Err(err) => {
                        crate::logger::log(&format!(
                            "jnclub sync: image {local_id} upload failed: {err}"
                        ));
                        return None;
                    }
                }
            }
        }
        // The peer shows this text under the thumbnail; a path would be
        // meaningless there too.
        if dto.preview.as_deref().is_none_or(|p| p.trim().is_empty()) {
            dto.preview = Some("图片".into());
        }
    }

    Some(PreparedItem { local_id, dto, blob })
}

/// The server's current maximum seq. One number that says whether a pull is
/// worth starting.
async fn remote_state(client: &reqwest::Client, config: &Config) -> AppResult<i64> {
    let url = format!("{}/api/clipboard/sync/state", config.base_url);
    let response = client
        .get(&url)
        .header("jn-token", &config.token)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    decode_envelope::<i64>(response).await
}

/// Land one server record locally.
///
/// Local edits that have not been pushed yet lose to the server copy: the
/// server already resolved the conflict by `rev`, and keeping the local text
/// would make the next push fail the same way forever. Surfacing the loss is a
/// UI concern that does not exist yet.
///
/// `blob` is the `(sha, path)` link for an image whose digest resolved to a
/// local file, so the index can reference the digest again without another
/// upload.
fn apply_remote(
    conn: &rusqlite::Connection,
    dto: &RecordDto,
    by_sync: &HashMap<String, IndexRow>,
    blob: Option<(&str, &str)>,
) -> AppResult<()> {
    let existing = by_sync.get(&dto.sync_id);
    let rev = dto.rev.unwrap_or(1);

    if dto.deleted_at.is_some() {
        if let Some(entry) = existing {
            delete_history(conn, entry.local_id)?;
            delete_index(conn, entry.local_id)?;
        }
        return Ok(());
    }

    let local_id = match existing {
        Some(entry) => {
            update_remote(conn, entry.local_id, dto)?;
            entry.local_id
        }
        None => insert_remote(conn, dto)?,
    };
    // The record travelled as plaintext (the origin device's key would not
    // open here); re-apply this device's at-rest policy so a sensitive row is
    // stored exactly like a locally captured one.
    apply_local_encryption_policy(conn, local_id, dto);
    if let Some(digest) = digest_of(conn, local_id)? {
        upsert_index(conn, local_id, &dto.sync_id, rev, &digest, blob)?;
        // This row is at its acknowledged state — the trigger flag raised by
        // the apply itself settles here instead of on the next scan.
        clear_dirty_flag(conn, local_id)?;
    }
    Ok(())
}

/// Encrypt one row's text fields with this device's master key — the mirror
/// of the capture pipeline's behaviour for sensitive rows. A failure (Keychain
/// access denied) leaves the row plaintext: the data still works locally, it
/// just is not protected at rest.
fn apply_local_encryption_policy(conn: &rusqlite::Connection, local_id: i64, dto: &RecordDto) {
    let tags = dto.tags.clone().unwrap_or_default();
    if !crate::database::has_sensitive_tag(&tags) {
        return;
    }
    if let Err(err) = encrypt_row_at_rest(conn, local_id) {
        crate::logger::log(&format!(
            "jnclub sync: row {local_id} stays plaintext at rest: {err}"
        ));
    }
}

fn encrypt_row_at_rest(conn: &rusqlite::Connection, local_id: i64) -> AppResult<()> {
    let (content, preview, html): (String, String, Option<String>) = conn
        .query_row(
            "SELECT content, preview, html_content FROM clipboard_history WHERE id = ?1",
            [local_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    let content = crate::infrastructure::encryption::encrypt_for_storage(&content)
        .map_err(AppError::Encryption)?;
    let preview = crate::infrastructure::encryption::encrypt_for_storage(&preview)
        .map_err(AppError::Encryption)?;
    let html = match html {
        Some(value) => Some(
            crate::infrastructure::encryption::encrypt_for_storage(&value)
                .map_err(AppError::Encryption)?,
        ),
        None => None,
    };
    conn.execute(
        "UPDATE clipboard_history SET content = ?2, preview = ?3, html_content = ?4 WHERE id = ?1",
        rusqlite::params![local_id, content, preview, html],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().expect("open database");
        conn.execute_batch(
            "
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE clipboard_history (
                id INTEGER PRIMARY KEY,
                content_type TEXT NOT NULL,
                content TEXT NOT NULL,
                source_app TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                preview TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                tags TEXT NOT NULL DEFAULT '[]',
                use_count INTEGER NOT NULL DEFAULT 0,
                pinned_order INTEGER NOT NULL DEFAULT 0,
                content_hash INTEGER NOT NULL DEFAULT 0,
                html_content TEXT,
                note TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL DEFAULT 0,
                last_used_at INTEGER NOT NULL DEFAULT 0,
                sort_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE jnclub_sync_index (
                local_id INTEGER PRIMARY KEY,
                sync_id TEXT NOT NULL UNIQUE,
                rev INTEGER NOT NULL DEFAULT 1,
                digest TEXT NOT NULL DEFAULT '',
                blob_sha TEXT,
                blob_source TEXT
            );
            CREATE TABLE jnclub_dirty (local_id INTEGER PRIMARY KEY);
            CREATE TRIGGER jnclub_dirty_after_insert
            AFTER INSERT ON clipboard_history
            BEGIN
                INSERT OR IGNORE INTO jnclub_dirty (local_id) VALUES (new.id);
            END;
            CREATE TRIGGER jnclub_dirty_after_update
            AFTER UPDATE ON clipboard_history
            BEGIN
                INSERT OR IGNORE INTO jnclub_dirty (local_id) VALUES (new.id);
            END;
            CREATE TRIGGER jnclub_dirty_after_delete
            AFTER DELETE ON clipboard_history
            BEGIN
                DELETE FROM jnclub_dirty WHERE local_id = old.id;
            END;
            CREATE INDEX idx_clipboard_history_created ON clipboard_history (created_at);
            ",
        )
        .expect("create schema");
        conn
    }

    fn insert_row(conn: &Connection, content: &str) -> i64 {
        conn.execute(
            "INSERT INTO clipboard_history
                (content_type, content, source_app, timestamp, preview, created_at, last_used_at, sort_at)
             VALUES ('text', ?1, 'Test', 1, ?1, 1, 1, 1)",
            [content],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn an_untracked_row_is_pushed_as_new() {
        let conn = fixture();
        insert_row(&conn, "hello");
        let pending = collect_changes(&conn).unwrap();
        assert_eq!(pending.items.len(), 1);
        assert!(pending.tombstone_sync_ids.is_empty());
        assert_eq!(pending.items[0].dto.rev, Some(1));
        // A fresh sync id is minted per row, not reused between rows.
        assert_eq!(Uuid::parse_str(&pending.items[0].dto.sync_id).is_ok(), true);
    }

    #[test]
    fn an_unchanged_row_is_not_pushed_again() {
        let conn = fixture();
        let id = insert_row(&conn, "hello");
        let pending = collect_changes(&conn).unwrap();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, &pending.items[0].dto.sync_id, 1, &digest, None).unwrap();

        let second = collect_changes(&conn).unwrap();
        assert!(second.items.is_empty(), "digest matched but the row was queued again");
    }

    #[test]
    fn a_stats_bump_is_not_pushed() {
        let conn = fixture();
        let id = insert_row(&conn, "hello");
        let pending = collect_changes(&conn).unwrap();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, &pending.items[0].dto.sync_id, 1, &digest, None).unwrap();

        // Every paste does this: counters up, row back to the top.
        conn.execute(
            "UPDATE clipboard_history SET use_count = use_count + 1, last_used_at = 42, sort_at = 99 WHERE id = ?1",
            [id],
        )
        .unwrap();
        let second = collect_changes(&conn).unwrap();
        assert!(second.items.is_empty(), "a paste must not re-ship the record");
    }

    #[test]
    fn an_edited_row_is_pushed_with_a_bumped_rev() {
        let conn = fixture();
        let id = insert_row(&conn, "hello");
        let pending = collect_changes(&conn).unwrap();
        let sync_id = pending.items[0].dto.sync_id.clone();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, &sync_id, 3, &digest, None).unwrap();

        conn.execute("UPDATE clipboard_history SET note = 'later' WHERE id = ?1", [id])
            .unwrap();
        let second = collect_changes(&conn).unwrap();
        assert_eq!(second.items.len(), 1);
        assert_eq!(second.items[0].dto.rev, Some(4));
        assert_eq!(second.items[0].dto.sync_id, sync_id);
    }

    #[test]
    fn a_row_deleted_locally_becomes_a_tombstone() {
        let conn = fixture();
        let id = insert_row(&conn, "hello");
        let pending = collect_changes(&conn).unwrap();
        let sync_id = pending.items[0].dto.sync_id.clone();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, &sync_id, 1, &digest, None).unwrap();
        delete_history(&conn, id).unwrap();

        let second = collect_changes(&conn).unwrap();
        assert!(second.tombstone_sync_ids.contains(&sync_id));
        assert_eq!(second.items.len(), 1);
        assert!(second.items[0].dto.deleted_at.is_some());
        assert_eq!(second.items[0].dto.rev, Some(2));
    }

    #[test]
    fn a_remote_record_lands_and_is_tracked() {
        let conn = fixture();
        let dto = RecordDto {
            sync_id: "remote-1".into(),
            content_type: "text".into(),
            content: "from phone".into(),
            content_hash: Some(0),
            html_content: None,
            preview: Some("from phone".into()),
            source_app: Some("Web".into()),
            is_pinned: Some(true),
            pinned_order: Some(2),
            tags: Some(vec!["work".into()]),
            note: Some("note".into()),
            use_count: Some(1),
            created_at: Some(10),
            last_used_at: Some(11),
            sort_at: Some(12),
            deleted_at: None,
            rev: Some(1),
            seq: Some(7),
        };
        apply_remote(&conn, &dto, &HashMap::new(), None).unwrap();

        let (content, pinned, tags): (String, i64, String) = conn
            .query_row(
                "SELECT content, is_pinned, tags FROM clipboard_history WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(content, "from phone");
        assert_eq!(pinned, 1);
        assert_eq!(tags, r#"["work"]"#);

        // Tracked, so the next push does not echo it back.
        let pending = collect_changes(&conn).unwrap();
        assert!(pending.items.is_empty());
    }

    #[test]
    fn a_remote_tombstone_removes_the_local_copy() {
        let conn = fixture();
        let id = insert_row(&conn, "gone soon");
        let pending = collect_changes(&conn).unwrap();
        let sync_id = pending.items[0].dto.sync_id.clone();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, &sync_id, 1, &digest, None).unwrap();

        let mut by_sync = HashMap::new();
        by_sync.insert(
            sync_id.clone(),
            IndexRow {
                local_id: id,
                sync_id: sync_id.clone(),
                rev: 1,
                digest,
                blob_sha: None,
                blob_source: None,
            },
        );
        let tombstone = RecordDto {
            sync_id,
            content_type: "text".into(),
            content: String::new(),
            content_hash: None,
            html_content: None,
            preview: None,
            source_app: None,
            is_pinned: None,
            pinned_order: None,
            tags: None,
            note: None,
            use_count: None,
            created_at: None,
            last_used_at: None,
            sort_at: None,
            deleted_at: Some(99),
            rev: Some(2),
            seq: None,
        };
        apply_remote(&conn, &tombstone, &by_sync, None).unwrap();

        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM clipboard_history", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        let indexed: i64 = conn
            .query_row("SELECT COUNT(*) FROM jnclub_sync_index", [], |row| row.get(0))
            .unwrap();
        assert_eq!(indexed, 0);
    }

    /// Talks to a real `jnclub-module-clipboard`, because a mock of the server
    /// only proves the mock agrees with itself. Ignored by default: it needs a
    /// deployment and a token.
    ///
    /// ```text
    /// JNCLUB_TEST_BASE_URL=http://localhost:19005 JNCLUB_TEST_TOKEN=<jn-token> \
    ///   cargo test live_server -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "needs a running JNClub and JNCLUB_TEST_TOKEN"]
    async fn live_server_round_trips_a_record() {
        let base_url = std::env::var("JNCLUB_TEST_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:19005".to_string());
        let token = std::env::var("JNCLUB_TEST_TOKEN").expect("JNCLUB_TEST_TOKEN must be set");
        let config = Config { base_url, token };
        let client = http_client().expect("build client");

        let conn = fixture();
        let marker = format!("rust round trip {}", Uuid::new_v4());
        insert_row(&conn, &marker);

        let pending = collect_changes(&conn).unwrap();
        assert_eq!(pending.items.len(), 1);
        assert!(pending.tombstone_sync_ids.is_empty());
        let sync_id = pending.items[0].dto.sync_id.clone();

        let pushed = push(
            &client,
            &config,
            pending.items.iter().map(|item| item.dto.clone()).collect(),
        )
        .await
        .expect("push to the live server");
        let accepted = pushed.accepted.unwrap_or_default();
        assert!(
            accepted.contains(&sync_id),
            "server accepted {accepted:?}, expected {sync_id}"
        );

        // The record must come back on a full pull, which is what another
        // device would see.
        let mut found = false;
        let mut since = 0i64;
        for _ in 0..10 {
            let page = pull_page(&client, &config, since, DEFAULT_LIMIT).await.expect("pull");
            if let Some(records) = page.records {
                if records.iter().any(|r| r.sync_id == sync_id && r.content == marker) {
                    found = true;
                    break;
                }
            }
            let next = page.next_seq.unwrap_or(since);
            if !page.has_more.unwrap_or(false) || next == since {
                break;
            }
            since = next;
        }
        assert!(found, "the pushed record did not come back from the server");
    }

    /// The image path end to end against a running server.
    ///
    /// ```sh
    /// cargo test live_server -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "needs a running JNClub and JNCLUB_TEST_TOKEN"]
    async fn live_server_round_trips_an_image() {
        let base_url = std::env::var("JNCLUB_TEST_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:19005".to_string());
        let token = std::env::var("JNCLUB_TEST_TOKEN").expect("JNCLUB_TEST_TOKEN must be set");
        let config = Config { base_url, token };
        let client = http_client().expect("build client");

        // A 2x2 PNG: small enough to inline, real enough that the mime sniff
        // has something to recognise.
        let png: Vec<u8> = vec![
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x02, 0x00, 0x00,
            0x00, 0xFD, 0xD4, 0x9A, 0x73, 0x00, 0x00, 0x00, 0x16, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x00,
            0x00, 0x00, 0x1D, 0x00, 0x11, 0x00, 0x01, 0x89, 0x5B, 0x0C, 0x0B, 0x00, 0x00, 0x00,
            0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];

        let sha = upload_blob(&client, &config, png.clone(), "image/png")
            .await
            .expect("upload the image");
        assert_eq!(sha.len(), 64, "server answered with {sha}");

        let fetched = download_blob(&client, &config, &sha)
            .await
            .expect("download the image")
            .expect("the image is on the server");
        assert_eq!(fetched, png, "the bytes came back changed");
    }

    /// The desktop keeps images as files, so the push path reads the file
    /// rather than a data URL. That branch is the one that runs in production.
    #[tokio::test]
    #[ignore = "needs a running JNClub and JNCLUB_TEST_TOKEN"]
    async fn live_server_round_trips_an_image_file() {
        let base_url = std::env::var("JNCLUB_TEST_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:19005".to_string());
        let token = std::env::var("JNCLUB_TEST_TOKEN").expect("JNCLUB_TEST_TOKEN must be set");
        let config = Config { base_url, token };
        let client = http_client().expect("build client");

        let png: Vec<u8> = vec![
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x02, 0x00, 0x00,
            0x00, 0xFD, 0xD4, 0x9A, 0x73, 0x00, 0x00, 0x00, 0x16, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x00,
            0x00, 0x00, 0x1D, 0x00, 0x11, 0x00, 0x01, 0x89, 0x5B, 0x0C, 0x0B, 0x00, 0x00, 0x00,
            0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        let path = std::env::temp_dir().join("jnclub-live-image-probe.png");
        std::fs::write(&path, &png).expect("write the probe file");

        let (bytes, mime) =
            read_local_image(path.to_str().unwrap()).expect("read the probe file back");
        assert_eq!(mime, "image/png");
        let sha = upload_blob(&client, &config, bytes, &mime)
            .await
            .expect("upload the image");
        assert_eq!(sha.len(), 64);

        let fetched = download_blob(&client, &config, &sha)
            .await
            .expect("download the image")
            .expect("the image is on the server");
        assert_eq!(fetched, png, "the bytes came back changed");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn an_unknown_remote_record_is_inserted_once() {
        let conn = fixture();
        let dto = RecordDto {
            sync_id: "remote-2".into(),
            content_type: "text".into(),
            content: "once".into(),
            content_hash: None,
            html_content: None,
            preview: None,
            source_app: None,
            is_pinned: None,
            pinned_order: None,
            tags: None,
            note: None,
            use_count: None,
            created_at: Some(5),
            last_used_at: None,
            sort_at: None,
            deleted_at: None,
            rev: Some(1),
            seq: Some(1),
        };
        apply_remote(&conn, &dto, &HashMap::new(), None).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM clipboard_history", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn an_accepted_push_does_not_advance_the_pull_cursor() {
        // A push response reports the server's *global* maximum seq, which
        // includes records other devices wrote and this device has not pulled
        // yet. Accepting that value as the pull cursor would skip those
        // records forever — pull only ever returns `seq > since`.
        let conn = fixture();
        write_setting(&conn, LAST_SEQ_KEY, "100").unwrap();
        let id = insert_row(&conn, "hello");
        let pending = collect_changes(&conn).unwrap();

        let prepared = [PreparedItem {
            local_id: id,
            dto: pending.items[0].dto.clone(),
            blob: None,
        }];
        let response = PushResponse {
            accepted: Some(vec![pending.items[0].dto.sync_id.clone()]),
            conflicts: Some(Vec::new()),
            // The server's global maximum, not "our" records: the trap itself.
            next_seq: Some(203),
        };
        apply_push_response(&conn, &prepared, &pending.tombstone_sync_ids, &response, &[]).unwrap();

        let cursor = read_setting(&conn, LAST_SEQ_KEY);
        assert_eq!(
            cursor.as_deref(),
            Some("100"),
            "a push must never move the pull cursor"
        );
        // The record is indexed though, so the next round does not re-ship it.
        let indexed: i64 = conn
            .query_row("SELECT COUNT(*) FROM jnclub_sync_index", [], |row| row.get(0))
            .unwrap();
        assert_eq!(indexed, 1);
    }

    #[tokio::test]
    async fn an_unchanged_image_is_referenced_by_its_cached_digest() {
        // Pinning or retagging an image row must not ship the screenshot
        // again. The reuse path is pure bookkeeping: no network call at all,
        // which the deliberately unreachable client below proves.
        let conn = fixture();
        let path = "/tmp/attachments/img_pinme.png";
        let id = insert_row(&conn, path);
        conn.execute("UPDATE clipboard_history SET content_type = 'image' WHERE id = ?1", [id])
            .unwrap();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        let sha = "a".repeat(64);
        upsert_index(&conn, id, "sync-image", 1, &digest, Some((sha.as_str(), path))).unwrap();

        // Any edit that is not a content move.
        conn.execute("UPDATE clipboard_history SET is_pinned = 1 WHERE id = ?1", [id]).unwrap();
        let pending = collect_changes(&conn).unwrap();
        assert_eq!(pending.items.len(), 1);

        let config = Config {
            base_url: "http://127.0.0.1:1".into(),
            token: String::new(),
        };
        let client = http_client().unwrap();
        let prepared =
            prepare_item(&client, &config, &pending.index_by_local, pending.items[0].clone())
                .await
                .expect("reuse needs no network");
        assert_eq!(prepared.dto.content, sha);
        assert!(prepared.blob.is_none(), "nothing was uploaded");
    }

    #[test]
    fn a_pulled_image_row_remembers_its_blob_reference() {
        let conn = fixture();
        let sha = "b".repeat(64);
        let original = RecordDto {
            sync_id: "img-pull".into(),
            content_type: "image".into(),
            content: sha.clone(),
            content_hash: Some(0),
            html_content: None,
            preview: Some("图片".into()),
            source_app: Some("Web".into()),
            is_pinned: None,
            pinned_order: None,
            tags: None,
            note: None,
            use_count: None,
            created_at: Some(1),
            last_used_at: None,
            sort_at: None,
            deleted_at: None,
            rev: Some(4),
            seq: Some(9),
        };
        let mut localised = original.clone();
        let local_path = "/tmp/attachments/img_pulled.png".to_string();
        localised.content = local_path.clone();

        let blob = image_blob_link(&original, &localised)
            .expect("a resolved image reference is linkable");
        assert_eq!(blob, (sha.clone(), local_path.clone()));
        apply_remote(&conn, &localised, &HashMap::new(), Some((&sha, &local_path))).unwrap();

        let (stored_sha, stored_source): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT blob_sha, blob_source FROM jnclub_sync_index WHERE sync_id = 'img-pull'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(stored_sha.as_deref(), Some(sha.as_str()));
        assert_eq!(stored_source.as_deref(), Some(local_path.as_str()));
    }

    // ------------------------------------------------ pull-side duplicate merge

    fn remote_text_dto(sync_id: &str, rev: i64, content: &str, created_at: i64) -> RecordDto {
        RecordDto {
            sync_id: sync_id.into(),
            content_type: "text".into(),
            content: content.into(),
            content_hash: None,
            html_content: None,
            preview: Some(content.into()),
            source_app: Some("Web".into()),
            is_pinned: None,
            pinned_order: None,
            tags: None,
            note: None,
            use_count: Some(1),
            created_at: Some(created_at),
            last_used_at: None,
            sort_at: None,
            deleted_at: None,
            rev: Some(rev),
            seq: None,
        }
    }

    fn index_count(conn: &Connection, sync_id: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM jnclub_sync_index WHERE sync_id = ?1",
            [sync_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn a_later_remote_duplicate_of_a_local_row_loses_to_it() {
        // 电脑 10:00 复制的 "hello" 已同步；手机 10:05 复制了同一句话。
        // 本地行更早，应当保留自己的身份；远端身份排一份墓碑。
        let conn = fixture();
        let id = insert_row(&conn, "hello");
        conn.execute("UPDATE clipboard_history SET created_at = 200, use_count = 0 WHERE id = ?1", [id])
            .unwrap();
        let changes = collect_changes(&conn).unwrap();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, "local-old", 1, &digest, None).unwrap();
        let _ = changes;

        let dto = remote_text_dto("remote-1", 1, "hello", 500);
        let dup = find_duplicate(&conn, &dto).unwrap().expect("the local copy matches");
        assert_eq!(dup.local_id, id);
        absorb_duplicate(&conn, &dto, &dup).unwrap();

        // 本地行的索引没动，远端身份进了墓碑队列
        let identity: String = conn
            .query_row(
                "SELECT sync_id FROM jnclub_sync_index WHERE local_id = ?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(identity, "local-old");
        assert_eq!(index_count(&conn, "remote-1"), 1, "远端身份应排进墓碑队列");

        // 下一轮 collect_changes 把墓碑推出去
        let changes = collect_changes(&conn).unwrap();
        assert!(changes.tombstone_sync_ids.contains("remote-1"));
        let tombstone = changes
            .items
            .iter()
            .find(|item| item.dto.sync_id == "remote-1")
            .expect("the tombstone is queued for the next push");
        assert!(tombstone.dto.deleted_at.is_some());
    }

    #[test]
    fn an_earlier_remote_duplicate_takes_over_a_newer_local_row() {
        // 反过来：手机更早复制，电脑后复制。远端身份胜出，本地行改挂到它，
        // 本地旧身份排墓碑——所有设备最终都收敛到同一条记录。
        let conn = fixture();
        let id = insert_row(&conn, "hello");
        conn.execute("UPDATE clipboard_history SET created_at = 500, use_count = 3 WHERE id = ?1", [id])
            .unwrap();
        let changes = collect_changes(&conn).unwrap();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, "local-new", 1, &digest, None).unwrap();
        let _ = changes;

        let dto = remote_text_dto("remote-1", 2, "hello", 100);
        let dup = find_duplicate(&conn, &dto).unwrap().expect("the local copy matches");
        absorb_duplicate(&conn, &dto, &dup).unwrap();

        // 本地行改挂远端身份，rev 取远端的
        let (identity, rev): (String, i64) = conn
            .query_row(
                "SELECT sync_id, rev FROM jnclub_sync_index WHERE local_id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(identity, "remote-1");
        assert_eq!(rev, 2);
        // 旧身份排墓碑，且不再重推这一行（它已被重指）
        assert_eq!(index_count(&conn, "local-new"), 1);
        let changes = collect_changes(&conn).unwrap();
        assert!(changes.tombstone_sync_ids.contains("local-new"));
        assert!(
            !changes.items.iter().any(|item| item.dto.sync_id == "remote-1"),
            "胜出的身份不能再被推一次"
        );

        // 收录时间取更早的（首次复制语义）
        let created_at: i64 = conn
            .query_row("SELECT created_at FROM clipboard_history WHERE id = ?1", [id], |row| row.get(0))
            .unwrap();
        assert_eq!(created_at, 100);
        // 计数取两者较大值
        let use_count: i64 = conn
            .query_row("SELECT use_count FROM clipboard_history WHERE id = ?1", [id], |row| row.get(0))
            .unwrap();
        assert_eq!(use_count, 3);
    }

    #[test]
    fn an_image_duplicate_merges_by_digest_without_reading_bytes() {
        // 两台设备各贴过同一张截图：字节相同 → digest 相同。合并按
        // digest 判断，不需要读文件、更不需要下载。
        let conn = fixture();
        let path = "/tmp/attachments/img_dup.png";
        let id = insert_row(&conn, path);
        conn.execute("UPDATE clipboard_history SET content_type = 'image', created_at = 200 WHERE id = ?1", [id])
            .unwrap();
        let digest = "a".repeat(64);
        let row_digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, "img-old", 1, &row_digest, Some((digest.as_str(), path))).unwrap();

        let dto = RecordDto {
            sync_id: "img-remote".into(),
            content_type: "image".into(),
            content: digest.clone(),
            content_hash: Some(0),
            html_content: None,
            preview: Some("图片".into()),
            source_app: Some("Web".into()),
            is_pinned: None,
            pinned_order: None,
            tags: None,
            note: None,
            use_count: None,
            created_at: Some(100),
            last_used_at: None,
            sort_at: None,
            deleted_at: None,
            rev: Some(1),
            seq: None,
        };
        let dup = find_duplicate(&conn, &dto).unwrap().expect("the digest matches");
        absorb_duplicate(&conn, &dto, &dup).unwrap();

        // 远端更早 → 接管本地行的索引；本地旧身份排墓碑
        let identity: String = conn
            .query_row(
                "SELECT sync_id FROM jnclub_sync_index WHERE local_id = ?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(identity, "img-remote");
        assert_eq!(index_count(&conn, "img-old"), 1);
        // 图片引用跟着换到远端 digest 上，本地路径不变
        let (blob_sha, blob_source): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT blob_sha, blob_source FROM jnclub_sync_index WHERE local_id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(blob_sha.as_deref(), Some(digest.as_str()));
        assert_eq!(blob_source.as_deref(), Some(path));
    }

    #[test]
    fn a_record_older_than_the_merge_window_is_not_a_duplicate() {
        // 两周前在别处复制的同一句话：不合并。两边都会保留两条记录，
        // 但至少不会两台设备各自做出相反的决定。
        let conn = fixture();
        let id = insert_row(&conn, "hello");
        conn.execute("UPDATE clipboard_history SET created_at = 500 WHERE id = ?1", [id])
            .unwrap();

        let dto = remote_text_dto("remote-1", 1, "hello", 500 - DEDUPE_WINDOW_MS - 1);
        assert!(
            find_duplicate(&conn, &dto).unwrap().is_none(),
            "超出合并窗口的记录不该被判重"
        );
    }
}
