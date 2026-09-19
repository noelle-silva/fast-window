//! 资产导入：图标 / 壁纸。
//!
//! 内容哈希寻址落盘：文件名 = 内容 SHA-1 + 规范扩展名；写入幂等、文件不可变。

use std::path::{Path, PathBuf};

use base64::engine::general_purpose;
use base64::Engine as _;
use sha1::{Digest, Sha1};

pub const ASSETS_DIR: &str = "assets";
pub const ICON_ASSETS_DIR: &str = "icons";
pub const WALLPAPER_ASSETS_DIR: &str = "wallpapers";

pub const SUPPORTED_IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "webp", "gif", "ico", "svg"];
const MAX_ICON_ASSET_BYTES: usize = 12 * 1024 * 1024;
const MAX_DATA_URL_CHARS: usize = 24 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAsset {
    pub id: String,
    pub kind: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetImportPayload {
    pub kind: String,
    #[serde(default)]
    pub source_path: String,
    #[serde(default)]
    pub data_url: String,
}

struct AssetSource {
    bytes: Vec<u8>,
    ext: String,
}

fn normalize_ext(ext: &str) -> String {
    let lowered = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if lowered == "jpeg" {
        "jpg".to_string()
    } else {
        lowered
    }
}

fn is_supported_ext(ext: &str) -> bool {
    SUPPORTED_IMAGE_EXTS.contains(&ext)
}

/// 资产 ID 规则：`<icons|wallpapers>/<40 位小写十六进制>.<支持扩展名>`，恰好两段。
pub fn is_safe_asset_id(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.contains("..") || trimmed.starts_with('/') {
        return false;
    }
    let mut segments = trimmed.split('/');
    let (Some(subdir), Some(filename), None) = (segments.next(), segments.next(), segments.next())
    else {
        return false;
    };
    if subdir != ICON_ASSETS_DIR && subdir != WALLPAPER_ASSETS_DIR {
        return false;
    }
    let mut parts = filename.split('.');
    let (Some(stem), Some(ext), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    if stem.len() != 40 || !stem.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return false;
    }
    is_supported_ext(&normalize_ext(ext))
}

/// 资产文件绝对路径；非法 ID 直接报错。
pub fn asset_file_path(data_dir: &Path, asset_id: &str) -> Result<PathBuf, String> {
    let trimmed = asset_id.trim();
    if !is_safe_asset_id(trimmed) {
        return Err(format!("invalid asset id: {trimmed}"));
    }
    let (subdir, filename) = trimmed.split_once('/').ok_or_else(|| "invalid asset id".to_string())?;
    Ok(data_dir.join(ASSETS_DIR).join(subdir).join(filename))
}

/// 导入资产。`kind` 为 `icon` / `wallpaper`；`source_path` 与 `data_url` 二选一。
pub fn import_asset(
    data_dir: &Path,
    kind: &str,
    source_path: &str,
    data_url: &str,
) -> Result<ImportedAsset, String> {
    let kind = kind.trim();
    let (subdir, max_bytes) = match kind {
        "icon" => (ICON_ASSETS_DIR, Some(MAX_ICON_ASSET_BYTES)),
        "wallpaper" => (WALLPAPER_ASSETS_DIR, None),
        _ => return Err("asset kind must be icon or wallpaper".to_string()),
    };

    let source = load_asset_source(source_path.trim(), data_url.trim())?;
    if source.bytes.is_empty() {
        return Err("asset file is empty".to_string());
    }
    if let Some(max) = max_bytes {
        if source.bytes.len() > max {
            return Err(format!(
                "{kind} asset file is too large: max {max} bytes"
            ));
        }
    }
    validate_image_content(&source.bytes, &source.ext)?;

    let digest = Sha1::digest(&source.bytes);
    let asset_name = format!("{}{}", hex_lower(&digest), ext_with_dot(&source.ext));
    let asset_id = format!("{subdir}/{asset_name}");
    let target = asset_file_path(data_dir, &asset_id)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create asset directory failed: {e}"))?;
    }
    if !target.exists() {
        write_asset_file(&target, &source.bytes)?;
    }
    Ok(ImportedAsset {
        id: asset_id,
        kind: kind.to_string(),
    })
}

