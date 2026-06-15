use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::app_lifecycle::{
    manager::{
        ensure_app_control_endpoint, running_app_control_endpoint, AppLaunchOptions,
        AppLifecycleManager,
    },
    send_control_json, AppControlEndpoint, RegisteredAppLaunchConfig,
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
    #[serde(default)]
    launch_policy: AppCapabilityLaunchPolicy,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityListRequest {
    apps: Vec<RegisteredAppLaunchConfig>,
    #[serde(default)]
    launch_policy: AppCapabilityLaunchPolicy,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AppCapabilityLaunchPolicy {
    RunningOnly,
    AllowLaunch,
}

impl Default for AppCapabilityLaunchPolicy {
    fn default() -> Self {
        Self::RunningOnly
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityResponse {
    app_id: String,
    capability_id: String,
    response: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityListResponse {
    apps: Vec<AppCapabilityListApp>,
    errors: Vec<AppCapabilityListError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityListApp {
    app_id: String,
    commands: Vec<crate::app_registry::AppReportedCommand>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityListError {
    app_id: String,
    message: String,
    can_launch: bool,
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
    launch_policy: AppCapabilityLaunchPolicy,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let endpoint = resolve_app_capability_endpoint(app_handle, state, app, launch_options, launch_policy).await?;
    tokio::task::spawn_blocking(move || send_control_json(endpoint, body))
        .await
        .map_err(|e| format!("应用能力调度任务失败: {e}"))?
}

async fn resolve_app_capability_endpoint(
    app_handle: AppHandle,
    state: Arc<AppLifecycleManager>,
    app: &RegisteredAppLaunchConfig,
    launch_options: AppLaunchOptions,
    launch_policy: AppCapabilityLaunchPolicy,
) -> Result<AppControlEndpoint, String> {
    match launch_policy {
        AppCapabilityLaunchPolicy::AllowLaunch => {
            ensure_app_control_endpoint(app_handle, state, app, launch_options).await
        }
        AppCapabilityLaunchPolicy::RunningOnly => running_app_control_endpoint(state, &app.id)
            .await?
            .ok_or_else(|| "应用未运行，未自动启动".to_string()),
    }
}

pub(crate) async fn describe_app_commands(
    app_handle: AppHandle,
    state: Arc<AppLifecycleManager>,
    app: &RegisteredAppLaunchConfig,
    launch_options: AppLaunchOptions,
    launch_policy: AppCapabilityLaunchPolicy,
) -> Result<Vec<crate::app_registry::AppReportedCommand>, String> {
    let endpoint = resolve_app_capability_endpoint(app_handle, state, app, launch_options, launch_policy).await?;
    let response = tokio::task::spawn_blocking(move || {
        send_control_json(endpoint, serde_json::json!({ "action": "describeCapabilities" }))
    })
    .await
    .map_err(|e| format!("应用能力清单读取任务失败: {e}"))??;

    let value = serde_json::from_value::<AppControlCapabilityDescription>(response)
        .map_err(|e| format!("应用能力清单响应解析失败: {e}"))?;
    Ok(value.available_commands)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppControlCapabilityDescription {
    #[serde(default)]
    available_commands: Vec<crate::app_registry::AppReportedCommand>,
}

#[tauri::command]
pub(crate) async fn app_capability_list(
    app_handle: AppHandle,
    state: tauri::State<'_, Arc<AppLifecycleManager>>,
    request: AppCapabilityListRequest,
) -> Result<AppCapabilityListResponse, String> {
    let mut apps = Vec::new();
    let mut errors = Vec::new();

    for app in request.apps {
        let app_id = match validate_runtime_identifier(&app.id, "appId") {
            Ok(app_id) => app_id,
            Err(error) => {
                errors.push(AppCapabilityListError {
                    app_id: app.id,
                    message: error,
                    can_launch: false,
                });
                continue;
            }
        };
        match describe_app_commands(
            app_handle.clone(),
            state.inner().clone(),
            &app,
            AppLaunchOptions::default(),
            request.launch_policy,
        )
        .await
        {
            Ok(commands) => apps.push(AppCapabilityListApp { app_id, commands }),
            Err(error) => errors.push(AppCapabilityListError {
                app_id,
                message: error,
                can_launch: true,
            }),
        }
    }

    Ok(AppCapabilityListResponse { apps, errors })
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
        AppCapabilityLaunchPolicy::AllowLaunch,
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
        request.launch_policy,
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
