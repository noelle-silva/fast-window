#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const CONFIG_FILE: &str = "eucli-studio-settings.json";
const WRITE_TEST_FILE: &str = ".fw-eucli-studio-write-test";
const BACKEND_BINARY_BASE: &str = "eucli-studio-backend";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataDirStatus {
    data_dir: String,
    default_data_dir: String,
    configured_data_dir: Option<String>,
    writable: bool,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FwLaunchInfo {
    launched: bool,
    standalone: bool,
    mode: String,
}

#[derive(Clone, Serialize)]
struct BackendEndpoint {
    url: String,
    token: String,
}

#[derive(Deserialize)]
struct BackendReadyFrame {
    #[serde(rename = "type")]
    frame_type: String,
    ipc: BackendReadyIpc,
}

#[derive(Deserialize)]
struct BackendReadyIpc {
    url: String,
}

struct BackendProcess {
    child: Child,
    endpoint: BackendEndpoint,
}

#[derive(Default)]
struct BackendState {
    process: Mutex<Option<BackendProcess>>,
}

#[tauri::command]
fn fw_launch_info() -> FwLaunchInfo {
    FwLaunchInfo {
        launched: false,
        standalone: true,
        mode: "standalone".to_string(),
    }
}

#[tauri::command]
fn fw_initial_command() -> Option<String> {
    None
}

#[tauri::command]
fn app_ready() {}

#[tauri::command]
fn hide_to_tray(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| format!("隐藏窗口失败: {e}"))
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle, state: tauri::State<'_, BackendState>) -> Result<(), String> {
    stop_backend_process(&state)?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn backend_endpoint(
    app: tauri::AppHandle,
    state: tauri::State<'_, BackendState>,
) -> Result<BackendEndpoint, String> {
    let mut guard = state
        .process
        .lock()
        .map_err(|_| "后端状态锁已损坏".to_string())?;
    if let Some(process) = guard.as_mut() {
        if process
            .child
            .try_wait()
            .map_err(|e| format!("检查后端进程失败: {e}"))?
            .is_none()
        {
            return Ok(process.endpoint.clone());
        }
    }

    let endpoint = start_backend_process(&app, &mut guard)?;
    Ok(endpoint)
}

#[tauri::command]
fn data_dir_status(app: tauri::AppHandle) -> Result<DataDirStatus, String> {
    let configured = load_data_dir_setting(&app)?;
    let default_data_dir = default_data_dir(&app)?;
    let data_dir = env_data_dir()
        .or_else(|| configured.clone())
        .unwrap_or_else(|| default_data_dir.clone());
    let writable_result = ensure_writable_dir(&data_dir);
    let writable_error = writable_result.as_ref().err().cloned();
    Ok(DataDirStatus {
        data_dir: data_dir.display().to_string(),
        default_data_dir: default_data_dir.display().to_string(),
        configured_data_dir: configured.map(|path| path.display().to_string()),
        writable: writable_result.is_ok(),
        error: writable_error,
    })
}

#[tauri::command]
fn pick_data_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, BackendState>,
) -> Result<Option<DataDirStatus>, String> {
    {
        let mut guard = state
            .process
            .lock()
            .map_err(|_| "后端状态锁已损坏".to_string())?;
        if let Some(process) = guard.as_mut() {
            if process
                .child
                .try_wait()
                .map_err(|e| format!("检查后端进程失败: {e}"))?
                .is_none()
            {
                return Err("请先真正退出客户端，再切换数据目录".to_string());
            }
            *guard = None;
        }
    }
    let folder = rfd::FileDialog::new()
        .set_title("选择 eucli-studio 数据目录")
        .pick_folder();

    let Some(path) = folder else {
        return Ok(None);
    };

    save_data_dir_setting(&app, &path)?;
    stop_backend_process(&state)?;
    Ok(Some(data_dir_status(app)?))
}