fn write_asset_file(target: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write as _;
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
    {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => return Ok(()),
        Err(err) => return Err(format!("create asset target failed: {err}")),
    };
    let write_result = file.write_all(bytes).and_then(|_| file.flush());
    if let Err(err) = write_result {
        drop(file);
        let _ = std::fs::remove_file(target);
        return Err(format!("write asset target failed: {err}"));
    }
    Ok(())
}

fn ext_with_dot(ext: &str) -> String {
    format!(".{ext}")
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn load_asset_source(source_path: &str, data_url: &str) -> Result<AssetSource, String> {
    if source_path.is_empty() && data_url.is_empty() {
        return Err("asset source path or data URL is required".to_string());
    }
    if !source_path.is_empty() && !data_url.is_empty() {
        return Err("asset import accepts exactly one source".to_string());
    }
    if !data_url.is_empty() {
        return data_url_source(data_url);
    }
    file_source(source_path)
}

fn file_source(source_path: &str) -> Result<AssetSource, String> {
    let path = Path::new(source_path);
    let ext = normalize_ext(&path.extension().and_then(|s| s.to_str()).unwrap_or(""));
    if !is_supported_ext(&ext) {
        return Err("asset must be a png, jpg, jpeg, webp, gif, ico, or svg image".to_string());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("read asset source failed: {e}"))?;
    Ok(AssetSource { bytes, ext })
}

fn data_url_source(data_url: &str) -> Result<AssetSource, String> {
    let lowered = data_url.to_ascii_lowercase();
    if !lowered.starts_with("data:image/") {
        return Err("asset data URL must be a base64 image".to_string());
    }
    let Some(comma) = data_url.find(',') else {
        return Err("asset data URL must be a base64 image".to_string());
    };
    let meta = &data_url[..comma];
    if !meta.to_ascii_lowercase().ends_with(";base64") {
        return Err("asset data URL must be a base64 image".to_string());
    }
    let ext = image_ext_from_data_url_media_type(meta)?;
    let payload = &data_url[comma + 1..];
    if payload.len() > MAX_DATA_URL_CHARS {
        return Err(format!(
            "asset data URL is too large: max {MAX_DATA_URL_CHARS} bytes"
        ));
    }
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("decode asset data URL failed: {e}"))?;
    Ok(AssetSource { bytes, ext })
}

fn image_ext_from_data_url_media_type(meta: &str) -> Result<String, String> {
    let media_type = meta
        .trim_start_matches("data:")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let ext = match media_type.as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/x-icon" | "image/vnd.microsoft.icon" | "image/ico" => "ico",
        "image/svg+xml" => "svg",
        _ => return Err("asset data URL must be a base64 image".to_string()),
    };
    Ok(ext.to_string())
}

// ── 内容校验 ────────────────────────────────────────────────────────────────

pub fn validate_image_content(payload: &[u8], ext: &str) -> Result<(), String> {
    let ext = normalize_ext(ext);
    match ext.as_str() {
        "webp" => {
            if payload.len() < 12 || &payload[0..4] != b"RIFF" || &payload[8..12] != b"WEBP" {
                return Err("asset content is not a supported image".to_string());
            }
            Ok(())
        }
        "ico" => validate_ico_content(payload),
        "svg" => validate_svg_content(payload),
        "png" => {
            if payload.len() < 8 || &payload[0..8] != b"\x89PNG\r\n\x1a\n" {
                return Err("asset content is not a supported image".to_string());
            }
            Ok(())
        }
        "jpg" => {
            if payload.len() < 3 || &payload[0..3] != b"\xFF\xD8\xFF" {
                return Err("asset content is not a supported image".to_string());
            }
            Ok(())
        }
        "gif" => {
            if payload.len() < 6 || (&payload[0..6] != b"GIF87a" && &payload[0..6] != b"GIF89a") {
                return Err("asset content is not a supported image".to_string());
            }
            Ok(())
        }
        _ => Err("asset content is not a supported image".to_string()),
    }
}

