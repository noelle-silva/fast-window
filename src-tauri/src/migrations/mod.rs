use serde_json::Value;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

mod m001_flat_json_to_storage_json;
mod m002_storage_json_to_kv;

fn stamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis()
}

fn migrations_state_path(app: &tauri::AppHandle) -> PathBuf {
    crate::app_data_dir(app)
        .join(".meta")
        .join("migrations.json")
}

fn read_applied(app: &tauri::AppHandle) -> BTreeSet<String> {
    let path = migrations_state_path(app);
    let Ok(v) = crate::read_json_value(&path) else {
        return BTreeSet::new();
    };
    let Some(arr) = v.get("applied").and_then(|x| x.as_array()) else {
        return BTreeSet::new();
    };
    arr.iter()
        .filter_map(|it| it.as_str().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect()
}

fn write_applied(app: &tauri::AppHandle, applied: &BTreeSet<String>) -> Result<(), String> {
    let path = migrations_state_path(app);
    let arr: Vec<Value> = applied.iter().map(|s| Value::String(s.clone())).collect();
    let mut obj = serde_json::Map::new();
    obj.insert("applied".to_string(), Value::Array(arr));
    crate::write_json_value(&path, &Value::Object(obj))
}

fn backup_root(app: &tauri::AppHandle, migration_id: &str, stamp: u128) -> PathBuf {
    crate::app_data_dir(app)
        .join(".backup")
        .join("migrations")
        .join(migration_id)
        .join(format!("{stamp}"))
}

fn ensure_parent(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn backup_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    ensure_parent(dst)?;
    std::fs::copy(src, dst)?;
    Ok(())
}

fn list_plugin_ids_from_data_dir(app: &tauri::AppHandle) -> Vec<String> {
    let root = crate::app_data_dir(app);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return vec![];
    };
    let mut out: Vec<String> = Vec::new();
    for e in entries.flatten() {
        let Ok(ty) = e.file_type() else {
            continue;
        };
        if !ty.is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if crate::is_safe_id(&name) {
            out.push(name);
        }
    }
    out.sort();
    out
}

fn run_one(
    app: &tauri::AppHandle,
    id: &str,
    applied: &mut BTreeSet<String>,
    needs: fn(&tauri::AppHandle) -> bool,
    f: fn(&tauri::AppHandle) -> Result<bool, String>,
) {
    if !needs(app) {
        if !applied.contains(id) {
            applied.insert(id.to_string());
            let _ = write_applied(app, applied);
        }
        return;
    }
    match f(app) {
        Ok(_) => {
            if !needs(app) {
                applied.insert(id.to_string());
                let _ = write_applied(app, applied);
            }
        }
        Err(e) => {
            eprintln!("[migration] {id} failed: {e}");
        }
    }
}

pub fn run_all(app: &tauri::AppHandle) {
    let mut applied = read_applied(app);
    run_one(
        app,
        "m001-flat-json-to-storage-json",
        &mut applied,
        m001_flat_json_to_storage_json::needs,
        m001_flat_json_to_storage_json::run,
    );
    run_one(
        app,
        "m002-storage-json-to-kv",
        &mut applied,
        m002_storage_json_to_kv::needs,
        m002_storage_json_to_kv::run,
    );
}

