use std::{
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};

const LIBRARY_DIR_NAME: &str = "library";
const ASSETS_DIR_NAME: &str = "Assets";
const UPLOAD_STAGING_DIR_NAME: &str = ".uploading";
const PASTED_UPLOAD_STAGING_DIR_NAME: &str = "pasted";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StagePastedAssetFileInput {
    name: Option<String>,
    content_base64: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StagedPastedAssetFile {
    path: String,
    name: String,
}

#[tauri::command]
pub(crate) fn stage_pasted_asset_file(
    app: tauri::AppHandle,
    input: StagePastedAssetFileInput,
) -> Result<StagedPastedAssetFile, String> {
    let name = sanitize_pasted_asset_file_name(input.name.as_deref().unwrap_or(""));
    let payload = base64_payload(&input.content_base64);
    if payload.is_empty() {
        return Err("粘贴附件内容为空".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("解析粘贴附件内容失败: {e}"))?;
    if bytes.is_empty() {
        return Err("粘贴附件内容为空".to_string());
    }

    let staging_dir = pasted_asset_staging_dir(&app)?;
    std::fs::create_dir_all(&staging_dir).map_err(|e| format!("创建粘贴附件临时目录失败: {e}"))?;
    let target = create_unique_pasted_asset_file(&staging_dir, &name, &bytes)?;
    Ok(StagedPastedAssetFile {
        path: target.display().to_string(),
        name,
    })
}

#[tauri::command]
pub(crate) fn cleanup_staged_pasted_asset_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<(), String> {
    let staging_dir = pasted_asset_staging_dir(&app)?;
    for path in paths {
        let target = PathBuf::from(path.trim());
        if target.as_os_str().is_empty()
            || !target.is_file()
            || !is_path_inside(&staging_dir, &target)
        {
            continue;
        }
        let _ = std::fs::remove_file(target);
    }
    Ok(())
}

fn pasted_asset_staging_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::data_dir::resolve_data_dir(app)?
        .join(LIBRARY_DIR_NAME)
        .join(ASSETS_DIR_NAME)
        .join(UPLOAD_STAGING_DIR_NAME)
        .join(PASTED_UPLOAD_STAGING_DIR_NAME))
}

fn create_unique_pasted_asset_file(
    dir: &Path,
    name: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    for attempt in 0..1000_u16 {
        let candidate = dir.join(format!("pasted-{now}-{attempt}-{name}"));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes) {
                    let _ = std::fs::remove_file(&candidate);
                    return Err(format!("写入粘贴附件临时文件失败: {error}"));
                }
                return Ok(candidate);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("创建粘贴附件临时文件失败: {error}")),
        }
    }
    Err("创建粘贴附件临时文件失败: 文件名冲突过多".to_string())
}

fn base64_payload(input: &str) -> &str {
    let trimmed = input.trim();
    if let Some((prefix, payload)) = trimmed.split_once(',') {
        if prefix.trim_start().starts_with("data:") {
            return payload.trim();
        }
    }
    trimmed
}

fn sanitize_pasted_asset_file_name(input: &str) -> String {
    let base = Path::new(input.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let stem = sanitize_file_name_part(
        Path::new(base)
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("pasted-attachment"),
        80,
    );
    let ext = sanitize_file_name_part(
        Path::new(base)
            .extension()
            .and_then(|name| name.to_str())
            .unwrap_or(""),
        16,
    );
    let stem = if stem.is_empty() {
        "pasted-attachment".to_string()
    } else {
        stem
    };
    if ext.is_empty() {
        stem
    } else {
        format!("{stem}.{ext}")
    }
}

fn sanitize_file_name_part(input: &str, limit: usize) -> String {
    let mut out = String::new();
    for ch in input.trim().chars() {
        if out.len() >= limit {
            break;
        }
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ' ') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    out.trim_matches(|ch| ch == ' ' || ch == '.').to_string()
}

fn is_path_inside(parent: &Path, child: &Path) -> bool {
    let parent = match parent.canonicalize() {
        Ok(path) => path,
        Err(_) => return false,
    };
    let child = match child.canonicalize() {
        Ok(path) => path,
        Err(_) => return false,
    };
    child == parent || child.starts_with(&parent)
}
