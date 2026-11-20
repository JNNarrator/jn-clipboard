//! Commands for the WeChat channel (手机与电脑互传的微信入口).
//!
//! 前端不直接 fetch 微信接口，而是走这里代理，原因有两条：
//!
//! 1. **鉴权**：微信接口需要 `jn-token`，而它只存在于本机的设置表里
//!    （`jnclub.sync_token`）。让前端持有 token 会把它暴露在 webview 里，
//!    也没有必要——后端就在同一台机器上。
//! 2. **CORS**：JNClub 的 CORS 是显式白名单（默认只放行本地 Vite），
//!    Tauri webview 发出的请求 Origin 不在名单内，直连会被浏览器层拦掉。
//!
//! 因此这里的每个命令都是「取本地凭据 → 请求 JNClub → 回传结果」的薄代理。
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::services::jnclub_sync;

/// 微信通道状态，直接对应后端 `/api/wechat/status` 的字段。
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Default)]
pub struct WechatStatus {
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub connected: bool,
    // 字段名必须与后端返回的 camelCase 一致。此前这里写的是 snake_case，
    // 而服务端返回 userId / waitingScan / notifyOnCopy —— serde 匹配不上，
    // 这些字段会静默变成默认值，UI 上表现为"一直显示未连接"。
    #[serde(default, rename = "userId")]
    pub user_id: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default, rename = "waitingScan")]
    pub waiting_scan: bool,
    #[serde(default, rename = "notifyOnCopy")]
    pub notify_on_copy: bool,
    #[serde(default)]
    pub whitelist: Option<String>,
    #[serde(default)]
    pub enabled: bool,
}

/// 后端统一响应外壳 `{ code, message, data }`。
#[derive(serde::Deserialize, Debug)]
struct Envelope<T> {
    code: i32,
    #[serde(default)]
    message: String,
    data: Option<T>,
}

fn credentials(app: &AppHandle) -> AppResult<(String, String)> {
    let conn = jnclub_sync::lock_db_for_wechat(app)?;
    let base_url = jnclub_sync::base_url_for_wechat(&conn);
    let token = jnclub_sync::token_for_wechat(&conn);
    drop(conn);
    if base_url.is_empty() {
        return Err(AppError::Validation("尚未配置同步服务器".into()));
    }
    if token.is_empty() {
        return Err(AppError::Auth("尚未登录 JNClub".into()));
    }
    Ok((base_url, token))
}

/// 把后端返回折叠成"要么数据、要么一个可读错误"。
fn unwrap_envelope<T>(body: &str) -> AppResult<T>
where
    T: serde::de::DeserializeOwned,
{
    let env: Envelope<T> = serde_json::from_str(body)
        .map_err(|e| AppError::Internal(format!("响应解析失败: {e}")))?;
    if env.code != 200 {
        return Err(AppError::Internal(
            if env.message.is_empty() { "服务端返回失败".to_string() } else { env.message },
        ));
    }
    env.data
        .ok_or_else(|| AppError::Internal("服务端未返回数据".into()))
}

async fn post<T: serde::de::DeserializeOwned>(app: &AppHandle, path: &str) -> AppResult<T> {
    let (base_url, token) = credentials(app)?;
    let url = format!("{}{}", base_url, path);
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("jn-token", token)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("无法连接同步服务: {e}")))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if status.as_u16() == 401 {
        return Err(AppError::Auth("登录已过期，请重新登录".into()));
    }
    if !status.is_success() {
        return Err(AppError::Network(format!("同步服务返回 {status}")));
    }
    unwrap_envelope(&body)
}

/// 查询微信通道状态。
#[tauri::command]
pub async fn get_wechat_status(app: AppHandle) -> AppResult<WechatStatus> {
    let (base_url, token) = credentials(&app)?;
    let url = format!("{}/api/wechat/status", base_url);
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("jn-token", token)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("无法连接同步服务: {e}")))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if status.as_u16() == 401 {
        return Err(AppError::Auth("登录已过期，请重新登录".into()));
    }
    if !status.is_success() {
        return Err(AppError::Network(format!("同步服务返回 {status}")));
    }
    unwrap_envelope(&body)
}

/// 请求登录二维码。返回二维码内容字符串；已登录时 `connected` 为 true。
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Default)]
pub struct QrcodeResult {
    #[serde(default)]
    pub connected: bool,
    #[serde(default, rename = "qrcodeContent")]
    pub qrcode_content: Option<String>,
    /// 后端渲染好的 `data:image/png;base64,...`，前端直接塞进 img 即可。
    /// 少了这个字段桌面端就拿不到二维码图片，扫码登录无从谈起。
    #[serde(default, rename = "qrcodeImage")]
    pub qrcode_image: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[tauri::command]
pub async fn request_wechat_qrcode(app: AppHandle) -> AppResult<QrcodeResult> {
    post(&app, "/api/wechat/qrcode").await
}

/// 停止监听（保留凭据）。
#[tauri::command]
pub async fn stop_wechat_channel(app: AppHandle) -> AppResult<()> {
    let _: Option<serde_json::Value> = post(&app, "/api/wechat/stop").await?;
    Ok(())
}

/// 用已保存的凭据恢复通道。
#[tauri::command]
pub async fn resume_wechat_channel(app: AppHandle) -> AppResult<WechatStatus> {
    let (base_url, token) = credentials(&app)?;
    let url = format!("{}/api/wechat/resume", base_url);
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("jn-token", token)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("无法连接同步服务: {e}")))?;
    let body = response.text().await.unwrap_or_default();
    let data: serde_json::Value = unwrap_envelope(&body)?;
    Ok(WechatStatus {
        state: data.get("state").and_then(|v| v.as_str()).unwrap_or("DOWN").to_string(),
        connected: data.get("state").and_then(|v| v.as_str()) == Some("CONNECTED"),
        ..Default::default()
    })
}