fn start_backend_process(
    app: &tauri::AppHandle,
    slot: &mut Option<BackendProcess>,
) -> Result<BackendEndpoint, String> {
    let data_dir = data_dir_status(app.clone())?.data_dir;
    let token = create_session_token();
    let mut command = backend_command(app)?;
    command.env("FW_APP_SESSION_TOKEN", &token);
    command.env("FW_APP_DATA_DIR", data_dir);
    command.env(
        "EUCLI_STUDIO_RELEASE_JSON",
        include_str!("../../release.json"),
    );
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::inherit());

    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 eucli-studio Go 后端失败: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Go 后端 stdout 不可用".to_string())?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("读取 Go 后端 ready 信息失败: {e}"))?;
    let ready: BackendReadyFrame = serde_json::from_str(line.trim())
        .map_err(|e| format!("解析 Go 后端 ready 信息失败: {e}"))?;
    if ready.frame_type != "ready" || !ready.ipc.url.starts_with("ws://127.0.0.1:") {
        return Err("Go 后端 ready 信息无效".to_string());
    }
    let endpoint = BackendEndpoint {
        url: ready.ipc.url,
        token,
    };
    *slot = Some(BackendProcess {
        child,
        endpoint: endpoint.clone(),
    });
    Ok(endpoint)
}

fn stop_backend_process(state: &tauri::State<'_, BackendState>) -> Result<(), String> {
    let mut guard = state
        .process
        .lock()
        .map_err(|_| "后端状态锁已损坏".to_string())?;
    if let Some(mut process) = guard.take() {
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
    Ok(())
}

fn backend_command(app: &tauri::AppHandle) -> Result<Command, String> {
    if let Some(binary) = resolve_backend_binary(app) {
        return Ok(Command::new(binary));
    }

    #[cfg(debug_assertions)]
    {
        let mut command = Command::new("go");
        command.arg("run").arg(".");
        command.current_dir(backend_go_dir()?);
        return Ok(command);
    }

    #[cfg(not(debug_assertions))]
    {
        Err("eucli-studio Go 后端二进制不存在".to_string())
    }
}

fn resolve_backend_binary(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.to_path_buf());
            dirs.push(parent.join("binaries"));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.clone());
        dirs.push(resource_dir.join("binaries"));
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));

    for dir in dirs {
        let candidate = dir.join(backend_binary_name());
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn backend_binary_name() -> String {
    if cfg!(target_os = "windows") {
        format!("{BACKEND_BINARY_BASE}.exe")
    } else {
        BACKEND_BINARY_BASE.to_string()
    }
}

fn backend_go_dir() -> Result<PathBuf, String> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("backend-go");
    if dir.is_dir() {
        Ok(dir)
    } else {
        Err(format!("backend-go 目录不存在: {}", dir.display()))
    }
}

fn create_session_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("eucli-studio-{nanos}-{}", std::process::id())
}

fn default_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("data"))
        .map_err(|e| format!("读取默认数据目录失败: {e}"))
}

// env_data_dir 返回开发体验入口通过环境变量显式指定的客户端数据目录。
// 正式客户端启动时不存在该环境变量，仍然使用设置或默认目录。
fn env_data_dir() -> Option<PathBuf> {
    std::env::var("FW_APP_DATA_DIR")
        .ok()
        .map(|value| PathBuf::from(value.trim()))
        .filter(|path| !path.as_os_str().is_empty())
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(CONFIG_FILE))
        .map_err(|e| format!("读取 App 配置目录失败: {e}"))
}

fn load_data_dir_setting(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let path = settings_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取数据目录配置失败: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析数据目录配置失败: {e}"))?;
    let data_dir = value
        .get("dataDir")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    Ok(data_dir)
}

fn save_data_dir_setting(app: &tauri::AppHandle, data_dir: &Path) -> Result<(), String> {
    ensure_writable_dir(data_dir)?;
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let payload = serde_json::json!({ "dataDir": data_dir.display().to_string() });
    let text =
        serde_json::to_string_pretty(&payload).map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(path, format!("{text}\n")).map_err(|e| format!("保存数据目录配置失败: {e}"))
}

fn ensure_writable_dir(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|e| format!("数据目录不可创建: {} ({e})", path.display()))?;
    let test_path = path.join(WRITE_TEST_FILE);
    std::fs::write(&test_path, b"ok")
        .map_err(|e| format!("数据目录不可写: {} ({e})", path.display()))?;
    let _ = std::fs::remove_file(test_path);
    Ok(())
}

fn main() {
    #[cfg(debug_assertions)]
    let context = tauri::generate_context!("tauri.conf.dev.json");
    #[cfg(not(debug_assertions))]
    let context = tauri::generate_context!("tauri.conf.json");

    tauri::Builder::default()
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            backend_endpoint,
            fw_launch_info,
            fw_initial_command,
            app_ready,
            hide_to_tray,
            exit_app,
            data_dir_status,
            pick_data_dir
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(context)
        .expect("error while running eucli-studio app");
}
