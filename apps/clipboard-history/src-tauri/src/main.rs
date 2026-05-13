#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_layout;
mod backend_lifecycle;
mod backend_sidecar;
mod control_server;
mod data_dir;
mod fw_window;
mod shutdown;
mod single_instance;
mod standalone_tray;

use backend_sidecar::{start_backend, BackendEndpoint, BackendState};
use base64::Engine as _;
use control_server::{
    available_commands, start_control_server, ControlServerConfig, CLIPBOARD_HISTORY_APP_ID,
};
use data_dir::DataDirStatus;
use fw_window::{
    app_ready, apply_fw_args, fw_initial_command, fw_launch_info, install_window_policy,
    parse_fw_args, report_available_commands, take_shutdown_requested, FwWindowState,
};
use shutdown::ShutdownState;
use std::fs;
use std::sync::Arc;
use tauri::{Manager, RunEvent, WindowEvent};

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
fn pick_legacy_data_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<FwWindowState>>,
) -> Result<Option<PickedDir>, String> {
    let window = main_window(&app)?;
    let _native_dialog = fw_window::enter_native_dialog(state.inner().clone());
    let Some(path) = rfd::FileDialog::new()
        .set_parent(&window)
        .set_title("选择旧剪贴板历史数据目录")
        .pick_folder()
    else {
        return Ok(None);
    };
    Ok(Some(PickedDir {
        dir: path.display().to_string(),
    }))
}

#[tauri::command]
fn pick_image_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<FwWindowState>>,
) -> Result<Option<PickedImage>, String> {
    let window = main_window(&app)?;
    let _native_dialog = fw_window::enter_native_dialog(state.inner().clone());
    let Some(path) = rfd::FileDialog::new()
        .set_parent(&window)
        .set_title("选择要收藏的图片")
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif"])
        .pick_file()
    else {
        return Ok(None);
    };
    let bytes = fs::read(&path).map_err(|e| format!("读取图片失败: {e}"))?;
    let mime = image_mime_from_path(&path)?;
    let data_url = format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    Ok(Some(PickedImage {
        data_url,
        mime,
        source_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("图片")
            .to_string(),
    }))
}

#[derive(serde::Serialize)]
struct PickedDir {
    dir: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedImage {
    data_url: String,
    mime: &'static str,
    source_name: String,
}

#[tauri::command]
async fn pick_data_dir(
    app: tauri::AppHandle,
    backend_state: tauri::State<'_, Arc<BackendState>>,
    window_state: tauri::State<'_, Arc<FwWindowState>>,
) -> Result<Option<DataDirStatus>, String> {
    let window = main_window(&app)?;
    let _native_dialog = fw_window::enter_native_dialog(window_state.inner().clone());
    let Some(path) = rfd::FileDialog::new()
        .set_parent(&window)
        .set_title("选择剪贴板历史数据目录")
        .pick_folder()
    else {
        return Ok(None);
    };
    data_dir::save_data_dir(&app, &path)?;
    backend_state.stop().await;
    backend_state.clear_runtime_state();
    let state_inner = backend_state.inner().clone();
    if let Err(error) = start_backend(app.clone(), state_inner).await {
        backend_state.set_runtime_error(error.clone());
        return Err(error);
    }
    Ok(Some(data_dir::data_dir_status(&app, None)?))
}

fn main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())
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
            pick_legacy_data_dir,
            pick_image_file,
            hide_to_tray,
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
            let app_handle_for_window_close = app.handle().clone();
            let window_state_for_window_close = window_state_setup.clone();
            let shutdown_for_window_close = shutdown_state_setup.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if standalone_launch && !take_shutdown_requested(&window_state_for_window_close)
                    {
                        api.prevent_close();
                        if let Some(window) = app_handle_for_window_close.get_webview_window("main")
                        {
                            let _ =
                                fw_window::hide_to_tray(&window, &window_state_for_window_close);
                        }
                    } else {
                        api.prevent_close();
                        shutdown_for_window_close.shutdown(app_handle_for_window_close.clone());
                    }
                }
            });
            install_window_policy(&window, &fw_args, window_state_setup.clone());
            apply_fw_args(&window, &fw_args, &window_state_setup);
            start_control_server(
                app.handle().clone(),
                window_state_setup.clone(),
                ControlServerConfig {
                    name: "fw-clipboard-history-control",
                    app_id: CLIPBOARD_HISTORY_APP_ID,
                    server_id: "fw-control",
                    bind_addr: "127.0.0.1:0",
                    token: control_server::session_token(),
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
                    eprintln!("[clipboard-history-app] {error}");
                }
            });
            Ok(())
        })
        .build(context)
        .expect("error while building clipboard history app")
        .run(move |app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                if !shutdown_state_for_run.is_shutting_down() {
                    api.prevent_exit();
                    shutdown_state_for_run.shutdown(app.clone());
                }
            }
        });
}

fn image_mime_from_path(path: &std::path::Path) -> Result<&'static str, String> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Ok("image/png"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "webp" => Ok("image/webp"),
        "gif" => Ok("image/gif"),
        _ => Err("请选择 PNG、JPG、WEBP 或 GIF 图片".to_string()),
    }
}

fn desktop_identifier() -> &'static str {
    #[cfg(debug_assertions)]
    {
        "com.fastwindow.clipboardhistory.dev"
    }
    #[cfg(not(debug_assertions))]
    {
        "com.fastwindow.clipboardhistory"
    }
}

#[tauri::command]
fn hide_to_tray(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<FwWindowState>>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    fw_window::hide_to_tray(&window, &state).map_err(|e| format!("隐藏窗口失败: {e}"))
}
