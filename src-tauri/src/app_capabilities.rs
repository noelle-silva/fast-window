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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppHostShortcutListRequest {
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
pub(crate) struct AppCapabilityInvokeResponse {
    app_id: String,
    capability_id: String,
    response: serde_json::Value,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityOptionsResponse {
    app_id: String,
    capability_id: String,
    response: serde_json::Value,
    options: Vec<AppCapabilityOption>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityOption {
    value: String,
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityListResponse {
    apps: Vec<AppCapabilityListApp>,
    errors: Vec<AppCapabilityListError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppHostShortcutListResponse {
    apps: Vec<AppHostShortcutListApp>,
    errors: Vec<AppCapabilityListError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCapabilityListApp {
    app_id: String,
    capabilities: Vec<crate::app_registry::AppRuntimeDeclaration>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppHostShortcutListApp {
    app_id: String,
    host_shortcuts: Vec<crate::app_registry::AppRuntimeDeclaration>,
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
    let endpoint =
        resolve_app_capability_endpoint(app_handle, state, app, launch_options, launch_policy)
            .await?;
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

async fn describe_app_runtime_declarations(
    app_handle: AppHandle,
    state: Arc<AppLifecycleManager>,
    app: &RegisteredAppLaunchConfig,
    launch_options: AppLaunchOptions,
    launch_policy: AppCapabilityLaunchPolicy,
    action: &'static str,
    response_field: RuntimeDeclarationField,
) -> Result<Vec<crate::app_registry::AppRuntimeDeclaration>, String> {
    let endpoint =
        resolve_app_capability_endpoint(app_handle, state, app, launch_options, launch_policy)
            .await?;
    let response = tokio::task::spawn_blocking(move || {
        send_control_json(endpoint, serde_json::json!({ "action": action }))
    })
    .await
    .map_err(|e| format!("应用运行时声明读取任务失败: {e}"))??;

    runtime_declarations_from_response(response, response_field)
}

pub(crate) async fn describe_app_capabilities(
    app_handle: AppHandle,
    state: Arc<AppLifecycleManager>,
    app: &RegisteredAppLaunchConfig,
    launch_options: AppLaunchOptions,
    launch_policy: AppCapabilityLaunchPolicy,
) -> Result<Vec<crate::app_registry::AppRuntimeDeclaration>, String> {
    Ok(describe_app_runtime_declarations(
        app_handle,
        state,
        app,
        launch_options,
        launch_policy,
        "describeCapabilities",
        RuntimeDeclarationField::Capabilities,
    )
    .await?
    .into_iter()
    .filter(|capability| capability.kind.as_deref() == Some("capability"))
    .collect())
}

pub(crate) async fn describe_app_host_shortcuts(
    app_handle: AppHandle,
    state: Arc<AppLifecycleManager>,
    app: &RegisteredAppLaunchConfig,
    launch_options: AppLaunchOptions,
    launch_policy: AppCapabilityLaunchPolicy,
) -> Result<Vec<crate::app_registry::AppRuntimeDeclaration>, String> {
    Ok(describe_app_runtime_declarations(
        app_handle,
        state,
        app,
        launch_options,
        launch_policy,
        "describeHostShortcuts",
        RuntimeDeclarationField::HostShortcuts,
    )
    .await?
    .into_iter()
    .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppControlRuntimeDeclarationDescription {
    #[serde(default)]
    capabilities: Vec<crate::app_registry::AppRuntimeDeclaration>,
    #[serde(default)]
    host_shortcuts: Vec<crate::app_registry::AppRuntimeDeclaration>,
}

#[derive(Clone, Copy)]
enum RuntimeDeclarationField {
    Capabilities,
    HostShortcuts,
}

fn runtime_declarations_from_response(
    response: serde_json::Value,
    field: RuntimeDeclarationField,
) -> Result<Vec<crate::app_registry::AppRuntimeDeclaration>, String> {
    let value = serde_json::from_value::<AppControlRuntimeDeclarationDescription>(response)
        .map_err(|e| format!("应用运行时声明响应解析失败: {e}"))?;
    match field {
        RuntimeDeclarationField::Capabilities => Ok(value.capabilities),
        RuntimeDeclarationField::HostShortcuts => Ok(value.host_shortcuts),
    }
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
        match describe_app_capabilities(
            app_handle.clone(),
            state.inner().clone(),
            &app,
            AppLaunchOptions::default(),
            request.launch_policy,
        )
        .await
        {
            Ok(capabilities) => apps.push(AppCapabilityListApp {
                app_id,
                capabilities,
            }),
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
pub(crate) async fn app_host_shortcut_list(
    app_handle: AppHandle,
    state: tauri::State<'_, Arc<AppLifecycleManager>>,
    request: AppHostShortcutListRequest,
) -> Result<AppHostShortcutListResponse, String> {
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
        match describe_app_host_shortcuts(
            app_handle.clone(),
            state.inner().clone(),
            &app,
            AppLaunchOptions::default(),
            request.launch_policy,
        )
        .await
        {
            Ok(host_shortcuts) => apps.push(AppHostShortcutListApp {
                app_id,
                host_shortcuts,
            }),
            Err(error) => errors.push(AppCapabilityListError {
                app_id,
                message: error,
                can_launch: true,
            }),
        }
    }

    Ok(AppHostShortcutListResponse { apps, errors })
}

#[tauri::command]
pub(crate) async fn app_capability_invoke(
    app_handle: AppHandle,
    state: tauri::State<'_, Arc<AppLifecycleManager>>,
    request: AppCapabilityInvokeRequest,
) -> Result<AppCapabilityInvokeResponse, String> {
    app_capability_invoke_inner(app_handle, state.inner().clone(), request).await
}

pub(crate) async fn app_capability_invoke_inner(
    app_handle: AppHandle,
    state: Arc<AppLifecycleManager>,
    request: AppCapabilityInvokeRequest,
) -> Result<AppCapabilityInvokeResponse, String> {
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

    let text = capability_response_text(&response)?;

    Ok(AppCapabilityInvokeResponse {
        app_id,
        capability_id,
        response,
        text,
    })
}

fn capability_response_text(response: &serde_json::Value) -> Result<String, String> {
    let Some(value) = response.as_object() else {
        return Err("能力返回结果格式不合法：响应必须是包含 text 文本的对象".to_string());
    };
    let Some(text) = value.get("text").and_then(serde_json::Value::as_str) else {
        return Err("能力返回结果格式不合法：缺少 text 文本".to_string());
    };
    required_capability_text(text, "text")
}

fn required_capability_text(value: &str, label: &str) -> Result<String, String> {
    let text = value.trim().to_string();
    if text.is_empty() {
        return Err(format!("{label}为空"));
    }
    Ok(text)
}

#[tauri::command]
pub(crate) async fn app_capability_query_options(
    app_handle: AppHandle,
    state: tauri::State<'_, Arc<AppLifecycleManager>>,
    request: AppCapabilityOptionsRequest,
) -> Result<AppCapabilityOptionsResponse, String> {
    app_capability_query_options_inner(app_handle, state.inner().clone(), request).await
}

pub(crate) async fn app_capability_query_options_inner(
    app_handle: AppHandle,
    state: Arc<AppLifecycleManager>,
    request: AppCapabilityOptionsRequest,
) -> Result<AppCapabilityOptionsResponse, String> {
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
    let options = capability_options(&response)?;

    Ok(AppCapabilityOptionsResponse {
        app_id,
        capability_id,
        response,
        options,
    })
}

fn capability_options(response: &serde_json::Value) -> Result<Vec<AppCapabilityOption>, String> {
    let values = if let Some(values) = response.as_array() {
        values
    } else {
        let Some(value) = response.as_object() else {
            return Err(
                "能力配置选项响应格式不合法：响应必须是数组或包含 options 数组的对象".to_string(),
            );
        };
        value
            .get("options")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| "能力配置选项响应格式不合法：缺少 options 数组".to_string())?
    };
    values
        .iter()
        .enumerate()
        .map(|(index, value)| capability_option(value, index))
        .collect()
}

fn capability_option(
    value: &serde_json::Value,
    index: usize,
) -> Result<AppCapabilityOption, String> {
    let Some(item) = value.as_object() else {
        return Err(format!(
            "能力配置选项响应格式不合法：第 {} 个选项必须是对象",
            index + 1
        ));
    };
    let option_value = required_option_text(item.get("value"), "value", index)?;
    let label = required_option_text(item.get("label"), "label", index)?;
    Ok(AppCapabilityOption {
        value: option_value,
        label,
    })
}

fn required_option_text(
    value: Option<&serde_json::Value>,
    field: &str,
    index: usize,
) -> Result<String, String> {
    let Some(text) = value.and_then(serde_json::Value::as_str) else {
        return Err(format!(
            "能力配置选项响应格式不合法：第 {} 个选项缺少 {field}",
            index + 1
        ));
    };
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(format!(
            "能力配置选项响应格式不合法：第 {} 个选项 {field} 不能为空",
            index + 1
        ));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_text_field_response() {
        let text = capability_response_text(&serde_json::json!({ "text": " hello " })).unwrap();
        assert_eq!(text, "hello");
    }

    #[test]
    fn rejects_plain_text_response() {
        let error = capability_response_text(&serde_json::json!("hello")).unwrap_err();
        assert!(error.contains("包含 text 文本的对象"));
    }

    #[test]
    fn rejects_result_field_response() {
        let error =
            capability_response_text(&serde_json::json!({ "result": "hello" })).unwrap_err();
        assert!(error.contains("缺少 text 文本"));
    }

    #[test]
    fn rejects_output_field_response() {
        let error =
            capability_response_text(&serde_json::json!({ "output": "hello" })).unwrap_err();
        assert!(error.contains("缺少 text 文本"));
    }

    #[test]
    fn rejects_missing_text_response() {
        let error = capability_response_text(&serde_json::json!({ "value": "hello" })).unwrap_err();
        assert!(error.contains("缺少 text 文本"));
    }

    #[test]
    fn rejects_empty_text_response() {
        let error = capability_response_text(&serde_json::json!({ "text": " " })).unwrap_err();
        assert!(error.contains("text为空"));
    }

    #[test]
    fn extracts_array_options() {
        let options = capability_options(&serde_json::json!([
            { "value": " space-1 ", "label": " Space 1 " }
        ]))
        .unwrap();
        assert_eq!(options[0].value, "space-1");
        assert_eq!(options[0].label, "Space 1");
    }

    #[test]
    fn extracts_wrapped_options() {
        let options = capability_options(&serde_json::json!({
            "options": [{ "value": "template-1", "label": "Template 1" }]
        }))
        .unwrap();
        assert_eq!(options[0].value, "template-1");
        assert_eq!(options[0].label, "Template 1");
    }

    #[test]
    fn rejects_missing_options() {
        let error = capability_options(&serde_json::json!({ "items": [] })).unwrap_err();
        assert!(error.contains("缺少 options 数组"));
    }

    #[test]
    fn rejects_option_without_value() {
        let error = capability_options(&serde_json::json!([{ "label": "Space 1" }])).unwrap_err();
        assert!(error.contains("缺少 value"));
    }

    #[test]
    fn rejects_option_without_label() {
        let error = capability_options(&serde_json::json!([{ "value": "space-1" }])).unwrap_err();
        assert!(error.contains("缺少 label"));
    }

    #[test]
    fn rejects_empty_option_text() {
        let error = capability_options(&serde_json::json!([{ "value": " ", "label": "Space 1" }]))
            .unwrap_err();
        assert!(error.contains("value 不能为空"));
    }
}
