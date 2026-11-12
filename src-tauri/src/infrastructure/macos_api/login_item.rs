//! Launch at login through SMAppService (macOS 13+).
//!
//! The old way, a plist written to ~/Library/LaunchAgents, is attributed to
//! the signing certificate: macOS's "Background Items Added" notice and Login
//! Items settings showed the developer's personal name instead of jn-clipboard. An
//! agent shipped inside the app bundle (Contents/Library/LaunchAgents, see
//! tauri.macos.conf.json) and registered here is shown with the app's name and
//! icon, and still passes --minimized so jn-clipboard starts hidden.
//!
//! None of this exists before macOS 13 or outside a bundled .app (dev runs);
//! callers fall back to the old launcher then.

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2::msg_send;
use objc2_foundation::{NSError, NSString};

/// Must match the file name under Contents/Library/LaunchAgents.
const AGENT_PLIST: &str = "com.jnarrator.jnclipboard.autostart.plist";

// SMAppServiceStatus
const STATUS_ENABLED: isize = 1;
const STATUS_REQUIRES_APPROVAL: isize = 2;

#[link(name = "ServiceManagement", kind = "framework")]
unsafe extern "C" {}

fn agent_service() -> Option<Retained<AnyObject>> {
    // SMAppService is only in macOS 13+; the framework itself is older.
    let class = AnyClass::get(c"SMAppService")?;
    let name = NSString::from_str(AGENT_PLIST);
    unsafe { msg_send![class, agentServiceWithPlistName: &*name] }
}

fn status(service: &AnyObject) -> isize {
    unsafe { msg_send![service, status] }
}

/// Whether this system and this build can use SMAppService. False before
/// macOS 13 and when the agent plist isn't in the bundle (dev builds).
pub fn available() -> bool {
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent()?.parent().map(|contents| contents.join("Library/LaunchAgents").join(AGENT_PLIST)))
        .is_some_and(|plist| plist.exists());
    bundled && agent_service().is_some()
}

/// Registered and allowed to run. "Requires approval" means the user turned
/// it off in System Settings, so it counts as off.
pub fn is_enabled() -> bool {
    agent_service().is_some_and(|service| status(&service) == STATUS_ENABLED)
}

/// Registered, but switched off in System Settings › Login Items. Only the
/// user can switch it back on, over there; registering again changes nothing.
pub fn requires_approval() -> bool {
    agent_service().is_some_and(|service| status(&service) == STATUS_REQUIRES_APPROVAL)
}

/// Opens System Settings at Login Items.
pub fn open_settings() {
    if let Some(class) = AnyClass::get(c"SMAppService") {
        let _: () = unsafe { msg_send![class, openSystemSettingsLoginItems] };
    }
}

/// Turning it on fails while the user has it switched off in System Settings
/// (see `requires_approval`): it is registered but won't launch.
pub fn set_enabled(enabled: bool) -> Result<(), String> {
    let service = agent_service().ok_or("SMAppService unavailable")?;
    let current = status(&service);
    let registered = current == STATUS_ENABLED || current == STATUS_REQUIRES_APPROVAL;
    if enabled != registered {
        let result: Result<(), Retained<NSError>> = unsafe {
            if enabled {
                msg_send![&service, registerAndReturnError: _]
            } else {
                msg_send![&service, unregisterAndReturnError: _]
            }
        };
        result.map_err(|error| error.localizedDescription().to_string())?;
    }
    if enabled && status(&service) == STATUS_REQUIRES_APPROVAL {
        return Err("Launch at login is turned off in System Settings".to_string());
    }
    Ok(())
}

/// Re-registers the item so launchd records the running bundle's signature.
///
/// The registration carries a Launch Constraint: the set of cdhashes launchd
/// and AMFI accept for this item. It is filled in when the item is registered,
/// and an in-place update replaces Contents without touching the registration,
/// so the constraint keeps naming the binary that is already gone. Every login
/// start is then killed at exec — SIGKILL "Code Signature Invalid",
/// `CODESIGNING / Launch Constraint Violation` in the crash report — before any
/// app code runs, which is why the app cannot report it itself. Unregistering
/// and registering again writes a constraint for the binary that just started.
///
/// Returns `Ok(())` without touching anything when the item is off or was
/// switched off in System Settings: nothing starts at login then, and
/// registering again would undo the user's choice.
pub fn refresh_registration() -> Result<(), String> {
    let service = agent_service().ok_or("SMAppService unavailable")?;
    if status(&service) != STATUS_ENABLED {
        return Ok(());
    }
    // Ignored: the record may already be gone (booted out by hand), and what
    // matters is the registration below.
    let _: Result<(), Retained<NSError>> =
        unsafe { msg_send![&service, unregisterAndReturnError: _] };
    // The background-item store is written out of process, so an immediate
    // register can land while the old record is still being torn down. Losing
    // the registration would leave launch at login off, so retry briefly.
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
        let result: Result<(), Retained<NSError>> =
            unsafe { msg_send![&service, registerAndReturnError: _] };
        match result {
            Ok(()) => return Ok(()),
            Err(error) => last_error = error.localizedDescription().to_string(),
        }
    }
    Err(last_error)
}

/// Identity of the bundle on disk, to tell whether the registration is stale.
///
/// The cdhash would be exact, but reading it means the Security framework;
/// version, size and mtime of the executable move with every rebuilt bundle and
/// cost nothing, which is enough to notice an in-place update.
pub fn registration_fingerprint(version: &str) -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let metadata = std::fs::metadata(&exe).ok()?;
    let mtime = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some(format!("{version}:{}:{mtime}", metadata.len()))
}
