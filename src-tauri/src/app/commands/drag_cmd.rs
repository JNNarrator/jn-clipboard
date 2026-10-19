use serde::Deserialize;
use tauri::WebviewWindow;

/// What a native drag carries out of TieZ, and its preview.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDragRequest {
    /// Files dropped as files (an image or file entry).
    pub files: Vec<String>,
    pub text: Option<String>,
    pub html: Option<String>,
    pub url: Option<String>,
    /// The preview badge as base64 PNG, drawn at a higher scale for Retina.
    pub preview: String,
    /// Badge size in points, and where the pointer holds it.
    pub preview_width: f64,
    pub preview_height: f64,
    pub grab_x: f64,
    pub grab_y: f64,
}

/// Starts a system drag for an entry (macOS). Other platforms keep the web
/// view's drag, so they get an error and the page carries on with it.
#[tauri::command]
pub fn start_native_drag(window: WebviewWindow, request: NativeDragRequest) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        crate::infrastructure::macos_api::native_drag::start(&window, request)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, request);
        Err("native drag is only used on macOS".to_string())
    }
}
