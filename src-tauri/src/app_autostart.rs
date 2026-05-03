use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::app_launcher::{
    app_launch_inner, build_registered_app_launch_args, AppLauncherState, RegisteredAppLaunchConfig,
};

fn auto_start_targets(app: &AppHandle) -> Result<Vec<RegisteredAppLaunchConfig>, String> {
    let records = crate::app_registry::load_registered_app_records(app)?;
    let mut targets = Vec::new();

    for value in records {
        let config: RegisteredAppLaunchConfig = serde_json::from_value(value)
            .map_err(|error| format!("注册应用配置不完整: {error}"))?;
        if config.auto_start {
            targets.push(config);
        }
    }

    Ok(targets)
}

async fn launch_auto_start_app(app: AppHandle, config: RegisteredAppLaunchConfig) -> Result<(), String> {
    let launcher = app.state::<Arc<AppLauncherState>>().inner().clone();
    app_launch_inner(
        app,
        launcher,
        config.id.clone(),
        config.path.clone(),
        build_registered_app_launch_args(&config, "hide"),
    )
    .await
}

pub(crate) fn schedule_registered_app_auto_start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(800)).await;
        let targets = match auto_start_targets(&app) {
            Ok(targets) => targets,
            Err(error) => {
                eprintln!("[app-autostart] failed to load registered apps: {error}");
                crate::host_primitives::emit_toast(&app, format!("读取应用自启配置失败：{error}"));
                return;
            }
        };

        for config in targets {
            let app_id = config.id.clone();
            if let Err(error) = launch_auto_start_app(app.clone(), config).await {
                eprintln!("[app-autostart] failed to auto start {app_id}: {error}");
                crate::host_primitives::emit_toast(&app, format!("自启应用失败：{app_id}，{error}"));
            }
        }
    });
}
