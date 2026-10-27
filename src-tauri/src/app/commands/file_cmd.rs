use crate::error::{AppError, AppResult};
use image::ImageFormat;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct FileSize {
    pub size: u64,
}

#[tauri::command]
pub fn get_file_size(path: String) -> AppResult<FileSize> {
    use std::fs;
    let metadata = fs::metadata(&path).map_err(AppError::from)?;
    Ok(FileSize {
        size: metadata.len(),
    })
}

#[tauri::command]
pub async fn save_file_copy(source_path: String, target_path: String) -> AppResult<()> {
    copy_file_to(Path::new(&source_path), Path::new(&target_path))
}

/// Saving a file onto itself (same folder, "Replace") leaves it as it is:
/// copying a file onto itself empties it on macOS.
fn copy_file_to(source: &Path, target: &Path) -> AppResult<()> {
    if is_same_file(source, target) {
        return Ok(());
    }
    std::fs::copy(source, target).map_err(AppError::from)?;
    Ok(())
}

fn is_same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (std::fs::metadata(a), std::fs::metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        matches!(
            (std::fs::canonicalize(a), std::fs::canonicalize(b)),
            (Ok(x), Ok(y)) if x == y
        )
    }
}

#[tauri::command]
pub async fn save_file_batch(
    source_paths: Vec<String>,
    target_dir: String,
    batch_name: String,
) -> AppResult<String> {
    if source_paths.len() < 2 || source_paths.len() > 2_000 {
        return Err(AppError::Validation(
            "文件包必须包含 2–2000 个文件".to_string(),
        ));
    }
    let target_root = PathBuf::from(target_dir);
    if !target_root.is_dir() {
        return Err(AppError::Validation("请选择有效的文件夹。".to_string()));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let safe_batch_name = sanitize_copy_name(&batch_name, "TieZ 文件包");
        let package_dir = unique_copy_path(&target_root, &safe_batch_name, true);
        std::fs::create_dir(&package_dir).map_err(AppError::from)?;

        for source in source_paths {
            let source = PathBuf::from(source);
            if !source.is_file() {
                let _ = std::fs::remove_dir_all(&package_dir);
                return Err(AppError::Validation(format!(
                    "源文件不存在：{}",
                    source.to_string_lossy()
                )));
            }
            let requested_name = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("文件");
            let safe_name = sanitize_copy_name(requested_name, "文件");
            let target = unique_copy_path(&package_dir, &safe_name, false);
            if let Err(error) = std::fs::copy(&source, &target) {
                let _ = std::fs::remove_dir_all(&package_dir);
                return Err(AppError::from(error));
            }
        }

        Ok(package_dir.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| AppError::Internal(error.to_string()))?
}

fn sanitize_copy_name(value: &str, fallback: &str) -> String {
    let cleaned = value
        .chars()
        .filter(|character| !character.is_control())
        .map(|character| {
            if matches!(character, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                character
            }
        })
        .take(120)
        .collect::<String>();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned.to_string()
    }
}

fn unique_copy_path(root: &Path, requested_name: &str, directory: bool) -> PathBuf {
    let initial = root.join(requested_name);
    if !initial.exists() {
        return initial;
    }
    let requested = Path::new(requested_name);
    let stem = requested
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("文件");
    let extension = if directory {
        None
    } else {
        requested.extension().and_then(|value| value.to_str())
    };
    for suffix in 2..=10_000 {
        let candidate_name = match extension {
            Some(extension) => format!("{stem} ({suffix}).{extension}"),
            None => format!("{stem} ({suffix})"),
        };
        let candidate = root.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    root.join(format!("{}-{}", stem, uuid::Uuid::new_v4()))
}

fn normalize_image_ext(ext: &str) -> Option<&'static str> {
    match ext.to_lowercase().as_str() {
        "png" => Some("png"),
        "jpg" | "jpeg" => Some("jpg"),
        "webp" => Some("webp"),
        "gif" => Some("gif"),
        "avif" => Some("avif"),
        _ => None,
    }
}

pub(crate) fn image_ext_from_filename(name: &str) -> Option<&'static str> {
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    normalize_image_ext(ext)
}

pub(crate) fn image_ext_from_bytes(bytes: &[u8]) -> Option<&'static str> {
    let format = image::guess_format(bytes).ok()?;
    match format {
        ImageFormat::Png => Some("png"),
        ImageFormat::Jpeg => Some("jpg"),
        ImageFormat::Gif => Some("gif"),
        ImageFormat::WebP => Some("webp"),
        _ => None,
    }
}

pub(crate) fn image_ext_from_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/avif" => Some("avif"),
        _ => None,
    }
}

#[derive(Serialize)]
pub struct TextFilePreview {
    pub text: String,
    pub truncated: bool,
}

#[tauri::command]
pub async fn read_text_file_preview(path: String) -> Result<TextFilePreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        const LIMIT: usize = 100_000;
        let extension = Path::new(&path).extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(extension.as_str(), "md" | "markdown" | "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs" | "py" | "sh" | "bash" | "zsh" | "json" | "yaml" | "yml" | "toml" | "txt" | "css" | "html" | "rs" | "go" | "c" | "h" | "cpp" | "java" | "sql") {
            return Err("Unsupported file type".into());
        }
        let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        if !file.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("Not a regular file".into());
        }
        let mut bytes = Vec::new();
        file.take((LIMIT + 1) as u64).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.contains(&0) { return Err("Binary file".into()); }
        let truncated = bytes.len() > LIMIT;
        if truncated { bytes.truncate(LIMIT); }
        let text = match std::str::from_utf8(&bytes) {
            Ok(text) => text.to_owned(),
            Err(error) if truncated && error.error_len().is_none() => String::from_utf8(bytes[..error.valid_up_to()].to_vec()).map_err(|e| e.to_string())?,
            Err(_) => return Err("File is not UTF-8 text".into()),
        };
        Ok(TextFilePreview { text, truncated })
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::copy_file_to;

    #[test]
    fn saving_a_file_onto_itself_keeps_its_content() {
        let dir = std::env::temp_dir().join(format!("tiez-save-as-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("photo.png");
        std::fs::write(&file, b"image bytes").unwrap();

        copy_file_to(&file, &file).unwrap();
        copy_file_to(&file, &dir.join(".").join("photo.png")).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"image bytes");

        let copy = dir.join("copy.png");
        copy_file_to(&file, &copy).unwrap();
        assert_eq!(std::fs::read(&copy).unwrap(), b"image bytes");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
