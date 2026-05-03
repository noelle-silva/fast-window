use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
pub(crate) struct AppLauncherState {
    processes: Mutex<HashMap<String, Arc<AppProcessEntry>>>,
}

struct AppProcessEntry {
    pid: u32,
    started_at_ms: u64,
    child: AsyncMutex<Option<Child>>,
    exit_code: Mutex<Option<i32>>,
    control: Mutex<Option<AppControlEndpoint>>,
}

#[derive(Clone)]
struct AppControlEndpoint {
    url: String,
    token: String,
}

enum AppRuntimeMessage {
    ControlReady(AppControlEndpoint),
    WindowBounds(crate::app_registry::AppWindowBounds),
    AvailableCommands(Vec<crate::app_registry::AppReportedCommand>),
    Ignore,
}

impl Drop for AppLauncherState {
    fn drop(&mut self) {
        let entries: Vec<Arc<AppProcessEntry>> = self
            .processes
            .lock()
            .map(|g| g.values().cloned().collect())
            .unwrap_or_default();
        for entry in entries {
            if let Ok(mut child) = entry.child.try_lock() {
                if let Some(ch) = child.as_mut() {
                    let _ = ch.start_kill();
                }
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

fn launch_action(args: &[String]) -> String {
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--fw-action" && i + 1 < args.len() {
            let action = args[i + 1].trim();
            if matches!(action, "toggle" | "show" | "hide" | "close") {
                return action.to_string();
            }
        }
        i += 1;
    }
    "show".to_string()
}

fn launch_command(args: &[String]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--fw-command" && i + 1 < args.len() {
            let command = args[i + 1].trim();
            if !command.is_empty() && !command.starts_with("--") {
                return Some(command.to_string());
            }
        }
        i += 1;
    }
    None
}

fn action_for_running_instance(action: &str) -> &str {
    match action {
        "hide" => "hide",
        "close" => "close",
        "toggle" => "toggle",
        _ => "show",
    }
}

#[cfg(target_os = "windows")]
fn allow_foreground_for_process(pid: u32) {
    if pid == 0 {
        return;
    }

    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(pid);
    }
}

#[cfg(not(target_os = "windows"))]
fn allow_foreground_for_process(_pid: u32) {}

fn should_allow_foreground(action: &str) -> bool {
    matches!(action, "show" | "toggle")
}

async fn wait_control_endpoint(entry: &Arc<AppProcessEntry>) -> Result<AppControlEndpoint, String> {
    for _ in 0..60 {
        if let Some(endpoint) = entry
            .control
            .lock()
            .map_err(|_| "应用控制状态锁定失败".to_string())?
            .clone()
        {
            return Ok(endpoint);
        }

        if entry.exit_code.lock().ok().and_then(|c| *c).is_some() {
            return Err("应用已退出".to_string());
        }

        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    Err("应用控制通道尚未就绪".to_string())
}

fn read_http_response(stream: &mut TcpStream) -> Result<String, String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buffer = Vec::new();
    stream
        .read_to_end(&mut buffer)
        .map_err(|e| format!("读取应用控制响应失败: {e}"))?;
    Ok(String::from_utf8_lossy(&buffer).to_string())
}

fn send_control_action(
    endpoint: AppControlEndpoint,
    action: String,
    command: Option<String>,
) -> Result<String, String> {
    let url = endpoint.url.trim().trim_end_matches('/');
    let Some(addr) = url.strip_prefix("http://") else {
        return Err("应用控制地址不支持".to_string());
    };
    let mut body_value = serde_json::json!({ "action": action });
    if let Some(command) = command {
        body_value["command"] = serde_json::Value::String(command);
    }
    let body = body_value.to_string();
    let request = format!(
        "POST /control HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nX-FW-Control-Token: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        endpoint.token,
        body,
    );

    let mut stream = TcpStream::connect(addr).map_err(|e| format!("连接应用控制通道失败: {e}"))?;
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("发送应用控制指令失败: {e}"))?;
    let response = read_http_response(&mut stream)?;
    if response.starts_with("HTTP/1.1 200") {
        Ok(response)
    } else {
        Err(format!("应用控制指令失败: {response}"))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppControlResponse {
    #[serde(default)]
    available_commands: Vec<crate::app_registry::AppReportedCommand>,
}

fn available_commands_from_response(response: &str) -> Vec<crate::app_registry::AppReportedCommand> {
    let Some((_, body)) = response.split_once("\r\n\r\n") else {
        return Vec::new();
    };
    serde_json::from_str::<AppControlResponse>(body)
        .map(|value| value.available_commands)
        .unwrap_or_default()
}

async fn send_control_action_async(
    entry: Arc<AppProcessEntry>,
    action: String,
    command: Option<String>,
) -> Result<Vec<crate::app_registry::AppReportedCommand>, String> {
    let endpoint = wait_control_endpoint(&entry).await?;

    let response = tokio::task::spawn_blocking(move || send_control_action(endpoint, action, command))
        .await
        .map_err(|e| format!("应用控制任务失败: {e}"))??;
    Ok(available_commands_from_response(&response))
}

fn runtime_message_from_stdout_line(line: &str) -> AppRuntimeMessage {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return AppRuntimeMessage::Ignore;
    };
    match value.get("type").and_then(|v| v.as_str()) {
        Some("fw-app-control-ready") => control_from_stdout_value(&value)
            .map(AppRuntimeMessage::ControlReady)
            .unwrap_or(AppRuntimeMessage::Ignore),
        Some("fw-app-window-bounds") => value
            .get("windowBounds")
            .and_then(crate::app_registry::AppWindowBounds::from_value)
            .map(AppRuntimeMessage::WindowBounds)
            .unwrap_or(AppRuntimeMessage::Ignore),
        Some("fw-app-commands") => value
            .get("commands")
            .and_then(|commands| {
                serde_json::from_value::<Vec<crate::app_registry::AppReportedCommand>>(
                    commands.clone(),
                )
                .ok()
            })
            .map(AppRuntimeMessage::AvailableCommands)
            .unwrap_or(AppRuntimeMessage::Ignore),
        _ => AppRuntimeMessage::Ignore,
    }
}

