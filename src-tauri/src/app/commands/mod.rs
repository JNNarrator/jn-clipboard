pub mod secure_transfer;
pub use secure_transfer::*;
pub mod clipboard_cmd;
pub mod drag_cmd;
pub mod file_cmd;
pub mod history_cmd;
pub mod hotkey_cmd;
pub mod settings_cmd;
pub mod system_cmd;
pub mod tag_color_cmd;
pub mod theme_cmd;
pub mod thumbnail_cmd;
pub mod ui_cmd;
pub mod release_info;

// Re-export all commands for convenience in main.rs if needed,
// though tauri usually expects them to be referenced via module path in generate_handler!
pub use clipboard_cmd::*;
pub use drag_cmd::*;
pub use file_cmd::*;
pub use history_cmd::*;
pub use hotkey_cmd::*;
pub use settings_cmd::*;
pub use system_cmd::*;
pub use tag_color_cmd::*;
pub use theme_cmd::*;
pub use thumbnail_cmd::*;
pub use ui_cmd::*;
pub use release_info::*;
