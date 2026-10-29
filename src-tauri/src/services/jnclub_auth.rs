//! Browser-based SSO login for the desktop app.
//!
//! The app never asks for a password. It opens the system browser at JNClub's
//! `/sso/login`, the user signs in there (where the password field, the
//! captcha and the session cookie all belong), and JNClub redirects back to a
//! listener this module owns on the loopback interface. The listener lives
//! only until that one redirect arrives.
//!
//! ## Why the loopback listener is hand-rolled
//!
//! It has to serve exactly one GET request and then die. Pulling in an HTTP
//! framework for that would add a dependency and an attack surface for no
//! gain, so the request line is parsed by hand below. The listener binds port
//! 0 (the OS picks a free one) and only ever accepts connections from
//! 127.0.0.1, so nothing outside the machine can reach it.
//!
//! ## What keeps this safe
//!
//! JNClub only honours `desktop_callback` when it points at a loopback
//! address — see `SsoClientController.isLoopbackCallback`. Without that check
//! the parameter would be an open redirect that hands out session tokens.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::services::jnclub_sync::{self, SyncStatus};

/// Where JNClub answers when the build has no origin stored yet.
///
/// The `/jnclub` prefix matters: nginx maps both `/jnclub/api/` and
/// `/jnclub/sso/` onto the gateway, so this one value covers the sync API and
/// the SSO client endpoint. Pointing at the bare host would reach the SSO
/// server instead of the client half of the handshake.
pub const DEFAULT_BASE_URL: &str = "https://jiangnan.88933.vip/jnclub";

/// How long the browser may take before we give up and stop listening.
const LISTEN_TIMEOUT: Duration = Duration::from_secs(300);

