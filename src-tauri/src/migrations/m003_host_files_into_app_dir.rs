use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

const APP_ID: &str = "__app";
const APP_CONFIG_FILE: &str = "app.json";
const WALLPAPER_SETTINGS_KEY: &str = "wallpaper";

fn app_dir(app: &tauri::AppHandle) -> PathBuf {
    crate::app_data_dir(app).join(APP_ID)
}

fn legacy_app_config_path(app: &tauri::AppHandle) -> PathBuf {
    crate::app_data_dir(app).join(APP_CONFIG_FILE)
}

fn app_config_path(app: &tauri::AppHandle) -> PathBuf {
    app_dir(app).join(APP_CONFIG_FILE)
}

fn legacy_wallpaper_dir(app: &tauri::AppHandle) -> PathBuf {
    crate::app_data_dir(app).join("wallpaper")
}

fn new_wallpaper_dir(app: &tauri::AppHandle) -> PathBuf {
    app_dir(app).join("wallpaper")
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))
}

fn try_move_file(src: &Path, dst: &Path) -> Result<bool, String> {
    if !src.is_file() {
        return Ok(false);
    }
    if dst.exists() {
        return Ok(false);
    }
    if let Some(parent) = dst.parent() {
        ensure_dir(parent)?;
    }

    if std::fs::rename(src, dst).is_ok() {
        return Ok(true);
    }
    std::fs::copy(src, dst).map_err(|e| format!("复制文件失败: {e}"))?;
    let _ = std::fs::remove_file(src);
    Ok(true)
}

fn merge_move_dir_no_overwrite(src: &Path, dst: &Path) -> Result<bool, String> {
    if !src.is_dir() {
        return Ok(false);
    }
    ensure_dir(dst)?;

    let mut changed = false;
    let mut stack: Vec<(PathBuf, PathBuf)> = vec![(src.to_path_buf(), dst.to_path_buf())];
    while let Some((cur_src, cur_dst)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&cur_src) else {
            continue;
        };
        for ent in rd.flatten() {
            let from = ent.path();
            let to = cur_dst.join(ent.file_name());
            let Ok(ty) = ent.file_type() else {
                continue;
            };
            if ty.is_dir() {
                stack.push((from, to));
                continue;
            }
            if !ty.is_file() {
                continue;
            }
            if to.exists() {
                continue;
            }
            if let Some(parent) = to.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if std::fs::rename(&from, &to).is_err() {
                if std::fs::copy(&from, &to).is_ok() {
                    let _ = std::fs::remove_file(&from);
                    changed = true;
                }
            } else {
                changed = true;
            }
        }
    }

    Ok(changed)
}

fn read_json_object_map(path: &Path) -> Option<Map<String, Value>> {
    let v = crate::read_json_value(path).ok()?;
    json_value_to_object_map(v)
}

fn read_json_object_map_unlocked(path: &Path) -> Option<Map<String, Value>> {
    let v = crate::json_file::read_value_unlocked(path).ok()?;
    json_value_to_object_map(v)
}

