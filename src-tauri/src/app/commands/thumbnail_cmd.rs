use crate::error::AppError;
use image::codecs::gif::GifDecoder;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::webp::WebPDecoder;
use image::{AnimationDecoder, DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

/// Longest side (px) of a generated thumbnail.
pub const THUMBNAIL_MAX_SIDE: u32 = 320;
const THUMBNAIL_JPEG_QUALITY: u8 = 82;
/// Bump to invalidate every cached thumbnail when the output format changes.
const THUMBNAIL_CACHE_VERSION: &str = "v1";

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Returns an absolute path to a thumbnail (longest side <= 320 px) for `path`.
/// Images that already fit, and animated GIF/WebP, return `path` unchanged.
#[tauri::command]
pub async fn get_image_thumbnail(app: AppHandle, path: String) -> Result<String, AppError> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::IO(format!("cache dir unavailable: {}", e)))?
        .join("thumbnails");
    tauri::async_runtime::spawn_blocking(move || build_thumbnail(&path, &cache_dir))
        .await
        .map_err(|e| AppError::Internal(format!("thumbnail task failed: {}", e)))?
}

/// Target size that keeps the aspect ratio with the longest side <= `max_side`.
/// `None` means the image already fits and should be used as-is.
pub fn fit_within(width: u32, height: u32, max_side: u32) -> Option<(u32, u32)> {
    if width <= max_side && height <= max_side {
        return None;
    }
    let scale = max_side as f64 / width.max(height) as f64;
    let scaled = |v: u32| ((v as f64 * scale).round() as u32).clamp(1, max_side);
    Some((scaled(width), scaled(height)))
}

/// Cache file stem derived from (canonical path, size, mtime); any edit changes it.
pub fn thumbnail_cache_key(canonical_path: &Path, file_size: u64, mtime_nanos: u128) -> String {
    let mut hasher = Sha256::new();
    hasher.update(THUMBNAIL_CACHE_VERSION.as_bytes());
    hasher.update(THUMBNAIL_MAX_SIDE.to_le_bytes());
    hasher.update(canonical_path.to_string_lossy().as_bytes());
    hasher.update([0u8]);
    hasher.update(file_size.to_le_bytes());
    hasher.update(mtime_nanos.to_le_bytes());
    format!("{:x}", hasher.finalize())
}

fn build_thumbnail(path: &str, cache_dir: &Path) -> Result<String, AppError> {
    let canonical =
        fs::canonicalize(path).map_err(|e| AppError::IO(format!("image not accessible: {}", e)))?;
    let meta = fs::metadata(&canonical)
        .map_err(|e| AppError::IO(format!("image not accessible: {}", e)))?;
    if !meta.is_file() {
        return Err(AppError::IO("image path is not a file".to_string()));
    }
    let mtime_nanos = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let key = thumbnail_cache_key(&canonical, meta.len(), mtime_nanos);

    // Cache hit: reuse without decoding anything.
    for ext in ["jpg", "png"] {
        let cached = cache_dir.join(format!("{}.{}", key, ext));
        if cached.is_file() {
            return Ok(cached.to_string_lossy().into_owned());
        }
    }

    let format = open_reader(&canonical)?.format();
    let (width, height) = open_reader(&canonical)?
        .into_dimensions()
        .map_err(|_| decode_error())?;
    let Some((target_w, target_h)) = fit_within(width, height, THUMBNAIL_MAX_SIDE) else {
        return Ok(path.to_string());
    };
    if is_animated(&canonical, format) {
        return Ok(path.to_string());
    }

    let mut decoder = open_reader(&canonical)?
        .into_decoder()
        .map_err(|_| decode_error())?;
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|_| decode_error())?;
    if let Some(orientation) = orientation {
        img.apply_orientation(orientation);
    }
    // Orientation may swap width/height; recompute from the oriented image.
    let (target_w, target_h) =
        fit_within(img.width(), img.height(), THUMBNAIL_MAX_SIDE).unwrap_or((target_w, target_h));
    let thumb = img.thumbnail_exact(target_w, target_h);

    let keep_alpha = thumb.color().has_alpha() && thumb.to_rgba8().pixels().any(|p| p.0[3] < 255);
    let (ext, bytes) = if keep_alpha {
        let mut out = Vec::new();
        DynamicImage::ImageRgba8(thumb.to_rgba8())
            .write_to(&mut std::io::Cursor::new(&mut out), ImageFormat::Png)
            .map_err(|e| AppError::Internal(format!("thumbnail encode failed: {}", e)))?;
        ("png", out)
    } else {
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, THUMBNAIL_JPEG_QUALITY)
            .encode_image(&thumb.to_rgb8())
            .map_err(|e| AppError::Internal(format!("thumbnail encode failed: {}", e)))?;
        ("jpg", out)
    };

    fs::create_dir_all(cache_dir)?;
    let final_path = cache_dir.join(format!("{}.{}", key, ext));
    write_atomically(&final_path, &bytes)?;
    Ok(final_path.to_string_lossy().into_owned())
}

