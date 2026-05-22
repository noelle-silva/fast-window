#[cfg(debug_assertions)]
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

#[cfg(debug_assertions)]
const DEV_SYNC_UNINSTALLED_PLUGINS_KEY: &str = "pluginDevSyncUninstalled";
const PLUGIN_ORDER_KEY: &str = "pluginOrder";
const DISABLED_PLUGINS_KEY: &str = "disabledPlugins";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginUninstallResult {
    plugin_id: String,
    deleted_data: bool,
    warnings: Vec<String>,
}

fn remove_id_from_array_value(value: Value, plugin_id: &str) -> Option<Value> {
    let Value::Array(items) = value else {
        return None;
    };

    let mut changed = false;
    let mut next = Vec::with_capacity(items.len());
    for item in items {
        if item.as_str() == Some(plugin_id) {
            changed = true;
            continue;
        }
        next.push(item);
    }

    if changed {
        Some(Value::Array(next))
    } else {
        None
    }
}

fn remove_plugin_id_from_app_array(
    app: &tauri::AppHandle,
    key: &str,
    plugin_id: &str,
) -> Result<(), String> {
    let vp = crate::storage_value_path(app, crate::APP_STORAGE_ID, key)?;
    if vp.is_file() {
        if let Some(next) = remove_id_from_array_value(crate::read_json_value(&vp)?, plugin_id) {
            crate::write_json_value(&vp, &next)?;
        }
    }

    let legacy_paths = [
        crate::storage_file_path(app, crate::APP_STORAGE_ID).ok(),
        crate::storage_flat_legacy_file_path(app, crate::APP_STORAGE_ID).ok(),
    ];

    for path in legacy_paths.into_iter().flatten() {
        if !path.is_file() {
            continue;
        }
        let Value::Object(mut map) = crate::read_json_value(&path)? else {
            continue;
        };
        let Some(value) = map.remove(key) else {
            continue;
        };
        let Some(next) = remove_id_from_array_value(value.clone(), plugin_id) else {
            map.insert(key.to_string(), value);
            continue;
        };
        map.insert(key.to_string(), next);
        crate::write_json_value(&path, &Value::Object(map))?;
    }

    Ok(())
}

fn remove_key_from_config_object(map: &mut Map<String, Value>, object_key: &str, plugin_id: &str) {
    let Some(Value::Object(obj)) = map.get_mut(object_key) else {
        return;
    };
    obj.remove(plugin_id);
    if obj.is_empty() {
        map.remove(object_key);
    }
}

fn remove_plugin_data_config(app: &tauri::AppHandle, plugin_id: &str) -> Result<(), String> {
    crate::update_app_config_map(app, |map| {
        remove_key_from_config_object(map, crate::PLUGIN_OUTPUT_DIRS_KEY, plugin_id);
        remove_key_from_config_object(map, crate::PLUGIN_LIBRARY_DIRS_KEY, plugin_id);
        Ok(())
    })
}

fn cleanup_uninstalled_plugin_metadata(
    app: &tauri::AppHandle,
    plugin_id: &str,
    delete_data: bool,
) -> Vec<String> {
    let mut warnings = Vec::new();

    if let Err(e) = remove_plugin_id_from_app_array(app, PLUGIN_ORDER_KEY, plugin_id) {
        warnings.push(format!("清理插件排序记录失败: {e}"));
    }
    if let Err(e) = remove_plugin_id_from_app_array(app, DISABLED_PLUGINS_KEY, plugin_id) {
        warnings.push(format!("清理插件禁用记录失败: {e}"));
    }

    let mut prefs = crate::read_plugin_auto_update_prefs(app);
    if prefs.remove(plugin_id).is_some() {
        if let Err(e) = crate::write_plugin_auto_update_prefs(app, &prefs) {
            warnings.push(format!("清理自动更新记录失败: {e}"));
        }
    }

    if delete_data {
        if let Err(e) = remove_plugin_data_config(app, plugin_id) {
            warnings.push(format!("清理插件数据目录配置失败: {e}"));
        }
        if let Err(e) =
            crate::wallpaper::remove_plugin_icon_override(app.clone(), plugin_id.to_string())
        {
            warnings.push(format!("清理插件自定义图标失败: {e}"));
        }
    }

    warnings
}

fn canonical_child_path(root: &Path, child: &Path, label: &str) -> Result<PathBuf, String> {
    let root_c = std::fs::canonicalize(root).map_err(|e| format!("{label}根目录不可用: {e}"))?;
    let child_c = std::fs::canonicalize(child).map_err(|e| format!("{label}路径不可用: {e}"))?;
    if child_c == root_c || !child_c.starts_with(&root_c) {
        return Err(format!("{label}路径越界"));
    }
    Ok(child_c)
}

fn move_dir_out_of_service(dir: &Path, tag: &str) -> Result<PathBuf, String> {
    let Some(parent) = dir.parent() else {
        return Err("目标目录没有父目录".to_string());
    };
    let stamp = crate::now_ms();
    let trash = parent.join(format!(".uninstalled-{tag}-{stamp}"));
    std::fs::rename(dir, &trash).map_err(|e| format!("移出插件目录失败（可能被占用）: {e}"))?;
    Ok(trash)
}

