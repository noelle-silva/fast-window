use std::collections::HashMap;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::Shortcut;

const REGISTRY_KEY: &str = "registeredApps";
const REGISTERED_APPS_CHANGED_EVENT: &str = "fast-window:registered-apps-changed";
const COMMAND_ICON_DATA_URL_MAX_LEN: usize = 700 * 1024;
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppRuntimeDeclaration {
    pub(crate) id: String,
    pub(crate) title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) hotkey: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) config_fields: Vec<AppCapabilityConfigField>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityConfigField {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) option_source: String,
}

#[derive(Clone, Debug)]
struct AppCapabilityConfigFieldInput {
    id: Option<String>,
    label: Option<String>,
    option_source: Option<String>,
}

impl From<AppCapabilityConfigField> for AppCapabilityConfigFieldInput {
    fn from(field: AppCapabilityConfigField) -> Self {
        Self {
            id: Some(field.id),
            label: Some(field.label),
            option_source: Some(field.option_source),
        }
    }
}

fn without_app_runtime_declarations(mut value: Value) -> Value {
    if let Some(record) = value.as_object_mut() {
        record.remove("availableCommands");
        record.remove("capabilities");
        record.remove("hostShortcuts");
    }
    value
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
    Ok(load_registry_array(app)?
        .into_iter()
        .map(without_app_runtime_declarations)
        .collect())
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

pub(crate) fn upsert_registered_app_record(
    app: &AppHandle,
    app_record: Value,
) -> Result<(), String> {
    let id = validate_app_value(&app_record)?;
    let mut registry = load_registered_app_records(app)?;
    if let Some(existing) = registry
        .iter_mut()
        .find(|item| app_id_from_value(item) == Some(id.as_str()))
    {
        *existing = app_record;
    } else {
        registry.push(app_record);
    }
    save_registry_and_refresh_shortcuts(app, registry)
}

pub(crate) fn replace_registered_app_record(
    app: &AppHandle,
    previous_id: &str,
    app_record: Value,
) -> Result<(), String> {
    let previous_id = previous_id.trim();
    if !crate::is_safe_id(previous_id) {
        return Err("previousAppId 不合法".to_string());
    }

    let next_id = validate_app_value(&app_record)?;
    let mut registry = load_registered_app_records(app)?;
    let mut replaced = false;
    let mut next = Vec::with_capacity(registry.len());

    for item in registry.drain(..) {
        let item_id = app_id_from_value(&item);
        if item_id == Some(previous_id) {
            if !replaced {
                next.push(app_record.clone());
                replaced = true;
            }
            continue;
        }
        if item_id == Some(next_id.as_str()) {
            continue;
        }
        next.push(item);
    }

    if !replaced {
        next.push(app_record);
    }

    save_registry_and_refresh_shortcuts(app, next)
}

fn save_registry_array(app: &AppHandle, items: Vec<Value>) -> Result<(), String> {
    let path = crate::storage_value_path(app, crate::APP_STORAGE_ID, REGISTRY_KEY)?;
    crate::write_json_value(&path, &Value::Array(items))
}

fn save_registry_and_refresh_shortcuts(
    app: &AppHandle,
    registry: Vec<Value>,
) -> Result<(), String> {
    let registry: Vec<Value> = registry
        .into_iter()
        .map(without_app_runtime_declarations)
        .collect();
    for item in &registry {
        validate_app_value(item)?;
    }
    validate_app_host_shortcuts(&registry)?;
    validate_app_hotkeys(&registry)?;
    validate_app_hotkey_launch_behaviors(&registry)?;
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
        if let Some(raw_hotkey) = app_hotkey_from_value(item) {
            register_unique_shortcut(
                &mut seen,
                raw_hotkey,
                format!("{app_id} 的应用快捷键"),
                format!("{app_id} 的快捷键格式不合法"),
            )?;
        }

        let Some(commands) = item.get("commands").and_then(Value::as_array) else {
            continue;
        };
        for command in commands {
            let command_id = command
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            let Some(raw_hotkey) = command_hotkey_from_value(command) else {
                continue;
            };
            register_unique_shortcut(
                &mut seen,
                raw_hotkey,
                format!("{app_id}/{command_id} 的宿主快捷命令快捷键"),
                format!("{app_id}/{command_id} 的宿主快捷命令快捷键格式不合法"),
            )?;
        }
    }
    Ok(())
}

