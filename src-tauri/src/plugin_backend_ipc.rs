use crate::plugin_backend_endpoint::{parse_ready_ipc, PluginBackendEndpointState};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const BACKEND_READY_TIMEOUT_MS: u64 = 10_000;
pub(crate) const BACKEND_MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Serialize)]
struct BackendRpcRequestFrame<'a> {
    id: &'a str,
    method: &'a str,
    params: &'a Value,
}

#[derive(Deserialize)]
pub(crate) struct BackendRpcResponseFrame {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) ok: Option<bool>,
    #[serde(default)]
    pub(crate) result: Value,
    #[serde(default)]
    pub(crate) error: Option<Value>,
}

pub(crate) enum BackendStdoutFrame {
    Ready(Option<PluginBackendEndpointState>),
    ProtocolError(String),
    LegacyResponse(BackendRpcResponseFrame),
    Log,
}

pub(crate) fn encode_request_frame(
    id: &str,
    method: &str,
    params: &Value,
) -> Result<Vec<u8>, String> {
    let frame = BackendRpcRequestFrame { id, method, params };
    let line = serde_json::to_vec(&frame).map_err(|e| format!("序列化后端请求失败: {e}"))?;
    ensure_frame_size(line.len(), "background.invoke payload")?;
    Ok(line)
}

pub(crate) fn parse_stdout_frame(line: &str) -> BackendStdoutFrame {
    if line.len() > BACKEND_MAX_FRAME_BYTES {
        return BackendStdoutFrame::Log;
    }

    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return BackendStdoutFrame::Log;
    };

    if value.get("type").and_then(|v| v.as_str()) == Some("ready") {
        return match parse_ready_ipc(&value) {
            Ok(endpoint) => BackendStdoutFrame::Ready(endpoint),
            Err(error) => BackendStdoutFrame::ProtocolError(error),
        };
    }

    if value.get("ready").and_then(|v| v.as_bool()) == Some(true) {
        return BackendStdoutFrame::Ready(None);
    }

    match serde_json::from_value::<BackendRpcResponseFrame>(value) {
        Ok(resp) if !resp.id.trim().is_empty() => BackendStdoutFrame::LegacyResponse(resp),
        _ => BackendStdoutFrame::Log,
    }
}

pub(crate) fn response_result(resp: BackendRpcResponseFrame) -> Result<Value, String> {
    match (resp.ok, resp.error) {
        (Some(false), Some(error)) => Err(error_to_string(error)),
        (Some(false), None) => Err("插件后端请求失败".to_string()),
        (_, Some(error)) => Err(error_to_string(error)),
        _ => Ok(resp.result),
    }
}

pub(crate) fn ensure_frame_size(bytes: usize, label: &str) -> Result<(), String> {
    if bytes > BACKEND_MAX_FRAME_BYTES {
        return Err(format!(
            "{label} 超过 {} bytes 限制",
            BACKEND_MAX_FRAME_BYTES
        ));
    }
    Ok(())
}

fn error_to_string(error: Value) -> String {
    if let Some(s) = error.as_str() {
        return s.to_string();
    }
    if let Some(message) = error.get("message").and_then(|v| v.as_str()) {
        return message.to_string();
    }
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ready_signal() {
        assert!(matches!(
            parse_stdout_frame(r#"{"type":"ready"}"#),
            BackendStdoutFrame::Ready(None)
        ));
        assert!(matches!(
            parse_stdout_frame(r#"{"ready":true}"#),
            BackendStdoutFrame::Ready(None)
        ));
    }

    #[test]
    fn parses_direct_ready_endpoint() {
        let frame = parse_stdout_frame(
            r#"{"type":"ready","ipc":{"mode":"direct","transport":"local-websocket","url":"ws://127.0.0.1:39421","protocolVersion":1}}"#,
        );
        match frame {
            BackendStdoutFrame::Ready(Some(endpoint)) => {
                assert_eq!(endpoint.url, "ws://127.0.0.1:39421")
            }
            _ => panic!("expected direct ready endpoint"),
        }
    }

    #[test]
    fn rejects_non_localhost_ready_endpoint() {
        assert!(matches!(
            parse_stdout_frame(
                r#"{"type":"ready","ipc":{"mode":"direct","transport":"local-websocket","url":"ws://localhost:39421","protocolVersion":1}}"#,
            ),
            BackendStdoutFrame::ProtocolError(_)
        ));
    }

    #[test]
    fn rejects_wrong_transport() {
        assert!(matches!(
            parse_stdout_frame(
                r#"{"type":"ready","ipc":{"mode":"direct","transport":"stdio","url":"ws://127.0.0.1:39421","protocolVersion":1}}"#,
            ),
            BackendStdoutFrame::ProtocolError(_)
        ));
    }

    #[test]
    fn parses_response_frame() {
        let frame = parse_stdout_frame(r#"{"id":"rpc-1","ok":true,"result":{"pong":true}}"#);
        match frame {
            BackendStdoutFrame::LegacyResponse(resp) => assert_eq!(resp.id, "rpc-1"),
            _ => panic!("expected response frame"),
        }
    }

    #[test]
    fn encodes_request_with_size_limit() {
        let params = serde_json::json!({ "message": "hello" });
        let line = encode_request_frame("rpc-1", "demo.ping", &params).expect("request frame");
        assert!(line.starts_with(br#"{"id":"rpc-1""#));
    }
}
