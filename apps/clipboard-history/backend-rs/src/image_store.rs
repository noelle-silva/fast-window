use crate::data_contract::{FALLBACK_IMAGES_DIR_NAME, OUTPUT_IMAGES_DIR_NAME};
use base64::Engine as _;
use std::fs;
use std::path::{Path, PathBuf};

const MANAGED_IMAGE_PREFIX: &str = "clipboard-image-";
const MANAGED_IMAGE_SUFFIX: &str = ".png";

pub fn write_clipboard_image(output_root: &Path, hash: u32, png: &[u8]) -> Result<(String, String), String> {
    fs::create_dir_all(output_root).map_err(|e| format!("创建图片目录失败: {e}"))?;
    let hash_hex = format!("{hash:08x}");
    let filename = format!("clipboard-image-{hash_hex}.png");
    let full = output_root.join(&filename);
    fs::write(&full, png).map_err(|e| format!("写入图片失败: {e}"))?;
    Ok((format!("img:{hash_hex}"), full.to_string_lossy().to_string()))
}

pub fn read_output_image(output_root: &Path, requested: &str) -> Result<String, String> {
    let path = resolve_output_path(output_root, requested)?;
    let bytes = fs::read(&path).map_err(|e| format!("读取图片失败: {e}"))?;
    let mime = match path.extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

pub fn delete_managed_output_image(output_root: &Path, requested: &str) {
    if managed_clipboard_image_file_name_from_reference(requested).is_none() {
        return;
    }
    if let Ok(path) = resolve_output_path(output_root, requested) {
        let _ = fs::remove_file(path);
    }
}

pub fn managed_clipboard_image_file_name_from_reference(reference: &str) -> Option<String> {
    managed_clipboard_image_file_name(reference).or_else(|| image_file_name_from_token(reference))
}

fn resolve_output_path(output_root: &Path, requested: &str) -> Result<PathBuf, String> {
    let raw = requested.trim();
    if raw.is_empty() || raw.contains('\0') {
        return Err("图片路径无效".to_string());
    }

    let candidate = PathBuf::from(raw);
    if candidate.is_absolute() && candidate.is_file() && is_path_inside_allowed_roots(output_root, &candidate) {
        return Ok(candidate);
    }

    if let Some(file_name) = managed_clipboard_image_file_name_from_reference(raw) {
        return Ok(output_root.join(file_name));
    }

    let full = if candidate.is_absolute() { candidate } else { output_root.join(candidate) };
    if !is_path_inside_allowed_roots(output_root, &full) {
        return Err("路径越界".to_string());
    }
    Ok(full)
}

fn is_path_inside_allowed_roots(output_root: &Path, full: &Path) -> bool {
    let data_root = output_root.parent().unwrap_or(output_root);
    let roots = [
        output_root.to_path_buf(),
        data_root.join(OUTPUT_IMAGES_DIR_NAME),
        data_root.join(FALLBACK_IMAGES_DIR_NAME),
    ];
    let parent = full.parent().unwrap_or(output_root).canonicalize().unwrap_or_else(|_| output_root.to_path_buf());
    roots.iter().any(|root| {
        let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        parent.starts_with(root)
    })
}

fn image_file_name_from_token(value: &str) -> Option<String> {
    let hash = value.trim().strip_prefix("img:")?;
    is_8_hex(hash).then(|| format!("{MANAGED_IMAGE_PREFIX}{hash}{MANAGED_IMAGE_SUFFIX}"))
}

fn managed_clipboard_image_file_name(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let name = normalized.split('/').last()?.to_ascii_lowercase();
    if !name.starts_with(MANAGED_IMAGE_PREFIX) || !name.ends_with(MANAGED_IMAGE_SUFFIX) {
        return None;
    }
    if name.len() != "clipboard-image-00000000.png".len() {
        return None;
    }
    let hash = &name[MANAGED_IMAGE_PREFIX.len().."clipboard-image-00000000".len()];
    is_8_hex(hash).then_some(name)
}

fn is_8_hex(value: &str) -> bool {
    value.len() == 8 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
