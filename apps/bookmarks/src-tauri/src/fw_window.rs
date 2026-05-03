use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

const FOCUS_HIDE_DELAY_MS: u64 = 120;

pub(crate) struct FwArgs {
    pub(crate) launched: bool,
    pub(crate) action: String,
    pub(crate) mode: String,
    pub(crate) x: Option<i32>,
    pub(crate) y: Option<i32>,
    pub(crate) width: Option<u32>,
    pub(crate) height: Option<u32>,
}

#[derive(Default)]
pub(crate) struct FwWindowState {
    last_window_position: Mutex<Option<PhysicalPosition<i32>>>,
    initial_action: Mutex<Option<String>>,
}

pub(crate) fn parse_fw_args() -> FwArgs {
    let args: Vec<String> = std::env::args().collect();
    let mut fw = FwArgs {
        launched: false,
        action: "toggle".into(),
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
                if i + 1 < args.len() && matches!(args[i + 1].as_str(), "toggle" | "show" | "hide" | "close") {
                    fw.action = args[i + 1].clone();
                    i += 1;
                }
            }
            "--fw-mode" => {
                if i + 1 < args.len() && matches!(args[i + 1].as_str(), "default" | "window" | "top") {
                    fw.mode = args[i + 1].clone();
                    i += 1;
                }
            }
            "--fw-x" if i + 1 < args.len() => {
                if let Ok(v) = args[i + 1].parse::<i32>() { fw.x = Some(v); }
                i += 1;
            }
            "--fw-y" if i + 1 < args.len() => {
                if let Ok(v) = args[i + 1].parse::<i32>() { fw.y = Some(v); }
                i += 1;
            }
            "--fw-width" if i + 1 < args.len() => {
                if let Ok(v) = args[i + 1].parse::<u32>() { if v > 0 { fw.width = Some(v); } }
                i += 1;
            }
            "--fw-height" if i + 1 < args.len() => {
                if let Ok(v) = args[i + 1].parse::<u32>() { if v > 0 { fw.height = Some(v); } }
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
    }
    if args.mode == "default" || args.mode == "top" {
        let _ = window.set_always_on_top(true);
    }
    if let (Some(x), Some(y)) = (args.x, args.y) {
        let position = PhysicalPosition::new(x, y);
        let _ = window.set_position(position);
        remember_window_position(state, position);
    }
    if let (Some(w), Some(h)) = (args.width, args.height) {
        let _ = window.set_size(PhysicalSize::new(w, h));
    }
    if let Ok(mut initial_action) = state.initial_action.lock() {
        *initial_action = Some(args.action.clone());
    }

    match args.action.as_str() {
        "hide" => { hide_without_animation(window, state); }
        "close" => { let _ = window.close(); }
        _ => { stage_initial_show(window, state); }
    }
}

pub(crate) fn install_focus_policy(window: &WebviewWindow, args: &FwArgs, state: Arc<FwWindowState>) {
    if !args.launched || args.mode != "default" {
        return;
    }

    let window_for_event = window.clone();
    window.on_window_event(move |event| {
        match event {
            WindowEvent::Focused(false) => {
                schedule_hide_if_unfocused(window_for_event.clone(), state.clone());
            }
            WindowEvent::Moved(_) => {
                if let Ok(position) = window_for_event.outer_position() {
                    remember_window_position(&state, position);
                }
            }
            _ => {}
        }
    });
}

pub(crate) fn apply_control_action(app: &tauri::AppHandle, state: &FwWindowState, action: &str) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;

    match action {
        "show" => {
            show_and_focus(&window, state);
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
                Ok(())
            }
        }
        "close" => window.close().map_err(|e| format!("关闭窗口失败: {e}")),
        _ => Err(format!("未知窗口指令: {action}")),
    }
}

#[tauri::command]
pub(crate) fn app_ready(app: tauri::AppHandle, state: tauri::State<'_, Arc<FwWindowState>>) -> Result<(), String> {
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
        "close" => window.close().map_err(|e| format!("关闭窗口失败: {e}")),
        _ => {
            show_and_focus(&window, &state);
            Ok(())
        }
    }
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

fn remember_window_position(state: &FwWindowState, position: PhysicalPosition<i32>) {
    if position.x <= -9000 || position.y <= -9000 {
        return;
    }
    if let Ok(mut last) = state.last_window_position.lock() {
        *last = Some(position);
    }
}

fn restore_window_position(window: &WebviewWindow, state: &FwWindowState) {
    let position = state
        .last_window_position
        .lock()
        .ok()
        .and_then(|last| *last);
    if let Some(position) = position {
        let _ = window.set_position(position);
    }
}

fn hide_without_animation(window: &WebviewWindow, state: &FwWindowState) {
    if let Ok(position) = window.outer_position() {
        remember_window_position(state, position);
    }
    let _ = window.set_position(PhysicalPosition::new(-10000, -10000));
    let _ = window.hide();
}

fn stage_initial_show(window: &WebviewWindow, state: &FwWindowState) {
    if state.last_window_position.lock().ok().and_then(|last| *last).is_none() {
        if let Ok(position) = window.outer_position() {
            remember_window_position(state, position);
        }
    }
    let _ = window.set_position(PhysicalPosition::new(-10000, -10000));
    let _ = window.hide();
}

fn show_and_focus(window: &WebviewWindow, state: &FwWindowState) {
    restore_window_position(window, state);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}
