use std::path::Path;

use super::paths::resolve_plugin_output_dir;

pub(crate) fn open_plugin_output_dir(
    app: &tauri::AppHandle,
    plugin_id: &str,
) -> Result<(), String> {
    let dir = resolve_plugin_output_dir(app, plugin_id);
    crate::open_dir_in_file_manager(&dir)
}

pub(crate) fn open_absolute_existing_dir(dir: &Path) -> Result<(), String> {
    if !dir.is_absolute() {
        return Err("dir 必须是绝对路径".to_string());
    }
    if !dir.exists() {
        return Err("目录不存在".to_string());
    }
    if !dir.is_dir() {
        return Err("路径不是目录".to_string());
    }
    crate::open_dir_in_file_manager(dir)
}
