use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::Manager;
use tokio::process::{Child, ChildStdout, Command};

use crate::backend_lifecycle::BackendProcessState;
use crate::control_server::session_token as create_session_token;
use crate::data_dir;

const BACKEND_SIDECAR_BASE: &str = "ai-studio-backend";

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
        self.process.endpoint("AI Studio 后台未就绪").await
    }
}

pub(crate) async fn start_backend(
    app: tauri::AppHandle,
    state: Arc<BackendState>,
) -> Result<(), String> {
    let session_token = create_session_token();
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
        .map_err(|e| format!("启动 AI Studio 后台失败: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "AI Studio 后台 stdout 不可用".to_string())?;
    Ok((child, stdout))
}

fn backend_endpoint_from_ready(
    value: serde_json::Value,
    session_token: &str,
) -> Option<BackendEndpoint> {
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
    let dirs = backend_sidecar_dirs(app);
    let candidates = backend_sidecar_candidates(&dirs);
    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "AI Studio 后台 sidecar 不存在，期望文件名包含 {}，已查找目录：{}",
        backend_sidecar_file_names().join("、"),
        format_sidecar_dirs(&dirs),
    ))
}

fn backend_sidecar_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(debug_assertions)]
    push_unique_path(
        &mut dirs,
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"),
    );
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            push_unique_path(&mut dirs, dir.to_path_buf());
            push_unique_path(&mut dirs, dir.join("binaries"));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        push_unique_path(&mut dirs, resource_dir.clone());
        push_unique_path(&mut dirs, resource_dir.join("binaries"));
    }
    #[cfg(not(debug_assertions))]
    push_unique_path(
        &mut dirs,
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"),
    );
    dirs
}

fn backend_sidecar_candidates(dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let names = backend_sidecar_file_names();
    for dir in dirs {
        for name in &names {
            push_unique_path(&mut candidates, dir.join(name));
        }
    }
    for path in scan_backend_sidecars(dirs) {
        push_unique_path(&mut candidates, path);
    }
    candidates
}

fn backend_sidecar_file_names() -> Vec<String> {
    let mut names = vec![executable_name(BACKEND_SIDECAR_BASE)];
    if let Some(tuple) = target_tuple() {
        names.push(executable_name(&format!("{BACKEND_SIDECAR_BASE}-{tuple}")));
    }
    names.sort();
    names.dedup();
    names
}

fn executable_name(base: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn scan_backend_sidecars(dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut matches = Vec::new();
    for dir in dirs {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if is_backend_sidecar_file_name(file_name) {
                push_unique_path(&mut matches, path);
            }
        }
    }
    matches.sort();
    matches
}

fn is_backend_sidecar_file_name(file_name: &str) -> bool {
    if file_name == executable_name(BACKEND_SIDECAR_BASE) {
        return true;
    }
    if !file_name.starts_with(&format!("{BACKEND_SIDECAR_BASE}-")) {
        return false;
    }
    !cfg!(target_os = "windows") || file_name.ends_with(".exe")
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|item| item == &path) {
        paths.push(path);
    }
}

fn format_sidecar_dirs(dirs: &[PathBuf]) -> String {
    dirs.iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join("；")
}

fn target_tuple() -> Option<&'static str> {
    if cfg!(all(
        target_os = "windows",
        target_arch = "x86_64",
        target_env = "msvc"
    )) {
        return Some("x86_64-pc-windows-msvc");
    }
    if cfg!(all(
        target_os = "windows",
        target_arch = "aarch64",
        target_env = "msvc"
    )) {
        return Some("aarch64-pc-windows-msvc");
    }
    if cfg!(all(
        target_os = "windows",
        target_arch = "x86_64",
        target_env = "gnu"
    )) {
        return Some("x86_64-pc-windows-gnu");
    }
    if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        return Some("x86_64-apple-darwin");
    }
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Some("aarch64-apple-darwin");
    }
    if cfg!(all(
        target_os = "linux",
        target_arch = "x86_64",
        target_env = "gnu"
    )) {
        return Some("x86_64-unknown-linux-gnu");
    }
    if cfg!(all(
        target_os = "linux",
        target_arch = "aarch64",
        target_env = "gnu"
    )) {
        return Some("aarch64-unknown-linux-gnu");
    }
    if cfg!(all(
        target_os = "linux",
        target_arch = "x86_64",
        target_env = "musl"
    )) {
        return Some("x86_64-unknown-linux-musl");
    }
    if cfg!(all(
        target_os = "linux",
        target_arch = "aarch64",
        target_env = "musl"
    )) {
        return Some("aarch64-unknown-linux-musl");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{is_backend_sidecar_file_name, BACKEND_SIDECAR_BASE};

    #[test]
    fn recognizes_short_and_target_triple_sidecar_names() {
        let short = if cfg!(target_os = "windows") {
            format!("{BACKEND_SIDECAR_BASE}.exe")
        } else {
            BACKEND_SIDECAR_BASE.to_string()
        };
        assert!(is_backend_sidecar_file_name(&short));

        let triple = if cfg!(target_os = "windows") {
            format!("{BACKEND_SIDECAR_BASE}-x86_64-pc-windows-msvc.exe")
        } else {
            format!("{BACKEND_SIDECAR_BASE}-x86_64-unknown-linux-gnu")
        };
        assert!(is_backend_sidecar_file_name(&triple));
        assert!(!is_backend_sidecar_file_name(
            "other-backend-x86_64-pc-windows-msvc.exe"
        ));
    }
}
