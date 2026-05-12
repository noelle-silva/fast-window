use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::Manager;
use tokio::process::{Child, ChildStdout, Command};

use crate::backend_lifecycle::BackendProcessState;
use crate::data_dir;

#[cfg(all(target_os = "windows", not(debug_assertions)))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendEndpoint {
    pub(crate) mode: &'static str,
    pub(crate) transport: &'static str,
    pub(crate) url: String,
    pub(crate) image_base_url: String,
    pub(crate) token: String,
    pub(crate) protocol_version: u8,
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
        self.process.endpoint("剪贴板历史后台未就绪").await
    }
}

pub(crate) async fn start_backend(
    app: tauri::AppHandle,
    state: Arc<BackendState>,
) -> Result<(), String> {
    let session_token = token();
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
    cmd.env("FW_APP_DATA_DIR", data_dir);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::inherit());
    cmd.kill_on_drop(true);
    hide_backend_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动剪贴板历史后台失败: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "剪贴板历史后台 stdout 不可用".to_string())?;
    Ok((child, stdout))
}

fn backend_endpoint_from_ready(value: serde_json::Value, session_token: &str) -> Option<BackendEndpoint> {
    if value.get("type").and_then(|v| v.as_str()) != Some("ready") {
        return None;
    }
    let ipc = value.get("ipc")?;
    let url = ipc.get("url").and_then(|v| v.as_str())?.to_string();
    let image_base_url = ipc
        .get("imageBaseUrl")
        .and_then(|v| v.as_str())?
        .to_string();
    Some(BackendEndpoint {
        mode: "direct",
        transport: "local-websocket",
        url,
        image_base_url,
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

fn backend_command(app: &tauri::AppHandle) -> Result<Command, String> {
    Ok(Command::new(resolve_backend_sidecar(app)?))
}

fn token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("failed to generate clipboard history sidecar token");
    format!("ch-{}", hex_token(&bytes))
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

fn resolve_backend_sidecar(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let exe_name = if cfg!(target_os = "windows") {
        "clipboard-history-backend.exe"
    } else {
        "clipboard-history-backend"
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

    Err(format!("剪贴板历史 sidecar 不存在: {exe_name}"))
}
