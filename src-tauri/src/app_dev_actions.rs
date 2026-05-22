use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;

use crate::app_lifecycle::{stop_registered_app_for_update, AppLifecycleManager};

const HOST_DEV_PROFILE_ENV: &str = "FAST_WINDOW_HOST_PROFILE";
const HOST_DEV_PROFILE_VALUE: &str = "dev";
const DEV_STAGE_SCRIPT: &str = "scripts/stage-v5-app.mjs";

#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppDevStageResult {
    app_id: String,
    stop_result: crate::app_lifecycle::manager::AppStopResult,
    command: Vec<String>,
}

#[tauri::command]
pub(crate) async fn app_dev_stage_v5(
    lifecycle: tauri::State<'_, Arc<AppLifecycleManager>>,
    app_id: String,
) -> Result<AppDevStageResult, String> {
    ensure_host_dev_profile()?;
    let app_id = normalize_dev_action_app_id(app_id)?;

    let stop_result = stop_registered_app_for_update(lifecycle.inner(), &app_id).await?;
    let workspace_root = host_workspace_root()?;
    let command = vec![
        "pnpm".to_string(),
        "apps:stage:v5:dev".to_string(),
        "--".to_string(),
        "--app".to_string(),
        app_id.clone(),
    ];
    run_dev_stage_command_in_terminal(&workspace_root, &app_id).await?;

    Ok(AppDevStageResult {
        app_id,
        stop_result,
        command,
    })
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
    let stage_script = root.join(DEV_STAGE_SCRIPT);
    if !stage_script.is_file() {
        return Err(format!("无法定位 app dev stage 脚本: {}", stage_script.display()));
    }
    Ok(root)
}

async fn run_dev_stage_command_in_terminal(
    workspace_root: &Path,
    app_id: &str,
) -> Result<(), String> {
    let mut command = dev_stage_terminal_command(workspace_root, app_id)?;
    let status = command
        .status()
        .await
        .map_err(|error| format!("启动 app dev stage 终端失败: {error}"))?;

    if !status.success() {
        return Err(format!("app dev stage 终端命令失败，退出码: {status}"));
    }

    Ok(())
}

#[cfg(windows)]
fn dev_stage_terminal_command(workspace_root: &Path, app_id: &str) -> Result<Command, String> {
    let script = format!(
        "title Fast Window Dev Stage - {app_id} && \
         echo [fast-window] staging dev app: {app_id} && \
         echo [fast-window] command: pnpm apps:stage:v5:dev -- --app {app_id} && \
         echo. && \
         call pnpm.cmd apps:stage:v5:dev -- --app {app_id} & \
         set \"FW_EXIT_CODE=!ERRORLEVEL!\" & \
         echo. & \
         if !FW_EXIT_CODE! EQU 0 (echo [fast-window] stage dev completed.) else (echo [fast-window] stage dev failed with exit code !FW_EXIT_CODE!.) & \
         echo [fast-window] window will close in 5 seconds... & \
         timeout /t 5 /nobreak >nul & \
         exit /b !FW_EXIT_CODE!"
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
fn dev_stage_terminal_command(_workspace_root: &Path, _app_id: &str) -> Result<Command, String> {
    Err("当前平台暂不支持可视化终端执行 app dev stage".to_string())
}
