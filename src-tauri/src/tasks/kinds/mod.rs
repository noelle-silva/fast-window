mod clipboard_watch;
mod http_request;

use serde_json::Value;

use crate::tasks::state::TaskManagerState;

pub(crate) const KIND_HTTP_REQUEST: &str = "http.request";
pub(crate) const KIND_CLIPBOARD_WATCH: &str = "clipboard.watch";

pub(crate) fn normalize_payload_for_kind(kind: &str, payload: Value) -> Result<Value, String> {
    match kind {
        KIND_CLIPBOARD_WATCH => Ok(if payload.is_null() {
            serde_json::json!({})
        } else {
            payload
        }),
        KIND_HTTP_REQUEST => Ok(payload),
        _ => Ok(payload),
    }
}

pub(crate) fn validate_task_kind(kind: &str) -> Result<(), String> {
    let k = kind.trim();
    if k.is_empty() {
        return Err("task kind 不能为空".to_string());
    }
    if k.len() > 96 {
        return Err("task kind 过长".to_string());
    }
    // 标准化约束：仅允许常见 ASCII 可读字符，避免奇怪空白/控制字符污染状态与日志。
    if !k
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
    {
        return Err("task kind 含非法字符".to_string());
    }
    Ok(())
}

pub(crate) fn validate_payload_if_supported(kind: &str, payload: &Value) -> Result<(), String> {
    match kind {
        KIND_HTTP_REQUEST => http_request::validate_payload(payload),
        KIND_CLIPBOARD_WATCH => clipboard_watch::validate_payload(payload),
        // v2 兼容：历史上允许创建未知 kind（会在执行阶段失败）。这里不提前拦截。
        _ => Ok(()),
    }
}

pub(crate) async fn run_task_kind(
    app: &tauri::AppHandle,
    manager: std::sync::Arc<TaskManagerState>,
    task_id: String,
    plugin_id: String,
    kind: String,
    payload: Value,
) -> Result<Value, String> {
    match kind.as_str() {
        KIND_HTTP_REQUEST => http_request::run(payload).await,
        KIND_CLIPBOARD_WATCH => {
            clipboard_watch::run(app, manager, task_id, plugin_id, payload).await
        }
        _ => Err(format!("不支持的任务类型: {kind}")),
    }
}
