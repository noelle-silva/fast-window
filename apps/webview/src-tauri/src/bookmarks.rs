use std::path::{Path, PathBuf};

use base64::engine::general_purpose;
use base64::Engine as _;
use serde::{Deserialize, Serialize};

const BOOKMARKS_FILE: &str = "bookmarks.json";
const ICONS_DIR: &str = "bookmark-icons";
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Bookmark {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) icon_url: String,
    #[serde(default)]
    pub(crate) icon_data_url: String,
    #[serde(default)]
    pub(crate) icon_path: String,
    #[serde(default)]
    pub(crate) created_at: u64,
    #[serde(default)]
    pub(crate) updated_at: u64,
}

fn bookmarks_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::data_dir::resolve_data_dir(app).map(|dir| dir.join(BOOKMARKS_FILE))
}

fn icons_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::data_dir::resolve_data_dir(app).map(|dir| dir.join(ICONS_DIR))
}

fn ensure_icons_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = icons_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建图标目录失败: {e}"))?;
    Ok(dir)
}

fn icon_within_icons_dir(root: &Path, path: &str) -> Result<PathBuf, String> {
    let root_c = std::fs::canonicalize(root).map_err(|e| format!("图标目录不可用: {e}"))?;
    if path.trim().is_empty() {
        return Err("图片路径不能为空".to_string());
    }
    let input = PathBuf::from(path.trim());
    let full = if input.is_absolute() {
        input
    } else {
        root_c.join(input)
    };
    let full_c = std::fs::canonicalize(&full).map_err(|e| format!("图片路径无效: {e}"))?;
    if !full_c.starts_with(&root_c) {
        return Err("图片路径越界".to_string());
    }
    Ok(full_c)
}

#[tauri::command]
pub(crate) fn bookmarks_load(app: tauri::AppHandle) -> Result<Vec<Bookmark>, String> {
    let path = bookmarks_file(&app)?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取书签失败: {e}"))?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&text).map_err(|e| format!("解析书签失败: {e}"))
}

#[tauri::command]
pub(crate) fn bookmarks_save(app: tauri::AppHandle, items: Vec<Bookmark>) -> Result<(), String> {
    if items.len() > 512 {
        return Err("书签过多（超过 512 条）".to_string());
    }
    let path = bookmarks_file(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建书签目录失败: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(&items)
        .map_err(|e| format!("序列化书签失败: {e}"))?;
    std::fs::write(&path, format!("{payload}\n")).map_err(|e| format!("保存书签失败: {e}"))?;
    Ok(())
}

fn decode_base64_image_payload(raw: &str) -> Result<(Vec<u8>, String), String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("图片数据为空".to_string());
    }

    if s.starts_with("data:") {
        let base64_pos = s
            .find("base64,")
            .ok_or_else(|| "data URL 缺少 base64,".to_string())?;
        let meta = &s["data:".len()..base64_pos];
        let b64 = &s[(base64_pos + "base64,".len())..];

        let ext = if meta.contains("image/png") {
            "png"
        } else if meta.contains("image/gif") {
            "gif"
        } else if meta.contains("image/jpeg") {
            "jpg"
        } else if meta.contains("image/webp") {
            "webp"
        } else {
            "png"
        };

        if b64.len() > 40 * 1024 * 1024 {
            return Err("图片数据过大".to_string());
        }
        let bytes = general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("base64 解码失败: {e}"))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err("图片过大".to_string());
        }
        return Ok((bytes, ext.to_string()));
    }

    if s.len() > 40 * 1024 * 1024 {
        return Err("图片数据过大".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(s)
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("图片过大".to_string());
    }
    Ok((bytes, "png".to_string()))
}

fn path_has_image_ext(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif")
}

fn image_mime_by_ext(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
}

#[tauri::command]
pub(crate) fn bookmark_icon_write(
    app: tauri::AppHandle,
    data_url_or_base64: String,
) -> Result<String, String> {
    let (bytes, payload_ext) = decode_base64_image_payload(&data_url_or_base64)?;
    let dir = ensure_icons_dir(&app)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_millis(0))
        .as_millis();
    let filename = format!("icon-{stamp}.{payload_ext}");
    let full = dir.join(filename);
    std::fs::write(&full, bytes).map_err(|e| format!("写入图标失败: {e}"))?;
    Ok(full.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn bookmark_icon_read(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    let dir = ensure_icons_dir(&app)?;
    let full_c = icon_within_icons_dir(&dir, &path)?;
    if !full_c.is_file() {
        return Err("图片不存在".to_string());
    }
    if !path_has_image_ext(&full_c) {
        return Err("不支持的图片类型".to_string());
    }
    let bytes = std::fs::read(&full_c).map_err(|e| format!("读取图片失败: {e}"))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("图片过大".to_string());
    }
    let mime = image_mime_by_ext(&full_c);
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[tauri::command]
pub(crate) fn bookmark_icon_delete(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = ensure_icons_dir(&app)?;
    let full_c = icon_within_icons_dir(&dir, &path)?;
    std::fs::remove_file(&full_c).map_err(|e| format!("删除图片失败: {e}"))
}
