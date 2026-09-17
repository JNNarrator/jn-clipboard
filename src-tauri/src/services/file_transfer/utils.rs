use crate::services::file_transfer::models::ServerActivityState;
use base64::{engine::general_purpose, Engine as _};
use local_ip_address::list_afinet_netifas;
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

pub fn update_activity(app_handle: &AppHandle) {
    if let Ok(mut guard) = app_handle
        .state::<ServerActivityState>()
        .last_activity
        .lock()
    {
        *guard = Some(SystemTime::now());
    }
}

pub fn get_app_logo_base64(_app: &AppHandle) -> String {
    // Embed the icon directly to ensure it works in Dev and Prod without path issues
    const ICON_BYTES: &[u8] = include_bytes!("../../../icons/icon.png");
    format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(ICON_BYTES)
    )
}

pub fn score_interface(name: &str, ip: &str) -> i32 {
    let mut score = 0;
    if name.contains("wi-fi") || name.contains("wlan") {
        score += 10;
    }
    if name.contains("ethernet") {
        score += 5;
    }
    if ip.starts_with("192.168.") {
        score += 3;
    }
    if ip.starts_with("10.") {
        score += 2;
    }
    score
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub ip: String,
    pub is_virtual: bool,
    pub label: String,
}

fn get_interface_label(name: &str, ip: &str, is_virtual: bool) -> String {
    let name_lower = name.to_lowercase();
    let type_desc = if is_virtual {
        "VPN / 虚拟网卡"
    } else if name_lower.contains("wi-fi") || name_lower.contains("wlan") || name_lower == "en0" {
        "Wi-Fi"
    } else if name_lower.contains("eth") || name_lower.contains("ethernet") || name_lower.starts_with("en") {
        "以太网 / 局域网"
    } else {
        "局域网"
    };

    format!("{} · {} ({})", ip, name, type_desc)
}

#[tauri::command]
pub fn get_available_network_interfaces() -> Vec<NetworkInterfaceInfo> {
    if let Ok(ifas) = list_afinet_netifas() {
        let mut list = Vec::new();
        for (name, ip) in ifas {
            let ip_str = ip.to_string();
            let name_lower = name.to_lowercase();
            if ip.is_loopback() || !ip.is_ipv4() {
                continue;
            }

            let is_virtual = name_lower.contains("vnet")
                || name_lower.contains("vbox")
                || name_lower.contains("virtual")
                || name_lower.contains("vmnet")
                || name_lower.contains("tailscale")
                || name_lower.contains("zerotier")
                || name_lower.contains("pseudo")
                || name_lower.contains("clash")
                || name_lower.contains("wsl")
                || name_lower.contains("vethernet")
                || name_lower.contains("docker")
                || name_lower.contains("hyper-v")
                || name_lower.contains("radmin")
                || name_lower.contains("utun")
                || ip_str.starts_with("198.18.");

            let label = get_interface_label(&name, &ip_str, is_virtual);
            list.push((name_lower, ip_str, is_virtual, name, label));
        }

        // Sort: physical/LAN interfaces first, then by priority score
        list.sort_by(|(name_a, ip_a, is_virt_a, _, _), (name_b, ip_b, is_virt_b, _, _)| {
            if *is_virt_a != *is_virt_b {
                return is_virt_a.cmp(is_virt_b);
            }
            let score_a = score_interface(name_a, ip_a);
            let score_b = score_interface(name_b, ip_b);
            score_b.cmp(&score_a)
        });

        return list
            .into_iter()
            .map(|(_, ip, is_virtual, name, label)| NetworkInterfaceInfo {
                name,
                ip,
                is_virtual,
                label,
            })
            .collect();
    }
    vec![]
}

#[tauri::command]
pub fn get_available_ips() -> Vec<String> {
    let interfaces = get_available_network_interfaces();
    let physical: Vec<String> = interfaces
        .iter()
        .filter(|iface| !iface.is_virtual)
        .map(|iface| iface.ip.clone())
        .collect();
    if !physical.is_empty() {
        physical
    } else {
        interfaces.into_iter().map(|iface| iface.ip).collect()
    }
}

pub async fn bind_listener(start_port: u16) -> (tokio::net::TcpListener, u16) {
    let mut port = start_port;
    loop {
        let addr = format!("0.0.0.0:{}", port);
        match tokio::net::TcpListener::bind(&addr).await {
            Ok(listener) => return (listener, port),
            Err(_) => {
                if port >= 65535 {
                    if let Ok(listener) = tokio::net::TcpListener::bind("0.0.0.0:0").await {
                        let p = listener.local_addr().map(|a| a.port()).unwrap_or(0);
                        return (listener, p);
                    }
                    break;
                }
                port += 1;
            }
        }
    }
    (tokio::net::TcpListener::bind("0.0.0.0:0").await.unwrap(), 0)
}
