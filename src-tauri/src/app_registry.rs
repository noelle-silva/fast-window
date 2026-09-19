use std::collections::HashMap;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::Shortcut;

const REGISTRY_KEY: &str = "registeredApps";
const REGISTERED_APPS_CHANGED_EVENT: &str = "fast-window:registered-apps-changed";
const COMMAND_ICON_DATA_URL_MAX_LEN: usize = 700 * 1024;
const USER_CONFIG_KEYS: [&str; 7] = [
    "hotkey",
    "hotkeyLaunchBehavior",
    "autoStart",
    "windowX",
    "windowY",
    "windowWidth",
    "windowHeight",
];
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

/// 读取持久化登记记录（未装配展示字段）。调用方不必持锁。
fn load_persisted_app_records(app: &AppHandle) -> Result<Vec<Value>, String> {
    let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    load_persisted_app_records_locked(app)
}

/// 读取持久化登记记录（未装配展示字段）。调用方必须已持有宿主存储锁。
fn load_persisted_app_records_locked(app: &AppHandle) -> Result<Vec<Value>, String> {
    Ok(load_registry_array(app)?
        .into_iter()
        .map(without_app_runtime_declarations)
        .collect())
}

fn record_path(value: &Value) -> Option<&str> {
    value
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
}

fn non_empty_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// 判断记录里的展示字段是「用户覆盖」还是「清单旧快照」：
/// - 与当前清单一致 → 不是覆盖（读取走清单、写入剥离）
/// - 记录没有版本快照（已被写时迁移过）→ 剩下的差异只能是用户编辑 → 覆盖
/// - 记录版本与当前清单一致（清单自记录写入后未更新）→ 差异只能来自用户编辑 → 覆盖
/// - 清单已更新过（版本不同）→ 视为旧快照，按「读时最新」原则剥离
fn keep_user_override(record: &Value, manifest: &Value, key: &str) -> bool {
    let Some(record_value) = non_empty_string(record, key) else {
        return false;
    };
    let Some(manifest_value) = non_empty_string(manifest, key) else {
        return true;
    };
    if record_value == manifest_value {
        return false;
    }
    let (Some(record_version), Some(manifest_version)) = (
        non_empty_string(record, "version"),
        non_empty_string(manifest, "version"),
    ) else {
        return true;
    };
    record_version == manifest_version
}

/// 读取展示字段：用户覆盖优先，否则取清单最新值。
fn display_field(record: &Value, manifest: &Value, key: &str) -> Option<Value> {
    let source = if keep_user_override(record, manifest, key) {
        record
    } else {
        manifest
    };
    non_empty_string(source, key).map(Value::String)
}

fn manifest_view_for_exe_path(exe_path: &str) -> Option<Value> {
    let path = std::path::PathBuf::from(exe_path.trim());
    if path.as_os_str().is_empty() {
        return None;
    }
    match crate::app_installer::resolve_installed_app_info(&path) {
        Ok(Some(info)) => match serde_json::to_value(info) {
            Ok(value) => Some(value),
            Err(error) => {
                eprintln!("[app-registry] failed to serialize installed app info: {error}");
                None
            }
        },
        Ok(None) => None,
        Err(error) => {
            eprintln!(
                "[app-registry] failed to read installed app manifest at {}: {error}",
                path.display()
            );
            None
        }
    }
}

/// 命令列表是用户在注册面板里确认过的配置：记录为准，清单只在记录缺字段时补齐，
/// 不覆盖用户编辑过的名称、命令 ID、图标与快捷键。
fn merge_registered_app_commands(record: &Value, manifest: &Value) -> Value {
    let Some(record_commands) = record.get("commands").and_then(Value::as_array) else {
        return manifest
            .get("commands")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new()));
    };
    let manifest_by_id = manifest
        .get("commands")
        .and_then(Value::as_array)
        .map(|commands| {
            commands
                .iter()
                .filter_map(|command| {
                    let id = non_empty_string(command, "id")?;
                    Some((id, command.clone()))
                })
                .collect::<HashMap<String, Value>>()
        })
        .unwrap_or_default();

    let merged = record_commands
        .iter()
        .map(|command| {
            let Some(command_id) = non_empty_string(command, "id") else {
                return command.clone();
            };
            let Some(manifest_command) = manifest_by_id.get(command_id.as_str()) else {
                return command.clone();
            };
            let mut item = command.as_object().cloned().unwrap_or_default();
            if non_empty_string(command, "title").is_none() {
                if let Some(title) = non_empty_string(manifest_command, "title") {
                    item.insert("title".to_string(), Value::String(title));
                }
            }
            if non_empty_string(command, "icon").is_none()
                && non_empty_string(manifest_command, "icon").is_some()
            {
                if let Some(icon) = manifest_command.get("icon") {
                    item.insert("icon".to_string(), icon.clone());
                }
            }
            Value::Object(item)
        })
        .collect();
    Value::Array(merged)
}

