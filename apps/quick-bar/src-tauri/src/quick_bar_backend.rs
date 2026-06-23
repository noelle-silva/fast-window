mod host_capability;
mod registry;
#[path = "selection_observer.rs"]
pub(crate) mod selection_observer;

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::{
    data_dir,
    selection_capture::SelectionCapture,
    toolbar_display::{ToolbarDisplayMode, ToolbarDisplayModeState},
};

const DATA_SCHEMA_VERSION: u32 = 1;
const DATA_VERSION: u32 = 1;
const META_FILE: &str = "_meta.json";
const MIGRATIONS_FILE: &str = "_migrations.json";

pub(crate) struct QuickBarBackendState {
    registry_lock: Mutex<()>,
}

impl Default for QuickBarBackendState {
    fn default() -> Self {
        Self { registry_lock: Mutex::new(()) }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendHealth {
    ok: bool,
    data_dir: String,
    time: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetaDoc {
    schema_version: u32,
    data_version: u32,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MigrationsLedger {
    schema_version: u32,
    data_version: u32,
    applied: Vec<MigrationEntry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MigrationEntry {
    id: String,
    from_version: u32,
    to_version: u32,
    description: String,
    applied_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolbarButtonClickParams {
    button_id: String,
    selected_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolbarButtonClickResult {
    title: String,
    text: String,
}

pub(crate) enum ToolbarRuntimeCommand {
    None,
    Show(SelectionCapture),
    Hide,
}

pub(crate) enum ToolbarExternalAction {
    MouseDown { x: i32, y: i32 },
    MouseWheel,
    KeyDown { vk_code: i32, sys: bool },
}

pub(crate) struct ToolbarRuntimeFacts {
    pub(crate) has_active_context: bool,
    pub(crate) pointer_inside_toolbar: bool,
}

#[derive(Deserialize)]
struct HostCapabilityInvokeEnvelope {
    text: String,
}

impl QuickBarBackendState {
    pub(crate) async fn dispatch(
        &self,
        app: &tauri::AppHandle,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        ensure_ready(app)?;
        match method {
            "quickBar.health" => to_value(health(app)?),
            "quickBar.registry.list" => to_value(self.with_registry_lock(|| registry::list(app))?),
            "quickBar.registry.add" => to_value(self.with_registry_lock(|| registry::add(app, params))?),
            "quickBar.registry.remove" => {
                self.with_registry_lock(|| registry::remove(app, params))?;
                Ok(json!({ "ok": true }))
            }
            "quickBar.registry.update" => to_value(self.with_registry_lock(|| registry::update(app, params))?),
            "quickBar.capability.list" => host_capability::list(params).await,
            "quickBar.capability.invoke" => host_capability::invoke(params).await,
            "quickBar.capability.options" => host_capability::query_options(params).await,
            "quickBar.toolbar.buttonClick" => self.handle_toolbar_button_click(app, params).await,
            other => Err(format!("未知 Quick Bar 后台方法: {other}")),
        }
    }

    fn with_registry_lock<T>(&self, run: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let _guard = self
            .registry_lock
            .lock()
            .map_err(|_| "Quick Bar 后台按钮数据锁定失败".to_string())?;
        run()
    }

    async fn handle_toolbar_button_click(
        &self,
        app: &tauri::AppHandle,
        params: Value,
    ) -> Result<Value, String> {
        let input: ToolbarButtonClickParams = decode_params(params)?;
        let button_id = input.button_id.trim();
        let selected_text = input.selected_text.trim();
        if button_id.is_empty() {
            return Err("Quick Bar 按钮编号不能为空".to_string());
        }
        if selected_text.is_empty() {
            return Err("当前没有可用的划词内容".to_string());
        }
        let button = self.with_registry_lock(|| registry::find_enabled(app, button_id))?;
        let response = host_capability::invoke_for_button(&button, selected_text).await?;
        to_value(ToolbarButtonClickResult {
            title: button.title,
            text: extract_response_text(response)?,
        })
    }
}

pub(crate) fn ensure_ready(app: &tauri::AppHandle) -> Result<(), String> {
    let data_dir = data_dir::resolve_data_dir(app)?;
    data_dir::ensure_writable_dir(&data_dir)?;
    let ledger_path = data_dir.join(MIGRATIONS_FILE);
    let ledger = if ledger_path.is_file() {
        let text = std::fs::read_to_string(&ledger_path)
            .map_err(|e| format!("读取 Quick Bar 迁移记录失败: {e}"))?;
        serde_json::from_str::<MigrationsLedger>(&text)
            .map_err(|e| format!("解析 Quick Bar 迁移记录失败: {e}"))?
    } else {
        MigrationsLedger {
            schema_version: DATA_SCHEMA_VERSION,
            data_version: DATA_VERSION,
            applied: Vec::new(),
        }
    };
    if ledger.data_version > DATA_VERSION {
        return Err(format!(
            "Quick Bar 数据版本 {} 高于当前支持版本 {}",
            ledger.data_version, DATA_VERSION
        ));
    }
    let normalized = MigrationsLedger {
        schema_version: DATA_SCHEMA_VERSION,
        data_version: DATA_VERSION,
        applied: ledger.applied,
    };
    write_json(&ledger_path, &normalized)?;
    write_json(
        &data_dir.join(META_FILE),
        &MetaDoc {
            schema_version: DATA_SCHEMA_VERSION,
            data_version: DATA_VERSION,
            updated_at: now_text()?,
        },
    )
}

pub(crate) fn handle_observed_selection(
    display_mode_state: &ToolbarDisplayModeState,
    observer_state: Arc<selection_observer::SelectionObserverState>,
    capture: SelectionCapture,
) -> Result<ToolbarRuntimeCommand, String> {
    observer_state.remember_observed_selection(capture.clone())?;
    if display_mode_state.mode() == ToolbarDisplayMode::Automatic {
        return Ok(ToolbarRuntimeCommand::Show(capture));
    }
    Ok(ToolbarRuntimeCommand::None)
}

pub(crate) async fn handle_shortcut_pressed(
    observer_state: Arc<selection_observer::SelectionObserverState>,
) -> Result<ToolbarRuntimeCommand, String> {
    match observer_state.current_capture().await? {
        Some(capture) => Ok(ToolbarRuntimeCommand::Show(capture)),
        None => Ok(ToolbarRuntimeCommand::Hide),
    }
}

pub(crate) fn handle_toolbar_external_action(
    facts: ToolbarRuntimeFacts,
    action: ToolbarExternalAction,
) -> ToolbarRuntimeCommand {
    if !facts.has_active_context {
        return ToolbarRuntimeCommand::None;
    }

    match action {
        ToolbarExternalAction::MouseDown { .. } if facts.pointer_inside_toolbar => {
            ToolbarRuntimeCommand::None
        }
        ToolbarExternalAction::KeyDown { vk_code, sys } if sys || is_modifier_key(vk_code) => {
            ToolbarRuntimeCommand::None
        }
        ToolbarExternalAction::MouseWheel
        | ToolbarExternalAction::MouseDown { .. }
        | ToolbarExternalAction::KeyDown { .. } => ToolbarRuntimeCommand::Hide,
    }
}

fn health(app: &tauri::AppHandle) -> Result<BackendHealth, String> {
    let data_dir = data_dir::resolve_data_dir(app)?;
    Ok(BackendHealth {
        ok: true,
        data_dir: data_dir.display().to_string(),
        time: now_text()?,
    })
}

fn extract_response_text(value: Value) -> Result<String, String> {
    let envelope: HostCapabilityInvokeEnvelope = serde_json::from_value(value)
        .map_err(|e| format!("宿主能力响应协议错误，必须包含宿主整理后的 text 文本: {e}"))?;
    let text = envelope.text.trim().to_string();
    if text.is_empty() {
        return Err("宿主能力响应协议错误，宿主整理后的 text 文本为空".to_string());
    }
    Ok(text)
}

fn is_modifier_key(vk_code: i32) -> bool {
    matches!(vk_code, 0x10 | 0x11 | 0x12 | 0x5B | 0x5C)
}

fn to_value(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| format!("序列化 Quick Bar 后台响应失败: {e}"))
}

fn write_json(path: &std::path::Path, value: &impl Serialize) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建 Quick Bar 数据目录失败: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(value)
        .map_err(|e| format!("序列化 Quick Bar 数据失败: {e}"))?;
    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, format!("{payload}\n"))
        .map_err(|e| format!("写入 Quick Bar 数据失败: {e}"))?;
    std::fs::rename(&temp_path, path).map_err(|e| format!("保存 Quick Bar 数据失败: {e}"))
}

pub(super) fn now_text() -> Result<String, String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| format!("生成 Quick Bar 时间失败: {e}"))
}

pub(super) fn decode_params<T: for<'de> Deserialize<'de>>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|e| format!("解析 Quick Bar 后台请求失败: {e}"))
}

pub(super) fn write_backend_json(
    path: &std::path::Path,
    value: &impl Serialize,
) -> Result<(), String> {
    write_json(path, value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_host_normalized_text() {
        let text = extract_response_text(json!({ "text": " hello " })).unwrap();
        assert_eq!(text, "hello");
    }

    #[test]
    fn rejects_empty_response_text() {
        let error = extract_response_text(json!({ "text": " " })).unwrap_err();
        assert!(error.contains("text 文本为空"));
    }
}
