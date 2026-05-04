#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend_sidecar;
mod control_server;
mod data_dir;
mod fw_window;
mod single_instance;
mod standalone_tray;

use backend_sidecar::{start_backend, BackendEndpoint, BackendState};
use control_server::{available_commands, start_control_server, ControlServerConfig};
use data_dir::DataDirStatus;
use fw_window::{
    app_ready, apply_fw_args, fw_initial_command, fw_launch_info, install_window_policy, parse_fw_args,
    report_available_commands, FwWindowState,
};
use std::sync::Arc;
use tauri::{Manager, WindowEvent};

#[tauri::command]
async fn backend_endpoint(
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<BackendEndpoint, String> {
    state.endpoint().await
}

#[tauri::command]
fn data_dir_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<DataDirStatus, String> {
    Ok(data_dir::data_dir_status(&app, state.runtime_error()))
}

#[tauri::command]
async fn pick_data_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<Option<DataDirStatus>, String> {
    let Some(path) = rfd::FileDialog::new().set_title("选择 AI Studio 数据目录").pick_folder() else {
        return Ok(None);
    };
    data_dir::save_data_dir(&app, &path)?;
    state.stop_sync();
    state.clear_runtime_state();
    let state_inner = state.inner().clone();
    if let Err(error) = start_backend(app.clone(), state_inner).await {
        state.set_runtime_error(error.clone());
        return Err(error);
    }
    Ok(Some(data_dir::data_dir_status(&app, None)))
}

fn main() {
    let fw_args = parse_fw_args();
    if single_instance::forward_to_existing_instance(&fw_args) {
        return;
    }

    #[cfg(debug_assertions)]
    let context = tauri::generate_context!("tauri.conf.dev.json");
    #[cfg(not(debug_assertions))]
    let context = tauri::generate_context!("tauri.conf.json");

    let backend_state = Arc::new(BackendState::default());
    let backend_state_setup = backend_state.clone();
    let window_state = Arc::new(FwWindowState::default());
    let window_state_setup = window_state.clone();

    tauri::Builder::default()
        .manage(backend_state)
        .manage(window_state)
        .invoke_handler(tauri::generate_handler![backend_endpoint, data_dir_status, pick_data_dir, app_ready, fw_initial_command, fw_launch_info])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .expect("main window not found");
            let stop_backend = {
                let backend = backend_state_setup.clone();
                Arc::new(move || backend.stop_sync())
            };
            standalone_tray::install_standalone_tray(
                app,
                &fw_args,
                window_state_setup.clone(),
                stop_backend.clone(),
            )?;
            let stop_backend_for_window_close = stop_backend.clone();
            window.on_window_event(move |event| {
                if matches!(event, WindowEvent::CloseRequested { .. }) {
                    stop_backend_for_window_close();
                }
            });
            install_window_policy(&window, &fw_args, window_state_setup.clone());
            apply_fw_args(&window, &fw_args, &window_state_setup);
            start_control_server(
                app.handle().clone(),
                window_state_setup.clone(),
                ControlServerConfig {
                    name: "fw-ai-studio-control",
                    bind_addr: "127.0.0.1:0",
                    token: control_server::session_token(),
                    announce_to_stdout: true,
                },
            )?;
            single_instance::start_single_instance_server(
                app.handle().clone(),
                window_state_setup.clone(),
            )?;
            report_available_commands(serde_json::json!(available_commands()));

            let handle = app.handle().clone();
            let state = backend_state_setup.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_backend(handle, state).await {
                    backend_state_setup.set_runtime_error(e.clone());
                    eprintln!("[ai-studio-app] {e}");
                }
            });
            Ok(())
        })
        .run(context)
        .expect("error while running AI Studio app");
}