fn merge_app_view(record: &Value, manifest: &Value) -> Value {
    let mut out = Map::new();
    for key in ["id", "path"] {
        if let Some(value) = record.get(key) {
            out.insert(key.to_string(), value.clone());
        }
    }

    let name = display_field(record, manifest, "name")
        .unwrap_or_else(|| Value::String(String::new()));
    out.insert("name".to_string(), name);

    let icon = display_field(record, manifest, "icon")
        .unwrap_or_else(|| Value::String(String::new()));
    out.insert("icon".to_string(), icon);

    if let Some(version) = non_empty_string(manifest, "version") {
        out.insert("version".to_string(), Value::String(version));
    }
    if let Some(app_kind) = non_empty_string(manifest, "appKind") {
        out.insert("appKind".to_string(), Value::String(app_kind));
    }

    let display_mode = display_field(record, manifest, "displayMode")
        .unwrap_or_else(|| Value::String("default".to_string()));
    out.insert("displayMode".to_string(), display_mode);
    out.insert(
        "commands".to_string(),
        merge_registered_app_commands(record, manifest),
    );

    for key in USER_CONFIG_KEYS {
        if let Some(value) = record.get(key) {
            out.insert(key.to_string(), value.clone());
        }
    }
    if !out.contains_key("autoStart") {
        out.insert("autoStart".to_string(), Value::Bool(false));
    }

    Value::Object(out)
}

fn compose_registered_app_view(record: &Value) -> Value {
    let manifest = record_path(record).and_then(manifest_view_for_exe_path);
    match manifest {
        Some(manifest) => merge_app_view(record, &manifest),
        None => {
            let mut out = record.as_object().cloned().unwrap_or_default();
            if !out.contains_key("icon") {
                out.insert("icon".to_string(), Value::String(String::new()));
            }
            if !out.contains_key("displayMode") {
                out.insert("displayMode".to_string(), Value::String("default".to_string()));
            }
            if !out.contains_key("commands") {
                out.insert("commands".to_string(), Value::Array(Vec::new()));
            }
            if !out.contains_key("autoStart") {
                out.insert("autoStart".to_string(), Value::Bool(false));
            }
            Value::Object(out)
        }
    }
}

fn extract_persisted_app_record_with_manifest(
    record: &Value,
    manifest: Option<&Value>,
) -> Result<Value, String> {
    let id = app_id_from_value(record)
        .ok_or_else(|| "appId 不能为空".to_string())?
        .to_string();
    if !crate::is_safe_id(&id) {
        return Err("appId 不合法".to_string());
    }

    let mut out = Map::new();
    out.insert("id".to_string(), Value::String(id));
    out.insert(
        "path".to_string(),
        Value::String(record_path(record).unwrap_or("").to_string()),
    );

    for key in ["name", "icon", "displayMode"] {
        let Some(value) = record.get(key) else {
            continue;
        };
        if value.is_null() {
            continue;
        }
        let keep = match manifest {
            Some(manifest) => keep_user_override(record, manifest, key),
            None => true,
        };
        if keep {
            out.insert(key.to_string(), value.clone());
        }
    }

    for key in USER_CONFIG_KEYS {
        if let Some(value) = record.get(key) {
            out.insert(key.to_string(), value.clone());
        }
    }
    if let Some(commands) = record.get("commands") {
        out.insert("commands".to_string(), commands.clone());
    }

    Ok(Value::Object(out))
}

fn extract_persisted_app_record(record: &Value) -> Result<Value, String> {
    let manifest = record_path(record).and_then(manifest_view_for_exe_path);
    extract_persisted_app_record_with_manifest(record, manifest.as_ref())
}