fn command_hotkey_from_value(command: &Value) -> Option<&str> {
    command
        .get("hotkey")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|hotkey| !hotkey.is_empty())
}

fn register_unique_shortcut(
    seen: &mut HashMap<String, String>,
    raw_hotkey: &str,
    owner: String,
    invalid_message: String,
) -> Result<(), String> {
    let shortcut = Shortcut::from_str(raw_hotkey).map_err(|e| format!("{invalid_message}: {e}"))?;
    let normalized = shortcut.to_string();
    if let Some(existing_owner) = seen.insert(normalized.clone(), owner.clone()) {
        return Err(format!(
            "快捷键重复: {normalized}（{existing_owner} 和 {owner}）"
        ));
    }
    Ok(())
}

fn validate_app_hotkey_launch_behaviors(apps: &[Value]) -> Result<(), String> {
    for item in apps {
        let app_id = app_id_from_value(item).unwrap_or("");
        let Some(behavior) = item
            .get("hotkeyLaunchBehavior")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|behavior| !behavior.is_empty())
        else {
            continue;
        };
        if !matches!(behavior, "launch" | "runningOnly") {
            return Err(format!("{app_id} 的快捷键启动方式不合法: {behavior}"));
        }
    }
    Ok(())
}

fn validate_app_host_shortcuts(apps: &[Value]) -> Result<(), String> {
    for item in apps {
        let app_id = app_id_from_value(item).unwrap_or("");
        validate_host_shortcut_array(app_id, item.get("commands"), "宿主快捷命令")?;
    }
    Ok(())
}

fn validate_host_shortcut_array(
    app_id: &str,
    value: Option<&Value>,
    label: &str,
) -> Result<(), String> {
    let Some(commands) = value.and_then(Value::as_array) else {
        return Ok(());
    };

    let mut seen: HashMap<String, ()> = HashMap::new();
    for command in commands {
        let command_id = command
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| format!("{app_id} 的{label} ID 不能为空"))?;
        if !crate::is_safe_id(command_id) {
            return Err(format!("{app_id} 的{label} ID 不合法: {command_id}"));
        }
        let title = command
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .ok_or_else(|| format!("{app_id} 的{label}名称不能为空"))?;
        if seen.insert(command_id.to_string(), ()).is_some() {
            return Err(format!("{app_id} 的{label} ID 重复: {command_id}"));
        }
        if title.len() > 80 {
            return Err(format!("{app_id} 的{label}名称过长: {title}"));
        }
        validate_declaration_description(command.get("description"), app_id, label, command_id)?;
        validate_declaration_config_fields(command.get("configFields"), app_id, label, command_id)?;
        validate_host_shortcut_icon(command.get("icon"), app_id, label, command_id)?;
        if let Some(raw_hotkey) = command_hotkey_from_value(command) {
            Shortcut::from_str(raw_hotkey)
                .map_err(|e| format!("{app_id} 的{label}快捷键格式不合法: {e}"))?;
        }
    }
    Ok(())
}

fn validate_declaration_description(
    value: Option<&Value>,
    app_id: &str,
    label: &str,
    command_id: &str,
) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    let Some(description) = value.as_str().map(str::trim) else {
        return Err(format!("{app_id} 的{label}说明必须是字符串: {command_id}"));
    };
    if description.len() > 240 {
        return Err(format!("{app_id} 的{label}说明过长: {command_id}"));
    }
    Ok(())
}

fn validate_declaration_config_fields(
    value: Option<&Value>,
    app_id: &str,
    label: &str,
    command_id: &str,
) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    let Some(fields) = value.as_array() else {
        return Err(format!("{app_id} 的{label}配置项必须是数组: {command_id}"));
    };
    let fields = fields
        .iter()
        .map(config_field_input_from_value)
        .collect::<Vec<_>>();
    let message_subject = format!("{app_id} 的{label}");
    normalize_config_field_inputs(&message_subject, command_id, fields)?;
    Ok(())
}

