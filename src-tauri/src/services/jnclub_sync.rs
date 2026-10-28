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

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::database::DbState;
use crate::error::{AppError, AppResult};
use crate::infrastructure::repository::settings_repo::{SettingsRepository, SqliteSettingsRepository};

/// Where the JNClub origin and the Sa-Token live in the settings table.
pub const BASE_URL_KEY: &str = "jnclub.sync_base_url";
pub const TOKEN_KEY: &str = "jnclub.sync_token";
pub const LAST_SEQ_KEY: &str = "jnclub.sync_last_seq";
pub const LAST_AT_KEY: &str = "jnclub.sync_last_at";

const DEFAULT_LIMIT: u32 = 200;
/// A pull that never reports `hasMore == false` must not spin forever.
const MAX_PAGES: usize = 500;

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
            self.use_count.to_string(),
            self.created_at.to_string(),
            self.last_used_at.to_string(),
            self.sort_at.to_string(),
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

#[derive(Debug, Clone)]
struct IndexRow {
    local_id: i64,
    sync_id: String,
    rev: i64,
    digest: String,
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
    let base_url = read_setting(&conn, BASE_URL_KEY).unwrap_or_default().trim().trim_end_matches('/').to_string();
    let token = read_setting(&conn, TOKEN_KEY).unwrap_or_default().trim().to_string();
    if base_url.is_empty() || token.is_empty() {
        return Ok(None);
    }
    Ok(Some(Config { base_url, token }))
}

pub fn status(app: &AppHandle) -> AppResult<SyncStatus> {
    let conn = lock_db(app)?;
    let configured = read_setting(&conn, BASE_URL_KEY).is_some_and(|v| !v.trim().is_empty())
        && read_setting(&conn, TOKEN_KEY).is_some_and(|v| !v.trim().is_empty());
    let last_seq = read_setting(&conn, LAST_SEQ_KEY)
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let last_sync_at = read_setting(&conn, LAST_AT_KEY).and_then(|v| v.parse::<i64>().ok());
    Ok(SyncStatus { configured, last_seq, last_sync_at })
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

fn load_local_rows(conn: &rusqlite::Connection) -> AppResult<Vec<LocalRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, content_type, content, preview, source_app, html_content, is_pinned,
                    pinned_order, tags, note, use_count, created_at, last_used_at, sort_at,
                    content_hash
             FROM clipboard_history
             ORDER BY id ASC",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
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
        })
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| AppError::Database(e.to_string()))?);
    }
    Ok(out)
}