/// Percent-encode the few characters that appear in the callback URL.
///
/// A hand-rolled encoder is enough here because the only value ever encoded is
/// `http://127.0.0.1:<port>/callback`: digits, letters, `.`, `:` and `/`.
fn encode_callback(url: &str) -> String {
    let mut out = String::with_capacity(url.len() + 8);
    for byte in url.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Pull `token` out of a request line such as `GET /callback?token=abc HTTP/1.1`.
fn token_from_request_line(line: &str) -> Option<String> {
    let path = line.split_whitespace().nth(1)?;
    let query = path.split_once('?')?.1;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        if key == "token" && !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

fn read_request_line(stream: &mut TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    let mut buf = [0u8; 4096];
    let read = stream.read(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf[..read]);
    text.lines().next().map(|line| line.to_string())
}

fn write_close_page(stream: &mut TcpStream, ok: bool) {
    let message = if ok {
        "登录成功，可以关闭此页面回到 jn-clipboard。"
    } else {
        "登录未完成，请回到 jn-clipboard 重试。"
    };
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>jn-clipboard</title>\
         <style>body{{font-family:-apple-system,system-ui,sans-serif;display:flex;\
         align-items:center;justify-content:center;height:100vh;margin:0;\
         color:#333}}</style><p>{message}</p>\
         <script>setTimeout(()=>window.close(),600)</script>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Where to send the user for signing in.
///
/// `JNCLUB_SYNC_BASE_URL` wins so a development build can point at a local
/// server without shipping a different binary; otherwise the stored origin,
/// otherwise production.
fn resolve_base_url(app: &AppHandle) -> String {
    if let Some(from_env) = std::env::var("JNCLUB_SYNC_BASE_URL")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty())
    {
        return from_env;
    }
    jnclub_sync::stored_base_url(app)
        .ok()
        .flatten()
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
}

/// Accept connections until one carries a token, or the deadline passes.
///
/// Split out from `login` so it can be tested without a browser: everything
/// here is ordinary socket work.
fn wait_for_token(listener: &TcpListener, timeout: Duration) -> Option<String> {
    // Non-blocking, because a blocking `accept` would never return and the
    // deadline below would never be checked: a user who closes the browser
    // without signing in would leave the command hanging forever.
    if listener.set_nonblocking(true).is_err() {
        return None;
    }
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        let (mut stream, peer) = match listener.accept() {
            Ok(pair) => pair,
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }
            Err(_) => continue,
        };
        // Only the loopback interface is bound, but be explicit: a browser
        // extension or another local process must not be able to answer.
        if !peer.ip().is_loopback() {
            continue;
        }
        let _ = stream.set_nonblocking(false);
        let Some(line) = read_request_line(&mut stream) else {
            continue;
        };
        match token_from_request_line(&line) {
            Some(token) => {
                write_close_page(&mut stream, true);
                return Some(token);
            }
            None => {
                // Favicon and other stray requests land here.
                write_close_page(&mut stream, false);
            }
        }
    }
    None
}

/// Open the browser, wait for the redirect, and store the token it carries.
///
/// Blocking by nature (it waits on a socket), so the caller runs it on a
/// worker thread; the listener is created here rather than there so a port
/// conflict surfaces as an error instead of a hang.
pub async fn login(app: AppHandle) -> AppResult<SyncStatus> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| AppError::Internal(format!("cannot listen for the SSO callback: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .port();
    let base_url = resolve_base_url(&app);
    let callback = format!("http://127.0.0.1:{port}/callback");
    let auth_url = format!(
        "{base_url}/sso/login?desktop_callback={}",
        encode_callback(&callback)
    );

    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|e| AppError::Internal(format!("cannot open the browser: {e}")))?;

    // Accept loop runs on a blocking thread: TcpListener has no async API and
    // the wait is bounded, so this cannot outlive the login attempt.
    let token = tauri::async_runtime::spawn_blocking(move || wait_for_token(&listener, LISTEN_TIMEOUT))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let Some(token) = token else {
        return Err(AppError::Validation(
            "登录超时，请重试".to_string(),
        ));
    };

    jnclub_sync::set_credentials(&app, &base_url, &token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_token_from_a_request_line() {
        let line = "GET /callback?token=abc-123 HTTP/1.1";
        assert_eq!(token_from_request_line(line).as_deref(), Some("abc-123"));
    }

    #[test]
    fn ignores_requests_without_a_token() {
        assert_eq!(token_from_request_line("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(token_from_request_line("GET /callback?token= HTTP/1.1"), None);
    }

    #[test]
    fn keeps_the_token_intact_when_it_is_not_the_first_parameter() {
        let line = "GET /callback?state=1&token=tok HTTP/1.1";
        assert_eq!(token_from_request_line(line).as_deref(), Some("tok"));
    }

    #[test]
    fn a_real_connection_hands_back_the_token_it_carries() {
        use std::io::Write;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        // A stray request first: the loop must survive it and keep waiting.
        let stray = std::thread::spawn(move || {
            let mut s = TcpStream::connect(addr).expect("connect");
            let _ = s.write_all(b"GET /favicon.ico HTTP/1.1\r\n\r\n");
            let mut buf = [0u8; 64];
            let read = s.read(&mut buf).expect("read the close page");
            assert!(read > 0, "the stray request must be answered");
        });
        // The listener accepts one connection at a time, so the stray request
        // has to be finished before the real one opens: otherwise which of the
        // two the accept loop sees first is a coin flip, and the loser waits on
        // a socket nobody will ever accept.
        let real = std::thread::spawn(move || {
            stray.join().expect("stray thread");
            let mut s = TcpStream::connect(addr).expect("connect");
            let _ = s.write_all(b"GET /callback?token=tok-42 HTTP/1.1\r\n\r\n");
            let _ = s.read(&mut [0u8; 64]);
        });

        let token = wait_for_token(&listener, Duration::from_secs(5));
        real.join().expect("real thread");
        assert_eq!(token.as_deref(), Some("tok-42"));
    }

    #[test]
    fn gives_up_when_nothing_arrives() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        assert_eq!(wait_for_token(&listener, Duration::from_millis(150)), None);
    }

    #[test]
    fn encodes_the_callback_for_the_query_string() {
        assert_eq!(
            encode_callback("http://127.0.0.1:51234/callback"),
            "http%3A%2F%2F127.0.0.1%3A51234%2Fcallback"
        );
    }
}
