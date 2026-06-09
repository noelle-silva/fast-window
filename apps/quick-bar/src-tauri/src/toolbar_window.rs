use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow};

use crate::selection_capture::{capture_current_selection, SelectionCapture};

const TOOLBAR_LABEL: &str = "quick-bar-toolbar";
const TOOLBAR_EVENT: &str = "quick-bar-selection";
const TOOLBAR_WIDTH: u32 = 420;
const TOOLBAR_HEIGHT: u32 = 62;
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
    let position = toolbar_position(app, payload.anchor_x, payload.anchor_y)?;
    window
        .set_size(PhysicalSize::new(TOOLBAR_WIDTH, TOOLBAR_HEIGHT))
        .map_err(|e| format!("设置 Quick Bar 浮动条尺寸失败: {e}"))?;
    window
        .set_position(position)
        .map_err(|e| format!("设置 Quick Bar 浮动条位置失败: {e}"))?;
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

fn toolbar_position(
    app: &tauri::AppHandle,
    anchor_x: i32,
    anchor_y: i32,
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
    let max_x = area.position.x + area.size.width as i32 - TOOLBAR_WIDTH as i32;
    let max_y = area.position.y + area.size.height as i32 - TOOLBAR_HEIGHT as i32;
    x = x.clamp(area.position.x, max_x.max(area.position.x));
    y = y.clamp(area.position.y, max_y.max(area.position.y));
    Ok(PhysicalPosition::new(x, y))
}
