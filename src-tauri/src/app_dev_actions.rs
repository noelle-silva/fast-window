use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;

use crate::app_lifecycle::{stop_registered_app_for_update, AppLifecycleManager};

const HOST_DEV_PROFILE_ENV: &str = "FAST_WINDOW_HOST_PROFILE";
const HOST_DEV_PROFILE_VALUE: &str = "dev";
const APP_COMMAND_SCRIPTS: &[&str] = &["scripts/stage-v5-app.mjs", "scripts/release-v5-app.mjs"];

#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum AppDevTerminalCommandRequest {
    StageDev,
    Release { bump: AppReleaseBump },
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AppReleaseBump {
    Patch,
    Minor,
    Major,
}

impl AppReleaseBump {
    fn as_arg(self) -> &'static str {
        match self {
            Self::Patch => "patch",
            Self::Minor => "minor",
            Self::Major => "major",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Patch => "Release Patch",
            Self::Minor => "Release Minor",
            Self::Major => "Release Major",
        }
    }
}

struct AppDevTerminalCommandSpec {
    title: String,
    description: String,
    args: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppDevTerminalCommandResult {
    app_id: String,
    stop_result: crate::app_lifecycle::manager::AppStopResult,
    command: Vec<String>,
}

#[tauri::command]
pub(crate) async fn app_dev_run_terminal_command(
    lifecycle: tauri::State<'_, Arc<AppLifecycleManager>>,
    app_id: String,
    request: AppDevTerminalCommandRequest,
) -> Result<AppDevTerminalCommandResult, String> {
    ensure_host_dev_profile()?;
    let app_id = normalize_dev_action_app_id(app_id)?;

    let stop_result = stop_registered_app_for_update(lifecycle.inner(), &app_id).await?;
    let workspace_root = host_workspace_root()?;
    let spec = request.to_spec(&app_id);
    run_app_dev_terminal_command(&workspace_root, &spec).await?;

    Ok(AppDevTerminalCommandResult {
        app_id,
        stop_result,
        command: spec.command_preview(),
    })
}

impl AppDevTerminalCommandRequest {
    fn to_spec(&self, app_id: &str) -> AppDevTerminalCommandSpec {
        match self {
            Self::StageDev => AppDevTerminalCommandSpec {
                title: format!("Fast Window Stage Dev - {app_id}"),
                description: format!("stage dev app: {app_id}"),
                args: vec![
                    "apps:stage:v5:dev".to_string(),
                    "--".to_string(),
                    "--app".to_string(),
                    app_id.to_string(),
                ],
            },
            Self::Release { bump } => AppDevTerminalCommandSpec {
                title: format!("Fast Window {} - {app_id}", bump.label()),
                description: format!("release app: {app_id} ({})", bump.as_arg()),
                args: vec![
                    "apps:release:v5".to_string(),
                    "--".to_string(),
                    "--app".to_string(),
                    app_id.to_string(),
                    "--bump".to_string(),
                    bump.as_arg().to_string(),
                ],
            },
        }
    }
}

impl AppDevTerminalCommandSpec {
    fn command_preview(&self) -> Vec<String> {
        let mut command = vec!["pnpm".to_string(), "run".to_string()];
        command.extend(self.args.clone());
        command
    }
}

fn ensure_host_dev_profile() -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("当前宿主不是 debug 构建，拒绝执行 app 开发命令".to_string());
    }

    match std::env::var(HOST_DEV_PROFILE_ENV) {
        Ok(value) if value == HOST_DEV_PROFILE_VALUE => Ok(()),
        _ => Err("当前宿主不是 dev profile，拒绝执行 app 开发命令".to_string()),
    }
}

fn normalize_dev_action_app_id(app_id: String) -> Result<String, String> {
    let app_id = app_id.trim().to_string();
    if app_id.len() > 128 || !crate::is_safe_id(&app_id) {
        return Err("appId 不合法".to_string());
    }
    Ok(app_id)
}

fn host_workspace_root() -> Result<PathBuf, String> {
    let tauri_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let Some(root) = tauri_dir.parent() else {
        return Err("无法定位宿主仓库根目录".to_string());
    };
    let root = root.to_path_buf();
    for script in APP_COMMAND_SCRIPTS {
        let script_path = root.join(script);
        if !script_path.is_file() {
            return Err(format!("无法定位 app 终端命令脚本: {}", script_path.display()));
        }
    }
    Ok(root)
}

async fn run_app_dev_terminal_command(
    workspace_root: &Path,
    spec: &AppDevTerminalCommandSpec,
) -> Result<(), String> {
    let mut command = app_dev_terminal_command(workspace_root, spec)?;
    let status = command
        .status()
        .await
        .map_err(|error| format!("启动 app 终端命令失败: {error}"))?;

    if !status.success() {
        return Err(format!("app 终端命令失败，退出码: {status}"));
    }

    Ok(())
}

#[cfg(windows)]
fn app_dev_terminal_command(workspace_root: &Path, spec: &AppDevTerminalCommandSpec) -> Result<Command, String> {
    let command_text = cmd_display_command(spec);
    let command_args = cmd_command_args(spec);
    let script = format!(
        "title {} && \
         echo [fast-window] {} && \
         echo [fast-window] command: {} && \
         echo. && \
         call pnpm.cmd {} & \
         set \"FW_EXIT_CODE=!ERRORLEVEL!\" & \
         echo. & \
         if !FW_EXIT_CODE! EQU 0 (echo [fast-window] command completed.) else (echo [fast-window] command failed with exit code !FW_EXIT_CODE!.) & \
         echo [fast-window] window will close in 5 seconds... & \
         timeout /t 5 /nobreak >nul & \
         exit /b !FW_EXIT_CODE!",
        cmd_quote(&spec.title),
        spec.description,
        command_text,
        command_args,
    );

    let mut command = Command::new("cmd.exe");
    command
        .current_dir(workspace_root)
        .creation_flags(CREATE_NEW_CONSOLE)
        .arg("/d")
        .arg("/s")
        .arg("/v:on")
        .arg("/c")
        .arg(script);
    Ok(command)
}

#[cfg(not(windows))]
fn app_dev_terminal_command(_workspace_root: &Path, _spec: &AppDevTerminalCommandSpec) -> Result<Command, String> {
    Err("当前平台暂不支持可视化终端执行 app 命令".to_string())
}

#[cfg(windows)]
fn cmd_display_command(spec: &AppDevTerminalCommandSpec) -> String {
    spec.command_preview()
        .into_iter()
        .map(|arg| cmd_quote(&arg))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(windows)]
fn cmd_command_args(spec: &AppDevTerminalCommandSpec) -> String {
    let mut args = vec!["run".to_string()];
    args.extend(spec.args.clone());
    args.into_iter()
        .map(|arg| cmd_quote(&arg))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(windows)]
fn cmd_quote(value: &str) -> String {
    if value.is_empty() {
        return "\"\"".to_string();
    }
    if !value.chars().any(|c| matches!(c, ' ' | '"' | '^' | '&' | '|' | '<' | '>' | '%')) {
        return value.to_string();
    }
    let escaped = value
        .replace('%', "%%")
        .replace('^', "^^")
        .replace('"', "^\"");
    format!("\"{escaped}\"")
}
