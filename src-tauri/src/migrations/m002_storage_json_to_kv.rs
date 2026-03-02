use serde_json::Value;
use std::path::Path;

fn read_json_object(path: &Path) -> Option<serde_json::Map<String, Value>> {
    let v = crate::read_json_value(path).ok()?;
    match v {
        Value::Object(obj) => Some(obj),
        _ => None,
    }
}

pub fn needs(app: &tauri::AppHandle) -> bool {
    let plugin_ids = super::list_plugin_ids_from_data_dir(app);
    for plugin_id in plugin_ids {
        let legacy = crate::app_data_dir(app).join(&plugin_id).join("storage.json");
        if legacy.is_file() {
            return true;
        }
    }
    false
}

pub fn run(app: &tauri::AppHandle) -> Result<bool, String> {
    // 新布局按 key 拆文件：data/<pluginId>/storage/<key>.json
    // 迁移来源：data/<pluginId>/storage.json（旧 map）
    let plugin_ids = super::list_plugin_ids_from_data_dir(app);
    let mut changed = false;

    for plugin_id in plugin_ids {
        let plugin_dir = crate::app_data_dir(app).join(&plugin_id);
        let legacy = plugin_dir.join("storage.json");
        if !legacy.is_file() {
            continue;
        }

        let Some(map) = read_json_object(&legacy) else {
            // 非对象：不动它，避免误删用户文件
            continue;
        };

        let lock = crate::storage_lock_for(&plugin_id);
        let _g = lock.lock().unwrap_or_else(|e| e.into_inner());

        let mut failed = false;
        for (k, v) in &map {
            let vp = match crate::storage_value_path(app, &plugin_id, k) {
                Ok(p) => p,
                Err(_) => continue,
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
            continue;
        }

        // 自检：每个 key 都能读回 JSON（至少保证文件可解析）
        for k in map.keys() {
            let vp = match crate::storage_value_path(app, &plugin_id, k) {
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

        if failed {
            continue;
        }

        let _ = std::fs::remove_file(&legacy);
    }

    Ok(changed)
}