fn json_value_to_object_map(v: Value) -> Option<Map<String, Value>> {
    match v {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

fn merge_missing_keys(
    mut target: Map<String, Value>,
    legacy: Map<String, Value>,
) -> (Map<String, Value>, bool) {
    let mut changed = false;
    for (key, value) in legacy {
        if target.contains_key(&key) {
            continue;
        }
        target.insert(key, value);
        changed = true;
    }
    (target, changed)
}

fn migrate_app_config(app: &tauri::AppHandle) -> Result<bool, String> {
    let old_cfg = legacy_app_config_path(app);
    let new_cfg = app_config_path(app);
    crate::json_file::with_exclusive_path(&new_cfg, || {
        if !old_cfg.is_file() {
            return Ok(false);
        }

        ensure_dir(&app_dir(app))?;
        if !new_cfg.exists() {
            return try_move_file(&old_cfg, &new_cfg);
        }

        let Some(legacy_map) = read_json_object_map(&old_cfg) else {
            return Ok(false);
        };
        let Some(next_map) = read_json_object_map_unlocked(&new_cfg) else {
            return Ok(false);
        };

        let (next_map, changed) = merge_missing_keys(next_map, legacy_map);

        if changed {
            crate::json_file::write_pretty_unlocked(&new_cfg, &Value::Object(next_map))?;
        }
        let _ = std::fs::remove_file(&old_cfg);
        Ok(changed)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_missing_keys_preserves_existing_values() {
        let mut target = Map::new();
        target.insert(
            "wakeShortcut".to_string(),
            Value::String("control+alt+Space".to_string()),
        );

        let mut legacy = Map::new();
        legacy.insert(
            "wakeShortcut".to_string(),
            Value::String("control+shift+K".to_string()),
        );
        legacy.insert(
            "mainWindowModeShortcut".to_string(),
            Value::String("control+alt+M".to_string()),
        );

        let (merged, changed) = merge_missing_keys(target, legacy);

        assert!(changed);
        assert_eq!(
            merged.get("wakeShortcut"),
            Some(&Value::String("control+alt+Space".to_string()))
        );
        assert_eq!(
            merged.get("mainWindowModeShortcut"),
            Some(&Value::String("control+alt+M".to_string()))
        );
    }
}

fn migrate_wallpaper_config_paths(app: &tauri::AppHandle) -> Result<bool, String> {
    let vp = crate::storage_value_path(app, APP_ID, WALLPAPER_SETTINGS_KEY)?;
    if !vp.is_file() {
        return Ok(false);
    }
    let Some(mut obj) = read_json_object_map(&vp) else {
        return Ok(false);
    };

    let data_root = crate::app_data_dir(app);

    let mut changed = false;
    let update_rel = |rel: &str| -> Option<String> {
        let old_rel = rel.trim();
        if !old_rel.starts_with("wallpaper/") {
            return None;
        }
        let new_rel = format!("{APP_ID}/{old_rel}");

        let old_full = data_root.join(old_rel);
        let new_full = data_root.join(&new_rel);

        if new_full.is_file() {
            return Some(new_rel);
        }
        if old_full.is_file() {
            let _ = try_move_file(&old_full, &new_full).ok();
            if new_full.is_file() {
                return Some(new_rel);
            }
        }
        None
    };

    if let Some(Value::String(s)) = obj.get("path").cloned() {
        if let Some(next) = update_rel(&s) {
            obj.insert("path".to_string(), Value::String(next));
            changed = true;
        }
    }

    if let Some(Value::Array(arr)) = obj.get_mut("items") {
        for it in arr.iter_mut() {
            let Value::Object(it_obj) = it else {
                continue;
            };
            let Some(Value::String(p)) = it_obj.get("path").cloned() else {
                continue;
            };
            if let Some(next) = update_rel(&p) {
                it_obj.insert("path".to_string(), Value::String(next));
                changed = true;
            }
        }
    }

    if !changed {
        return Ok(false);
    }
    crate::write_json_value(&vp, &Value::Object(obj))?;
    Ok(true)
}

pub fn run(app: &tauri::AppHandle) -> Result<bool, String> {
    let mut changed = false;

    // 1) app.json：data/app.json -> data/__app/app.json；若新旧同时存在，只补齐新文件缺失字段。
    if migrate_app_config(app)? {
        changed = true;
    }

    // 2) wallpaper 文件夹：data/wallpaper -> data/__app/wallpaper（不覆盖已有文件）
    let old_wall_dir = legacy_wallpaper_dir(app);
    let new_wall_dir = new_wallpaper_dir(app);
    if merge_move_dir_no_overwrite(&old_wall_dir, &new_wall_dir)? {
        changed = true;
    }

    // 3) 更新 wallpaper 配置引用路径，并在需要时补搬单个文件
    if migrate_wallpaper_config_paths(app)? {
        changed = true;
    }

    Ok(changed)
}
