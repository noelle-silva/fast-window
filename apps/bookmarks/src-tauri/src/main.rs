#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fw_window;

use fw_window::{
    app_ready, apply_control_action, apply_fw_args, install_window_policy, parse_fw_args,
    FwWindowState,
};
use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Clone, Serialize)]
struct BackendEndpoint {
    url: String,
    token: String,
}

#[derive(Clone, Serialize)]
struct ControlEndpoint {
    url: String,
    token: String,
}

#[derive(Default)]
struct BackendState {
    child: AsyncMutex<Option<Child>>,
    endpoint: Mutex<Option<BackendEndpoint>>,
}

impl Drop for BackendState {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.try_lock() {
            if let Some(ch) = child.as_mut() {
                let _ = ch.start_kill();
            }
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis()
}

fn token() -> String {
    format!("bm-{}-{}", now_ms(), std::process::id())
}

fn write_json_line(value: serde_json::Value) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{}", value);
    let _ = out.flush();
}

fn start_control_server(
    app: tauri::AppHandle,
    window_state: Arc<FwWindowState>,
) -> Result<ControlEndpoint, String> {
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("启动控制通道失败: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取控制通道端口失败: {e}"))?
        .port();

    let endpoint = ControlEndpoint {
        url: format!("http://127.0.0.1:{port}"),
        token: token(),
    };

    write_json_line(serde_json::json!({
        "type": "fw-app-control-ready",
        "control": {
            "mode": "http",
            "url": endpoint.url,
            "token": endpoint.token,
            "protocolVersion": 1
        }
    }));

    let expected_token = endpoint.token.clone();
    thread::Builder::new()
        .name("fw-app-control".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        handle_control_connection(stream, &app, &window_state, &expected_token)
                    }
                    Err(error) => {
                        eprintln!("[bookmarks-app] control connection failed: {error}");
                        break;
                    }
                }
            }
        })
        .map_err(|e| format!("启动控制通道线程失败: {e}"))?;

    Ok(endpoint)
}

struct ControlRequest {
    method: String,
    path: String,
    token: String,
    body: Vec<u8>,
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

    Ok(ControlRequest {
        method,
        path,
        token,
        body,
    })
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

fn handle_control_connection(
    mut stream: TcpStream,
    app: &tauri::AppHandle,
    window_state: &FwWindowState,
    expected_token: &str,
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

    let value = serde_json::from_slice::<serde_json::Value>(&request.body)
        .unwrap_or_else(|_| serde_json::json!({}));
    let action = value
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("show");

    match apply_control_action(app, window_state, action) {
        Ok(()) => write_control_response(&mut stream, 200, serde_json::json!({ "ok": true })),
        Err(error) => write_control_response(
            &mut stream,
            400,
            serde_json::json!({ "ok": false, "error": error }),
        ),
    }
}

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    resource_or_exe_dir(app).join("data")
}

fn resource_or_exe_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .ok()
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(Path::to_path_buf))
        })
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
}

fn resolve_backend_entry(app: &tauri::AppHandle) -> PathBuf {
    resource_or_exe_dir(app).join("backend").join("index.js")
}

#[tauri::command]
async fn backend_endpoint(
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<BackendEndpoint, String> {
    for _ in 0..100 {
        if let Ok(g) = state.endpoint.lock() {
            if let Some(ep) = g.clone() {
                return Ok(ep);
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err("后台未就绪".to_string())
}

async fn start_backend(app: tauri::AppHandle, state: Arc<BackendState>) -> Result<(), String> {
    let session_token = token();
    let data_dir = app_data_dir(&app);
    let _ = std::fs::create_dir_all(&data_dir);

    let backend_js = resolve_backend_entry(&app);

    let mut cmd = Command::new("node");
    cmd.arg(backend_js);
    cmd.env("FW_APP_SESSION_TOKEN", &session_token);
    cmd.env("FW_APP_DATA_DIR", data_dir);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::inherit());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("启动后台失败: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "后台 stdout 不可用".to_string())?;
    {
        let mut g = state.child.lock().await;
        *g = Some(child);
    }

    let state_for_stdout = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if value.get("type").and_then(|v| v.as_str()) != Some("ready") {
                continue;
            }
            let Some(url) = value
                .get("ipc")
                .and_then(|v| v.get("url"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
            else {
                continue;
            };
            if let Ok(mut g) = state_for_stdout.endpoint.lock() {
                *g = Some(BackendEndpoint {
                    url,
                    token: session_token.clone(),
                });
            }
        }
    });

    Ok(())
}

fn main() {
    let fw_args = parse_fw_args();

    let backend_state = Arc::new(BackendState::default());
    let backend_state_setup = backend_state.clone();
    let window_state = Arc::new(FwWindowState::default());
    let window_state_setup = window_state.clone();

    tauri::Builder::default()
        .manage(backend_state)
        .manage(window_state)
        .invoke_handler(tauri::generate_handler![backend_endpoint, app_ready])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .expect("main window not found");
            install_window_policy(&window, &fw_args, window_state_setup.clone());
            apply_fw_args(&window, &fw_args, &window_state_setup);
            start_control_server(app.handle().clone(), window_state_setup.clone())?;

            let handle = app.handle().clone();
            let state = backend_state_setup.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_backend(handle, state).await {
                    eprintln!("[bookmarks-app] {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running bookmarks app");
}
