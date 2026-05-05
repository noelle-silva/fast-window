use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

const FOCUS_HIDE_DELAY_MS: u64 = 120;
const BOUNDS_REPORT_DELAY_MS: u64 = 350;
const HIDDEN_POSITION_THRESHOLD: i32 = -9000;
const MIN_WINDOW_WIDTH: u32 = 320;
const MIN_WINDOW_HEIGHT: u32 = 220;
const RUNTIME_COMMAND_EVENT: &str = "fw-app-command";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCommandPayload {
    command: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FwLaunchInfo {
    pub(crate) launched: bool,
    pub(crate) standalone: bool,
    pub(crate) mode: String,
}

#[derive(Clone)]
pub(crate) struct FwArgs {
    pub(crate) launched: bool,
    pub(crate) action: String,
    pub(crate) command: Option<String>,
    pub(crate) mode: String,
    pub(crate) x: Option<i32>,
    pub(crate) y: Option<i32>,
    pub(crate) width: Option<u32>,
    pub(crate) height: Option<u32>,
}

#[derive(Default)]
pub(crate) struct FwWindowState {
    last_window_bounds: Mutex<Option<WindowBounds>>,
    initial_action: Mutex<Option<String>>,
    initial_command: Mutex<Option<String>>,
    launch_info: Mutex<Option<FwLaunchInfo>>,
    bounds_report_seq: AtomicU64,
}

#[derive(Clone, Copy)]
struct WindowBounds {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

pub(crate) fn parse_fw_args() -> FwArgs {
    let args: Vec<String> = std::env::args().collect();
    let mut fw = FwArgs {
        launched: false,
        action: "toggle".into(),
        command: None,
        mode: "default".into(),
        x: None,
        y: None,
        width: None,
        height: None,
    };

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--fw-launched" => fw.launched = true,
            "--fw-action" => {
                if i + 1 < args.len()
                    && matches!(args[i + 1].as_str(), "toggle" | "show" | "hide" | "close")
                {
                    fw.action = args[i + 1].clone();
                    i += 1;
                }
            }
            "--fw-mode" => {
                if i + 1 < args.len()
                    && matches!(args[i + 1].as_str(), "default" | "window" | "top")
                {
                    fw.mode = args[i + 1].clone();
                    i += 1;
                }
            }
            "--fw-command" if i + 1 < args.len() => {
                let command = args[i + 1].trim();
                if !command.is_empty() && !command.starts_with("--") {
                    fw.command = Some(command.to_string());
                }
                i += 1;
            }
            "--fw-x" if i + 1 < args.len() => {
                if let Ok(v) = args[i + 1].parse::<i32>() {
                    fw.x = Some(v);
                }
                i += 1;
            }
            "--fw-y" if i + 1 < args.len() => {
                if let Ok(v) = args[i + 1].parse::<i32>() {
                    fw.y = Some(v);
                }
                i += 1;
            }
            "--fw-width" if i + 1 < args.len() => {
                if let Ok(v) = args[i + 1].parse::<u32>() {
                    if v > 0 {
                        fw.width = Some(v);
                    }
                }
                i += 1;
            }
            "--fw-height" if i + 1 < args.len() => {
                if let Ok(v) = args[i + 1].parse::<u32>() {
                    if v > 0 {
                        fw.height = Some(v);
                    }
                }
                i += 1;
            }
            _ => {}
        }
        i += 1;
    }

    fw
}

