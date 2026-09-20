//! Idle "light mode": destroy the main WebView to free memory while clipboard
//! listening / hotkeys / tray keep running. Recreate on next summon (#154).

use crate::app_state::SettingsState;
use crate::database::DbState;
use crate::global_state::{
    CURRENT_DOCK, IS_HIDDEN, LAST_SHOW_TIMESTAMP, NAVIGATION_ENABLED, NAVIGATION_MODE_ACTIVE,
    WINDOW_PINNED,
};
use crate::infrastructure::repository::settings_repo::SettingsRepository;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

/// True while the main WebView has been destroyed for light mode.
pub static WEBVIEW_LIGHT_MODE: AtomicBool = AtomicBool::new(false);

/// Wall-clock ms when the UI was last hidden. 0 = currently considered "in use".
static LAST_HIDDEN_AT_MS: AtomicU64 = AtomicU64::new(0);

/// When true, `ExitRequested` is allowed to tear down the process (tray Quit etc.).
pub static ALLOW_APP_EXIT: AtomicBool = AtomicBool::new(false);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn on_window_shown() {
    LAST_HIDDEN_AT_MS.store(0, Ordering::SeqCst);
    WEBVIEW_LIGHT_MODE.store(false, Ordering::SeqCst);
}

pub fn on_window_hidden() {
    LAST_HIDDEN_AT_MS.store(now_ms(), Ordering::SeqCst);
}

pub fn request_app_exit(app: &AppHandle) {
    ALLOW_APP_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn light_mode_enabled(app: &AppHandle) -> bool {
    app.try_state::<SettingsState>()
        .map(|s| s.light_mode_enabled.load(Ordering::Relaxed))
        .unwrap_or(false)
}

fn light_mode_idle_minutes(app: &AppHandle) -> u64 {
    app.try_state::<SettingsState>()
        .map(|s| s.light_mode_idle_minutes.load(Ordering::Relaxed).max(1))
        .unwrap_or(15)
}

fn light_mode_idle_ms(app: &AppHandle) -> u64 {
    // Bench override: TIEZ_LIGHT_MODE_IDLE_SECS=15 → enter after 15s (not minutes).
    if let Ok(secs) = std::env::var("TIEZ_LIGHT_MODE_IDLE_SECS") {
        if let Ok(s) = secs.parse::<u64>() {
            return s.saturating_mul(1000).max(1_000);
        }
    }
    light_mode_idle_minutes(app).saturating_mul(60_000)
}

fn watcher_interval() -> Duration {
    if std::env::var("TIEZ_LIGHT_MODE_IDLE_SECS").is_ok() {
        Duration::from_secs(2)
    } else {
        Duration::from_secs(30)
    }
}

fn trim_working_set() {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::ProcessStatus::EmptyWorkingSet;
        use windows::Win32::System::Threading::GetCurrentProcess;
        unsafe {
            let _ = EmptyWorkingSet(GetCurrentProcess());
        }
    }
}

fn apply_post_create(app: &AppHandle, window: &WebviewWindow) {
    if let Some(db) = app.try_state::<DbState>() {
        let width = db
            .settings_repo
            .get("app.window_width")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<u32>().ok());
        let height = db
            .settings_repo
            .get("app.window_height")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<u32>().ok());
        if let (Some(w), Some(h)) = (width, height) {
            if w >= 250 && h >= 200 {
                let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: w,
                    height: h,
                }));
            }
        }

        let theme = db
            .settings_repo
            .get("app.theme")
            .ok()
            .flatten()
            .unwrap_or_else(|| crate::build_config::default_theme_id().to_string());
        let mode = db
            .settings_repo
            .get("app.color_mode")
            .ok()
            .flatten();
        if let Some(settings) = app.try_state::<SettingsState>() {
            let _ = crate::app::commands::set_theme(
                window.clone(),
                settings,
                db,
                theme,
                mode,
                None,
            );
        }
    }

    let pinned = WINDOW_PINNED.load(Ordering::Relaxed);
    let _ = window.set_always_on_top(pinned);

    #[cfg(target_os = "windows")]
    {
        let _ = window.set_focusable(!pinned);
        crate::infrastructure::windows_api::webview_keys::disable_browser_accelerator_keys_for_window(
            window,
        );
        crate::infrastructure::windows_api::drag_drop::register_emoji_drag_drop(app.clone());
    }

    #[cfg(target_os = "macos")]
    {
        crate::infrastructure::macos_api::window::configure_overlay_space_behavior(window);
        if let Err(err) =
            crate::infrastructure::macos_api::window::setup_clipboard_panel(window)
        {
            eprintln!("[light-mode] setup_clipboard_panel failed: {err}");
        }
        crate::infrastructure::macos_api::window::configure_overlay_space_behavior(window);
        crate::app::window_manager::apply_macos_window_material(window).ok();
    }

    crate::app::window_manager::maybe_open_devtools(window);
}

