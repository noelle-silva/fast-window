use crate::http_api::{http_request_for_task, HttpRequest};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestTaskPayload {
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    body_base64: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestTaskResult {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
    attempt_count: u32,
}

pub(crate) fn validate_payload(payload: &Value) -> Result<(), String> {
    let p = serde_json::from_value::<HttpRequestTaskPayload>(payload.clone())
        .map_err(|e| format!("任务参数无效: {e}"))?;
    if p.method.trim().is_empty() {
        return Err("任务参数无效: method 不能为空".to_string());
    }
    if p.url.trim().is_empty() {
        return Err("任务参数无效: url 不能为空".to_string());
    }
    Ok(())
}

pub(crate) async fn run(payload: Value) -> Result<Value, String> {
    let payload: HttpRequestTaskPayload =
        serde_json::from_value(payload).map_err(|e| format!("任务参数无效: {e}"))?;

    // 对发送阶段失败（服务端未处理请求）的错误自动重试，重试完全安全。
    // 最多重试 2 次（共 3 次尝试），退避间隔 400ms / 900ms。
    const MAX_RETRIES: u32 = 2;
    const RETRY_DELAYS_MS: [u64; 2] = [400, 900];

    let mut last_err = String::new();
    for attempt in 0..=MAX_RETRIES {
        let req = HttpRequest {
            method: payload.method.clone(),
            url: payload.url.clone(),
            headers: payload.headers.clone(),
            body: payload.body.clone(),
            body_base64: payload.body_base64.clone(),
            timeout_ms: payload.timeout_ms,
        };
        match http_request_for_task(req).await {
            Ok(resp) => {
                return serde_json::to_value(HttpRequestTaskResult {
                    status: resp.status,
                    headers: resp.headers,
                    body: resp.body,
                    attempt_count: attempt + 1,
                })
                .map_err(|e| format!("任务结果序列化失败: {e}"));
            }
            Err(e) => {
                last_err = e.message.clone();
                let retryable = e.kind.is_retryable();
                if attempt < MAX_RETRIES && retryable {
                    tokio::time::sleep(tokio::time::Duration::from_millis(
                        RETRY_DELAYS_MS[attempt as usize],
                    ))
                    .await;
                    continue;
                }
                break;
            }
        }
    }
    Err(last_err)
}
