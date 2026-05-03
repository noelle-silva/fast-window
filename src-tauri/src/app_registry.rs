use std::collections::HashMap;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::Shortcut;

const REGISTRY_KEY: &str = "registeredApps";
const REGISTERED_APPS_CHANGED_EVENT: &str = "fast-window:registered-apps-changed";
const HIDDEN_POSITION_THRESHOLD: i32 = -9_000;
const MAX_ABS_POSITION: i32 = 100_000;
const MIN_WINDOW_WIDTH: u32 = 200;
const MIN_WINDOW_HEIGHT: u32 = 150;
const MAX_WINDOW_SIZE: u32 = 20_000;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppWindowBounds {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

impl AppWindowBounds {
    pub(crate) fn from_value(value: &Value) -> Option<Self> {
        let x = i32::try_from(value.get("x")?.as_i64()?).ok()?;
        let y = i32::try_from(value.get("y")?.as_i64()?).ok()?;
        let width = u32::try_from(value.get("width")?.as_u64()?).ok()?;
        let height = u32::try_from(value.get("height")?.as_u64()?).ok()?;
        let bounds = Self {
            x,
            y,
            width,
            height,
        };
        bounds.is_valid().then_some(bounds)
    }

    fn is_valid(self) -> bool {
        if self.x <= HIDDEN_POSITION_THRESHOLD || self.y <= HIDDEN_POSITION_THRESHOLD {
            return false;
        }
        if self.x.abs() > MAX_ABS_POSITION || self.y.abs() > MAX_ABS_POSITION {
            return false;
        }
        if self.width < MIN_WINDOW_WIDTH || self.height < MIN_WINDOW_HEIGHT {
            return false;
        }
        self.width <= MAX_WINDOW_SIZE && self.height <= MAX_WINDOW_SIZE
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisteredAppsChangedPayload {
    app_id: String,
    reason: &'static str,
    window_bounds: AppWindowBounds,
}

fn emit_registry_changed(app: &AppHandle) {
    let _ = app.emit(
        REGISTERED_APPS_CHANGED_EVENT,
        serde_json::json!({ "reason": "registryChanged" }),
    );
}

fn load_registry_array(app: &AppHandle) -> Result<Vec<Value>, String> {
    match load_registry_value(app)? {
        Value::Array(items) => Ok(items),
        _ => Ok(Vec::new()),
    }
}

pub(crate) fn load_registered_app_records(app: &AppHandle) -> Result<Vec<Value>, String> {
    let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    load_registry_array(app)
}

pub(crate) fn load_registered_app_record(
    app: &AppHandle,
    app_id: &str,
) -> Result<Option<Value>, String> {
    let id = app_id.trim();
    if !crate::is_safe_id(id) {
        return Err("appId 不合法".to_string());
    }

    Ok(load_registered_app_records(app)?
        .into_iter()
        .find(|item| app_id_from_value(item) == Some(id)))
}

fn save_registry_array(app: &AppHandle, items: Vec<Value>) -> Result<(), String> {
    let path = crate::storage_value_path(app, crate::APP_STORAGE_ID, REGISTRY_KEY)?;
    crate::write_json_value(&path, &Value::Array(items))
}

fn save_registry_and_refresh_shortcuts(app: &AppHandle, registry: Vec<Value>) -> Result<(), String> {
    for item in &registry {
        validate_app_value(item)?;
    }
    validate_app_hotkeys(&registry)?;
    validate_app_commands(&registry)?;
    crate::app_shortcuts::validate_registered_app_shortcuts_available(app, &registry)?;

    {
        let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        save_registry_array(app, registry)?;
    }

    crate::app_shortcuts::refresh_registered_app_shortcuts(app)?;
    emit_registry_changed(app);
    Ok(())
}

fn app_id_from_value(value: &Value) -> Option<&str> {
    value
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
}

fn validate_app_value(value: &Value) -> Result<String, String> {
    let id = app_id_from_value(value).ok_or_else(|| "appId 不能为空".to_string())?;
    if !crate::is_safe_id(id) {
        return Err("appId 不合法".to_string());
    }
    Ok(id.to_string())
}

fn app_hotkey_from_value(value: &Value) -> Option<&str> {
    value
        .get("hotkey")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|hotkey| !hotkey.is_empty())
}

fn validate_app_hotkeys(apps: &[Value]) -> Result<(), String> {
    let mut seen: HashMap<String, String> = HashMap::new();
    for item in apps {
        let app_id = app_id_from_value(item).unwrap_or("");
        let Some(raw_hotkey) = app_hotkey_from_value(item) else {
            continue;
        };
        let shortcut = Shortcut::from_str(raw_hotkey)
            .map_err(|e| format!("{app_id} 的快捷键格式不合法: {e}"))?;
        let normalized = shortcut.to_string();
        if let Some(existing_app_id) = seen.insert(normalized.clone(), app_id.to_string()) {
            return Err(format!(
                "快捷键重复: {normalized}（{existing_app_id} 和 {app_id}）"
            ));
        }
    }
    Ok(())
}

fn validate_app_commands(apps: &[Value]) -> Result<(), String> {
    for item in apps {
        let app_id = app_id_from_value(item).unwrap_or("");
        let Some(commands) = item.get("commands").and_then(Value::as_array) else {
            continue;
        };

        let mut seen: HashMap<String, ()> = HashMap::new();
        for command in commands {
            let command_id = command
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .ok_or_else(|| format!("{app_id} 的命令 ID 不能为空"))?;
            if !crate::is_safe_id(command_id) {
                return Err(format!("{app_id} 的命令 ID 不合法: {command_id}"));
            }
            let title = command
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .ok_or_else(|| format!("{app_id} 的命令名称不能为空"))?;
            if seen.insert(command_id.to_string(), ()).is_some() {
                return Err(format!("{app_id} 的命令 ID 重复: {command_id}"));
            }
            if title.len() > 80 {
                return Err(format!("{app_id} 的命令名称过长: {title}"));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn app_registry_load(app: AppHandle) -> Result<Vec<Value>, String> {
    let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    load_registry_array(&app)
}

#[tauri::command]
pub(crate) fn app_registry_save(app: AppHandle, apps: Vec<Value>) -> Result<(), String> {
    save_registry_and_refresh_shortcuts(&app, apps)
}

#[tauri::command]
pub(crate) fn app_registry_add(app: AppHandle, app_record: Value) -> Result<(), String> {
    let id = validate_app_value(&app_record)?;
    let mut registry = load_registered_app_records(&app)?;
    if let Some(existing) = registry
        .iter_mut()
        .find(|item| app_id_from_value(item) == Some(id.as_str()))
    {
        *existing = app_record;
    } else {
        registry.push(app_record);
    }
    save_registry_and_refresh_shortcuts(&app, registry)
}

#[tauri::command]
pub(crate) fn app_registry_remove(app: AppHandle, app_id: String) -> Result<(), String> {
    let id = app_id.trim().to_string();
    if !crate::is_safe_id(&id) {
        return Err("appId 不合法".to_string());
    }

    let registry = load_registered_app_records(&app)?;
    let next: Vec<Value> = registry
        .into_iter()
        .filter(|item| app_id_from_value(item) != Some(id.as_str()))
        .collect();
    save_registry_and_refresh_shortcuts(&app, next)
}

#[tauri::command]
pub(crate) fn app_registry_update(
    app: AppHandle,
    app_id: String,
    patch: Map<String, Value>,
) -> Result<(), String> {
    let id = app_id.trim().to_string();
    if !crate::is_safe_id(&id) {
        return Err("appId 不合法".to_string());
    }

    let mut registry = load_registered_app_records(&app)?;
    let mut changed = false;
    for item in &mut registry {
        if app_id_from_value(item) != Some(id.as_str()) {
            continue;
        }
        let Some(record) = item.as_object_mut() else {
            continue;
        };
        for (key, value) in patch {
            if key == "id" {
                continue;
            }
            if value.is_null() {
                record.remove(&key);
                continue;
            }
            record.insert(key, value);
        }
        changed = true;
        break;
    }
    if changed {
        save_registry_and_refresh_shortcuts(&app, registry)?;
    }
    Ok(())
}

fn load_registry_value(app: &AppHandle) -> Result<Value, String> {
    let path = crate::storage_value_path(app, crate::APP_STORAGE_ID, REGISTRY_KEY)?;
    if path.is_file() {
        return crate::read_json_value(&path);
    }
    Ok(
        crate::read_legacy_storage_value(app, crate::APP_STORAGE_ID, REGISTRY_KEY)
            .unwrap_or_else(|| Value::Array(Vec::new())),
    )
}

fn app_bounds_unchanged(app: &Map<String, Value>, bounds: AppWindowBounds) -> bool {
    app.get("windowX").and_then(Value::as_i64) == Some(bounds.x as i64)
        && app.get("windowY").and_then(Value::as_i64) == Some(bounds.y as i64)
        && app.get("windowWidth").and_then(Value::as_u64) == Some(bounds.width as u64)
        && app.get("windowHeight").and_then(Value::as_u64) == Some(bounds.height as u64)
}

fn update_app_bounds(app: &mut Map<String, Value>, bounds: AppWindowBounds) {
    app.insert("windowX".to_string(), Value::from(bounds.x));
    app.insert("windowY".to_string(), Value::from(bounds.y));
    app.insert("windowWidth".to_string(), Value::from(bounds.width));
    app.insert("windowHeight".to_string(), Value::from(bounds.height));
}

pub(crate) fn persist_app_window_bounds(
    app: &AppHandle,
    app_id: &str,
    bounds: AppWindowBounds,
) -> Result<bool, String> {
    if !crate::is_safe_id(app_id) {
        return Err("appId 不合法".to_string());
    }
    if !bounds.is_valid() {
        return Ok(false);
    }

    let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let mut registry = load_registry_value(app)?;
    let Value::Array(items) = &mut registry else {
        return Ok(false);
    };

    let mut changed = false;
    for item in items {
        let Some(app_record) = item.as_object_mut() else {
            continue;
        };
        if app_record.get("id").and_then(Value::as_str) != Some(app_id) {
            continue;
        }
        if app_bounds_unchanged(app_record, bounds) {
            return Ok(false);
        }
        update_app_bounds(app_record, bounds);
        changed = true;
        break;
    }

    if !changed {
        return Ok(false);
    }

    let path = crate::storage_value_path(app, crate::APP_STORAGE_ID, REGISTRY_KEY)?;
    crate::write_json_value(&path, &registry)?;

    let _ = app.emit(
        REGISTERED_APPS_CHANGED_EVENT,
        RegisteredAppsChangedPayload {
            app_id: app_id.to_string(),
            reason: "windowBoundsChanged",
            window_bounds: bounds,
        },
    );

    Ok(true)
}