pub(crate) fn apply_fw_args(window: &WebviewWindow, args: &FwArgs, state: &FwWindowState) {
    if args.launched {
        let _ = window.set_skip_taskbar(true);
        if args.mode == "default" || args.mode == "top" {
            let _ = window.set_always_on_top(true);
        }
    } else {
        let _ = window.set_skip_taskbar(false);
        let _ = window.set_always_on_top(false);
    }
    if let (Some(x), Some(y)) = (args.x, args.y) {
        let position = PhysicalPosition::new(x, y);
        let _ = window.set_position(position);
        remember_window_bounds_from_window(window, state);
    }
    if let (Some(w), Some(h)) = (args.width, args.height) {
        let _ = window.set_size(PhysicalSize::new(w, h));
        remember_window_bounds_from_window(window, state);
    }
    if let Ok(mut initial_action) = state.initial_action.lock() {
        *initial_action = Some(args.action.clone());
    }
    if let Ok(mut initial_command) = state.initial_command.lock() {
        *initial_command = args.command.clone();
    }
    if let Ok(mut launch_info) = state.launch_info.lock() {
        *launch_info = Some(FwLaunchInfo {
            launched: args.launched,
            standalone: !args.launched,
            mode: if args.launched { args.mode.clone() } else { "standalone".to_string() },
        });
    }

    match args.action.as_str() {
        "hide" => {
            hide_without_animation(window, state);
        }
        "close" => {
            let _ = close_window(window, state);
        }
        _ => {
            stage_initial_show(window, state);
        }
    }
}

pub(crate) fn report_available_commands(commands: serde_json::Value) {
    write_stdout_json_line(serde_json::json!({
        "type": "fw-app-commands",
        "commands": commands
    }));
}

fn write_stdout_json_line(value: serde_json::Value) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{}", value);
    let _ = out.flush();
}

pub(crate) fn install_window_policy(
    window: &WebviewWindow,
    args: &FwArgs,
    state: Arc<FwWindowState>,
) {
    if !args.launched {
        return;
    }

    let auto_hide_on_blur = args.mode == "default";
    let window_for_event = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => {
            if auto_hide_on_blur {
                schedule_hide_if_unfocused(window_for_event.clone(), state.clone());
            }
        }
        WindowEvent::Moved(_) => {
            remember_window_bounds_from_window(&window_for_event, &state);
            schedule_window_bounds_report(window_for_event.clone(), state.clone());
        }
        WindowEvent::Resized(_) => {
            remember_window_bounds_from_window(&window_for_event, &state);
            schedule_window_bounds_report(window_for_event.clone(), state.clone());
        }
        WindowEvent::CloseRequested { .. } => {
            remember_window_bounds_from_window(&window_for_event, &state);
            report_remembered_window_bounds(&state);
        }
        _ => {}
    });
}

pub(crate) fn apply_control_action(
    app: &tauri::AppHandle,
    state: &FwWindowState,
    action: &str,
    command: Option<&str>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;

    match action {
        "show" => {
            show_and_focus(&window, state);
            emit_runtime_command(&window, command)?;
            Ok(())
        }
        "hide" => {
            hide_without_animation(&window, state);
            Ok(())
        }
        "toggle" => {
            if window.is_visible().unwrap_or(false) {
                hide_without_animation(&window, state);
                Ok(())
            } else {
                show_and_focus(&window, state);
                emit_runtime_command(&window, command)?;
                Ok(())
            }
        }
        "close" => close_window(&window, state).map_err(|e| format!("关闭窗口失败: {e}")),
        _ => Err(format!("未知窗口指令: {action}")),
    }
}

fn emit_runtime_command(window: &WebviewWindow, command: Option<&str>) -> Result<(), String> {
    let Some(command) = command.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    window
        .emit(
            RUNTIME_COMMAND_EVENT,
            RuntimeCommandPayload {
                command: command.to_string(),
            },
        )
        .map_err(|e| format!("投递运行中命令失败: {e}"))
}

#[tauri::command]
pub(crate) fn app_ready(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<FwWindowState>>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    let action = state
        .initial_action
        .lock()
        .ok()
        .and_then(|value| value.clone())
        .unwrap_or_else(|| "show".to_string());

    match action.as_str() {
        "hide" => Ok(()),
        "close" => close_window(&window, &state).map_err(|e| format!("关闭窗口失败: {e}")),
        _ => {
            show_and_focus(&window, &state);
            Ok(())
        }
    }
}

#[tauri::command]
pub(crate) fn fw_initial_command(
    state: tauri::State<'_, Arc<FwWindowState>>,
) -> Result<Option<String>, String> {
    Ok(state.initial_command.lock().ok().and_then(|value| value.clone()))
}