fn validate_ico_content(payload: &[u8]) -> Result<(), String> {
    let invalid = || "asset content is not a supported image".to_string();
    if payload.len() < 22 || payload[0] != 0 || payload[1] != 0 || payload[2] != 1 || payload[3] != 0
    {
        return Err(invalid());
    }
    let count = u16::from_le_bytes([payload[4], payload[5]]) as usize;
    if count == 0 || count > 64 || payload.len() < 6 + count * 16 {
        return Err(invalid());
    }
    for index in 0..count {
        let entry = 6 + index * 16;
        let size = u32::from_le_bytes([
            payload[entry + 8],
            payload[entry + 9],
            payload[entry + 10],
            payload[entry + 11],
        ]) as usize;
        let offset = u32::from_le_bytes([
            payload[entry + 12],
            payload[entry + 13],
            payload[entry + 14],
            payload[entry + 15],
        ]) as usize;
        if size == 0
            || offset < 6 + count * 16
            || offset > payload.len()
            || size > payload.len() - offset
        {
            return Err(invalid());
        }
        if !is_valid_ico_image_payload(&payload[offset..offset + size]) {
            return Err(invalid());
        }
    }
    Ok(())
}

fn is_valid_ico_image_payload(payload: &[u8]) -> bool {
    if payload.len() >= 8 && &payload[0..8] == b"\x89PNG\r\n\x1a\n" {
        return payload.len() >= 24 && &payload[12..16] == b"IHDR";
    }
    if payload.len() < 16 {
        return false;
    }
    let header_size = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]) as usize;
    if header_size != 40 && header_size != 108 && header_size != 124 {
        return false;
    }
    if payload.len() < header_size {
        return false;
    }
    let width = i32::from_le_bytes([payload[4], payload[5], payload[6], payload[7]]);
    let height = i32::from_le_bytes([payload[8], payload[9], payload[10], payload[11]]);
    let planes = u16::from_le_bytes([payload[12], payload[13]]);
    let bits_per_pixel = u16::from_le_bytes([payload[14], payload[15]]);
    width > 0 && height > 0 && planes == 1 && bits_per_pixel > 0
}

fn validate_svg_content(payload: &[u8]) -> Result<(), String> {
    if payload.iter().all(|b| b.is_ascii_whitespace()) {
        return Err("asset content is not a supported image".to_string());
    }
    let text = std::str::from_utf8(payload)
        .map_err(|_| "asset content is not a supported image".to_string())?;
    let doc = roxmltree::Document::parse(text)
        .map_err(|_| "asset content is not a supported image".to_string())?;
    let root = doc.root_element();
    if root.tag_name().name().to_ascii_lowercase() != "svg" {
        return Err("asset content is not a supported image".to_string());
    }
    for node in doc.descendants() {
        if !node.is_element() {
            continue;
        }
        if is_unsafe_svg_element(node.tag_name().name()) {
            return Err("asset svg contains unsupported active content".to_string());
        }
        for attr in node.attributes() {
            if is_unsafe_svg_attribute(attr.name(), attr.value()) {
                return Err("asset svg contains unsupported external content".to_string());
            }
        }
    }
    Ok(())
}

fn is_unsafe_svg_element(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "script" | "foreignobject" | "iframe" | "object" | "embed" | "audio" | "video" | "canvas"
    )
}

fn is_unsafe_svg_attribute(name: &str, value: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let value = value.trim().to_ascii_lowercase();
    if name.starts_with("on") {
        return true;
    }
    if value.contains("javascript:") {
        return true;
    }
    if value.contains("url(") && !value.contains("url(#") {
        return true;
    }
    if name == "href" || name == "src" {
        return !value.is_empty() && !value.starts_with('#');
    }
    if name == "style" {
        return value.contains("url(");
    }
    false
}

// ── 图片尺寸探测（网页图标发现使用） ────────────────────────────────────────