fn remove_plugin_dir(app: &tauri::AppHandle, plugin_id: &str) -> Result<Vec<String>, String> {
    let plugins_dir = crate::app_plugins_dir(app);
    std::fs::create_dir_all(&plugins_dir).map_err(|e| format!("创建插件目录失败: {e}"))?;

    let plugin_dir = plugins_dir.join(plugin_id);
    if !plugin_dir.is_dir() || !plugin_dir.join("manifest.json").is_file() {
        return Err("插件不存在或缺少 manifest.json".to_string());
    }

    let plugin_dir_c = canonical_child_path(&plugins_dir, &plugin_dir, "插件")?;
    let trash = move_dir_out_of_service(&plugin_dir_c, plugin_id)?;
    let mut warnings = Vec::new();
    if let Err(e) = std::fs::remove_dir_all(&trash) {
        warnings.push(format!(
            "插件已从列表移除，但残留目录清理失败: {} ({e})",
            trash.to_string_lossy()
        ));
    }
    Ok(warnings)
}

fn remove_plugin_data(app: &tauri::AppHandle, plugin_id: &str) -> Vec<String> {
    let lock = crate::storage_lock_for(plugin_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let mut warnings = Vec::new();

    let data_root = crate::app_data_dir(app);
    let data_dir = data_root.join(plugin_id);
    if data_dir.exists() {
        match canonical_child_path(&data_root, &data_dir, "插件数据") {
            Ok(data_dir_c) => {
                if let Err(e) = std::fs::remove_dir_all(&data_dir_c) {
                    warnings.push(format!("删除插件数据目录失败: {e}"));
                }
            }
            Err(e) => warnings.push(e),
        }
    }

    let legacy_flat = data_root.join(format!("{plugin_id}.json"));
    if legacy_flat.is_file() {
        if let Err(e) = std::fs::remove_file(&legacy_flat) {
            warnings.push(format!("删除插件旧版数据文件失败: {e}"));
        }
    }

    warnings
}

#[cfg(debug_assertions)]
pub(crate) fn dev_sync_uninstalled_plugin_ids(app: &tauri::AppHandle) -> BTreeSet<String> {
    let Ok(vp) =
        crate::storage_value_path(app, crate::APP_STORAGE_ID, DEV_SYNC_UNINSTALLED_PLUGINS_KEY)
    else {
        return BTreeSet::new();
    };
    if !vp.is_file() {
        return BTreeSet::new();
    }

    let Ok(Value::Array(items)) = crate::read_json_value(&vp) else {
        return BTreeSet::new();
    };
    items
        .into_iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .filter(|id| crate::is_safe_id(id))
        .collect()
}

#[cfg(debug_assertions)]
fn write_dev_sync_uninstalled_plugin_ids(
    app: &tauri::AppHandle,
    ids: &BTreeSet<String>,
) -> Result<(), String> {
    let vp =
        crate::storage_value_path(app, crate::APP_STORAGE_ID, DEV_SYNC_UNINSTALLED_PLUGINS_KEY)?;
    let value = Value::Array(ids.iter().cloned().map(Value::String).collect());
    crate::write_json_value(&vp, &value)
}

#[cfg(debug_assertions)]
fn remember_dev_sync_uninstalled_plugin(
    app: &tauri::AppHandle,
    plugin_id: &str,
) -> Result<(), String> {
    let mut ids = dev_sync_uninstalled_plugin_ids(app);
    ids.insert(plugin_id.to_string());
    write_dev_sync_uninstalled_plugin_ids(app, &ids)
}

#[cfg(debug_assertions)]
pub(crate) fn forget_dev_sync_uninstalled_plugin(app: &tauri::AppHandle, plugin_id: &str) {
    let mut ids = dev_sync_uninstalled_plugin_ids(app);
    if !ids.remove(plugin_id) {
        return;
    }
    let _ = write_dev_sync_uninstalled_plugin_ids(app, &ids);
}

#[cfg(not(debug_assertions))]
pub(crate) fn forget_dev_sync_uninstalled_plugin(_app: &tauri::AppHandle, _plugin_id: &str) {}

#[tauri::command]
pub(crate) fn uninstall_plugin(
    app: tauri::AppHandle,
    plugin_id: String,
    delete_data: bool,
) -> Result<PluginUninstallResult, String> {
    let plugin_id = plugin_id.trim().to_string();
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    #[cfg(debug_assertions)]
    remember_dev_sync_uninstalled_plugin(&app, &plugin_id)?;

    let mut warnings = remove_plugin_dir(&app, &plugin_id)?;
    warnings.extend(cleanup_uninstalled_plugin_metadata(
        &app,
        &plugin_id,
        delete_data,
    ));
    if delete_data {
        warnings.extend(remove_plugin_data(&app, &plugin_id));
    }

    Ok(PluginUninstallResult {
        plugin_id,
        deleted_data: delete_data,
        warnings,
    })
}