pub(crate) fn load_registered_app_records(app: &AppHandle) -> Result<Vec<Value>, String> {
    Ok(load_persisted_app_records(app)?
        .iter()
        .map(compose_registered_app_view)
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
    let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let mut registry = load_persisted_app_records_locked(app)?;
    if let Some(existing) = registry
        .iter_mut()
        .find(|item| app_id_from_value(item) == Some(id.as_str()))
    {
        *existing = app_record;
    } else {
        registry.push(app_record);
    }
    save_registry_and_refresh_shortcuts_locked(app, registry)
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
    let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let mut registry = load_persisted_app_records_locked(app)?;
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

    save_registry_and_refresh_shortcuts_locked(app, next)
}

fn save_registry_array(app: &AppHandle, items: &[Value]) -> Result<(), String> {
    let path = crate::storage_value_path(app, crate::APP_STORAGE_ID, REGISTRY_KEY)?;
    crate::write_json_value(&path, &Value::Array(items.to_vec()))
}

fn normalize_registry_records(registry: Vec<Value>) -> Result<Vec<Value>, String> {
    registry
        .iter()
        .map(extract_persisted_app_record)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("注册应用配置不合法: {error}"))
}

/// 保存注册表并刷新快捷键。调用方不必持锁，本函数负责整体互斥。
fn save_registry_and_refresh_shortcuts(
    app: &AppHandle,
    registry: Vec<Value>,
) -> Result<(), String> {
    let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    save_registry_and_refresh_shortcuts_locked(app, registry)
}

