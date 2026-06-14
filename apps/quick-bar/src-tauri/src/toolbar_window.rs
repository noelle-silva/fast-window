use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow};

use crate::selection_capture::{capture_current_selection, SelectionCapture};

const TOOLBAR_LABEL: &str = "quick-bar-toolbar";
const TOOLBAR_EVENT: &str = "quick-bar-selection";
const TOOLBAR_WIDTH: u32 = 420;
const TOOLBAR_HEIGHT: u32 = 62;
const TOOLBAR_RESULT_HEIGHT: u32 = 380;
const TOOLBAR_MARGIN: i32 = 10;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolbarPayload {
    selected_text: String,
    anchor_x: i32,
    anchor_y: i32,
}

#[derive(Default)]
pub(crate) struct ToolbarState {
    latest_payload: Mutex<Option<ToolbarPayload>>,
}

impl ToolbarState {
    fn set_payload(&self, payload: ToolbarPayload) -> Result<(), String> {
        let mut latest = self
            .latest_payload
            .lock()
            .map_err(|_| "Quick Bar 浮动条状态锁定失败".to_string())?;
        *latest = Some(payload);
        Ok(())
    }

    pub(crate) fn payload(&self) -> Option<ToolbarPayload> {
        self.latest_payload
            .lock()
            .ok()
            .and_then(|value| value.clone())
    }
}

#[tauri::command]
pub(crate) fn quick_bar_toolbar_payload(
    state: tauri::State<'_, Arc<ToolbarState>>,
) -> Result<Option<ToolbarPayload>, String> {
    Ok(state.payload())
}

#[tauri::command]
pub(crate) fn hide_quick_bar_toolbar(app: tauri::AppHandle) -> Result<(), String> {
    hide_toolbar(&app)
}

#[tauri::command]
pub(crate) fn show_quick_bar_result_popup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ToolbarState>>,
) -> Result<(), String> {
    let payload = state
        .payload()
        .ok_or_else(|| "Quick Bar 缺少划词上下文，无法显示结果浮窗".to_string())?;
    let window = app
        .get_webview_window(TOOLBAR_LABEL)
        .ok_or_else(|| "Quick Bar 浮动条窗口尚未创建".to_string())?;
    apply_toolbar_layout(
        &app,
        &window,
        payload.anchor_x,
        payload.anchor_y,
        TOOLBAR_WIDTH,
        TOOLBAR_RESULT_HEIGHT,
    )
}

pub(crate) fn show_toolbar_from_current_selection(
    app: &tauri::AppHandle,
    state: &ToolbarState,
) -> Result<(), String> {
    let capture = capture_current_selection()?;
    show_toolbar(app, state, capture)
}

pub(crate) fn hide_toolbar(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TOOLBAR_LABEL) {
        window
            .hide()
            .map_err(|e| format!("隐藏 Quick Bar 浮动条失败: {e}"))?;
    }
    Ok(())
}

fn show_toolbar(
    app: &tauri::AppHandle,
    state: &ToolbarState,
    capture: SelectionCapture,
) -> Result<(), String> {
    let payload = ToolbarPayload {
        selected_text: capture.text,
        anchor_x: capture.anchor_x,
        anchor_y: capture.anchor_y,
    };
    state.set_payload(payload.clone())?;

    let window = ensure_toolbar_window(app)?;
    apply_toolbar_layout(
        app,
        &window,
        payload.anchor_x,
        payload.anchor_y,
        TOOLBAR_WIDTH,
        TOOLBAR_HEIGHT,
    )?;
    window
        .set_always_on_top(true)
        .map_err(|e| format!("设置 Quick Bar 浮动条置顶失败: {e}"))?;
    window
        .show()
        .map_err(|e| format!("显示 Quick Bar 浮动条失败: {e}"))?;
    window
        .set_focus()
        .map_err(|e| format!("聚焦 Quick Bar 浮动条失败: {e}"))?;
    window
        .emit(TOOLBAR_EVENT, payload)
        .map_err(|e| format!("刷新 Quick Bar 浮动条内容失败: {e}"))
}

fn ensure_toolbar_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(TOOLBAR_LABEL) {
        return Ok(window);
    }

    let window = tauri::WebviewWindowBuilder::new(
        app,
        TOOLBAR_LABEL,
        WebviewUrl::App("index.html?view=toolbar".into()),
    )
    .title("Quick Bar")
    .inner_size(TOOLBAR_WIDTH as f64, TOOLBAR_HEIGHT as f64)
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .shadow(true)
    .visible(false)
    .build()
    .map_err(|e| format!("创建 Quick Bar 浮动条窗口失败: {e}"))?;

    let app_for_focus = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            let _ = hide_toolbar(&app_for_focus);
        }
    });
    Ok(window)
}

fn apply_toolbar_layout(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    anchor_x: i32,
    anchor_y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let position = toolbar_position(app, anchor_x, anchor_y, width, height)?;
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| format!("设置 Quick Bar 浮动条尺寸失败: {e}"))?;
    window
        .set_position(position)
        .map_err(|e| format!("设置 Quick Bar 浮动条位置失败: {e}"))
}

fn toolbar_position(
    app: &tauri::AppHandle,
    anchor_x: i32,
    anchor_y: i32,
    width: u32,
    height: u32,
) -> Result<PhysicalPosition<i32>, String> {
    let mut x = anchor_x + TOOLBAR_MARGIN;
    let mut y = anchor_y + TOOLBAR_MARGIN;
    let monitors = app
        .available_monitors()
        .map_err(|e| format!("读取屏幕工作区失败: {e}"))?;
    let monitor = monitors
        .iter()
        .find(|monitor| {
            let area = monitor.work_area();
            anchor_x >= area.position.x
                && anchor_y >= area.position.y
                && anchor_x <= area.position.x + area.size.width as i32
                && anchor_y <= area.position.y + area.size.height as i32
        })
        .or_else(|| monitors.first())
        .ok_or_else(|| "没有可用屏幕，无法显示 Quick Bar 浮动条".to_string())?;
    let area = monitor.work_area();
    let max_x = area.position.x + area.size.width as i32 - width as i32;
    let max_y = area.position.y + area.size.height as i32 - height as i32;
    x = x.clamp(area.position.x, max_x.max(area.position.x));
    y = y.clamp(area.position.y, max_y.max(area.position.y));
    Ok(PhysicalPosition::new(x, y))
}