fn config_field_input_from_value(value: &Value) -> AppCapabilityConfigFieldInput {
    AppCapabilityConfigFieldInput {
        id: value.get("id").and_then(Value::as_str).map(str::to_string),
        label: value
            .get("label")
            .and_then(Value::as_str)
            .map(str::to_string),
        option_source: value
            .get("optionSource")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn normalize_config_field_inputs(
    message_subject: &str,
    command_id: &str,
    fields: Vec<AppCapabilityConfigFieldInput>,
) -> Result<Vec<Value>, String> {
    let mut seen: HashMap<String, ()> = HashMap::new();
    let mut normalized = Vec::with_capacity(fields.len());
    for field in fields {
        let id = field
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| format!("{message_subject}配置项 ID 不能为空: {command_id}"))?
            .to_string();
        if !crate::is_safe_id(&id) {
            return Err(format!(
                "{message_subject}配置项 ID 不合法: {command_id}/{id}"
            ));
        }
        if seen.insert(id.clone(), ()).is_some() {
            return Err(format!(
                "{message_subject}配置项 ID 重复: {command_id}/{id}"
            ));
        }
        let field_label = field
            .label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .ok_or_else(|| format!("{message_subject}配置项名称不能为空: {command_id}/{id}"))?
            .to_string();
        if field_label.len() > 80 {
            return Err(format!(
                "{message_subject}配置项名称过长: {command_id}/{id}"
            ));
        }
        let option_source = field
            .option_source
            .as_deref()
            .map(str::trim)
            .filter(|source| !source.is_empty())
            .ok_or_else(|| format!("{message_subject}配置项选项来源不能为空: {command_id}/{id}"))?
            .to_string();
        if !crate::is_safe_id(&option_source) {
            return Err(format!(
                "{message_subject}配置项选项来源不合法: {command_id}/{id}"
            ));
        }
        normalized.push(serde_json::json!({
            "id": id,
            "label": field_label,
            "optionSource": option_source,
        }));
    }
    Ok(normalized)
}

fn validate_host_shortcut_icon(
    value: Option<&Value>,
    app_id: &str,
    label: &str,
    command_id: &str,
) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    let Some(icon) = value
        .as_str()
        .map(str::trim)
        .filter(|icon| !icon.is_empty())
    else {
        return Err(format!("{app_id} 的{label}图标必须是字符串: {command_id}"));
    };
    if icon.starts_with("data:image/") && icon.len() > COMMAND_ICON_DATA_URL_MAX_LEN {
        return Err(format!("{app_id} 的{label}图标过大: {command_id}"));
    }
    if is_valid_host_shortcut_icon(icon) {
        return Ok(());
    }
    Err(format!("{app_id} 的{label}图标不合法: {command_id}"))
}

fn is_short_icon_text(icon: &str) -> bool {
    icon.len() <= 8
        && !icon.contains('/')
        && !icon.contains('\\')
        && !icon.contains('.')
        && !icon.contains(':')
}

fn is_valid_host_shortcut_icon(icon: &str) -> bool {
    if icon.starts_with("data:image/") {
        return icon.len() <= COMMAND_ICON_DATA_URL_MAX_LEN;
    }
    is_short_icon_text(icon)
}

#[tauri::command]
pub(crate) fn app_registry_load(app: AppHandle) -> Result<Vec<Value>, String> {
    let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    Ok(load_registry_array(&app)?
        .into_iter()
        .map(without_app_runtime_declarations)
        .collect())
}

#[tauri::command]
pub(crate) fn app_registry_save(app: AppHandle, apps: Vec<Value>) -> Result<(), String> {
    save_registry_and_refresh_shortcuts(&app, apps)
}

#[tauri::command]
pub(crate) fn app_registry_add(app: AppHandle, app_record: Value) -> Result<(), String> {
    upsert_registered_app_record(&app, app_record)
}

#[tauri::command]
pub(crate) fn app_registry_replace(
    app: AppHandle,
    previous_app_id: String,
    app_record: Value,
) -> Result<(), String> {
    replace_registered_app_record(&app, &previous_app_id, app_record)
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