fn load_index(conn: &rusqlite::Connection) -> AppResult<Vec<IndexRow>> {
    let mut stmt = conn
        .prepare("SELECT local_id, sync_id, rev, digest FROM jnclub_sync_index")
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(IndexRow {
                local_id: row.get(0)?,
                sync_id: row.get(1)?,
                rev: row.get(2)?,
                digest: row.get(3)?,
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
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO jnclub_sync_index (local_id, sync_id, rev, digest) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(local_id) DO UPDATE SET sync_id = excluded.sync_id,
                                             rev = excluded.rev,
                                             digest = excluded.digest",
        rusqlite::params![local_id, sync_id, rev, digest],
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
        return Err(AppError::Network("token expired".into()));
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

/// Everything that has to travel: new rows, edited rows, deleted rows.
fn collect_changes(
    conn: &rusqlite::Connection,
) -> AppResult<(Vec<(i64, RecordDto)>, Vec<String>, usize)> {
    let rows = load_local_rows(conn)?;
    let index = load_index(conn)?;
    let by_local: HashMap<i64, IndexRow> = index.iter().cloned().map(|r| (r.local_id, r)).collect();
    let live: HashMap<i64, &LocalRow> = rows.iter().map(|r| (r.id, r)).collect();

    let mut pending: Vec<(i64, RecordDto)> = Vec::new();
    // Rows that vanished locally: push a tombstone, then forget them.
    let mut tombstones: Vec<String> = Vec::new();
    let now = now_ms();

    for row in &rows {
        match by_local.get(&row.id) {
            Some(entry) => {
                if entry.digest != row.digest() {
                    pending.push((row.id, row.to_dto(&entry.sync_id, entry.rev + 1)));
                }
            }
            None => {
                let sync_id = Uuid::new_v4().to_string();
                pending.push((row.id, row.to_dto(&sync_id, 1)));
            }
        }
    }

    for entry in &index {
        if !live.contains_key(&entry.local_id) {
            tombstones.push(entry.sync_id.clone());
            pending.push((
                entry.local_id,
                RecordDto {
                    sync_id: entry.sync_id.clone(),
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
                    rev: Some(entry.rev + 1),
                    seq: None,
                },
            ));
        }
    }

    Ok((pending, tombstones, rows.len()))
}

pub async fn sync_now(app: &AppHandle) -> AppResult<SyncOutcome> {
    let config = match read_config(app)? {
        Some(config) => config,
        None => return Err(AppError::Validation("sync is not configured".into())),
    };
    let client = http_client()?;

    // 1. Push. The connection guard is dropped before any await.
    let (pending, tombstones, _) = {
        let conn = lock_db(app)?;
        collect_changes(&conn)?
    };
    let mut outcome = SyncOutcome::default();
    if !pending.is_empty() {
        let payload: Vec<RecordDto> = pending.iter().map(|(_, dto)| dto.clone()).collect();
        let accepted_count = payload.len();
        let response = push(&client, &config, payload).await?;
        let accepted = response.accepted.unwrap_or_default();
        let conflicts = response.conflicts.unwrap_or_default();

        {
            let conn = lock_db(app)?;
            let by_sync_id: HashMap<String, i64> =
                pending.iter().map(|(id, dto)| (dto.sync_id.clone(), *id)).collect();
            for sync_id in &accepted {
                let Some(local_id) = by_sync_id.get(sync_id) else { continue };
                let Some((_, dto)) = pending.iter().find(|(_, dto)| &dto.sync_id == sync_id) else {
                    continue;
                };
                if tombstones.contains(sync_id) {
                    delete_index(&conn, *local_id)?;
                    continue;
                }
                if let Some(digest) = digest_of(&conn, *local_id)? {
                    upsert_index(&conn, *local_id, sync_id, dto.rev.unwrap_or(1), &digest)?;
                }
            }
            // A conflict means the server version is newer; adopt it so the
            // next pull converges instead of pushing the same row forever.
            for conflict in &conflicts {
                let Some(server) = conflict.server_record.as_ref() else { continue };
                if let Some(local_id) = by_sync_id.get(&server.sync_id).copied() {
                    if server.deleted_at.is_some() {
                        delete_history(&conn, local_id)?;
                        delete_index(&conn, local_id)?;
                    } else {
                        update_remote(&conn, local_id, server)?;
                        if let Some(digest) = digest_of(&conn, local_id)? {
                            upsert_index(
                                &conn,
                                local_id,
                                &server.sync_id,
                                conflict.server_rev.or(server.rev).unwrap_or(1),
                                &digest,
                            )?;
                        }
                    }
                }
            }
            outcome.pushed = accepted.len();
            outcome.conflicts = conflicts.len();
            outcome.tombstones = tombstones.len();
            let _ = accepted_count;
            if let Some(next) = response.next_seq {
                write_setting(&conn, LAST_SEQ_KEY, &next.to_string())?;
            }
        }
    }

    // 2. Pull until the server says there is nothing left.
    let mut since = {
        let conn = lock_db(app)?;
        read_setting(&conn, LAST_SEQ_KEY)
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0)
    };

    for _ in 0..MAX_PAGES {
        let page = pull_page(&client, &config, since, DEFAULT_LIMIT).await?;
        let records = page.records.unwrap_or_default();
        let next_seq = page.next_seq.unwrap_or(since);
        let has_more = page.has_more.unwrap_or(false);

        if !records.is_empty() {
            let conn = lock_db(app)?;
            let mut by_sync: HashMap<String, IndexRow> = HashMap::new();
            for entry in load_index(&conn)? {
                by_sync.insert(entry.sync_id.clone(), entry);
            }
            for record in &records {
                apply_remote(&conn, record, &by_sync)?;
                outcome.pulled += 1;
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

/// Land one server record locally.
///
/// Local edits that have not been pushed yet lose to the server copy: the
/// server already resolved the conflict by `rev`, and keeping the local text
/// would make the next push fail the same way forever. Surfacing the loss is a
/// UI concern that does not exist yet.
fn apply_remote(
    conn: &rusqlite::Connection,
    dto: &RecordDto,
    by_sync: &HashMap<String, IndexRow>,
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
    if let Some(digest) = digest_of(conn, local_id)? {
        upsert_index(conn, local_id, &dto.sync_id, rev, &digest)?;
    }
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
                digest TEXT NOT NULL DEFAULT ''
            );
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
        let (pending, tombstones, _) = collect_changes(&conn).unwrap();
        assert_eq!(pending.len(), 1);
        assert!(tombstones.is_empty());
        assert_eq!(pending[0].1.rev, Some(1));
        // A fresh sync id is minted per row, not reused between rows.
        assert_eq!(Uuid::parse_str(&pending[0].1.sync_id).is_ok(), true);
    }

    #[test]
    fn an_unchanged_row_is_not_pushed_again() {
        let conn = fixture();
        let id = insert_row(&conn, "hello");
        let (pending, _, _) = collect_changes(&conn).unwrap();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, &pending[0].1.sync_id, 1, &digest).unwrap();

        let (second, _, _) = collect_changes(&conn).unwrap();
        assert!(second.is_empty(), "digest matched but the row was queued again");
    }

    #[test]
    fn an_edited_row_is_pushed_with_a_bumped_rev() {
        let conn = fixture();
        let id = insert_row(&conn, "hello");
        let (pending, _, _) = collect_changes(&conn).unwrap();
        let sync_id = pending[0].1.sync_id.clone();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, &sync_id, 3, &digest).unwrap();

        conn.execute("UPDATE clipboard_history SET note = 'later' WHERE id = ?1", [id])
            .unwrap();
        let (second, _, _) = collect_changes(&conn).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].1.rev, Some(4));
        assert_eq!(second[0].1.sync_id, sync_id);
    }

    #[test]
    fn a_row_deleted_locally_becomes_a_tombstone() {
        let conn = fixture();
        let id = insert_row(&conn, "hello");
        let (pending, _, _) = collect_changes(&conn).unwrap();
        let sync_id = pending[0].1.sync_id.clone();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, &sync_id, 1, &digest).unwrap();
        delete_history(&conn, id).unwrap();

        let (second, tombstones, _) = collect_changes(&conn).unwrap();
        assert_eq!(tombstones, vec![sync_id.clone()]);
        assert_eq!(second.len(), 1);
        assert!(second[0].1.deleted_at.is_some());
        assert_eq!(second[0].1.rev, Some(2));
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
        apply_remote(&conn, &dto, &HashMap::new()).unwrap();

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
        let (pending, _, _) = collect_changes(&conn).unwrap();
        assert!(pending.is_empty());
    }

    #[test]
    fn a_remote_tombstone_removes_the_local_copy() {
        let conn = fixture();
        let id = insert_row(&conn, "gone soon");
        let (pending, _, _) = collect_changes(&conn).unwrap();
        let sync_id = pending[0].1.sync_id.clone();
        let digest = digest_of(&conn, id).unwrap().unwrap();
        upsert_index(&conn, id, &sync_id, 1, &digest).unwrap();

        let mut by_sync = HashMap::new();
        by_sync.insert(
            sync_id.clone(),
            IndexRow { local_id: id, sync_id: sync_id.clone(), rev: 1, digest },
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
        apply_remote(&conn, &tombstone, &by_sync).unwrap();

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

        let (pending, tombstones, _) = collect_changes(&conn).unwrap();
        assert_eq!(pending.len(), 1);
        assert!(tombstones.is_empty());
        let sync_id = pending[0].1.sync_id.clone();

        let pushed = push(&client, &config, pending.iter().map(|(_, dto)| dto.clone()).collect())
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
        apply_remote(&conn, &dto, &HashMap::new()).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM clipboard_history", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }
}
