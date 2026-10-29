//! Commands for the JNClub cross-device sync.
//!
//! Kept separate from `clipboard_cmd` because the engine is optional: a build
//! with no server configured never reaches any of this.
use tauri::AppHandle;

use crate::error::AppResult;
use crate::services::jnclub_auth;
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

/// Sign in through the system browser.
///
/// The command resolves once the browser comes back, which can be a while, so
/// it is async and the front end shows a pending state meanwhile.
#[tauri::command]
pub async fn jnclub_sync_login(app: AppHandle) -> AppResult<SyncStatus> {
    let status = jnclub_auth::login(app.clone()).await?;
    jnclub_sync::nudge(&app);
    Ok(status)
}

#[tauri::command]
pub fn jnclub_sync_sign_out(app: AppHandle) -> AppResult<SyncStatus> {
    let base_url = jnclub_sync::stored_base_url(&app)?.unwrap_or_default();
    let status = jnclub_sync::set_credentials(&app, &base_url, "")?;
    jnclub_sync::nudge(&app);
    Ok(status)
}
