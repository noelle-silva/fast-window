use serde::Serialize;
use tauri::{Emitter, EventTarget, Manager};

use crate::plugins::is_safe_id;
use crate::windowing::{ActivatePluginPayload, BrowserWindowState};

pub(crate) const TOAST_EVENT: &str = "fast-window:toast";
pub(crate) const ACTIVATE_PLUGIN_EVENT: &str = "fast-window:activate-plugin";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToastPayload {
    pub(crate) message: String,
}

pub(crate) fn emit_toast(app: &tauri::AppHandle, message: impl Into<String>) {
    let _ = app.emit_to(
        EventTarget::webview_window("main"),
        TOAST_EVENT,
        ToastPayload {
            message: message.into(),
        },
    );
}

pub(crate) fn emit_activate_plugin(app: &tauri::AppHandle, plugin_id: impl Into<String>) {
    let _ = app.emit_to(
        EventTarget::webview_window("main"),
        ACTIVATE_PLUGIN_EVENT,
        ActivatePluginPayload {
            plugin_id: plugin_id.into(),
        },
    );
}

pub(crate) fn emit_activate_plugin_if_any(app: &tauri::AppHandle) {
    let state = app.state::<BrowserWindowState>();
    let pid = state
        .return_to_plugin_id
        .lock()
        .ok()
        .and_then(|g| g.clone());
    if let Some(plugin_id) = pid {
        emit_activate_plugin(app, plugin_id);
    }
}

#[tauri::command]
pub(crate) fn host_toast(app: tauri::AppHandle, message: String) -> Result<(), String> {
    let msg = message.trim().to_string();
    if msg.is_empty() {
        return Err("message 不能为空".to_string());
    }
    // 防止恶意/错误输入撑爆前端状态（toast 不需要长文）
    let capped = if msg.len() > 2048 {
        msg.chars().take(2048).collect::<String>()
    } else {
        msg
    };

    emit_toast(&app, capped);
    Ok(())
}

#[tauri::command]
pub(crate) fn host_activate_plugin(app: tauri::AppHandle, plugin_id: String) -> Result<(), String> {
    let pid = plugin_id.trim().to_string();
    if pid.is_empty() {
        return Err("pluginId 不能为空".to_string());
    }
    if !is_safe_id(&pid) {
        return Err("pluginId 不合法".to_string());
    }

    emit_activate_plugin(&app, pid);
    Ok(())
}
