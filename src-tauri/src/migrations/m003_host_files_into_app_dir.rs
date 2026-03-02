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
    match v {
        Value::Object(map) => Some(map),
        _ => None,
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

    // 1) app.json：data/app.json -> data/__app/app.json
    let old_cfg = legacy_app_config_path(app);
    let new_cfg = app_config_path(app);
    if old_cfg.is_file() && !new_cfg.exists() {
        ensure_dir(&app_dir(app))?;
        if try_move_file(&old_cfg, &new_cfg)? {
            changed = true;
        }
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
