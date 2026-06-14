use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::app_lifecycle::{
    manager::{ensure_app_control_endpoint, AppLaunchOptions, AppLifecycleManager},
    send_control_json, RegisteredAppLaunchConfig,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityInvokeRequest {
    app: RegisteredAppLaunchConfig,
    capability_id: String,
    #[serde(default)]
    input: serde_json::Value,
    #[serde(default)]
    config: serde_json::Value,
    #[serde(default)]
    launch_options: AppLaunchOptions,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityOptionsRequest {
    app: RegisteredAppLaunchConfig,
    capability_id: String,
    option_source: String,
    #[serde(default)]
    config: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityResponse {
    app_id: String,
    capability_id: String,
    response: serde_json::Value,
}

#[tauri::command]
pub(crate) fn app_capability_env_vars() -> Vec<(String, String)> {
    crate::capability_server::capability_server_env_vars()
}

fn validate_runtime_identifier(value: &str, label: &str) -> Result<String, String> {
    let id = value.trim().to_string();
    if id.is_empty() {
        return Err(format!("{label} 不能为空"));
    }
    if !crate::is_safe_id(&id) {
        return Err(format!("{label} 不合法"));
    }
    Ok(id)
}

async fn send_app_capability_request(
    app_handle: AppHandle,
    state: Arc<AppLifecycleManager>,
    app: &RegisteredAppLaunchConfig,
    launch_options: AppLaunchOptions,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let endpoint = ensure_app_control_endpoint(app_handle, state, app, launch_options).await?;
    tokio::task::spawn_blocking(move || send_control_json(endpoint, body))
        .await
        .map_err(|e| format!("应用能力调度任务失败: {e}"))?
}

#[tauri::command]
pub(crate) async fn app_capability_invoke(
    app_handle: AppHandle,
    state: tauri::State<'_, Arc<AppLifecycleManager>>,
    request: AppCapabilityInvokeRequest,
) -> Result<AppCapabilityResponse, String> {
    app_capability_invoke_inner(app_handle, state.inner().clone(), request).await
}

pub(crate) async fn app_capability_invoke_inner(
    app_handle: AppHandle,
    state: Arc<AppLifecycleManager>,
    request: AppCapabilityInvokeRequest,
) -> Result<AppCapabilityResponse, String> {
    let app_id = validate_runtime_identifier(&request.app.id, "appId")?;
    let capability_id = validate_runtime_identifier(&request.capability_id, "capabilityId")?;
    let response = send_app_capability_request(
        app_handle,
        state,
        &request.app,
        request.launch_options,
        serde_json::json!({
            "action": "invokeCapability",
            "capabilityId": capability_id,
            "input": request.input,
            "config": request.config,
        }),
    )
    .await?;

    Ok(AppCapabilityResponse {
        app_id,
        capability_id,
        response,
    })
}

#[tauri::command]
pub(crate) async fn app_capability_query_options(
    app_handle: AppHandle,
    state: tauri::State<'_, Arc<AppLifecycleManager>>,
    request: AppCapabilityOptionsRequest,
) -> Result<AppCapabilityResponse, String> {
    app_capability_query_options_inner(app_handle, state.inner().clone(), request).await
}

pub(crate) async fn app_capability_query_options_inner(
    app_handle: AppHandle,
    state: Arc<AppLifecycleManager>,
    request: AppCapabilityOptionsRequest,
) -> Result<AppCapabilityResponse, String> {
    let app_id = validate_runtime_identifier(&request.app.id, "appId")?;
    let capability_id = validate_runtime_identifier(&request.capability_id, "capabilityId")?;
    let option_source = validate_runtime_identifier(&request.option_source, "optionSource")?;
    let response = send_app_capability_request(
        app_handle,
        state,
        &request.app,
        AppLaunchOptions::default(),
        serde_json::json!({
            "action": "queryCapabilityOptions",
            "capabilityId": capability_id,
            "optionSource": option_source,
            "config": request.config,
        }),
    )
    .await?;

    Ok(AppCapabilityResponse {
        app_id,
        capability_id,
        response,
    })
}
