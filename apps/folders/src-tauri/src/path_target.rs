use std::{fs, path::PathBuf};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PathTargetInfo {
    kind: String,
    path: String,
    name: String,
}

#[tauri::command]
pub(crate) fn inspect_path_target(path: String) -> Result<PathTargetInfo, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }

    let path = PathBuf::from(trimmed);
    let metadata = fs::metadata(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("路径不存在: {}", path.display())
        } else {
            format!("读取路径失败: {}: {error}", path.display())
        }
    })?;

    let kind = if metadata.is_dir() {
        "folder"
    } else if metadata.is_file() {
        "file"
    } else {
        return Err("只支持文件夹路径或文件路径".to_string());
    };

    Ok(PathTargetInfo {
        kind: kind.to_string(),
        path: trimmed.to_string(),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(trimmed)
            .to_string(),
    })
}
