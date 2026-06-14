use std::io::{self, Write};
use std::net::TcpListener;
use std::sync::{Arc, OnceLock};
use std::thread;

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::app_lifecycle::manager::AppLifecycleManager;

pub(super) mod capability_service;
pub(super) mod http_transport;

use capability_service::CapabilityService;

const BIND_ADDR: &str = "127.0.0.1:0";

static CAPABILITY_ENDPOINT: OnceLock<CapabilityServerEndpoint> = OnceLock::new();

pub(crate) fn capability_server_env_vars() -> Vec<(String, String)> {
    CAPABILITY_ENDPOINT.get().map_or(Vec::new(), |ep| {
        vec![
            ("FW_HOST_CAPABILITY_URL".to_string(), ep.url.clone()),
            ("FW_HOST_CAPABILITY_TOKEN".to_string(), ep.token.clone()),
        ]
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapabilityServerEndpoint {
    pub(crate) url: String,
    pub(crate) token: String,
}

pub(crate) fn start_capability_server(
    app: AppHandle,
    lifecycle: Arc<AppLifecycleManager>,
) -> Result<CapabilityServerEndpoint, String> {
    let listener =
        TcpListener::bind(BIND_ADDR).map_err(|e| format!("启动能力HTTP服务失败: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取能力HTTP服务端口失败: {e}"))?
        .port();
    let endpoint = CapabilityServerEndpoint {
        url: format!("http://127.0.0.1:{port}"),
        token: random_token("fw-host-capability"),
    };

    let _ = CAPABILITY_ENDPOINT.set(endpoint.clone());
    announce_server_ready(&endpoint);

    let expected_token = endpoint.token.clone();
    let service = CapabilityService::new(app, lifecycle);
    thread::Builder::new()
        .name("fw-capability-server".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        http_transport::handle_connection(stream, &expected_token, &service)
                    }
                    Err(error) => {
                        eprintln!("[capability-server] connection failed: {error}");
                        break;
                    }
                }
            }
        })
        .map_err(|e| format!("启动能力HTTP服务线程失败: {e}"))?;

    Ok(endpoint)
}

fn announce_server_ready(endpoint: &CapabilityServerEndpoint) {
    write_stdout_json_line(serde_json::json!({
        "type": "fw-host-capability-server-ready",
        "capabilityServer": {
            "mode": "http",
            "url": endpoint.url,
            "token": endpoint.token,
            "protocolVersion": 1
        }
    }));
}

pub(super) struct CapabilityHttpResponse {
    pub(super) status: u16,
    pub(super) body: Value,
}

impl CapabilityHttpResponse {
    pub(super) fn json(status: u16, body: Value) -> Self {
        Self { status, body }
    }

    pub(super) fn error(status: u16, error: impl Into<String>) -> Self {
        Self {
            status,
            body: error_body(error),
        }
    }

    pub(super) fn serialized<T: Serialize>(status: u16, value: T) -> Self {
        match serde_json::to_value(value) {
            Ok(body) => Self::json(status, body),
            Err(error) => Self::error(500, format!("响应序列化失败: {error}")),
        }
    }
}

fn error_body(error: impl Into<String>) -> Value {
    serde_json::json!({ "ok": false, "error": error.into() })
}

fn random_token(prefix: &str) -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("failed to generate capability server token");
    format!("{prefix}-{}", hex_token(&bytes))
}

fn hex_token(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn write_stdout_json_line(value: Value) {
    let mut out = io::stdout();
    let _ = writeln!(out, "{}", value);
    let _ = out.flush();
}