/// 探测图片固有尺寸；无法识别时返回 None。
pub fn image_dimensions(payload: &[u8], ext: &str) -> Option<(u32, u32)> {
    match normalize_ext(ext).as_str() {
        "png" => png_dimensions(payload),
        "jpg" => jpeg_dimensions(payload),
        "gif" => gif_dimensions(payload),
        "webp" => webp_dimensions(payload),
        "ico" => ico_dimensions(payload),
        "svg" => svg_dimensions(payload),
        _ => None,
    }
}

fn png_dimensions(payload: &[u8]) -> Option<(u32, u32)> {
    if payload.len() < 24 || &payload[0..8] != b"\x89PNG\r\n\x1a\n" || &payload[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes([payload[16], payload[17], payload[18], payload[19]]);
    let height = u32::from_be_bytes([payload[20], payload[21], payload[22], payload[23]]);
    Some((width, height))
}

fn gif_dimensions(payload: &[u8]) -> Option<(u32, u32)> {
    if payload.len() < 10 {
        return None;
    }
    let width = u16::from_le_bytes([payload[6], payload[7]]) as u32;
    let height = u16::from_le_bytes([payload[8], payload[9]]) as u32;
    Some((width, height))
}

fn jpeg_dimensions(payload: &[u8]) -> Option<(u32, u32)> {
    if payload.len() < 4 || payload[0] != 0xFF || payload[1] != 0xD8 {
        return None;
    }
    let mut index = 2usize;
    while index + 9 < payload.len() {
        if payload[index] != 0xFF {
            index += 1;
            continue;
        }
        let marker = payload[index + 1];
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            index += 2;
            continue;
        }
        let length = u16::from_be_bytes([payload[index + 2], payload[index + 3]]) as usize;
        if length < 2 || index + 2 + length > payload.len() {
            return None;
        }
        let is_sof = matches!(
            marker,
            0xC0 | 0xC1 | 0xC2 | 0xC3 | 0xC5 | 0xC6 | 0xC7 | 0xC9 | 0xCA | 0xCB | 0xCD | 0xCE | 0xCF
        );
        if is_sof {
            let height = u16::from_be_bytes([payload[index + 5], payload[index + 6]]) as u32;
            let width = u16::from_be_bytes([payload[index + 7], payload[index + 8]]) as u32;
            return Some((width, height));
        }
        if marker == 0xDA {
            return None;
        }
        index += 2 + length;
    }
    None
}

fn webp_dimensions(payload: &[u8]) -> Option<(u32, u32)> {
    if payload.len() < 30 || &payload[0..4] != b"RIFF" || &payload[8..12] != b"WEBP" {
        return None;
    }
    let chunk = &payload[12..16];
    match chunk {
        b"VP8 " => {
            if payload.len() < 30 {
                return None;
            }
            let width = u16::from_le_bytes([payload[26], payload[27]]) as u32 & 0x3FFF;
            let height = u16::from_le_bytes([payload[28], payload[29]]) as u32 & 0x3FFF;
            Some((width, height))
        }
        b"VP8L" => {
            if payload.len() < 25 || payload[20] != 0x2F {
                return None;
            }
            let bits = u32::from_le_bytes([payload[21], payload[22], payload[23], payload[24]]);
            let width = (bits & 0x3FFF) + 1;
            let height = ((bits >> 14) & 0x3FFF) + 1;
            Some((width, height))
        }
        b"VP8X" => {
            if payload.len() < 30 {
                return None;
            }
            let width = 1 + u32::from_le_bytes([payload[24], payload[25], payload[26], 0]);
            let height = 1 + u32::from_le_bytes([payload[27], payload[28], payload[29], 0]);
            Some((width, height))
        }
        _ => None,
    }
}