fn control_from_stdout_value(value: &serde_json::Value) -> Option<AppControlEndpoint> {
    if value.get("type").and_then(|v| v.as_str()) != Some("fw-app-control-ready") {
        return None;
    }
    let control = value.get("control")?;
    let url = control
        .get("url")
        .and_then(|v| v.as_str())?
        .trim()
        .to_string();
    let token = control
        .get("token")
        .and_then(|v| v.as_str())?
        .trim()
        .to_string();
    if url.is_empty() || token.is_empty() {
        return None;
    }
    Some(AppControlEndpoint { url, token })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppStatusResult {
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

impl AppStatusResult {
    fn stopped() -> Self {
        Self {
            running: false,
            pid: None,
            started_at: None,
            exit_code: None,
        }
    }
}

#[tauri::command]
pub(crate) async fn app_launch(
    app_handle: AppHandle,
    state: tauri::State<'_, Arc<AppLauncherState>>,
    app_id: String,
    exe_path: String,
    args: Vec<String>,
) -> Result<(), String> {
    app_launch_inner(app_handle, state.inner().clone(), app_id, exe_path, args).await
}

pub(crate) async fn app_launch_inner(
    app_handle: AppHandle,
    state: Arc<AppLauncherState>,
    app_id: String,
    exe_path: String,
    args: Vec<String>,
) -> Result<(), String> {
    let id = app_id.trim().to_string();
    if id.is_empty() {
        return Err("appId 不能为空".to_string());
    }
    if id.len() > 128 || id.contains(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_') {
        return Err("appId 不合法".to_string());
    }

    let path = PathBuf::from(exe_path.trim());
    if !path.is_file() {
        return Err(format!("应用文件不存在: {}", path.display()));
    }

    let running_entry = state
        .processes
        .lock()
        .ok()
        .and_then(|g| g.get(&id).cloned())
        .filter(|entry| entry.exit_code.lock().ok().and_then(|c| *c).is_none());

    if let Some(entry) = running_entry {
        let action = action_for_running_instance(&launch_action(&args)).to_string();
        let command = launch_command(&args);
        if should_allow_foreground(&action) {
            allow_foreground_for_process(entry.pid);
        }
        let available_commands = send_control_action_async(entry, action, command).await?;
        if !available_commands.is_empty() {
            crate::app_registry::persist_app_available_commands(
                &app_handle,
                &id,
                available_commands,
            )?;
        }
        return Ok(());
    }

    let mut cmd = Command::new(&path);
    cmd.args(&args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());

    let mut child = cmd.spawn().map_err(|e| format!("启动应用失败: {e}"))?;
    let pid = child.id().unwrap_or(0);
    if should_allow_foreground(&launch_action(&args)) {
        allow_foreground_for_process(pid);
    }
    let started_at_ms = now_ms();
    let stdout = child.stdout.take();

    let entry = Arc::new(AppProcessEntry {
        pid,
        started_at_ms,
        child: AsyncMutex::new(Some(child)),
        exit_code: Mutex::new(None),
        control: Mutex::new(None),
    });

    if let Some(stdout) = stdout {
        let entry_stdout = entry.clone();
        let app_stdout = app_handle.clone();
        let id_stdout = id.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                match runtime_message_from_stdout_line(&line) {
                    AppRuntimeMessage::ControlReady(endpoint) => {
                        if let Ok(mut g) = entry_stdout.control.lock() {
                            *g = Some(endpoint);
                        }
                    }
                    AppRuntimeMessage::WindowBounds(bounds) => {
                        if let Err(error) = crate::app_registry::persist_app_window_bounds(
                            &app_stdout,
                            &id_stdout,
                            bounds,
                        ) {
                            eprintln!("[app-launcher] failed to persist window bounds for {id_stdout}: {error}");
                        }
                    }
                    AppRuntimeMessage::AvailableCommands(commands) => {
                        if let Err(error) = crate::app_registry::persist_app_available_commands(
                            &app_stdout,
                            &id_stdout,
                            commands,
                        ) {
                            eprintln!("[app-launcher] failed to persist available commands for {id_stdout}: {error}");
                        }
                    }
                    AppRuntimeMessage::Ignore => {}
                }
            }
        });
    }

    // spawn reaper
    let entry_reap = entry.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let code = {
                let mut g = entry_reap.child.lock().await;
                if let Some(ch) = g.as_mut() {
                    match ch.try_wait() {
                        Ok(Some(st)) => {
                            let code = st.code();
                            let _ = g.take();
                            Some(code)
                        }
                        Ok(None) => None,
                        Err(_) => {
                            let _ = g.take();
                            None
                        }
                    }
                } else {
                    return;
                }
            };
            if let Some(code) = code {
                if let Ok(mut g) = entry_reap.exit_code.lock() {
                    *g = code;
                }
                return;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    });

    if let Ok(mut g) = state.processes.lock() {
        g.insert(id, entry);
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn app_stop(
    state: tauri::State<'_, Arc<AppLauncherState>>,
    app_id: String,
) -> Result<(), String> {
    let id = app_id.trim().to_string();
    if id.is_empty() {
        return Err("appId 不能为空".to_string());
    }

    let entry = state
        .processes
        .lock()
        .map_err(|_| "进程状态锁定失败".to_string())?
        .get(&id)
        .cloned();

    let Some(entry) = entry else {
        return Ok(());
    };

    {
        let mut g = entry.child.lock().await;
        if let Some(ch) = g.as_mut() {
            ch.start_kill().map_err(|e| format!("停止应用失败: {e}"))?;
            let _ = g.take();
        }
    }

    if let Ok(mut g) = state.processes.lock() {
        g.remove(&id);
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn app_status(
    state: tauri::State<'_, Arc<AppLauncherState>>,
    app_id: String,
) -> Result<AppStatusResult, String> {
    let id = app_id.trim().to_string();
    if id.is_empty() {
        return Err("appId 不能为空".to_string());
    }

    let entry = state
        .processes
        .lock()
        .map_err(|_| "进程状态锁定失败".to_string())?
        .get(&id)
        .cloned();

    let Some(entry) = entry else {
        return Ok(AppStatusResult::stopped());
    };

    let exit_code = entry.exit_code.lock().ok().and_then(|c| *c);
    if exit_code.is_some() {
        return Ok(AppStatusResult::stopped());
    }

    Ok(AppStatusResult {
        running: true,
        pid: Some(entry.pid),
        started_at: Some(entry.started_at_ms),
        exit_code: None,
    })
}

#[tauri::command]
pub(crate) fn app_status_many(
    state: tauri::State<'_, Arc<AppLauncherState>>,
    app_ids: Vec<String>,
) -> Result<HashMap<String, AppStatusResult>, String> {
    let mut out = HashMap::new();
    for id in app_ids {
        let id = id.trim().to_string();
        if id.is_empty() {
            continue;
        }
        let status = app_status_inner(&state, &id)?;
        out.insert(id, status);
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn app_icon_data_url(exe_path: String) -> Result<String, String> {
    let path = PathBuf::from(exe_path.trim());
    if !path.is_file() {
        return Err(format!("应用文件不存在: {}", path.display()));
    }
    if let Some(svg) = app_svg_icon_data_url(&path)? {
        return Ok(svg);
    }
    app_icon_data_url_inner(&path)
}

fn app_svg_icon_data_url(exe_path: &Path) -> Result<Option<String>, String> {
    let Some(app_dir) = exe_path.parent() else {
        return Ok(None);
    };
    let icon_path = app_dir.join("assets").join("icon.svg");
    if !icon_path.is_file() {
        return Ok(None);
    }

    let svg =
        std::fs::read_to_string(&icon_path).map_err(|e| format!("读取应用 SVG 图标失败: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(svg.as_bytes());
    Ok(Some(format!("data:image/svg+xml;base64,{b64}")))
}

#[cfg(target_os = "windows")]
fn app_icon_data_url_inner(path: &Path) -> Result<String, String> {
    crate::thumbnails::file_thumbnail_png_data_url(path, 64, 64)
}

#[cfg(not(target_os = "windows"))]
fn app_icon_data_url_inner(_path: &Path) -> Result<String, String> {
    Err("当前系统不支持读取应用图标".to_string())
}

fn app_status_inner(state: &Arc<AppLauncherState>, id: &str) -> Result<AppStatusResult, String> {
    let entry = state
        .processes
        .lock()
        .map_err(|_| "进程状态锁定失败".to_string())?
        .get(id)
        .cloned();

    let Some(entry) = entry else {
        return Ok(AppStatusResult::stopped());
    };

    let exit_code = entry.exit_code.lock().ok().and_then(|c| *c);
    if exit_code.is_some() {
        return Ok(AppStatusResult::stopped());
    }

    Ok(AppStatusResult {
        running: true,
        pid: Some(entry.pid),
        started_at: Some(entry.started_at_ms),
        exit_code: None,
    })
}