#[tauri::command]
pub(crate) fn fw_launch_info(state: tauri::State<'_, Arc<FwWindowState>>) -> Result<FwLaunchInfo, String> {
    state
        .launch_info
        .lock()
        .ok()
        .and_then(|value| value.clone())
        .ok_or_else(|| "启动信息尚未就绪".to_string())
}

fn schedule_hide_if_unfocused(window: WebviewWindow, state: Arc<FwWindowState>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(FOCUS_HIDE_DELAY_MS)).await;
        if !window.is_visible().unwrap_or(false) {
            return;
        }
        if window.is_focused().unwrap_or(false) {
            return;
        }
        hide_without_animation(&window, &state);
    });
}

fn remember_window_bounds_from_window(window: &WebviewWindow, state: &FwWindowState) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    remember_window_bounds(state, WindowBounds { position, size });
}

fn remember_window_bounds(state: &FwWindowState, bounds: WindowBounds) {
    if !is_valid_window_bounds(bounds) {
        return;
    }
    if let Ok(mut last) = state.last_window_bounds.lock() {
        *last = Some(bounds);
    }
}

fn restore_window_bounds(window: &WebviewWindow, state: &FwWindowState) {
    let bounds = state.last_window_bounds.lock().ok().and_then(|last| *last);
    if let Some(bounds) = bounds {
        let _ = window.set_size(bounds.size);
        let _ = window.set_position(bounds.position);
    }
}

fn hide_without_animation(window: &WebviewWindow, state: &FwWindowState) {
    remember_window_bounds_from_window(window, state);
    report_remembered_window_bounds(state);
    let _ = window.set_position(PhysicalPosition::new(-10000, -10000));
    let _ = window.hide();
}

fn stage_initial_show(window: &WebviewWindow, state: &FwWindowState) {
    if state
        .last_window_bounds
        .lock()
        .ok()
        .and_then(|last| *last)
        .is_none()
    {
        remember_window_bounds_from_window(window, state);
    }
    let _ = window.set_position(PhysicalPosition::new(-10000, -10000));
    let _ = window.hide();
}

pub(crate) fn show_and_focus(window: &WebviewWindow, state: &FwWindowState) {
    restore_window_bounds(window, state);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

pub(crate) fn close_window(window: &WebviewWindow, state: &FwWindowState) -> tauri::Result<()> {
    remember_window_bounds_from_window(window, state);
    report_remembered_window_bounds(state);
    window.close()
}

fn schedule_window_bounds_report(window: WebviewWindow, state: Arc<FwWindowState>) {
    let seq = state
        .bounds_report_seq
        .fetch_add(1, Ordering::Relaxed)
        .saturating_add(1);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(BOUNDS_REPORT_DELAY_MS)).await;
        if state.bounds_report_seq.load(Ordering::Relaxed) != seq {
            return;
        }
        remember_window_bounds_from_window(&window, &state);
        report_remembered_window_bounds(&state);
    });
}

fn report_remembered_window_bounds(state: &FwWindowState) {
    let bounds = state.last_window_bounds.lock().ok().and_then(|last| *last);
    let Some(bounds) = bounds else {
        return;
    };
    report_window_bounds(bounds);
}

fn report_window_bounds(bounds: WindowBounds) {
    if !is_valid_window_bounds(bounds) {
        return;
    }
    let message = serde_json::json!({
        "type": "fw-app-window-bounds",
        "windowBounds": {
            "x": bounds.position.x,
            "y": bounds.position.y,
            "width": bounds.size.width,
            "height": bounds.size.height,
        }
    });
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{message}");
    let _ = out.flush();
}

fn is_valid_window_bounds(bounds: WindowBounds) -> bool {
    if bounds.position.x <= HIDDEN_POSITION_THRESHOLD
        || bounds.position.y <= HIDDEN_POSITION_THRESHOLD
    {
        return false;
    }
    bounds.size.width >= MIN_WINDOW_WIDTH && bounds.size.height >= MIN_WINDOW_HEIGHT
}
