#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_layout;
mod backend_lifecycle;
mod backend_sidecar;
mod control_server;
mod data_dir;
mod fw_window;
mod native_dialog;
mod shutdown;
mod single_instance;
mod standalone_tray;
mod system_icon;

use backend_sidecar::{start_backend, BackendEndpoint, BackendState};
use control_server::{
    available_commands, random_token, start_control_server, ControlServerConfig, FOLDERS_APP_ID,
};
use data_dir::DataDirStatus;
use fw_window::{
    app_ready, apply_fw_args, fw_initial_command, fw_launch_info, install_window_policy,
    parse_fw_args, report_available_commands, take_shutdown_requested, FwWindowState,
};
use shutdown::ShutdownState;
use std::sync::Arc;
use tauri::{Manager, WindowEvent};

#[tauri::command]
async fn backend_endpoint(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<BackendEndpoint, String> {
    let state_inner = state.inner().clone();
    if let Err(error) = start_backend(app, state_inner).await {
        state.set_runtime_error(error.clone());
        return Err(error);
    }
    state.endpoint().await
}

#[tauri::command]
fn data_dir_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<DataDirStatus, String> {
    data_dir::data_dir_status(&app, state.runtime_error())
}

#[tauri::command]
async fn pick_data_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<Option<DataDirStatus>, String> {
    let Some(path) = native_dialog::run_file_dialog(&app, |dialog| {
        dialog.set_title("选择收藏集数据目录").pick_folder()
    })?
    else {
        return Ok(None);
    };
    data_dir::save_data_dir(&app, &path)?;
    state.stop().await;
    state.clear_runtime_state();
    let state_inner = state.inner().clone();
    if let Err(error) = start_backend(app.clone(), state_inner).await {
        state.set_runtime_error(error.clone());
        return Err(error);
    }
    Ok(Some(data_dir::data_dir_status(&app, None)?))
}

#[tauri::command]
fn pick_folder_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(native_dialog::run_file_dialog(&app, |dialog| {
        dialog.set_title("选择要收藏的文件夹").pick_folder()
    })?
    .map(|path| path.display().to_string()))
}

#[tauri::command]
fn pick_file_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(native_dialog::run_file_dialog(&app, |dialog| {
        dialog.set_title("选择要收藏的文件").pick_file()
    })?
    .map(|path| path.display().to_string()))
}

#[tauri::command]
fn pick_image_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(native_dialog::run_file_dialog(&app, |dialog| {
        dialog
            .set_title("选择图片")
            .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif"])
            .pick_file()
    })?
    .map(|path| path.display().to_string()))
}

#[tauri::command]
async fn restart_backend(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<DataDirStatus, String> {
    state.stop().await;
    state.clear_runtime_state();
    let state_inner = state.inner().clone();
    if let Err(error) = start_backend(app.clone(), state_inner).await {
        state.set_runtime_error(error.clone());
        return Err(error);
    }
    data_dir::data_dir_status(&app, None)
}

#[tauri::command]
fn hide_to_tray(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<FwWindowState>>,
) -> Result<(), String> {
    let window = native_dialog::main_window(&app)?;
    fw_window::hide_to_tray(&window, &state).map_err(|e| format!("隐藏窗口失败: {e}"))
}

fn desktop_identifier() -> &'static str {
    #[cfg(debug_assertions)]
    {
        "com.fastwindow.folders.dev"
    }
    #[cfg(not(debug_assertions))]
    {
        "com.fastwindow.folders"
    }
}

fn main() {
    let fw_args = parse_fw_args();
    let desktop_identifier = desktop_identifier().to_string();
    if single_instance::forward_to_existing_instance(&fw_args, &desktop_identifier) {
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
    let shutdown_state = ShutdownState::new(
        backend_state.clone(),
        window_state.clone(),
        desktop_identifier.clone(),
    );
    let shutdown_state_setup = shutdown_state.clone();
    let shutdown_state_for_run = shutdown_state.clone();

    tauri::Builder::default()
        .manage(backend_state)
        .manage(window_state)
        .invoke_handler(tauri::generate_handler![
            backend_endpoint,
            data_dir_status,
            pick_data_dir,
            pick_folder_path,
            pick_file_path,
            pick_image_path,
            restart_backend,
            hide_to_tray,
            system_icon::system_icon_data_url,
            app_ready,
            fw_initial_command,
            fw_launch_info
        ])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .expect("main window not found");
            let shutdown_for_tray = shutdown_state_setup.clone();
            standalone_tray::install_standalone_tray(
                app,
                &fw_args,
                window_state_setup.clone(),
                Arc::new(move |app| shutdown_for_tray.shutdown(app)),
            )?;

            let standalone_launch = !fw_args.launched;
            let app_handle_for_close = app.handle().clone();
            let window_state_for_close = window_state_setup.clone();
            let shutdown_for_close = shutdown_state_setup.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if standalone_launch && !take_shutdown_requested(&window_state_for_close) {
                        api.prevent_close();
                        if let Some(window) = app_handle_for_close.get_webview_window("main") {
                            let _ = fw_window::hide_to_tray(&window, &window_state_for_close);
                        }
                    } else {
                        api.prevent_close();
                        shutdown_for_close.shutdown(app_handle_for_close.clone());
                    }
                }
            });

            install_window_policy(&window, &fw_args, window_state_setup.clone());
            apply_fw_args(&window, &fw_args, &window_state_setup);
            start_control_server(
                app.handle().clone(),
                window_state_setup.clone(),
                ControlServerConfig {
                    name: "fw-folders-control",
                    app_id: FOLDERS_APP_ID,
                    server_id: "fw-control",
                    bind_addr: "127.0.0.1:0",
                    token: random_token("folders-control"),
                    announce_to_stdout: true,
                },
            )?;
            single_instance::start_single_instance_server(
                app.handle().clone(),
                window_state_setup.clone(),
                &desktop_identifier,
            )?;
            report_available_commands(serde_json::json!(available_commands()));

            let handle = app.handle().clone();
            let state = backend_state_setup.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = start_backend(handle, state).await {
                    backend_state_setup.set_runtime_error(error.clone());
                    eprintln!("[folders] {error}");
                }
            });
            Ok(())
        })
        .build(context)
        .expect("error while building folders app")
        .run(move |app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !shutdown_state_for_run.is_shutting_down() {
                    api.prevent_exit();
                    shutdown_state_for_run.shutdown(app.clone());
                }
            }
        });
}
