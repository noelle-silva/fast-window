use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use crate::backend_sidecar::BackendState;
use crate::control_http_client::{post_json_control_request, HttpControlEndpoint};

const ACTION_INVOKE_CAPABILITY: &str = "invokeCapability";
const ACTION_QUERY_CAPABILITY_OPTIONS: &str = "queryCapabilityOptions";
const BACKEND_CONTROL_PATH: &str = "/control";

pub(crate) fn is_capability_action(action: &str) -> bool {
    matches!(
        action,
        ACTION_INVOKE_CAPABILITY | ACTION_QUERY_CAPABILITY_OPTIONS
    )
}

pub(crate) fn handle_capability_action(
    app: &tauri::AppHandle,
    action: &str,
    value: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let body = capability_backend_body(action, value)?;
    let endpoint = backend_http_endpoint(app)?;
    post_json_control_request(
        &endpoint,
        BACKEND_CONTROL_PATH,
        body,
        Duration::from_secs(5),
        "收藏集后台能力请求失败",
    )
}

fn capability_backend_body(
    action: &str,
    value: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let capability_id = required_json_text(value, "capabilityId")?;
    let config = value
        .get("config")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    match action {
        ACTION_INVOKE_CAPABILITY => Ok(serde_json::json!({
            "action": ACTION_INVOKE_CAPABILITY,
            "capabilityId": capability_id,
            "input": required_json_text(value, "input")?,
            "config": config,
        })),
        ACTION_QUERY_CAPABILITY_OPTIONS => Ok(serde_json::json!({
            "action": ACTION_QUERY_CAPABILITY_OPTIONS,
            "capabilityId": capability_id,
            "optionSource": required_json_text(value, "optionSource")?,
            "config": config,
        })),
        _ => Err(format!("未知能力动作: {action}")),
    }
}

fn required_json_text(value: &serde_json::Value, field: &str) -> Result<String, String> {
    let text = value
        .get(field)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| format!("{field} 不能为空"))?;
    Ok(text.to_string())
}

fn backend_http_endpoint(app: &tauri::AppHandle) -> Result<HttpControlEndpoint, String> {
    let state = app.state::<Arc<BackendState>>().inner().clone();
    let endpoint = tauri::async_runtime::block_on(async move { state.endpoint().await })?;
    let url = endpoint.url.trim().trim_end_matches('/');
    let Some(addr) = url.strip_prefix("ws://") else {
        return Err("收藏集后台地址不支持 HTTP 转发".to_string());
    };
    Ok(HttpControlEndpoint::new(addr, endpoint.token))
}
