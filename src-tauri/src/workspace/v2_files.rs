use std::path::PathBuf;

use super::scope::WorkspaceScope;
use super::{paths, writable};

pub(crate) fn resolve_plugin_files_root(
    app: &tauri::AppHandle,
    plugin_id: &str,
    scope: &str,
) -> Result<PathBuf, String> {
    match WorkspaceScope::parse(scope)? {
        // 插件私有数据：data/<pluginId>（插件可在其目录内自由组织文件结构）
        WorkspaceScope::Data => Ok(paths::app_data_dir(app).join(plugin_id)),
        // 用户输出目录：可配置（新默认 data/<pluginId>/output；兼容旧目录 output-images，避免破坏用户空间）
        WorkspaceScope::Output => Ok(paths::resolve_plugin_output_dir(app, plugin_id)),
        // 用户库目录：可配置（默认 data/<pluginId>/library）
        WorkspaceScope::Library => Ok(paths::resolve_plugin_library_dir(app, plugin_id)),
    }
}

pub(crate) fn resolve_existing_file_in_scope(
    app: &tauri::AppHandle,
    plugin_id: &str,
    scope: &str,
    path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let root = resolve_plugin_files_root(app, plugin_id, scope)?;
    writable::ensure_writable_dir(&root)?;
    let root_c = std::fs::canonicalize(&root).map_err(|e| format!("文件根目录不可用: {e}"))?;

    let raw = path.trim();
    if raw.is_empty() {
        return Err("path 不能为空".to_string());
    }

    let input = PathBuf::from(raw);
    let full = if input.is_absolute() {
        input
    } else {
        let rel = crate::safe_relative_path(raw)?;
        root.join(rel)
    };
    if !full.exists() {
        return Err("文件不存在".to_string());
    }
    let full_c = std::fs::canonicalize(&full).map_err(|e| format!("文件路径无效: {e}"))?;
    if !full_c.starts_with(&root_c) {
        return Err("文件路径越界".to_string());
    }
    Ok((root_c, full_c))
}

pub(crate) fn resolve_write_path_in_scope(
    app: &tauri::AppHandle,
    plugin_id: &str,
    scope: &str,
    rel_path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let root = resolve_plugin_files_root(app, plugin_id, scope)?;
    writable::ensure_writable_dir(&root)?;
    let root_c = std::fs::canonicalize(&root).map_err(|e| format!("文件根目录不可用: {e}"))?;

    let rp = rel_path.trim();
    if rp.is_empty() {
        return Err("path 不能为空".to_string());
    }
    let rel = crate::safe_relative_path(rp)?;
    let full = root.join(rel);

    let parent = full
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| root.clone());
    std::fs::create_dir_all(&parent).map_err(|e| format!("创建目录失败: {e}"))?;
    let parent_c = std::fs::canonicalize(&parent).map_err(|e| format!("目录路径无效: {e}"))?;
    if !parent_c.starts_with(&root_c) {
        return Err("文件路径越界".to_string());
    }
    Ok((root_c, full))
}
