use crate::domain::models::ClipboardEntry;
use crate::infrastructure::encryption;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

pub trait TagRepository {
    fn set_color(&self, name: &str, color: Option<String>) -> Result<(), String>;
    fn get_colors(&self) -> Result<HashMap<String, String>, String>;
    fn get_all_with_counts(&self) -> Result<HashMap<String, i32>, String>;
    fn create(&self, name: &str) -> Result<(), String>;
    fn rename(&self, old_name: &str, new_name: &str) -> Result<(), String>;
    fn delete_globally(&self, name: &str, data_dir: Option<&std::path::Path>)
        -> Result<(), String>;
    fn get_entries_by_tag(&self, tag: &str) -> Result<Vec<ClipboardEntry>, String>;
    fn update_entry_tags(&self, id: i64, tags: Vec<String>) -> Result<(), String>;
}

pub struct SqliteTagRepository {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteTagRepository {
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    fn maybe_decrypt_text(&self, value: &str) -> rusqlite::Result<String> {
        encryption::decrypt_stored_value(value).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, e))))
    }

    fn entry_tags_with_conn(conn: &Connection, entry_id: i64) -> Result<Vec<String>, String> {
        let mut stmt = conn
            .prepare("SELECT tag FROM entry_tags WHERE entry_id = ?")
            .map_err(|e| e.to_string())?;
        let tags = stmt
            .query_map(params![entry_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(tags)
    }

    fn refresh_entry_tags_json(conn: &Connection, entry_id: i64) -> Result<(), String> {
        let mut stmt = conn
            .prepare("SELECT tag FROM entry_tags WHERE entry_id = ? ORDER BY tag")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![entry_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        let mut tags: Vec<String> = Vec::new();
        for row in rows {
            if let Ok(tag) = row {
                if !tag.trim().is_empty() {
                    tags.push(tag);
                }
            }
        }

        let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE clipboard_history SET tags = ?, tags_updated_at = ? WHERE id = ?",
            params![tags_json, chrono::Utc::now().timestamp_millis(), entry_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod rename_tests {
    use super::*;

    fn repo_with_entry(tag: &str) -> SqliteTagRepository {
        let conn = Connection::open_in_memory().expect("open database");
        crate::infrastructure::repository::migrations::run_migrations(&conn).expect("migrate");
        conn.execute(
            "INSERT INTO clipboard_history (id, content_type, content, source_app, timestamp, sort_at, preview, tags)
             VALUES (1, 'text', 'hunter2', 'App', 1, 1, 'hunter2', ?1)",
            params![serde_json::to_string(&[tag]).unwrap()],
        )
        .unwrap();
        conn.execute("INSERT INTO entry_tags (entry_id, tag) VALUES (1, ?1)", params![tag]).unwrap();
        SqliteTagRepository::new(Arc::new(Mutex::new(conn)))
    }

    fn stored_content(repo: &SqliteTagRepository) -> String {
        repo.conn
            .lock()
            .unwrap()
            .query_row("SELECT content FROM clipboard_history WHERE id = 1", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn renaming_a_tag_to_a_sensitive_name_encrypts_its_entries() {
        let repo = repo_with_entry("work");

        repo.rename("work", "Password").unwrap();
        assert!(encryption::is_encrypted_value(&stored_content(&repo)));

        repo.rename("Password", "work").unwrap();
        assert_eq!(stored_content(&repo), "hunter2");
    }
}

impl TagRepository for SqliteTagRepository {
    fn set_color(&self, name: &str, color: Option<String>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if let Some(c) = color {
            conn.execute(
                "INSERT INTO saved_tags (name, color) VALUES (?1, ?2) 
                 ON CONFLICT(name) DO UPDATE SET color = ?2",
                params![name, c],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "UPDATE saved_tags SET color = NULL WHERE name = ?1",
                params![name],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn get_colors(&self) -> Result<HashMap<String, String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT name, color FROM saved_tags WHERE color IS NOT NULL AND color != ''")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        let mut map = HashMap::new();
        for row in rows {
            if let Ok((name, color)) = row {
                map.insert(name, color);
            }
        }
        Ok(map)
    }

    fn get_all_with_counts(&self) -> Result<HashMap<String, i32>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT tag, COUNT(*) FROM entry_tags GROUP BY tag")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
            })
            .map_err(|e| e.to_string())?;

        let mut tag_counts: HashMap<String, i32> = HashMap::new();
        for row in rows {
            if let Ok((tag, count)) = row {
                tag_counts.insert(tag, count);
            }
        }

        // Also include saved tags with 0 count if not present
        let mut stmt_saved = conn
            .prepare("SELECT name FROM saved_tags")
            .map_err(|e| e.to_string())?;
        let saved_rows = stmt_saved
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        for row in saved_rows {
            if let Ok(name) = row {
                tag_counts.entry(name).or_insert(0);
            }
        }

        Ok(tag_counts)
    }

    fn create(&self, name: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO saved_tags (name) VALUES (?)",
            params![name],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn rename(&self, old_name: &str, new_name: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Update saved_tags table: merge color info if exists
        let old_color: Option<String> = conn
            .query_row(
                "SELECT color FROM saved_tags WHERE name = ?",
                params![old_name],
                |row| row.get(0),
            )
            .ok();

        conn.execute(
            "INSERT OR IGNORE INTO saved_tags (name, color) VALUES (?1, ?2)",
            params![new_name, old_color],
        )
        .map_err(|e| e.to_string())?;

        let _ = conn.execute("DELETE FROM saved_tags WHERE name = ?", params![old_name]);

        // Entries with a sensitive tag are stored encrypted (see update_entry_tags).
        let sensitivity_changes = crate::database::has_sensitive_tag(&[old_name.to_string()])
            != crate::database::has_sensitive_tag(&[new_name.to_string()]);
        let clipboard_repo =
            crate::infrastructure::repository::clipboard_repo::SqliteClipboardRepository::new(self.conn.clone());

        // Update entry_tags and refresh JSON cache
        let mut stmt = conn
            .prepare("SELECT entry_id FROM entry_tags WHERE tag = ?")
            .map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt
            .query_map(params![old_name], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        for id in ids {
            conn.execute(
                "INSERT OR IGNORE INTO entry_tags (entry_id, tag) VALUES (?1, ?2)",
                params![id, new_name],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM entry_tags WHERE entry_id = ? AND tag = ?",
                params![id, old_name],
            )
            .map_err(|e| e.to_string())?;
            Self::refresh_entry_tags_json(&conn, id)?;
            if sensitivity_changes {
                if crate::database::has_sensitive_tag(&Self::entry_tags_with_conn(&conn, id)?) {
                    clipboard_repo.encrypt_entry_with_conn(&conn, id)?;
                } else {
                    clipboard_repo.decrypt_entry_with_conn(&conn, id)?;
                }
            }
        }
        Ok(())
    }

    fn delete_globally(
        &self,
        name: &str,
        data_dir: Option<&std::path::Path>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Remove from saved_tags
        let _ = conn.execute("DELETE FROM saved_tags WHERE name = ?", params![name]);

        // Delete all entries that carry this tag
        let mut stmt = conn
            .prepare("SELECT entry_id FROM entry_tags WHERE tag = ?")
            .map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt
            .query_map(params![name], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        // Through the normal delete: it leaves a sync tombstone (without one a
        // synced device brings the entries back) and also cleans up rich-text
        // image files. Pinned entries are kept and only lose the tag, as
        // "clear history" keeps them.
        let clipboard_repo =
            crate::infrastructure::repository::clipboard_repo::SqliteClipboardRepository::new(self.conn.clone());
        let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut candidates = Vec::new();
        for id in ids {
            let pinned: bool = transaction
                .query_row("SELECT is_pinned FROM clipboard_history WHERE id = ?", [id], |row| row.get(0))
                .unwrap_or(false);
            if pinned {
                transaction
                    .execute("DELETE FROM entry_tags WHERE entry_id = ?1 AND tag = ?2", params![id, name])
                    .map_err(|e| e.to_string())?;
                Self::refresh_entry_tags_json(&transaction, id)?;
            } else {
                candidates.extend(clipboard_repo.delete_collecting_files(&transaction, id, data_dir)?);
            }
        }
        let unused = clipboard_repo.unreferenced_files(&transaction, candidates);
        transaction.commit().map_err(|e| e.to_string())?;
        crate::infrastructure::repository::clipboard_repo::remove_attachment_files(unused);
        Ok(())
    }

    fn get_entries_by_tag(&self, tag: &str) -> Result<Vec<ClipboardEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT ch.id, ch.content_type, ch.content, ch.html_content, ch.source_app, ch.sort_at, ch.preview, ch.is_pinned, ch.tags, ch.use_count, ch.is_external, ch.pinned_order, ch.source_app_path, ch.note, ch.created_at, ch.last_used_at, ch.sort_at
             FROM clipboard_history ch
             INNER JOIN entry_tags et ON ch.id = et.entry_id
             WHERE et.tag = ? 
             ORDER BY ch.is_pinned DESC, ch.pinned_order DESC, ch.sort_at DESC",
        ).map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([tag], |row| {
                let tags_str: String = row.get(8).unwrap_or_else(|_| "[]".to_string());
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                let content_raw: String = row.get(2)?;
                let html_raw: Option<String> = row.get(3).ok();
                let preview_raw: String = row.get(6)?;
                let content = self.maybe_decrypt_text(&content_raw)?;
                let preview = self.maybe_decrypt_text(&preview_raw)?;
                let html_content = html_raw.map(|v| self.maybe_decrypt_text(&v)).transpose()?;

                Ok(ClipboardEntry {
                    id: row.get(0)?,
                    content_type: row.get(1)?,
                    content,
                    html_content,
                    source_app: row.get(4)?,
                    timestamp: row.get(5)?,
                    created_at: row.get(14).unwrap_or_else(|_| row.get(5).unwrap_or(0)),
                    last_used_at: row.get(15).unwrap_or(0),
                    sort_at: row.get(16).unwrap_or_else(|_| row.get(5).unwrap_or(0)),
                    preview,
                    is_pinned: row.get::<_, i32>(7)? == 1,
                    tags,
                    use_count: row.get(9).unwrap_or(0),
                    is_external: row.get::<_, i32>(10)? == 1,
                    pinned_order: row.get(11).unwrap_or(0),
                    source_app_path: row.get(12).unwrap_or(None),
                    note: row.get::<_, String>(13).unwrap_or_default(),
                    file_preview_exists: true, // simplified
                })
            })
            .map_err(|e| e.to_string())?;

        let mut history = Vec::new();
        for row in rows {
            history.push(row.map_err(|e| e.to_string())?);
        }
        Ok(history)
    }

    fn update_entry_tags(&self, id: i64, tags: Vec<String>) -> Result<(), String> {
        let mut guard = self.conn.lock().map_err(|e| e.to_string())?;
        let conn = guard.transaction().map_err(|e| e.to_string())?;
        let repo = crate::infrastructure::repository::clipboard_repo::SqliteClipboardRepository::new(self.conn.clone());
        repo.validate_entry_with_conn(&conn, id)?;
        let mut seen: HashSet<String> = HashSet::new();
        let mut cleaned: Vec<String> = Vec::new();
        for tag in tags {
            let t = tag.trim();
            if t.is_empty() {
                continue;
            }
            let t_owned = t.to_string();
            if seen.insert(t_owned.clone()) {
                cleaned.push(t_owned);
            }
        }

        conn.execute("DELETE FROM entry_tags WHERE entry_id = ?", params![id])
            .map_err(|e| e.to_string())?;
        for tag in &cleaned {
            conn.execute(
                "INSERT OR IGNORE INTO entry_tags (entry_id, tag) VALUES (?1, ?2)",
                params![id, tag],
            )
            .map_err(|e| e.to_string())?;
        }

        let tags_json = serde_json::to_string(&cleaned).unwrap_or_else(|_| "[]".to_string());
        if crate::database::has_sensitive_tag(&cleaned) {
            repo.encrypt_entry_with_conn(&conn, id)?;
        } else {
            repo.decrypt_entry_with_conn(&conn, id)?;
        }
        conn.execute(
            "UPDATE clipboard_history SET tags = ?, tags_updated_at = ? WHERE id = ?",
            params![tags_json, chrono::Utc::now().timestamp_millis(), id],
        )
        .map_err(|e| e.to_string())?;
        conn.commit().map_err(|e| e.to_string())
    }
}
