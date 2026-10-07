//! Windows elevated (admin) logon autostart via Task Scheduler.
//! Registry Run cannot elevate; a Highest-privilege ONLOGON task can.

#![cfg(target_os = "windows")]

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::Duration;

const TASK_NAME: &str = r"TieZ\ElevatedAutostart";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn exe_path() -> Result<String, String> {
    Ok(std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string())
}

fn task_command_line() -> Result<String, String> {
    let exe = exe_path()?;
    Ok(format!("\"{exe}\" --minimized"))
}

pub fn is_elevated_autostart_installed() -> bool {
    Command::new("schtasks")
        .args(["/Query", "/TN", TASK_NAME])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn install_elevated_autostart_task() -> Result<(), String> {
    let tr = task_command_line()?;
    let status = Command::new("schtasks")
        .args([
            "/Create",
            "/TN",
            TASK_NAME,
            "/TR",
            &tr,
            "/SC",
            "ONLOGON",
            "/RL",
            "HIGHEST",
            "/F",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("schtasks create failed: {e}"))?;
    if !status.success() {
        return Err(
            "Failed to create elevated autostart task (administrator rights required)".into(),
        );
    }
    clear_registry_run_entry()?;
    Ok(())
}

pub fn uninstall_elevated_autostart_task() -> Result<(), String> {
    if !is_elevated_autostart_installed() {
        return Ok(());
    }
    let status = Command::new("schtasks")
        .args(["/Delete", "/TN", TASK_NAME, "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("schtasks delete failed: {e}"))?;
    if !status.success() {
        return Err("Failed to remove elevated autostart task".into());
    }
    Ok(())
}

pub fn clear_registry_run_entry() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_WRITE | KEY_READ,
        )
        .map_err(|e| e.to_string())?;
    let _ = key.delete_value("TieZ");
    let _ = key.delete_value("tie-z");
    Ok(())
}

pub fn write_registry_run_entry() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_WRITE | KEY_READ,
        )
        .map_err(|e| e.to_string())?;
    let cmd = task_command_line()?;
    key.set_value("TieZ", &cmd).map_err(|e| e.to_string())
}

pub fn registry_run_present() -> bool {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run") else {
        return false;
    };
    key.get_value::<String, _>("TieZ").is_ok() || key.get_value::<String, _>("tie-z").is_ok()
}

/// Relaunch this exe elevated to install/uninstall the task (one UAC prompt).
pub fn run_elevated_helper(install: bool) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::WaitForSingleObject;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let exe = exe_path()?;
    let arg = if install {
        "--install-elevated-autostart"
    } else {
        "--uninstall-elevated-autostart"
    };

    let exe_wide: Vec<u16> = OsStr::new(&exe)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let args_wide: Vec<u16> = OsStr::new(arg)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let runas: Vec<u16> = OsStr::new("runas")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: PCWSTR::from_raw(runas.as_ptr()),
            lpFile: PCWSTR::from_raw(exe_wide.as_ptr()),
            lpParameters: PCWSTR::from_raw(args_wide.as_ptr()),
            nShow: SW_HIDE.0 as i32,
            ..Default::default()
        };

        if ShellExecuteExW(&mut info).is_err() || info.hProcess.is_invalid() {
            return Err("Administrator approval was cancelled or elevation failed".into());
        }

        let wait = WaitForSingleObject(info.hProcess, 60_000);
        let _ = CloseHandle(info.hProcess);
        if wait == WAIT_TIMEOUT {
            return Err("Timed out waiting for elevated autostart helper".into());
        }
        if wait != WAIT_OBJECT_0 {
            return Err("Elevated autostart helper did not finish cleanly".into());
        }
    }

    for _ in 0..20 {
        if is_elevated_autostart_installed() == install {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    if install {
        Err("Elevated autostart task was not created".into())
    } else if is_elevated_autostart_installed() {
        Err("Elevated autostart task was not removed".into())
    } else {
        Ok(())
    }
}
