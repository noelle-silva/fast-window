use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::fw_window::{apply_control_action, publish_search, FwWindowState};

pub(crate) const EVERYTHING_APP_ID: &str = "everything";
const PUBLISH_SEARCH_CAPABILITY_ID: &str = "publish-search";
const PUBLISH_SEARCH_COMMAND: &str = "publish";
const DECLARATION_KIND_CAPABILITY: &str = "capability";
const DECLARATION_KIND_HOST_SHORTCUT: &str = "hostShortcut";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCommandDescriptor {
    pub(crate) id: &'static str,
    pub(crate) title: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) config_fields: Option<&'static [AppCommandConfigField]>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCommandConfigField {
    pub(crate) id: &'static str,
    pub(crate) label: &'static str,
    pub(crate) option_source: &'static str,
}

#[derive(Clone, Serialize)]
pub(crate) struct ControlEndpoint {
    pub(crate) url: String,
    pub(crate) token: String,
}

pub(crate) struct ControlServerConfig {
    pub(crate) name: &'static str,
    pub(crate) app_id: &'static str,
    pub(crate) server_id: &'static str,
    pub(crate) bind_addr: &'static str,
    pub(crate) token: String,
    pub(crate) announce_to_stdout: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlClientResponse {
    ok: bool,
    app_id: Option<String>,
    server_id: Option<String>,
    protocol_version: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlPayload {
    action: Option<String>,
    command: Option<String>,
    capability_id: Option<String>,
    input: Option<serde_json::Value>,
    #[serde(rename = "config")]
    _config: Option<serde_json::Value>,
    search_query: Option<serde_json::Value>,
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
            id: "open-search",
            title: "打开 Everything 搜索",
            kind: Some(DECLARATION_KIND_HOST_SHORTCUT),
            description: None,
            config_fields: None,
        },
        AppCommandDescriptor {
            id: "focus-query",
            title: "聚焦搜索框",
            kind: Some(DECLARATION_KIND_HOST_SHORTCUT),
            description: None,
            config_fields: None,
        },
        AppCommandDescriptor {
            id: "show-setup",
            title: "打开 Everything 设置",
            kind: Some(DECLARATION_KIND_HOST_SHORTCUT),
            description: None,
            config_fields: None,
        },
        AppCommandDescriptor {
            id: PUBLISH_SEARCH_CAPABILITY_ID,
            title: "Everything 搜索",
            kind: Some(DECLARATION_KIND_CAPABILITY),
            description: Some("在 Everything 中搜索文件"),
            config_fields: Some(&[]),
        },
    ]
}

fn available_host_shortcuts() -> Vec<AppCommandDescriptor> {
    available_commands()
        .into_iter()
        .filter(|command| command.kind == Some(DECLARATION_KIND_HOST_SHORTCUT))
        .collect()
}

fn available_capabilities() -> Vec<AppCommandDescriptor> {
    available_commands()
        .into_iter()
        .filter(|command| command.kind == Some(DECLARATION_KIND_CAPABILITY))
        .collect()
}

pub(crate) fn random_token(prefix: &str) -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("failed to generate Everything app token");
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