fn ico_dimensions(payload: &[u8]) -> Option<(u32, u32)> {
    if payload.len() < 6 || payload[2] != 1 {
        return None;
    }
    let count = u16::from_le_bytes([payload[4], payload[5]]) as usize;
    if count == 0 || payload.len() < 6 + count * 16 {
        return None;
    }
    let mut best = (0u32, 0u32);
    for index in 0..count {
        let entry = 6 + index * 16;
        let width = if payload[entry] == 0 { 256 } else { payload[entry] as u32 };
        let height = if payload[entry + 1] == 0 { 256 } else { payload[entry + 1] as u32 };
        if width * height > best.0 * best.1 {
            best = (width, height);
        }
    }
    if best.0 == 0 {
        return None;
    }
    Some(best)
}

fn svg_dimensions(payload: &[u8]) -> Option<(u32, u32)> {
    let text = std::str::from_utf8(payload).ok()?;
    let doc = roxmltree::Document::parse(text).ok()?;
    let root = doc.root_element();
    let width = svg_length(root.attribute("width"));
    let height = svg_length(root.attribute("height"));
    if let (Some(w), Some(h)) = (width, height) {
        return Some((w, h));
    }
    if let Some(view_box) = root.attribute("viewBox") {
        let parts: Vec<f64> = view_box
            .split(|c: char| c == ',' || c.is_ascii_whitespace())
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse::<f64>().ok())
            .collect();
        if parts.len() == 4 && parts[2] > 0.0 && parts[3] > 0.0 {
            return Some((parts[2].round() as u32, parts[3].round() as u32));
        }
    }
    None
}

fn svg_length(value: Option<&str>) -> Option<u32> {
    let raw = value?.trim();
    let numeric: String = raw
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if numeric.is_empty() {
        return None;
    }
    let parsed: f64 = numeric.parse().ok()?;
    if parsed <= 0.0 {
        return None;
    }
    Some(parsed.round() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha1_asset_id(subdir: &str, payload: &[u8], ext: &str) -> String {
        format!("{subdir}/{}.{ext}", hex_lower(&Sha1::digest(payload)))
    }

    #[test]
    fn safe_asset_id_rules() {
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89";
        let id = sha1_asset_id("icons", png, "png");
        assert!(is_safe_asset_id(&id));
        assert!(!is_safe_asset_id("icons/../evil.png"));
        assert!(!is_safe_asset_id(&format!("/{id}")));
        assert!(!is_safe_asset_id("icons/UPPERCASE.png"));
        assert!(!is_safe_asset_id("other/abcdef.png"));
        assert!(!is_safe_asset_id("icons/short.png"));
        assert!(!is_safe_asset_id("icons/abcdef.exe"));
    }

    #[test]
    fn imports_png_idempotently() {
        let dir = std::env::temp_dir().join(format!("fw-webview-assets-{}", crate::collections::model::now_ms()));
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89";
        let payload = general_purpose::STANDARD.encode(png);
        let data_url = format!("data:image/png;base64,{payload}");
        let first = import_asset(&dir, "icon", "", &data_url).expect("first import");
        let second = import_asset(&dir, "icon", "", &data_url).expect("second import");
        assert_eq!(first.id, second.id);
        assert!(asset_file_path(&dir, &first.id).expect("path").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_oversized_icon() {
        let dir = std::env::temp_dir().join(format!("fw-webview-assets-big-{}", crate::collections::model::now_ms()));
        let mut png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89".to_vec();
        png.resize(MAX_ICON_ASSET_BYTES + 1, 0);
        let payload = general_purpose::STANDARD.encode(&png);
        let data_url = format!("data:image/png;base64,{payload}");
        assert!(import_asset(&dir, "icon", "", &data_url).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_active_svg() {
        let payload = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>";
        assert!(validate_image_content(payload, "svg").is_err());
        let safe = b"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/></svg>";
        assert!(validate_image_content(safe, "svg").is_ok());
    }

    #[test]
    fn detects_dimensions() {
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x20\x00\x00\x00\x10\x08\x06\x00\x00\x00";
        assert_eq!(png_dimensions(png), Some((32, 16)));
        let gif = b"GIF89a\x40\x00\x20\x00\x00";
        assert_eq!(gif_dimensions(gif), Some((64, 32)));
    }
}