/// Ensure the main WebView exists (recreate after light-mode destroy).
pub fn ensure_main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("main") {
        WEBVIEW_LIGHT_MODE.store(false, Ordering::SeqCst);
        return Ok(window);
    }

    let cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .ok_or_else(|| "main window config missing".to_string())?;

    // from_config must not run on a sync WebView2 command path; callers should
    // already be off the webview IPC stack (hotkey / tray / idle thread).
    let builder = WebviewWindowBuilder::from_config(app, &cfg).map_err(|e| e.to_string())?;
    let window = builder
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    apply_post_create(app, &window);
    WEBVIEW_LIGHT_MODE.store(false, Ordering::SeqCst);
    on_window_shown();
    eprintln!("[light-mode] main WebView recreated");
    Ok(window)
}

fn window_is_idle_candidate(app: &AppHandle) -> bool {
    if WINDOW_PINNED.load(Ordering::Relaxed) {
        return false;
    }
    if CURRENT_DOCK.load(Ordering::Relaxed) != 0 || IS_HIDDEN.load(Ordering::Relaxed) {
        // Edge-docked: keep WebView for quick hover reveal.
        return false;
    }
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    !window.is_visible().unwrap_or(true)
}

pub fn try_enter_light_mode(app: &AppHandle) {
    if !light_mode_enabled(app) {
        return;
    }
    if WEBVIEW_LIGHT_MODE.load(Ordering::SeqCst) {
        return;
    }
    if !window_is_idle_candidate(app) {
        return;
    }

    let hidden_at = LAST_HIDDEN_AT_MS.load(Ordering::SeqCst);
    if hidden_at == 0 {
        return;
    }
    let idle_ms = light_mode_idle_ms(app);
    if now_ms().saturating_sub(hidden_at) < idle_ms {
        return;
    }

    if let Some(preview) = app.get_webview_window("compact-preview") {
        let _ = preview.destroy();
    }

    if let Some(main) = app.get_webview_window("main") {
        // Re-check visibility right before destroy.
        if main.is_visible().unwrap_or(false) {
            return;
        }
        WEBVIEW_LIGHT_MODE.store(true, Ordering::SeqCst);
        NAVIGATION_ENABLED.store(false, Ordering::SeqCst);
        NAVIGATION_MODE_ACTIVE.store(false, Ordering::SeqCst);
        if let Err(err) = main.destroy() {
            WEBVIEW_LIGHT_MODE.store(false, Ordering::SeqCst);
            eprintln!("[light-mode] destroy failed: {err}");
            return;
        }
        eprintln!(
            "[light-mode] WebView destroyed after {} ms idle",
            idle_ms
        );
        trim_working_set();
    }
}

pub fn start_idle_watcher(app: AppHandle) {
    let watcher_app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(watcher_interval());
            if !light_mode_enabled(&watcher_app) {
                continue;
            }
            try_enter_light_mode(&watcher_app);
        }
    });

    // Deterministic memory bench: --bench-light-mode
    // shows briefly, hides, waits idle secs (env or 15), then destroys WebView.
    if std::env::args().any(|a| a == "--bench-light-mode") {
        let app2 = app.clone();
        std::thread::spawn(move || {
            let idle_ms = light_mode_idle_ms(&app2).max(5_000);
            std::thread::sleep(Duration::from_secs(5));
            if let Some(window) = app2.get_webview_window("main") {
                let _ = window.hide();
            }
            on_window_hidden();
            eprintln!(
                "[light-mode] bench: hidden, waiting {} ms before destroy",
                idle_ms
            );
            std::thread::sleep(Duration::from_millis(idle_ms + 2_000));
            try_enter_light_mode(&app2);
            eprintln!(
                "[light-mode] bench: after try_enter light_mode={} webview={}",
                WEBVIEW_LIGHT_MODE.load(Ordering::SeqCst),
                app2.get_webview_window("main").is_some()
            );
        });
    }
}

/// Touch hidden timestamp if the window is already hidden (e.g. silent start).
pub fn seed_hidden_if_needed(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if !window.is_visible().unwrap_or(true) {
            on_window_hidden();
        }
    } else {
        // No window yet — treat as already light.
        WEBVIEW_LIGHT_MODE.store(true, Ordering::SeqCst);
        on_window_hidden();
    }
    let _ = LAST_SHOW_TIMESTAMP.load(Ordering::Relaxed);
}