pub(crate) fn start_control_server(
    app: tauri::AppHandle,
    window_state: std::sync::Arc<FwWindowState>,
    config: ControlServerConfig,
) -> Result<ControlEndpoint, String> {
    let listener =
        TcpListener::bind(config.bind_addr).map_err(|e| format!("启动{}失败: {e}", config.name))?;
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
                "appId": config.app_id,
                "serverId": config.server_id,
                "protocolVersion": 1
            }
        }));
    }

    let expected_token = endpoint.token.clone();
    let server_name = config.name;
    let app_id = config.app_id;
    let server_id = config.server_id;
    thread::Builder::new()
        .name(server_name.to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => handle_control_connection(
                        stream,
                        &app,
                        &window_state,
                        &expected_token,
                        app_id,
                        server_id,
                    ),
                    Err(error) => {
                        eprintln!("[everything] {} connection failed: {error}", server_name);
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
    expected_app_id: &str,
    expected_server_id: &str,
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
    control_response_matches(body, expected_app_id, expected_server_id)
}

fn handle_control_connection(
    mut stream: TcpStream,
    app: &tauri::AppHandle,
    window_state: &FwWindowState,
    expected_token: &str,
    app_id: &str,
    server_id: &str,
) {
    let request = match read_control_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            write_control_response(
                &mut stream,
                400,
                serde_json::json!({ "ok": false, "error": error }),
            );
            return;
        }
    };

    if request.path != "/control" {
        write_control_response(
            &mut stream,
            404,
            serde_json::json!({ "ok": false, "error": "控制入口不存在" }),
        );
        return;
    }
    if request.method != "POST" {
        write_control_response(
            &mut stream,
            405,
            serde_json::json!({ "ok": false, "error": "控制入口只接受 POST" }),
        );
        return;
    }
    if request.token != expected_token {
        write_control_response(
            &mut stream,
            401,
            serde_json::json!({ "ok": false, "error": "控制令牌无效" }),
        );
        return;
    }

    let payload = match parse_control_payload(&request.body) {
        Ok(payload) => payload,
        Err(error) => {
            write_control_response(
                &mut stream,
                400,
                serde_json::json!({ "ok": false, "error": error }),
            );
            return;
        }
    };
    let action = payload
        .action
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("show");
    let command = payload.command.as_deref();

    if action == "describeCapabilities" {
        write_control_response(
            &mut stream,
            200,
            serde_json::json!({
                "ok": true,
                "appId": app_id,
                "serverId": server_id,
                "protocolVersion": 1,
                "capabilities": available_capabilities()
            }),
        );
        return;
    }

    if action == "describeHostShortcuts" {
        write_control_response(
            &mut stream,
            200,
            serde_json::json!({
                "ok": true,
                "appId": app_id,
                "serverId": server_id,
                "protocolVersion": 1,
                "hostShortcuts": available_host_shortcuts()
            }),
        );
        return;
    }

    if action == "invokeCapability" {
        match handle_invoke_capability(app, window_state, &payload) {
            Ok(response) => write_control_response(&mut stream, 200, response),
            Err(error) => write_control_response(
                &mut stream,
                400,
                serde_json::json!({ "ok": false, "error": error }),
            ),
        }
        return;
    }

    if action == PUBLISH_SEARCH_COMMAND {
        match handle_publish_action(app, window_state, &payload) {
            Ok(response) => write_control_response(&mut stream, 200, response),
            Err(error) => write_control_response(
                &mut stream,
                400,
                serde_json::json!({ "ok": false, "error": error }),
            ),
        }
        return;
    }

    match apply_control_action(app, window_state, action, command, None) {
        Ok(()) => write_control_response(
            &mut stream,
            200,
            serde_json::json!({
                "ok": true,
                "appId": app_id,
                "serverId": server_id,
                "protocolVersion": 1
            }),
        ),
        Err(error) => write_control_response(
            &mut stream,
            400,
            serde_json::json!({ "ok": false, "error": error }),
        ),
    }
}

fn handle_invoke_capability(
    app: &tauri::AppHandle,
    window_state: &FwWindowState,
    payload: &ControlPayload,
) -> Result<serde_json::Value, String> {
    validate_publish_capability_id(payload.capability_id.as_deref())?;

    let query = extract_capability_search_query(payload.input.as_ref())?;
    publish_search(app, window_state, &query)?;

    Ok(serde_json::json!({
        "ok": true,
        "accepted": true,
        "capabilityId": PUBLISH_SEARCH_CAPABILITY_ID,
        "text": capability_accepted_text(&query),
    }))
}

fn handle_publish_action(
    app: &tauri::AppHandle,
    window_state: &FwWindowState,
    payload: &ControlPayload,
) -> Result<serde_json::Value, String> {
    let query = extract_search_query(payload)?.unwrap_or_default();
    publish_search(app, window_state, &query)?;

    Ok(serde_json::json!({
        "ok": true,
        "accepted": true,
        "text": capability_accepted_text(&query),
    }))
}

fn parse_control_payload(body: &[u8]) -> Result<ControlPayload, String> {
    serde_json::from_slice::<ControlPayload>(body).map_err(|_| "控制请求格式错误".to_string())
}

fn extract_search_query(payload: &ControlPayload) -> Result<Option<String>, String> {
    match &payload.search_query {
        None => Ok(None),
        Some(value) => value
            .as_str()
            .map(|query| Some(query.to_string()))
            .ok_or_else(|| "searchQuery 必须是字符串".to_string()),
    }
}

fn extract_capability_search_query(input: Option<&serde_json::Value>) -> Result<String, String> {
    match input {
        None | Some(serde_json::Value::Null) => Ok(String::new()),
        Some(serde_json::Value::String(text)) => Ok(text.clone()),
        Some(serde_json::Value::Object(value)) => match value.get("text") {
            Some(serde_json::Value::String(text)) => Ok(text.clone()),
            _ => Err("输入格式错误".to_string()),
        },
        Some(_) => Err("输入格式错误".to_string()),
    }
}

