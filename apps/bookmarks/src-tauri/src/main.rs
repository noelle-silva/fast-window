#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fw_window;
mod control_server;
mod single_instance;

use control_server::{available_commands, start_control_server, ControlServerConfig};
use fw_window::{
    app_ready, apply_fw_args, fw_initial_command, install_window_policy, parse_fw_args,
    report_available_commands, FwWindowState,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
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
    if single_instance::forward_to_existing_instance(&fw_args) {
        return;
    }

    let backend_state = Arc::new(BackendState::default());
    let backend_state_setup = backend_state.clone();
    let window_state = Arc::new(FwWindowState::default());
    let window_state_setup = window_state.clone();

    tauri::Builder::default()
        .manage(backend_state)
        .manage(window_state)
        .invoke_handler(tauri::generate_handler![backend_endpoint, app_ready, fw_initial_command])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .expect("main window not found");
            install_window_policy(&window, &fw_args, window_state_setup.clone());
            apply_fw_args(&window, &fw_args, &window_state_setup);
            start_control_server(
                app.handle().clone(),
                window_state_setup.clone(),
                ControlServerConfig {
                    name: "fw-app-control",
                    bind_addr: "127.0.0.1:0",
                    token: token(),
                    announce_to_stdout: true,
                },
            )?;
            single_instance::start_single_instance_server(
                app.handle().clone(),
                window_state_setup.clone(),
            )?;
            report_available_commands(serde_json::json!(available_commands()));

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
