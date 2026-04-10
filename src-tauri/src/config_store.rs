use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

pub(crate) fn app_config_path(app: &tauri::AppHandle) -> PathBuf {
    crate::app_data_dir(app)
        .join(crate::APP_STORAGE_ID)
        .join(crate::APP_CONFIG_FILE)
}

pub(crate) fn app_config_legacy_path(app: &tauri::AppHandle) -> PathBuf {
    crate::app_data_dir(app).join(crate::APP_CONFIG_FILE)
}

pub(crate) fn app_plugin_auto_update_prefs_path(app: &tauri::AppHandle) -> PathBuf {
    crate::app_data_dir(app)
        .join(crate::APP_STORAGE_ID)
        .join(crate::PLUGIN_AUTO_UPDATE_PREFS_FILE)
}

fn read_json_map_opt(path: &Path) -> Option<Map<String, Value>> {
    if !path.is_file() {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let v = serde_json::from_str::<Value>(&content).ok()?;
    match v {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

pub(crate) fn read_app_config_map(app: &tauri::AppHandle) -> Map<String, Value> {
    let p = app_config_path(app);
    if let Some(map) = read_json_map_opt(&p) {
        return map;
    }
    let legacy = app_config_legacy_path(app);
    read_json_map_opt(&legacy).unwrap_or_else(Map::new)
}

pub(crate) fn write_app_config_map(
    app: &tauri::AppHandle,
    map: &Map<String, Value>,
) -> Result<(), String> {
    let p = app_config_path(app);
    crate::write_json_map(&p, map)
}

pub(crate) fn read_plugin_auto_update_prefs(app: &tauri::AppHandle) -> BTreeMap<String, bool> {
    let p = app_plugin_auto_update_prefs_path(app);
    let Some(map) = read_json_map_opt(&p) else {
        return BTreeMap::new();
    };

    let mut out: BTreeMap<String, bool> = BTreeMap::new();
    for (k, v) in map {
        if !crate::is_safe_id(&k) {
            continue;
        }
        if v.as_bool() == Some(true) {
            out.insert(k, true);
        }
    }
    out
}

pub(crate) fn write_plugin_auto_update_prefs(
    app: &tauri::AppHandle,
    prefs: &BTreeMap<String, bool>,
) -> Result<(), String> {
    let p = app_plugin_auto_update_prefs_path(app);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }

    let mut obj = Map::<String, Value>::new();
    for (k, v) in prefs {
        // 仅持久化 true（开启自动更新）。缺失/false 视为关闭。
        if *v {
            obj.insert(k.clone(), Value::Bool(true));
        }
    }
    let out = serde_json::to_string_pretty(&Value::Object(obj))
        .map_err(|e| format!("序列化自动更新配置失败: {e}"))?;
    std::fs::write(&p, format!("{out}\n")).map_err(|e| format!("写入自动更新配置失败: {e}"))?;
    Ok(())
}

pub(crate) fn plugin_default_output_dir(app: &tauri::AppHandle, plugin_id: &str) -> PathBuf {
    // 默认输出目录：
    // - 新用户：data/<pluginId>/output
    // - 老用户：若旧目录 data/<pluginId>/output-images 已存在，则沿用（不破坏用户空间）
    let base = crate::app_data_dir(app).join(plugin_id);
    let legacy = base.join("output-images");
    if legacy.is_dir() {
        return legacy;
    }
    base.join("output")
}

pub(crate) fn plugin_default_ref_images_dir(app: &tauri::AppHandle, plugin_id: &str) -> PathBuf {
    // 插件私有图片存放在 data/<pluginId>/ref-images（不走可配置输出目录，避免混入用户空间）
    crate::app_data_dir(app).join(plugin_id).join("ref-images")
}

pub(crate) fn plugin_default_library_dir(app: &tauri::AppHandle, plugin_id: &str) -> PathBuf {
    // 默认库目录：data/<pluginId>/library
    crate::app_data_dir(app).join(plugin_id).join("library")
}

pub(crate) fn read_plugin_output_dir_from_config(
    app: &tauri::AppHandle,
    plugin_id: &str,
) -> Option<PathBuf> {
    let map = read_app_config_map(app);
    let Some(Value::Object(obj)) = map.get(crate::PLUGIN_OUTPUT_DIRS_KEY) else {
        return None;
    };
    let Some(Value::String(s)) = obj.get(plugin_id) else {
        return None;
    };
    let raw = s.trim();
    if raw.is_empty() {
        return None;
    }
    Some(PathBuf::from(raw))
}

pub(crate) fn read_plugin_library_dir_from_config(
    app: &tauri::AppHandle,
    plugin_id: &str,
) -> Option<PathBuf> {
    let map = read_app_config_map(app);
    let Some(Value::Object(obj)) = map.get(crate::PLUGIN_LIBRARY_DIRS_KEY) else {
        return None;
    };
    let Some(Value::String(s)) = obj.get(plugin_id) else {
        return None;
    };
    let raw = s.trim();
    if raw.is_empty() {
        return None;
    }
    Some(PathBuf::from(raw))
}

pub(crate) fn write_plugin_output_dir_to_config(
    app: &tauri::AppHandle,
    plugin_id: &str,
    dir: &Path,
) -> Result<(), String> {
    let mut map = read_app_config_map(app);

    let v = map
        .entry(crate::PLUGIN_OUTPUT_DIRS_KEY.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !v.is_object() {
        *v = Value::Object(Map::new());
    }
    let obj = v.as_object_mut().unwrap();
    obj.insert(
        plugin_id.to_string(),
        Value::String(dir.to_string_lossy().to_string()),
    );

    write_app_config_map(app, &map)
}

pub(crate) fn write_plugin_library_dir_to_config(
    app: &tauri::AppHandle,
    plugin_id: &str,
    dir: &Path,
) -> Result<(), String> {
    let mut map = read_app_config_map(app);

    let v = map
        .entry(crate::PLUGIN_LIBRARY_DIRS_KEY.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !v.is_object() {
        *v = Value::Object(Map::new());
    }
    let obj = v.as_object_mut().unwrap();
    obj.insert(
        plugin_id.to_string(),
        Value::String(dir.to_string_lossy().to_string()),
    );

    write_app_config_map(app, &map)
}
