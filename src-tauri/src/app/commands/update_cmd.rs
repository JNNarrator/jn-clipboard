use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// GitHub's "latest release" endpoint: it already hides drafts and
/// prereleases, so whatever comes back is what users should be running.
/// Unauthenticated calls are limited to 60 an hour per IP, which is why the
/// frontend asks once per launch instead of polling.
const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/JNNarrator/jn-clipboard/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    /// `None` when nothing has been published yet — GitHub answers 404 then.
    pub latest_version: Option<String>,
    pub available: bool,
    pub release_url: Option<String>,
    pub notes: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
}

/// Parses the numeric core of a version, ignoring a `v` prefix and any
/// prerelease or build suffix: "v1.2.3-beta.1" → (1, 2, 3).
///
/// Only the ordered triple matters here. A prerelease of a newer version is
/// still newer than the release users have, and GitHub hands us published
/// releases only.
fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let core = value
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(['-', '+'])
        .next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// Whether `latest` is a version worth telling the user about. Anything
/// unparseable compares as "not newer": a garbled tag must never look like an
/// update and send people to a download they do not need.
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(latest), Some(current)) => latest > current,
        _ => false,
    }
}

fn http_client() -> AppResult<reqwest::Client> {
    // reqwest is built with `rustls-no-provider`; a client without a registered
    // provider panics. Installing it here keeps the module usable from tests.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))
}

/// Looks up the newest published release and compares it with this build.
/// Network failures surface as errors; an unpublished repository is not one.
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> AppResult<UpdateInfo> {
    let current_version = app.package_info().version.to_string();
    let client = http_client()?;

    let response = client
        .get(LATEST_RELEASE_URL)
        .header(
            reqwest::header::USER_AGENT,
            format!("jn-clipboard/{current_version}"),
        )
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo {
            current_version,
            latest_version: None,
            available: false,
            release_url: None,
            notes: None,
            published_at: None,
        });
    }
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "GitHub answered {}",
            response.status()
        )));
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let latest_version = release
        .tag_name
        .trim()
        .trim_start_matches(['v', 'V'])
        .to_string();
    let available = is_newer(&latest_version, &current_version);

    Ok(UpdateInfo {
        current_version,
        available,
        latest_version: Some(latest_version),
        release_url: Some(release.html_url),
        notes: release.body.filter(|body| !body.trim().is_empty()),
        published_at: release.published_at,
    })
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn a_higher_patch_wins() {
        assert!(is_newer("1.0.1", "1.0.0"));
        assert!(is_newer("1.1.0", "1.0.9"));
        assert!(is_newer("2.0.0", "1.99.99"));
    }

    #[test]
    fn the_same_version_is_not_an_update() {
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("v1.0.0", "1.0.0"));
    }

    #[test]
    fn an_older_release_is_not_an_update() {
        assert!(!is_newer("0.9.9", "1.0.0"));
    }

    #[test]
    fn a_leading_v_is_ignored() {
        assert!(is_newer("v1.2.0", "1.1.9"));
        assert!(is_newer("V1.2.0", "v1.1.9"));
    }

    #[test]
    fn missing_parts_count_as_zero() {
        assert!(!is_newer("1.2", "1.2.0"));
        assert!(is_newer("1.2.1", "1.2"));
    }

    #[test]
    fn prerelease_suffixes_do_not_hide_an_older_core() {
        assert!(is_newer("1.0.1-beta.1", "1.0.0"));
        assert!(!is_newer("1.0.0-beta.1", "1.0.0"));
    }

    #[test]
    fn nonsense_never_looks_like_an_update() {
        assert!(!is_newer("nightly", "1.0.0"));
        assert!(!is_newer("1.0.0", "nightly"));
        assert!(!is_newer("1.0.0.0", "1.0.0"));
        assert!(!is_newer("", "1.0.0"));
    }
}