/// 保存注册表并刷新快捷键。
/// 调用方必须已持有宿主存储锁：保证「读-改-写」在并发下不互相覆盖。
fn save_registry_and_refresh_shortcuts_locked(
    app: &AppHandle,
    registry: Vec<Value>,
) -> Result<(), String> {
    let registry = normalize_registry_records(registry)?;
    for item in &registry {
        validate_app_value(item)?;
    }
    validate_app_host_shortcuts(&registry)?;
    validate_app_hotkeys(&registry)?;
    validate_app_hotkey_launch_behaviors(&registry)?;
    crate::app_shortcuts::validate_registered_app_shortcuts_available(app, &registry)?;

    save_registry_array(app, &registry)?;

    crate::app_shortcuts::refresh_registered_app_shortcuts_for_records(app, &registry)?;
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
    load_registered_app_records(&app)
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

    let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let registry = load_persisted_app_records_locked(&app)?;
    let next: Vec<Value> = registry
        .into_iter()
        .filter(|item| app_id_from_value(item) != Some(id.as_str()))
        .collect();
    save_registry_and_refresh_shortcuts_locked(&app, next)
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

    let lock = crate::storage_lock_for(crate::APP_STORAGE_ID);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let mut registry = load_persisted_app_records_locked(&app)?;
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
        save_registry_and_refresh_shortcuts_locked(&app, registry)?;
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

    let normalized = normalize_registry_records(
        registry
            .as_array()
            .cloned()
            .unwrap_or_default(),
    )?;
    let path = crate::storage_value_path(app, crate::APP_STORAGE_ID, REGISTRY_KEY)?;
    crate::write_json_value(&path, &Value::Array(normalized))?;

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

#[cfg(test)]
mod tests {
    use super::{
        extract_persisted_app_record_with_manifest, merge_app_view, validate_app_value,
    };
    use serde_json::{json, Value};

    fn manifest(name: &str) -> Value {
        json!({
            "id": "app-1",
            "name": name,
            "version": "2.0.0",
            "path": "C:/apps/app-1/app.exe",
            "icon": "data:image/svg+xml;base64,AAAA",
            "appKind": "desktop-app",
            "displayMode": "window",
            "commands": [
                { "id": "open", "title": "Open Latest" },
                { "id": "extra", "title": "Extra" }
            ]
        })
    }

    #[test]
    fn accepts_valid_app_ids() {
        assert!(validate_app_value(&json!({ "id": "app-1" })).is_ok());
        assert!(validate_app_value(&json!({ "id": "app 1" })).is_err());
        assert!(validate_app_value(&json!({})).is_err());
    }

    #[test]
    fn compose_view_prefers_manifest_and_keeps_user_config() {
        let record = json!({
            "id": "app-1",
            "path": "C:/apps/app-1/app.exe",
            "hotkey": "Alt+A",
            "autoStart": true,
            "commands": [{ "id": "open", "hotkey": "Alt+O" }]
        });

        let view = merge_app_view(&record, &manifest("App One"));

        assert_eq!(view["name"], "App One");
        assert_eq!(view["version"], "2.0.0");
        assert_eq!(view["appKind"], "desktop-app");
        assert_eq!(view["displayMode"], "window");
        assert_eq!(view["hotkey"], "Alt+A");
        assert_eq!(view["autoStart"], true);
        let commands = view["commands"].as_array().unwrap();
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0]["title"], "Open Latest");
        assert_eq!(commands[0]["hotkey"], "Alt+O");
    }

    #[test]
    fn compose_view_keeps_user_display_overrides() {
        let record = json!({
            "id": "app-1",
            "path": "C:/apps/app-1/app.exe",
            "name": "My Name",
            "displayMode": "top"
        });

        let view = merge_app_view(&record, &manifest("App One"));

        assert_eq!(view["name"], "My Name");
        assert_eq!(view["displayMode"], "top");
    }

    #[test]
    fn compose_view_keeps_migrated_user_overrides_without_version_snapshot() {
        let record = json!({
            "id": "app-1",
            "path": "C:/apps/app-1/app.exe",
            "name": "My Name"
        });

        let view = merge_app_view(&record, &manifest("App One"));

        assert_eq!(view["name"], "My Name");
    }

    #[test]
    fn compose_view_updates_stale_snapshot_when_manifest_renamed() {
        let record = json!({
            "id": "app-1",
            "path": "C:/apps/app-1/app.exe",
            "name": "Old Name",
            "icon": "data:image/svg+xml;base64,OLD",
            "displayMode": "top",
            "version": "1.0.0"
        });

        let view = merge_app_view(&record, &manifest("App One"));

        assert_eq!(view["name"], "App One");
        assert_eq!(view["icon"], "data:image/svg+xml;base64,AAAA");
        assert_eq!(view["displayMode"], "window");
    }

    #[test]
    fn compose_view_falls_back_to_manifest_commands_without_record_commands() {
        let record = json!({ "id": "app-1", "path": "C:/apps/app-1/app.exe" });

        let view = merge_app_view(&record, &manifest("App One"));

        let commands = view["commands"].as_array().unwrap();
        assert_eq!(commands.len(), 2);
        assert_eq!(commands[1]["title"], "Extra");
    }

    #[test]
    fn compose_view_keeps_user_edited_command_title_and_selection() {
        let record = json!({
            "id": "app-1",
            "path": "C:/apps/app-1/app.exe",
            "commands": [{ "id": "open", "title": "用户改名" }]
        });

        let view = merge_app_view(&record, &manifest("App One"));

        let commands = view["commands"].as_array().unwrap();
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0]["id"], "open");
        assert_eq!(commands[0]["title"], "用户改名");
    }

    #[test]
    fn persisted_record_strips_manifest_snapshots_and_keeps_user_config() {
        let record = json!({
            "id": "app-1",
            "path": "C:/apps/app-1/app.exe",
            "name": "App One",
            "icon": "data:image/svg+xml;base64,AAAA",
            "displayMode": "window",
            "version": "2.0.0",
            "appKind": "desktop-app",
            "hotkey": "Alt+A",
            "hotkeyLaunchBehavior": "runningOnly",
            "autoStart": true,
            "windowX": 10,
            "windowY": 20,
            "windowWidth": 800,
            "windowHeight": 600,
            "commands": [{ "id": "open", "title": "Open Latest", "hotkey": "Alt+O" }],
            "availableCommands": []
        });

        let persisted =
            extract_persisted_app_record_with_manifest(&record, Some(&manifest("App One")))
                .unwrap();
        let object = persisted.as_object().unwrap();

        assert!(!object.contains_key("name"));
        assert!(!object.contains_key("icon"));
        assert!(!object.contains_key("displayMode"));
        assert!(!object.contains_key("version"));
        assert!(!object.contains_key("appKind"));
        assert!(!object.contains_key("availableCommands"));
        assert_eq!(persisted["hotkey"], "Alt+A");
        assert_eq!(persisted["hotkeyLaunchBehavior"], "runningOnly");
        assert_eq!(persisted["autoStart"], true);
        assert_eq!(persisted["windowX"], 10);
        assert_eq!(persisted["commands"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn persisted_record_keeps_user_overrides_different_from_manifest() {
        let record = json!({
            "id": "app-1",
            "path": "C:/apps/app-1/app.exe",
            "name": "My Name",
            "displayMode": "top",
            "version": "2.0.0"
        });

        let persisted =
            extract_persisted_app_record_with_manifest(&record, Some(&manifest("App One")))
                .unwrap();

        assert_eq!(persisted["name"], "My Name");
        assert_eq!(persisted["displayMode"], "top");
        assert!(persisted.get("version").is_none());
    }

    #[test]
    fn persisted_record_strips_stale_snapshot_after_manifest_update() {
        let record = json!({
            "id": "app-1",
            "path": "C:/apps/app-1/app.exe",
            "name": "Old Name",
            "displayMode": "top",
            "version": "1.0.0"
        });

        let persisted =
            extract_persisted_app_record_with_manifest(&record, Some(&manifest("App One")))
                .unwrap();
        let object = persisted.as_object().unwrap();

        assert!(!object.contains_key("name"));
        assert!(!object.contains_key("displayMode"));
    }

    fn write_installed_test_app(root: &std::path::Path) -> std::path::PathBuf {
        let package_dir = root.join("app-1").join("package");
        std::fs::create_dir_all(&package_dir).expect("创建测试应用目录失败");
        std::fs::write(
            package_dir.join("fw-app.json"),
            r#"{
                "type": "desktop-app",
                "id": "app-1",
                "name": "Manifest Name",
                "version": "3.1.4",
                "package": { "windowsExecutable": "app-1.exe", "icon": "ICON" },
                "displayMode": "window",
                "commands": [{ "id": "open", "title": "Manifest Open" }]
            }"#,
        )
        .expect("写入清单失败");
        let exe_path = package_dir.join("app-1.exe");
        std::fs::write(&exe_path, b"").expect("写入 exe 失败");
        exe_path
    }

    #[test]
    fn compose_view_reads_latest_manifest_from_exe_path() {
        let root = std::env::temp_dir().join(format!(
            "fw-app-registry-compose-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let exe_path = write_installed_test_app(&root);

        let record = json!({
            "id": "app-1",
            "path": exe_path.to_string_lossy(),
            "hotkey": "Alt+A",
            "commands": [{ "id": "open", "hotkey": "Alt+O" }]
        });
        let view = super::compose_registered_app_view(&record);

        assert_eq!(view["name"], "Manifest Name");
        assert_eq!(view["version"], "3.1.4");
        assert_eq!(view["appKind"], "desktop-app");
        assert_eq!(view["displayMode"], "window");
        assert_eq!(view["hotkey"], "Alt+A");
        assert_eq!(view["commands"][0]["title"], "Manifest Open");
        assert_eq!(view["commands"][0]["hotkey"], "Alt+O");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn persisted_record_write_migrates_snapshot_fields_against_latest_manifest() {
        let root = std::env::temp_dir().join(format!(
            "fw-app-registry-migrate-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let exe_path = write_installed_test_app(&root);

        let legacy_record = json!({
            "id": "app-1",
            "path": exe_path.to_string_lossy(),
            "name": "Manifest Name",
            "icon": "ICON",
            "version": "3.1.4",
            "appKind": "desktop-app",
            "displayMode": "window",
            "hotkey": "Alt+A",
            "autoStart": true,
            "commands": [{ "id": "open", "title": "Manifest Open", "hotkey": "Alt+O" }]
        });
        let persisted = super::extract_persisted_app_record(&legacy_record).unwrap();

        assert_eq!(persisted["id"], "app-1");
        assert_eq!(persisted["hotkey"], "Alt+A");
        assert_eq!(persisted["autoStart"], true);
        assert_eq!(persisted["commands"][0]["hotkey"], "Alt+O");
        assert!(persisted.get("name").is_none());
        assert!(persisted.get("icon").is_none());
        assert!(persisted.get("displayMode").is_none());
        assert!(persisted.get("version").is_none());
        assert!(persisted.get("appKind").is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn persisted_record_keeps_display_fields_when_manifest_unavailable() {
        let record = json!({
            "id": "app-1",
            "path": "C:/missing/app.exe",
            "name": "My Name",
            "icon": "My Icon",
            "displayMode": "top",
            "version": "2.0.0",
            "appKind": "desktop-app"
        });

        let persisted = extract_persisted_app_record_with_manifest(&record, None).unwrap();

        assert_eq!(persisted["name"], "My Name");
        assert_eq!(persisted["icon"], "My Icon");
        assert_eq!(persisted["displayMode"], "top");
        assert!(persisted.get("version").is_none());
        assert!(persisted.get("appKind").is_none());
    }
}
