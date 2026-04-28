use base64::Engine as _;
use std::fs;
use std::path::{Path, PathBuf};

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
    if !is_managed_clipboard_image_path(requested) {
        return;
    }
    if let Ok(path) = resolve_output_path(output_root, requested) {
        let _ = fs::remove_file(path);
    }
}

pub fn delete_output_image(output_root: &Path, requested: &str) -> Result<(), String> {
    if !is_managed_clipboard_image_path(requested) {
        return Ok(());
    }
    let path = resolve_output_path(output_root, requested)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除图片失败: {e}")),
    }
}

fn resolve_output_path(output_root: &Path, requested: &str) -> Result<PathBuf, String> {
    let raw = requested.trim();
    if raw.is_empty() || raw.contains('\0') {
        return Err("图片路径无效".to_string());
    }
    let candidate = PathBuf::from(raw);
    let full = if candidate.is_absolute() { candidate } else { output_root.join(candidate) };
    let root = output_root.canonicalize().unwrap_or_else(|_| output_root.to_path_buf());
    let parent = full.parent().unwrap_or(output_root).canonicalize().unwrap_or_else(|_| output_root.to_path_buf());
    if !parent.starts_with(root) {
        return Err("路径越界".to_string());
    }
    Ok(full)
}

fn is_managed_clipboard_image_path(path: &str) -> bool {
    let name = path.replace('\\', "/").split('/').last().unwrap_or("").to_ascii_lowercase();
    name.starts_with("clipboard-image-") && name.ends_with(".png") && name.len() == "clipboard-image-00000000.png".len()
}
