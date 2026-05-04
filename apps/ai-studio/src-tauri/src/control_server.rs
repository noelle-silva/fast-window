use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::fw_window::{apply_control_action, FwWindowState};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCommandDescriptor {
    pub(crate) id: &'static str,
    pub(crate) title: &'static str,
}

#[derive(Clone, Serialize)]
pub(crate) struct ControlEndpoint {
    pub(crate) url: String,
    pub(crate) token: String,
}

pub(crate) struct ControlServerConfig {
    pub(crate) name: &'static str,
    pub(crate) bind_addr: &'static str,
    pub(crate) token: String,
    pub(crate) announce_to_stdout: bool,
}

#[derive(Deserialize)]
struct ControlClientResponse {
    ok: bool,
}

struct ControlRequest {
    method: String,
    path: String,
    token: String,
    body: Vec<u8>,
}

pub(crate) fn available_commands() -> Vec<AppCommandDescriptor> {
    vec![
        AppCommandDescriptor {
            id: "new-chat",
            title: "新建对话",
        },
        AppCommandDescriptor {
            id: "open-studio",
            title: "打开 AI Studio",
        },
        AppCommandDescriptor {
            id: "provider-settings",
            title: "模型提供商设置",
        },
    ]
}

pub(crate) fn session_token() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    format!("ais-{}-{}", now, std::process::id())
}

pub(crate) fn start_control_server(
    app: tauri::AppHandle,
    window_state: std::sync::Arc<FwWindowState>,
    config: ControlServerConfig,
) -> Result<ControlEndpoint, String> {
    let listener = TcpListener::bind(config.bind_addr)
        .map_err(|e| format!("启动{}失败: {e}", config.name))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取{}端口失败: {e}", config.name))?
        .port();

    let endpoint = ControlEndpoint {
        url: format!("http://127.0.0.1:{port}"),
        token: config.token,
    };

    if config.announce_to_stdout {
        write_stdout_json_line(serde_json::json!({
            "type": "fw-app-control-ready",
            "control": {
                "mode": "http",
                "url": endpoint.url,
                "token": endpoint.token,
                "protocolVersion": 1
            }
        }));
    }

    let expected_token = endpoint.token.clone();
    thread::Builder::new()
        .name(config.name.to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => handle_control_connection(stream, &app, &window_state, &expected_token),
                    Err(error) => {
                        eprintln!("[ai-studio-app] {} connection failed: {error}", config.name);
                        break;
                    }
                }
            }
        })
        .map_err(|e| format!("启动{}线程失败: {e}", config.name))?;

    Ok(endpoint)
}

pub(crate) fn post_control_request(
    addr: &str,
    token: &str,
    action: &str,
    command: Option<&str>,
) -> bool {
    let mut body = serde_json::json!({ "action": action });
    if let Some(command) = command.map(str::trim).filter(|value| !value.is_empty()) {
        body["command"] = serde_json::Value::String(command.to_string());
    }

    let body = body.to_string();
    let request = format!(
        "POST /control HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nX-FW-Control-Token: {token}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body,
    );

    let Ok(mut stream) = TcpStream::connect(addr) else {
        return false;
    };
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = Vec::new();
    if stream.read_to_end(&mut response).is_err() {
        return false;
    }
    let response = String::from_utf8_lossy(&response);
    if !response.starts_with("HTTP/1.1 200") {
        return false;
    }
    let Some((_, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    serde_json::from_str::<ControlClientResponse>(body)
        .map(|value| value.ok)
        .unwrap_or(false)
}

fn handle_control_connection(
    mut stream: TcpStream,
    app: &tauri::AppHandle,
    window_state: &FwWindowState,
    expected_token: &str,
) {
    let request = match read_control_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            write_control_response(&mut stream, 400, serde_json::json!({ "ok": false, "error": error }));
            return;
        }
    };

    if request.path != "/control" {
        write_control_response(&mut stream, 404, serde_json::json!({ "ok": false, "error": "控制入口不存在" }));
        return;
    }
    if request.method != "POST" {
        write_control_response(&mut stream, 405, serde_json::json!({ "ok": false, "error": "控制入口只接受 POST" }));
        return;
    }
    if request.token != expected_token {
        write_control_response(&mut stream, 401, serde_json::json!({ "ok": false, "error": "控制令牌无效" }));
        return;
    }

    let value = serde_json::from_slice::<serde_json::Value>(&request.body)
        .unwrap_or_else(|_| serde_json::json!({}));
    let action = value
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("show");
    let command = value.get("command").and_then(|v| v.as_str());

    match apply_control_action(app, window_state, action, command) {
        Ok(()) => write_control_response(
            &mut stream,
            200,
            serde_json::json!({ "ok": true, "availableCommands": available_commands() }),
        ),
        Err(error) => write_control_response(&mut stream, 400, serde_json::json!({ "ok": false, "error": error })),
    }
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
}

fn read_control_request(stream: &mut TcpStream) -> Result<ControlRequest, String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));

    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    let header_end = loop {
        let n = stream
            .read(&mut chunk)
            .map_err(|e| format!("读取控制请求失败: {e}"))?;
        if n == 0 {
            return Err("控制请求为空".to_string());
        }
        buffer.extend_from_slice(&chunk[..n]);
        if let Some(end) = find_header_end(&buffer) {
            break end;
        }
        if buffer.len() > 64 * 1024 {
            return Err("控制请求头过大".to_string());
        }
    };

    let header = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();

    let mut content_length = 0usize;
    let mut token = String::new();
    for line in lines {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.eq_ignore_ascii_case("content-length") {
            content_length = value.parse::<usize>().unwrap_or(0);
        }
        if key.eq_ignore_ascii_case("x-fw-control-token") {
            token = value.to_string();
        }
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let n = stream
            .read(&mut chunk)
            .map_err(|e| format!("读取控制请求体失败: {e}"))?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);

    Ok(ControlRequest { method, path, token, body })
}

fn write_control_response(stream: &mut TcpStream, status: u16, body: serde_json::Value) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    };
    let payload = body.to_string();
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.as_bytes().len(),
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(payload.as_bytes());
    let _ = stream.flush();
}

fn write_stdout_json_line(value: serde_json::Value) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{}", value);
    let _ = out.flush();
}
