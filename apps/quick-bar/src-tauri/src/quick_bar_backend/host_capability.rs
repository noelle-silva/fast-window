use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::quick_bar_backend::{self, registry::RegistryButton};

const REQUEST_TIMEOUT_SECONDS: u64 = 30;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostCapabilityListParams {
    #[serde(default)]
    app_id: String,
    #[serde(default)]
    launch_policy: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostCapabilityInvokeRequest<'a> {
    app: &'a Value,
    capability_id: &'a str,
    input: &'a str,
    config: &'a Value,
}

pub(crate) async fn list(params: Value) -> Result<Value, String> {
    let request: HostCapabilityListParams = if params.is_null() {
        HostCapabilityListParams { app_id: String::new(), launch_policy: String::new() }
    } else {
        quick_bar_backend::decode_params(params)?
    };
    let launch_policy = normalize_launch_policy(&request.launch_policy)?;
    let mut url = endpoint_url()?;
    url.set_path("/capabilities");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("launchPolicy", launch_policy);
        let app_id = request.app_id.trim();
        if !app_id.is_empty() {
            query.append_pair("appId", app_id);
        }
    }
    send_get(url).await
}

pub(crate) async fn invoke(params: Value) -> Result<Value, String> {
    send_post("/capability/invoke", params).await
}

pub(crate) async fn query_options(params: Value) -> Result<Value, String> {
    send_post("/capability/query-options", params).await
}

pub(crate) async fn invoke_for_button(
    button: &RegistryButton,
    selected_text: &str,
) -> Result<Value, String> {
    let request = HostCapabilityInvokeRequest {
        app: &button.app,
        capability_id: &button.capability_id,
        input: selected_text,
        config: &button.config,
    };
    let params = serde_json::to_value(request)
        .map_err(|e| format!("生成能力调用请求失败: {e}"))?;
    invoke(params).await
}

fn normalize_launch_policy(value: &str) -> Result<&'static str, String> {
    match value.trim() {
        "" | "runningOnly" => Ok("runningOnly"),
        "allowLaunch" => Ok("allowLaunch"),
        other => Err(format!("能力读取策略不合法: {other}")),
    }
}

async fn send_get(url: reqwest::Url) -> Result<Value, String> {
    let client = http_client()?;
    let response = client
        .get(url)
        .header("X-FW-Control-Token", endpoint_token()?)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("读取宿主能力失败: {e}"))?;
    decode_response(response).await
}

async fn send_post(path: &str, body: Value) -> Result<Value, String> {
    let mut url = endpoint_url()?;
    url.set_path(path);
    let client = http_client()?;
    let response = client
        .post(url)
        .header("X-FW-Control-Token", endpoint_token()?)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("调用宿主能力失败: {e}"))?;
    decode_response(response).await
}

async fn decode_response(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取宿主能力响应失败: {e}"))?;
    if !status.is_success() {
        return Err(format!("宿主能力服务返回 {status}: {}", text.trim()));
    }
    if text.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(&text).map_err(|e| format!("解析宿主能力响应失败: {e}"))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("创建宿主能力访问客户端失败: {e}"))
}

fn endpoint_url() -> Result<reqwest::Url, String> {
    let value = std::env::var("FW_HOST_CAPABILITY_URL")
        .map_err(|_| "环境变量 FW_HOST_CAPABILITY_URL 未设置".to_string())?;
    reqwest::Url::parse(value.trim()).map_err(|e| format!("宿主能力地址不合法: {e}"))
}

fn endpoint_token() -> Result<String, String> {
    let token = std::env::var("FW_HOST_CAPABILITY_TOKEN")
        .map_err(|_| "环境变量 FW_HOST_CAPABILITY_TOKEN 未设置".to_string())?;
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("环境变量 FW_HOST_CAPABILITY_TOKEN 为空".to_string());
    }
    Ok(token)
}