fn validate_publish_capability_id(capability_id: Option<&str>) -> Result<&str, String> {
    let capability_id = capability_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "capabilityId 不能为空".to_string())?;
    if capability_id != PUBLISH_SEARCH_CAPABILITY_ID {
        return Err(format!("未知能力编号: {capability_id}"));
    }
    Ok(capability_id)
}

fn capability_accepted_text(query: &str) -> String {
    if query.trim().is_empty() {
        "已打开 Everything 搜索".to_string()
    } else {
        format!("已在 Everything 中搜索 {query}")
    }
}

fn control_response_matches(body: &str, expected_app_id: &str, expected_server_id: &str) -> bool {
    let Ok(value) = serde_json::from_str::<ControlClientResponse>(body) else {
        return false;
    };
    value.ok
        && value.protocol_version == Some(1)
        && value.app_id.as_deref() == Some(expected_app_id)
        && value.server_id.as_deref() == Some(expected_server_id)
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

    Ok(ControlRequest {
        method,
        path,
        token,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_publish_search_as_capability_only() {
        let capabilities = available_capabilities();

        assert_eq!(capabilities.len(), 1);
        assert_eq!(capabilities[0].id, PUBLISH_SEARCH_CAPABILITY_ID);
        assert_eq!(capabilities[0].title, "Everything 搜索");
        assert_eq!(capabilities[0].kind, Some(DECLARATION_KIND_CAPABILITY));
        assert_eq!(
            capabilities[0].description,
            Some("在 Everything 中搜索文件")
        );
        assert!(capabilities[0]
            .config_fields
            .as_ref()
            .is_some_and(|fields| fields.is_empty()));
    }

    #[test]
    fn lists_existing_commands_as_host_shortcuts_only() {
        let host_shortcuts = available_host_shortcuts();

        assert_eq!(host_shortcuts.len(), 3);
        assert!(host_shortcuts
            .iter()
            .all(|command| command.kind == Some(DECLARATION_KIND_HOST_SHORTCUT)));
        assert!(!host_shortcuts
            .iter()
            .any(|command| command.id == PUBLISH_SEARCH_CAPABILITY_ID));
    }

    #[test]
    fn extracts_capability_query_from_text_input() {
        assert_eq!(
            extract_capability_search_query(Some(&serde_json::json!("abc"))).unwrap(),
            "abc"
        );
    }

    #[test]
    fn extracts_capability_query_from_object_text_input() {
        assert_eq!(
            extract_capability_search_query(Some(&serde_json::json!({ "text": "abc" }))).unwrap(),
            "abc"
        );
    }

    #[test]
    fn extracts_empty_capability_query_from_missing_input() {
        assert_eq!(extract_capability_search_query(None).unwrap(), "");
        assert_eq!(
            extract_capability_search_query(Some(&serde_json::Value::Null)).unwrap(),
            ""
        );
    }

    #[test]
    fn rejects_unknown_capability_id() {
        let err = validate_publish_capability_id(Some("unknown"))
            .err()
            .expect("unknown capability should fail");
        assert!(err.contains("未知能力编号"));
    }

    #[test]
    fn builds_accepted_text_for_empty_and_non_empty_query() {
        assert_eq!(capability_accepted_text(""), "已打开 Everything 搜索");
        assert_eq!(
            capability_accepted_text("abc"),
            "已在 Everything 中搜索 abc"
        );
    }

    #[test]
    fn parses_publish_payload_with_search_query() {
        let payload = parse_control_payload(br#"{"action":"publish","searchQuery":"abc"}"#)
            .expect("publish payload should parse");

        assert_eq!(payload.action.as_deref(), Some("publish"));
        assert_eq!(
            extract_search_query(&payload).unwrap().as_deref(),
            Some("abc")
        );
    }

    #[test]
    fn accepts_publish_payload_without_search_query() {
        let payload = parse_control_payload(br#"{"action":"publish"}"#)
            .expect("publish payload without query should parse");

        assert_eq!(payload.action.as_deref(), Some("publish"));
        assert!(extract_search_query(&payload).unwrap().is_none());
    }

    #[test]
    fn rejects_publish_payload_with_non_string_search_query() {
        let payload = parse_control_payload(br#"{"action":"publish","searchQuery":123}"#)
            .expect("payload should parse before query validation");

        assert!(extract_search_query(&payload).is_err());
    }

    #[test]
    fn rejects_invalid_control_payload() {
        assert!(parse_control_payload(b"not-json").is_err());
    }
}
