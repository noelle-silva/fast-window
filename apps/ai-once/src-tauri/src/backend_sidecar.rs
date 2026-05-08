use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;

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
    child: AsyncMutex<Option<Child>>,
    endpoint: Mutex<Option<BackendEndpoint>>,
    last_error: Mutex<Option<String>>,
}

impl Drop for BackendState {
    fn drop(&mut self) {
        self.stop_sync();
    }
}

impl BackendState {
    pub(crate) async fn stop(&self) {
        let child = {
            let mut guard = self.child.lock().await;
            guard.take()
        };
        if let Some(mut ch) = child {
            let _ = ch.start_kill();
            let _ = ch.wait().await;
        }
    }

    pub(crate) fn stop_sync(&self) {
        if let Ok(mut child) = self.child.try_lock() {
            if let Some(mut ch) = child.take() {
                let _ = ch.start_kill();
            }
        }
    }

    pub(crate) fn runtime_error(&self) -> Option<String> {
        self.last_error.lock().ok().and_then(|value| value.clone())
    }

    pub(crate) fn clear_runtime_state(&self) {
        if let Ok(mut endpoint) = self.endpoint.lock() {
            *endpoint = None;
        }
        if let Ok(mut error) = self.last_error.lock() {
            *error = None;
        }
    }

    pub(crate) fn set_runtime_error(&self, value: String) {
        if let Ok(mut error) = self.last_error.lock() {
            *error = Some(value);
        }
    }

    pub(crate) async fn endpoint(&self) -> Result<BackendEndpoint, String> {
        for _ in 0..100 {
            if let Some(error) = self.runtime_error() {
                return Err(error);
            }
            if let Ok(endpoint) = self.endpoint.lock() {
                if let Some(endpoint) = endpoint.clone() {
                    return Ok(endpoint);
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err("AI Once 后台未就绪".to_string())
    }
}

pub(crate) async fn start_backend(
    app: tauri::AppHandle,
    state: Arc<BackendState>,
) -> Result<(), String> {
    let session_token = random_token("ai-once-backend");
    let data_dir = data_dir::resolve_data_dir(&app);
    data_dir::ensure_writable_dir(&data_dir)?;

    let mut cmd = Command::new(resolve_backend_sidecar(&app)?);
    cmd.env("FW_APP_SESSION_TOKEN", &session_token);
    cmd.env("FW_APP_DATA_DIR", &data_dir);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::inherit());
    cmd.kill_on_drop(true);
    hide_backend_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 AI Once 后台失败: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "AI Once 后台 stdout 不可用".to_string())?;
    {
        let mut guard = state.child.lock().await;
        *guard = Some(child);
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
            let Some(ipc) = value.get("ipc") else {
                continue;
            };
            let Some(url) = ipc
                .get("url")
                .and_then(|v| v.as_str())
                .filter(|url| url.starts_with("ws://127.0.0.1:"))
                .map(|s| s.to_string())
            else {
                continue;
            };
            if let Ok(mut endpoint) = state_for_stdout.endpoint.lock() {
                *endpoint = Some(BackendEndpoint {
                    mode: "direct",
                    transport: "local-websocket",
                    url,
                    token: session_token.clone(),
                    protocol_version: 1,
                });
            }
        }
    });

    Ok(())
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
        "ai-once-backend.exe"
    } else {
        "ai-once-backend"
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

    Err(format!("AI Once 后台 sidecar 不存在: {exe_name}"))
}
