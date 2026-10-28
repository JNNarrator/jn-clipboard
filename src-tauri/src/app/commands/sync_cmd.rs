//! Commands for the JNClub cross-device sync.
//!
//! Kept separate from `clipboard_cmd` because the engine is optional: a build
//! with no server configured never reaches any of this.
use tauri::AppHandle;

use crate::error::AppResult;
use crate::services::jnclub_sync::{self, SyncOutcome, SyncStatus};

#[tauri::command]
pub fn get_jnclub_sync_status(app: AppHandle) -> AppResult<SyncStatus> {
    jnclub_sync::status(&app)
}

#[tauri::command]
pub fn set_jnclub_sync_credentials(
    app: AppHandle,
    base_url: String,
    token: String,
) -> AppResult<SyncStatus> {
    jnclub_sync::set_credentials(&app, &base_url, &token)
}

#[tauri::command]
pub async fn jnclub_sync_now(app: AppHandle) -> AppResult<SyncOutcome> {
    jnclub_sync::sync_now(&app).await
}
