use std::path::PathBuf;

use super::writable::ensure_writable_dir;
use tauri::Manager;

pub(crate) fn app_local_base_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Some(p) = crate::portable_base_dir_from_env() {
        return p;
    }

    // 便携优先：exe 同目录（比 cwd 稳定）。但 MSI 默认装在 Program Files，不可写时退回到 AppData。
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if crate::is_dir_writable(dir) {
                return dir.to_path_buf();
            }
        }
    }

    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default())
}

pub(crate) fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app_local_base_dir(app).join("data")
}

pub(crate) fn app_plugins_dir(app: &tauri::AppHandle) -> PathBuf {
    app_local_base_dir(app).join("plugins")
}

pub(crate) fn resolve_plugin_output_dir(app: &tauri::AppHandle, plugin_id: &str) -> PathBuf {
    // 配置优先；若不可用则回退到默认目录（避免破坏用户空间）
    if let Some(p) = crate::config_store::read_plugin_output_dir_from_config(app, plugin_id) {
        if ensure_writable_dir(&p).is_ok() {
            return p;
        }
    }
    crate::config_store::plugin_default_output_dir(app, plugin_id)
}

pub(crate) fn resolve_plugin_library_dir(app: &tauri::AppHandle, plugin_id: &str) -> PathBuf {
    // 配置优先；若不可用则回退到默认目录（避免破坏用户空间）
    if let Some(p) = crate::config_store::read_plugin_library_dir_from_config(app, plugin_id) {
        if ensure_writable_dir(&p).is_ok() {
            return p;
        }
    }
    crate::config_store::plugin_default_library_dir(app, plugin_id)
}
