use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

const ENDPOINT_URL_MAX_LEN: usize = 2048;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginBackendEndpointRes {
    pub(crate) mode: String,
    pub(crate) transport: String,
    pub(crate) url: String,
    pub(crate) token: String,
    pub(crate) protocol_version: u32,
}

#[derive(Clone)]
pub(crate) struct PluginBackendEndpointState {
    pub(crate) mode: String,
    pub(crate) transport: String,
    pub(crate) url: String,
    pub(crate) protocol_version: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginBackendReadyIpcFrame {
    mode: String,
    transport: String,
    url: String,
    #[serde(default)]
    protocol_version: Option<u32>,
}

pub(crate) fn generate_session_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("生成后台会话 token 失败: {e}"))?;
    Ok(crate::to_hex_lower(&bytes))
}

pub(crate) fn parse_ready_ipc(value: &Value) -> Result<Option<PluginBackendEndpointState>, String> {
    if value.get("type").and_then(|v| v.as_str()) != Some("ready") {
        return Ok(None);
    }

    let Some(ipc) = value.get("ipc") else {
        return Ok(None);
    };
    let frame: PluginBackendReadyIpcFrame = serde_json::from_value(ipc.clone())
        .map_err(|e| format!("后台 ready.ipc 格式不合法: {e}"))?;

    if frame.mode != "direct" {
        return Err("后台 ready.ipc.mode 必须为 direct".to_string());
    }
    if frame.transport != "local-websocket" {
        return Err("后台 ready.ipc.transport 必须为 local-websocket".to_string());
    }
    validate_local_websocket_url(&frame.url)?;

    let protocol_version = frame.protocol_version.unwrap_or(1);
    if protocol_version == 0 {
        return Err("后台 ready.ipc.protocolVersion 不合法".to_string());
    }

    Ok(Some(PluginBackendEndpointState {
        mode: frame.mode,
        transport: frame.transport,
        url: frame.url,
        protocol_version,
    }))
}

pub(crate) fn validate_local_websocket_url(raw_url: &str) -> Result<(), String> {
    let url_text = raw_url.trim();
    if url_text.is_empty() {
        return Err("后台 ready.ipc.url 不能为空".to_string());
    }
    if url_text.len() > ENDPOINT_URL_MAX_LEN {
        return Err("后台 ready.ipc.url 过长".to_string());
    }

    let url = Url::parse(url_text).map_err(|_| "后台 ready.ipc.url 不是合法 URL".to_string())?;
    if url.scheme() != "ws" {
        return Err("后台 ready.ipc.url 只允许 ws://".to_string());
    }
    if url.host_str() != Some("127.0.0.1") {
        return Err("后台 ready.ipc.url 只允许 127.0.0.1".to_string());
    }
    if url.port().is_none() {
        return Err("后台 ready.ipc.url 必须包含端口".to_string());
    }
    Ok(())
}

pub(crate) fn build_endpoint_response(
    state: &PluginBackendEndpointState,
    token: &str,
) -> PluginBackendEndpointRes {
    PluginBackendEndpointRes {
        mode: state.mode.clone(),
        transport: state.transport.clone(),
        url: state.url.clone(),
        token: token.to_string(),
        protocol_version: state.protocol_version,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_direct_ready_endpoint() {
        let frame = json!({
            "type": "ready",
            "ipc": {
                "mode": "direct",
                "transport": "local-websocket",
                "url": "ws://127.0.0.1:39421",
                "protocolVersion": 1
            }
        });
        let endpoint = parse_ready_ipc(&frame)
            .expect("valid endpoint")
            .expect("endpoint");
        assert_eq!(endpoint.url, "ws://127.0.0.1:39421");
        assert_eq!(endpoint.protocol_version, 1);
    }

    #[test]
    fn rejects_non_localhost_ready_endpoint() {
        let frame = json!({
            "type": "ready",
            "ipc": {
                "mode": "direct",
                "transport": "local-websocket",
                "url": "ws://192.168.0.2:39421",
                "protocolVersion": 1
            }
        });
        assert!(parse_ready_ipc(&frame).is_err());
    }

    #[test]
    fn rejects_wrong_transport() {
        let frame = json!({
            "type": "ready",
            "ipc": {
                "mode": "direct",
                "transport": "stdio",
                "url": "ws://127.0.0.1:39421",
                "protocolVersion": 1
            }
        });
        assert!(parse_ready_ipc(&frame).is_err());
    }

    #[test]
    fn keeps_legacy_ready_without_ipc() {
        let frame = json!({ "type": "ready" });
        assert!(parse_ready_ipc(&frame).expect("legacy ready").is_none());
    }
}
