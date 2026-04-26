use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub(crate) fn plugin_backend_start(
    app: AppHandle,
    req: crate::plugin_backend_runtime::PluginBackendStartReq,
) -> Result<crate::plugin_backend_runtime::PluginBackendStartRes, String> {
    let manager = app
        .state::<Arc<crate::plugin_backend_runtime::PluginBackendManagerState>>()
        .inner()
        .clone();
    crate::plugin_backend_runtime::plugin_backend_start(&app, manager, req)
}

#[tauri::command]
pub(crate) async fn plugin_backend_stop(
    app: AppHandle,
    plugin_id: String,
) -> Result<crate::plugin_backend_runtime::PluginBackendStopRes, String> {
    let manager = app
        .state::<Arc<crate::plugin_backend_runtime::PluginBackendManagerState>>()
        .inner()
        .clone();
    crate::plugin_backend_runtime::plugin_backend_stop(manager, plugin_id).await
}

#[tauri::command]
pub(crate) fn plugin_backend_status(
    app: AppHandle,
    plugin_id: String,
) -> Result<crate::plugin_backend_state::PluginBackendStatusRes, String> {
    let manager = app
        .state::<Arc<crate::plugin_backend_runtime::PluginBackendManagerState>>()
        .inner()
        .clone();
    crate::plugin_backend_runtime::plugin_backend_status(manager, plugin_id)
}

#[tauri::command]
pub(crate) fn plugin_backend_status_many(
    app: AppHandle,
    plugin_ids: Vec<String>,
) -> Result<
    std::collections::HashMap<String, crate::plugin_backend_state::PluginBackendStatusRes>,
    String,
> {
    let manager = app
        .state::<Arc<crate::plugin_backend_runtime::PluginBackendManagerState>>()
        .inner()
        .clone();
    crate::plugin_backend_runtime::plugin_backend_status_many(manager, plugin_ids)
}

#[tauri::command]
pub(crate) async fn plugin_backend_invoke(
    app: AppHandle,
    req: crate::plugin_backend_runtime::PluginBackendInvokeReq,
) -> Result<crate::plugin_backend_runtime::PluginBackendInvokeRes, String> {
    let manager = app
        .state::<Arc<crate::plugin_backend_runtime::PluginBackendManagerState>>()
        .inner()
        .clone();
    crate::plugin_backend_runtime::plugin_backend_invoke(manager, req).await
}
