use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::Manager;
use tokio::process::{Child, ChildStdout, Command};

use crate::backend_lifecycle::BackendProcessState;
use crate::control_server::random_token;
use crate::data_dir;

#[cfg(all(target_os = "windows", not(debug_assertions)))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendEndpoint {
    pub(crate) mode: &'static str,
    pub(crate) transport: &'static str,
    pub(crate) url: String,
    pub(crate) token: String,
    pub(crate) protocol_version: u32,
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
        self.process.endpoint("收藏集后台未就绪").await
    }
}

pub(crate) async fn start_backend(
    app: tauri::AppHandle,
    state: Arc<BackendState>,
) -> Result<(), String> {
    let session_token = random_token("folders-backend");
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
    let data_dir = data_dir::resolve_data_dir(app)?;
    data_dir::ensure_writable_dir(&data_dir)?;

    let mut cmd = Command::new(resolve_backend_sidecar(app)?);
    cmd.env("FW_APP_SESSION_TOKEN", session_token);
    cmd.env("FW_APP_DATA_DIR", &data_dir);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::inherit());
    cmd.kill_on_drop(true);
    hide_backend_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动收藏集后台失败: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "收藏集后台 stdout 不可用".to_string())?;
    Ok((child, stdout))
}

fn backend_endpoint_from_ready(
    value: serde_json::Value,
    session_token: &str,
) -> Option<BackendEndpoint> {
    if value.get("type").and_then(|v| v.as_str()) != Some("ready") {
        return None;
    }
    let ipc = value.get("ipc")?;
    let url = ipc
        .get("url")
        .and_then(|v| v.as_str())
        .filter(|url| url.starts_with("ws://127.0.0.1:"))?
        .to_string();
    Some(BackendEndpoint {
        mode: "direct",
        transport: "local-websocket",
        url,
        token: session_token.to_string(),
        protocol_version: 1,
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

fn resolve_backend_sidecar(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let exe_name = if cfg!(target_os = "windows") {
        "folders-backend.exe"
    } else {
        "folders-backend"
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

    Err(format!("收藏集后台 sidecar 不存在: {exe_name}"))
}
