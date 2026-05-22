use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::app_lifecycle::{stop_registered_app_for_update, AppLifecycleManager};
use crate::dev_terminal::{host_workspace_root, run_dev_terminal_command, DevTerminalCommandSpec};

const HOST_DEV_PROFILE_ENV: &str = "FAST_WINDOW_HOST_PROFILE";
const HOST_DEV_PROFILE_VALUE: &str = "dev";
const APP_COMMAND_SCRIPTS: &[&str] = &["scripts/stage-v5-app.mjs", "scripts/release-v5-app.mjs"];

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
    let workspace_root = host_workspace_root(APP_COMMAND_SCRIPTS)?;
    let spec = request.to_spec(&app_id);
    run_app_dev_terminal_command(&workspace_root, &spec).await?;

    Ok(AppDevTerminalCommandResult {
        app_id,
        stop_result,
        command: spec.command_preview(),
    })
}

impl AppDevTerminalCommandRequest {
    fn to_spec(&self, app_id: &str) -> DevTerminalCommandSpec {
        match self {
            Self::StageDev => DevTerminalCommandSpec {
                title: format!("Fast Window Stage Dev - {app_id}"),
                description: format!("stage dev app: {app_id}"),
                args: vec![
                    "apps:stage:v5:dev".to_string(),
                    "--".to_string(),
                    "--app".to_string(),
                    app_id.to_string(),
                ],
            },
            Self::Release { bump } => DevTerminalCommandSpec {
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

async fn run_app_dev_terminal_command(
    workspace_root: &std::path::Path,
    spec: &DevTerminalCommandSpec,
) -> Result<(), String> {
    run_dev_terminal_command(workspace_root, spec).await
}