fn open_reader(path: &Path) -> Result<ImageReader<BufReader<fs::File>>, AppError> {
    ImageReader::open(path)
        .map_err(|e| AppError::IO(format!("image not accessible: {}", e)))?
        .with_guessed_format()
        .map_err(|e| AppError::IO(format!("image not accessible: {}", e)))
}

fn decode_error() -> AppError {
    AppError::Internal("failed to decode image".to_string())
}

fn is_animated(path: &Path, format: Option<ImageFormat>) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let reader = BufReader::new(file);
    match format {
        Some(ImageFormat::Gif) => GifDecoder::new(reader)
            .map(|d| d.into_frames().take(2).filter(|f| f.is_ok()).count() > 1)
            .unwrap_or(false),
        Some(ImageFormat::WebP) => WebPDecoder::new(reader)
            .map(|d| d.has_animation())
            .unwrap_or(false),
        _ => false,
    }
}

/// Write via a temp file + rename so concurrent callers never see a partial file.
fn write_atomically(final_path: &PathBuf, bytes: &[u8]) -> Result<(), AppError> {
    let temp_path = final_path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&temp_path, bytes)?;
    if let Err(e) = fs::rename(&temp_path, final_path) {
        let _ = fs::remove_file(&temp_path);
        // Another caller may have produced the same thumbnail first.
        if !final_path.is_file() {
            return Err(e.into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_within_keeps_aspect_ratio() {
        assert_eq!(fit_within(320, 320, 320), None);
        assert_eq!(fit_within(100, 50, 320), None);
        assert_eq!(fit_within(3840, 2160, 320), Some((320, 180)));
        assert_eq!(fit_within(1080, 2400, 320), Some((144, 320)));
        assert_eq!(fit_within(321, 100, 320), Some((320, 100)));
        // Extreme panoramas never collapse to 0 px.
        assert_eq!(fit_within(100_000, 10, 320), Some((320, 1)));
    }

    #[test]
    fn cache_key_changes_with_size_and_mtime() {
        let path = Path::new("/tmp/shot.png");
        let base = thumbnail_cache_key(path, 1024, 1_700_000_000_000_000_000);
        assert_eq!(
            base,
            thumbnail_cache_key(path, 1024, 1_700_000_000_000_000_000)
        );
        assert_ne!(
            base,
            thumbnail_cache_key(path, 1025, 1_700_000_000_000_000_000)
        );
        assert_ne!(
            base,
            thumbnail_cache_key(path, 1024, 1_700_000_000_000_000_001)
        );
        assert_ne!(
            base,
            thumbnail_cache_key(Path::new("/tmp/other.png"), 1024, 1_700_000_000_000_000_000)
        );
        assert_eq!(base.len(), 64);
    }

    #[test]
    fn builds_and_reuses_cached_thumbnail() {
        let root = std::env::temp_dir().join(format!(
            "tiez-thumb-test-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let cache = root.join("thumbnails");
        fs::create_dir_all(&root).unwrap();

        let big = root.join("big.png");
        image::RgbImage::from_pixel(1000, 500, image::Rgb([10, 20, 30]))
            .save(&big)
            .unwrap();
        let first = build_thumbnail(big.to_str().unwrap(), &cache).unwrap();
        assert!(first.ends_with(".jpg"));
        assert_eq!(image::image_dimensions(&first).unwrap(), (320, 160));
        assert_eq!(
            build_thumbnail(big.to_str().unwrap(), &cache).unwrap(),
            first
        );

        let alpha = root.join("alpha.png");
        image::RgbaImage::from_pixel(640, 640, image::Rgba([0, 0, 0, 0]))
            .save(&alpha)
            .unwrap();
        assert!(build_thumbnail(alpha.to_str().unwrap(), &cache)
            .unwrap()
            .ends_with(".png"));

        let small = root.join("small.png");
        image::RgbImage::new(100, 80).save(&small).unwrap();
        let small_str = small.to_str().unwrap();
        assert_eq!(build_thumbnail(small_str, &cache).unwrap(), small_str);

        assert!(matches!(
            build_thumbnail(root.join("missing.png").to_str().unwrap(), &cache),
            Err(AppError::IO(_))
        ));
        let broken = root.join("broken.png");
        fs::write(&broken, b"not an image").unwrap();
        assert!(matches!(
            build_thumbnail(broken.to_str().unwrap(), &cache),
            Err(AppError::Internal(_))
        ));

        let _ = fs::remove_dir_all(&root);
    }
}
