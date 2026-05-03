#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fw_window;
mod control_server;
mod data_dir;
mod single_instance;
mod standalone_tray;

use control_server::{available_commands, start_control_server, ControlServerConfig};
use data_dir::DataDirStatus;
use fw_window::{
    app_ready, apply_fw_args, fw_initial_command, fw_launch_info, install_window_policy, parse_fw_args,
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
    last_error: Mutex<Option<String>>,
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

impl BackendState {
    fn stop_sync(&self) {
        if let Ok(mut child) = self.child.try_lock() {
            if let Some(mut ch) = child.take() {
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

#[tauri::command]
fn data_dir_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<DataDirStatus, String> {
    let runtime_error = state.last_error.lock().ok().and_then(|value| value.clone());
    Ok(data_dir::data_dir_status(&app, runtime_error))
}

#[tauri::command]
async fn pick_data_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<Option<DataDirStatus>, String> {
    let Some(path) = rfd::FileDialog::new().set_title("选择网站收藏数据目录").pick_folder() else {
        return Ok(None);
    };
    data_dir::save_data_dir(&app, &path)?;
    state.stop_sync();
    if let Ok(mut endpoint) = state.endpoint.lock() {
        *endpoint = None;
    }
    if let Ok(mut error) = state.last_error.lock() {
        *error = None;
    }
    let state_inner = state.inner().clone();
    if let Err(error) = start_backend(app.clone(), state_inner).await {
        if let Ok(mut last_error) = state.last_error.lock() {
            *last_error = Some(error.clone());
        }
        return Err(error);
    }
    Ok(Some(data_dir::data_dir_status(&app, None)))
}

async fn start_backend(app: tauri::AppHandle, state: Arc<BackendState>) -> Result<(), String> {
    let session_token = token();
    let data_dir = data_dir::resolve_data_dir(&app);
    data_dir::ensure_writable_dir(&data_dir)?;

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

    #[cfg(debug_assertions)]
    let context = tauri::generate_context!("tauri.conf.dev.json");
    #[cfg(not(debug_assertions))]
    let context = tauri::generate_context!("tauri.conf.json");

    let backend_state = Arc::new(BackendState::default());
    let backend_state_setup = backend_state.clone();
    let window_state = Arc::new(FwWindowState::default());
    let window_state_setup = window_state.clone();

    tauri::Builder::default()
        .manage(backend_state)
        .manage(window_state)
        .invoke_handler(tauri::generate_handler![backend_endpoint, data_dir_status, pick_data_dir, app_ready, fw_initial_command, fw_launch_info])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .expect("main window not found");
            let backend_for_tray_quit = backend_state_setup.clone();
            standalone_tray::install_standalone_tray(
                app,
                &fw_args,
                window_state_setup.clone(),
                Arc::new(move || backend_for_tray_quit.stop_sync()),
            )?;
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
                    if let Ok(mut error) = backend_state_setup.last_error.lock() {
                        *error = Some(e.clone());
                    }
                    eprintln!("[bookmarks-app] {e}");
                }
            });
            Ok(())
        })
        .run(context)
        .expect("error while running bookmarks app");
}
