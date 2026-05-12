use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::Manager;
use tokio::process::{Child, ChildStdout, Command};

use crate::backend_lifecycle::BackendProcessState;
use crate::control_server::session_token;
use crate::data_dir;

#[cfg(all(target_os = "windows", not(debug_assertions)))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
pub(crate) struct BackendEndpoint {
    pub(crate) url: String,
    pub(crate) token: String,
}

#[derive(Default)]
pub(crate) struct BackendState {
    process: BackendProcessState<BackendEndpoint>,
}

impl BackendState {
    pub(crate) async fn stop(&self) {
        self.process.stop().await;
    }

    pub(crate) fn stop_sync(&self) {
        self.process.stop_sync();
    }

    pub(crate) fn runtime_error(&self) -> Option<String> {
        self.process.runtime_error()
    }

    pub(crate) fn clear_runtime_state(&self) {
        self.process.clear_runtime_state();
    }

    pub(crate) fn set_runtime_error(&self, value: String) {
        self.process.set_runtime_error(value);
    }

    pub(crate) async fn endpoint(&self) -> Result<BackendEndpoint, String> {
        self.process.endpoint("HyperCortex 后台未就绪").await
    }
}

pub(crate) async fn start_backend(
    app: tauri::AppHandle,
    state: Arc<BackendState>,
) -> Result<(), String> {
    let session_token = session_token();
    let spawn_token = session_token.clone();
    state
        .process
        .start(
            move || spawn_backend_child(&app, &spawn_token),
            move |value| backend_endpoint_from_ready(value, &session_token),
        )
        .await
}

fn spawn_backend_child(
    app: &tauri::AppHandle,
    session_token: &str,
) -> Result<(Child, ChildStdout), String> {
    let data_dir = data_dir::resolve_data_dir(app);
    data_dir::ensure_writable_dir(&data_dir)?;

    let mut cmd = backend_command(app)?;
    cmd.env("FW_APP_SESSION_TOKEN", session_token);
    cmd.env("FW_APP_DATA_DIR", &data_dir);
    cmd.env("FW_HYPERCORTEX_LIBRARY_DIR", data_dir.join("library"));
    if let Some(ffmpeg_path) = resolve_bundled_ffmpeg(app) {
        cmd.env("FW_HYPERCORTEX_FFMPEG", ffmpeg_path);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::inherit());
    cmd.kill_on_drop(true);
    hide_backend_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 HyperCortex 后台失败: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "HyperCortex 后台 stdout 不可用".to_string())?;
    Ok((child, stdout))
}

fn backend_endpoint_from_ready(value: serde_json::Value, session_token: &str) -> Option<BackendEndpoint> {
    if value.get("type").and_then(|v| v.as_str()) != Some("ready") {
        return None;
    }
    let url = value
        .get("ipc")
        .and_then(|v| v.get("url"))
        .and_then(|v| v.as_str())?
        .to_string();
    Some(BackendEndpoint {
        url,
        token: session_token.to_string(),
    })
}

fn hide_backend_console(cmd: &mut Command) {
    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(all(target_os = "windows", not(debug_assertions))))]
    {
        let _ = cmd;
    }
}

fn backend_command(app: &tauri::AppHandle) -> Result<Command, String> {
    Ok(Command::new(resolve_backend_sidecar(app)?))
}

fn resolve_backend_sidecar(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let exe_name = if cfg!(target_os = "windows") {
        "hypercortex-backend.exe"
    } else {
        "hypercortex-backend"
    };
    let candidates = [
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|dir| dir.join(exe_name))),
        app.path().resource_dir().ok().map(|dir| dir.join(exe_name)),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!("HyperCortex 后台 sidecar 不存在: {exe_name}"))
}

fn resolve_bundled_ffmpeg(app: &tauri::AppHandle) -> Option<PathBuf> {
    let exe_name = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let candidates = [
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|dir| dir.join("bin").join(exe_name))),
        app.path()
            .resource_dir()
            .ok()
            .map(|dir| dir.join("bin").join(exe_name)),
    ];

    candidates.into_iter().flatten().find(|path| path.is_file())
}
