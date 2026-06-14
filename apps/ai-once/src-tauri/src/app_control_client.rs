use std::time::Duration;

use serde::Deserialize;

use crate::control_http_client::{post_json_control_request, HttpControlEndpoint};

const APP_CONTROL_PATH: &str = "/control";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppControlResponse {
    ok: bool,
    app_id: Option<String>,
    server_id: Option<String>,
    protocol_version: Option<u32>,
}

pub(crate) fn post_app_control_request(
    addr: &str,
    token: &str,
    action: &str,
    command: Option<&str>,
    expected_app_id: &str,
    expected_server_id: &str,
) -> bool {
    let mut body = serde_json::json!({ "action": action });
    if let Some(command) = command.map(str::trim).filter(|value| !value.is_empty()) {
        body["command"] = serde_json::Value::String(command.to_string());
    }

    let endpoint = HttpControlEndpoint::new(addr, token);
    let Ok(response) = post_json_control_request(
        &endpoint,
        APP_CONTROL_PATH,
        body,
        Duration::from_secs(2),
        "发送 App 控制请求失败",
    ) else {
        return false;
    };
    app_control_response_matches(response, expected_app_id, expected_server_id)
}

fn app_control_response_matches(
    body: serde_json::Value,
    expected_app_id: &str,
    expected_server_id: &str,
) -> bool {
    let Ok(value) = serde_json::from_value::<AppControlResponse>(body) else {
        return false;
    };
    value.ok
        && value.protocol_version == Some(1)
        && value.app_id.as_deref() == Some(expected_app_id)
        && value.server_id.as_deref() == Some(expected_server_id)
}
