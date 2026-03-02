use serde_json::Value;
use std::path::{Path, PathBuf};

mod m003_host_files_into_app_dir;

fn legacy_flat_json_path(app: &tauri::AppHandle, plugin_id: &str) -> PathBuf {
    crate::app_data_dir(app).join(format!("{plugin_id}.json"))
}

fn legacy_storage_json_path(app: &tauri::AppHandle, plugin_id: &str) -> PathBuf {
    crate::app_data_dir(app).join(plugin_id).join("storage.json")
}

fn read_json_object(path: &Path) -> Option<serde_json::Map<String, Value>> {
    let v = crate::read_json_value(path).ok()?;
    match v {
        Value::Object(obj) => Some(obj),
        _ => None,
    }
}

/// 仅迁移单个插件的存储布局（幂等、可重复执行）。
///
/// - 旧1：`data/<pluginId>.json`
/// - 旧2：`data/<pluginId>/storage.json`（对象 map）
/// - 新：`data/<pluginId>/storage/<key>.json`
pub fn migrate_plugin_storage(app: &tauri::AppHandle, plugin_id: &str) -> Result<bool, String> {
    if !crate::is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let lock = crate::storage_lock_for(plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());

    let mut changed = false;

    // 旧1 -> 旧2：data/<pluginId>.json => data/<pluginId>/storage.json（不覆盖已有 storage.json）
    let old_flat = legacy_flat_json_path(app, plugin_id);
    let old_storage_json = legacy_storage_json_path(app, plugin_id);
    if old_flat.is_file() && !old_storage_json.is_file() {
        if let Some(parent) = old_storage_json.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建迁移目录失败: {e}"))?;
        }
        if std::fs::rename(&old_flat, &old_storage_json).is_err() {
            std::fs::copy(&old_flat, &old_storage_json)
                .map_err(|e| format!("迁移 storage.json 失败: {e}"))?;
            let _ = std::fs::remove_file(&old_flat);
        }
        changed = true;
    }

    // 旧2 -> 新：storage.json（对象）拆分为 storage/<key>.json；成功后删除旧文件
    if old_storage_json.is_file() {
        let Some(map) = read_json_object(&old_storage_json) else {
            // 非对象：不动它，避免误删用户文件
            return Ok(changed);
        };

        let mut failed = false;
        let mut has_unmappable_key = false;

        for (k, v) in &map {
            let vp = match crate::storage_value_path(app, plugin_id, k) {
                Ok(p) => p,
                Err(_) => {
                    has_unmappable_key = true;
                    continue;
                }
            };

            if vp.is_file() {
                let same = crate::read_json_value(&vp).ok().as_ref() == Some(v);
                if same {
                    continue;
                }
            }

            if crate::write_json_value(&vp, v).is_err() {
                failed = true;
                break;
            }
            changed = true;
        }

        if failed {
            return Ok(changed);
        }

        // 自检：每个 key 都能读回 JSON（至少保证文件可解析）
        for k in map.keys() {
            let vp = match crate::storage_value_path(app, plugin_id, k) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if !vp.is_file() {
                failed = true;
                break;
            }
            if crate::read_json_value(&vp).is_err() {
                failed = true;
                break;
            }
        }

        if failed || has_unmappable_key {
            // 有 key 无法映射到安全路径时，不删除旧文件，避免丢数据。
            return Ok(changed);
        }

        let _ = std::fs::remove_file(&old_storage_json);
        changed = true;
    }

    Ok(changed)
}

/// 宿主数据迁移（不触碰插件数据）。
///
/// - `data/app.json` -> `data/__app/app.json`
/// - `data/wallpaper/*` -> `data/__app/wallpaper/*`
/// - 更新 wallpaper 配置中的相对路径（`wallpaper/...` -> `__app/wallpaper/...`）
pub fn migrate_host_files_into_app_dir(app: &tauri::AppHandle) -> Result<bool, String> {
    m003_host_files_into_app_dir::run(app)
}
