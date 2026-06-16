use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow};
use tokio::sync::Notify;

use crate::selection_capture::SelectionCapture;

const TOOLBAR_LABEL: &str = "quick-bar-toolbar";
const RESULT_LABEL: &str = "quick-bar-result";
const TOOLBAR_EVENT: &str = "quick-bar-selection";
const RESULT_EVENT: &str = "quick-bar-result";
const TOOLBAR_CONTENT_WIDTH: u32 = 300;
const TOOLBAR_CONTENT_HEIGHT: u32 = 58;
const TOOLBAR_SHADOW_SPACE: u32 = 12;
const TOOLBAR_WIDTH: u32 = TOOLBAR_CONTENT_WIDTH + TOOLBAR_SHADOW_SPACE * 2;
const TOOLBAR_HEIGHT: u32 = TOOLBAR_CONTENT_HEIGHT + TOOLBAR_SHADOW_SPACE * 2;
const TOOLBAR_SHADOW_SPACE_I32: i32 = TOOLBAR_SHADOW_SPACE as i32;
const RESULT_WIDTH: u32 = 420;
const RESULT_HEIGHT: u32 = 380;
const TOOLBAR_MARGIN: i32 = 10;
const RESULT_READY_TIMEOUT_MS: u64 = 2000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolbarPayload {
    selected_text: String,
    anchor_x: i32,
    anchor_y: i32,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultPayload {
    title: String,
    status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error_text: Option<String>,
}

pub(crate) struct ToolbarState {
    latest_payload: Mutex<Option<ToolbarPayload>>,
    latest_result: Mutex<Option<ResultPayload>>,
    result_ready: Mutex<bool>,
    result_ready_notify: Notify,
}

impl Default for ToolbarState {
    fn default() -> Self {
        Self {
            latest_payload: Mutex::new(None),
            latest_result: Mutex::new(None),
            result_ready: Mutex::new(false),
            result_ready_notify: Notify::new(),
        }
    }
}

impl ToolbarState {
    pub(crate) fn set_payload(&self, payload: ToolbarPayload) -> Result<(), String> {
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

    fn set_result(&self, payload: ResultPayload) -> Result<(), String> {
        let mut latest = self
            .latest_result
            .lock()
            .map_err(|_| "Quick Bar 结果浮窗状态锁定失败".to_string())?;
        *latest = Some(payload);
        Ok(())
    }

    pub(crate) fn result(&self) -> Option<ResultPayload> {
        self.latest_result
            .lock()
            .ok()
            .and_then(|value| value.clone())
    }

    fn set_result_ready(&self, ready: bool) -> Result<(), String> {
        let mut current = self
            .result_ready
            .lock()
            .map_err(|_| "Quick Bar 结果浮窗准备状态锁定失败".to_string())?;
        *current = ready;
        if ready {
            self.result_ready_notify.notify_waiters();
        }
        Ok(())
    }

    fn result_ready(&self) -> Result<bool, String> {
        self.result_ready
            .lock()
            .map(|value| *value)
            .map_err(|_| "Quick Bar 结果浮窗准备状态锁定失败".to_string())
    }

    async fn wait_result_ready(&self) -> Result<(), String> {
        let wait = async {
            loop {
                let notified = self.result_ready_notify.notified();
                if self.result_ready()? {
                    return Ok(());
                }
                notified.await;
            }
        };
        tokio::time::timeout(Duration::from_millis(RESULT_READY_TIMEOUT_MS), wait)
            .await
            .map_err(|_| "Quick Bar 结果浮窗未完成准备".to_string())?
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
pub(crate) fn quick_bar_result_payload(
    state: tauri::State<'_, Arc<ToolbarState>>,
) -> Result<Option<ResultPayload>, String> {
    Ok(state.result())
}

#[tauri::command]
pub(crate) fn quick_bar_result_popup_ready(
    state: tauri::State<'_, Arc<ToolbarState>>,
) -> Result<(), String> {
    state.set_result_ready(true)
}

#[tauri::command]
pub(crate) fn hide_quick_bar_result_popup(app: tauri::AppHandle) -> Result<(), String> {
    hide_result_popup(&app)
}

#[tauri::command]
pub(crate) async fn show_quick_bar_result_popup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ToolbarState>>,
    title: String,
) -> Result<(), String> {
    let state = state.inner().clone();
    let payload = state
        .payload()
        .ok_or_else(|| "Quick Bar 缺少划词上下文，无法显示结果浮窗".to_string())?;
    let result = ResultPayload {
        title: title.trim().to_string(),
        status: "loading".to_string(),
        text: None,
        error_text: None,
    };
    state.set_result(result.clone())?;
    ensure_result_window(&app, &state)?;
    state.wait_result_ready().await?;
    let window = app
        .get_webview_window(RESULT_LABEL)
        .ok_or_else(|| "Quick Bar 结果浮窗不存在".to_string())?;
    apply_popup_layout(
        &app,
        &window,
        payload.anchor_x,
        payload.anchor_y,
        RESULT_WIDTH,
        RESULT_HEIGHT,
        PopupPlacement::AvoidSelection,
    )?;
    if let Err(error) = window.set_always_on_top(true) {
        log_window_warning("设置 Quick Bar 结果浮窗置顶失败", error);
    }
    window
        .show()
        .map_err(|e| format!("显示 Quick Bar 结果浮窗失败: {e}"))?;
    if let Err(error) = window.emit(RESULT_EVENT, result) {
        log_window_warning("刷新 Quick Bar 结果浮窗失败", error);
    }
    if let Err(error) = window.set_focus() {
        log_window_warning("聚焦 Quick Bar 结果浮窗失败", error);
    }
    if let Err(error) = hide_toolbar(&app) {
        log_window_warning("隐藏 Quick Bar 浮动条失败", error);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn update_quick_bar_result_popup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ToolbarState>>,
    payload: ResultPayload,
) -> Result<(), String> {
    validate_result_status(&payload.status)?;
    state.set_result(payload.clone())?;
    let Some(window) = app.get_webview_window(RESULT_LABEL) else {
        return Ok(());
    };
    window
        .emit(RESULT_EVENT, payload)
        .map_err(|e| format!("刷新 Quick Bar 结果浮窗失败: {e}"))
}

pub(crate) fn show_toolbar_from_current_selection(
    app: &tauri::AppHandle,
    state: &ToolbarState,
) -> Result<(), String> {
    let capture = state
        .payload()
        .map(selection_from_payload)
        .ok_or_else(|| "当前没有可用的文本选区".to_string())?;
    show_toolbar_from_capture(app, state, capture)
}

pub(crate) fn remember_selection(
    state: &ToolbarState,
    capture: SelectionCapture,
) -> Result<(), String> {
    state.set_payload(payload_from_selection(capture))
}

pub(crate) fn show_toolbar_from_capture(
    app: &tauri::AppHandle,
    state: &ToolbarState,
    capture: SelectionCapture,
) -> Result<(), String> {
    if let Err(error) = hide_result_popup(app) {
        log_window_warning("隐藏 Quick Bar 结果浮窗失败", error);
    }
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

fn hide_result_popup(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(RESULT_LABEL) {
        window
            .hide()
            .map_err(|e| format!("隐藏 Quick Bar 结果浮窗失败: {e}"))?;
    }
    Ok(())
}

fn show_toolbar(
    app: &tauri::AppHandle,
    state: &ToolbarState,
    capture: SelectionCapture,
) -> Result<(), String> {
    let payload = payload_from_selection(capture);
    state.set_payload(payload.clone())?;

    let window = ensure_toolbar_window(app)?;
    apply_popup_layout(
        app,
        &window,
        payload.anchor_x - TOOLBAR_SHADOW_SPACE_I32,
        payload.anchor_y - TOOLBAR_SHADOW_SPACE_I32,
        TOOLBAR_WIDTH,
        TOOLBAR_HEIGHT,
        PopupPlacement::Below,
    )?;
    if let Err(error) = window.set_always_on_top(true) {
        log_window_warning("设置 Quick Bar 浮动条置顶失败", error);
    }
    window
        .show()
        .map_err(|e| format!("显示 Quick Bar 浮动条失败: {e}"))?;
    if let Err(error) = window.emit(TOOLBAR_EVENT, payload) {
        log_window_warning("刷新 Quick Bar 浮动条内容失败", error);
    }
    if let Err(error) = window.set_focus() {
        if let Err(hide_error) = hide_toolbar(app) {
            log_window_warning("隐藏 Quick Bar 浮动条失败", hide_error);
        }
        return Err(format!("聚焦 Quick Bar 浮动条失败: {error}"));
    }
    Ok(())
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
    .shadow(false)
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

fn payload_from_selection(capture: SelectionCapture) -> ToolbarPayload {
    ToolbarPayload {
        selected_text: capture.text,
        anchor_x: capture.anchor_x,
        anchor_y: capture.anchor_y,
    }
}

fn selection_from_payload(payload: ToolbarPayload) -> SelectionCapture {
    SelectionCapture {
        text: payload.selected_text,
        anchor_x: payload.anchor_x,
        anchor_y: payload.anchor_y,
    }
}

fn ensure_result_window(
    app: &tauri::AppHandle,
    state: &ToolbarState,
) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(RESULT_LABEL) {
        return Ok(window);
    }
    state.set_result_ready(false)?;

    tauri::WebviewWindowBuilder::new(
        app,
        RESULT_LABEL,
        WebviewUrl::App("index.html?view=result".into()),
    )
    .title("Quick Bar 结果")
    .inner_size(RESULT_WIDTH as f64, RESULT_HEIGHT as f64)
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
    .map_err(|e| format!("创建 Quick Bar 结果浮窗失败: {e}"))
}

#[derive(Clone, Copy)]
enum PopupPlacement {
    Below,
    AvoidSelection,
}

fn apply_popup_layout(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    anchor_x: i32,
    anchor_y: i32,
    width: u32,
    height: u32,
    placement: PopupPlacement,
) -> Result<(), String> {
    let position = popup_position(app, anchor_x, anchor_y, width, height, placement)?;
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| format!("设置 Quick Bar 浮动条尺寸失败: {e}"))?;
    window
        .set_position(position)
        .map_err(|e| format!("设置 Quick Bar 浮动条位置失败: {e}"))
}

fn popup_position(
    app: &tauri::AppHandle,
    anchor_x: i32,
    anchor_y: i32,
    width: u32,
    height: u32,
    placement: PopupPlacement,
) -> Result<PhysicalPosition<i32>, String> {
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
    let mut x = anchor_x + TOOLBAR_MARGIN;
    let below_y = anchor_y + TOOLBAR_MARGIN;
    let above_y = anchor_y - height as i32 - TOOLBAR_MARGIN;
    let below_fits = below_y <= max_y;
    let mut y = match placement {
        PopupPlacement::Below => below_y,
        PopupPlacement::AvoidSelection if below_fits => below_y,
        PopupPlacement::AvoidSelection => above_y,
    };
    x = x.clamp(area.position.x, max_x.max(area.position.x));
    y = y.clamp(area.position.y, max_y.max(area.position.y));
    Ok(PhysicalPosition::new(x, y))
}

fn validate_result_status(status: &str) -> Result<(), String> {
    if matches!(status, "loading" | "done" | "error") {
        return Ok(());
    }
    Err("Quick Bar 结果状态不合法".to_string())
}

fn log_window_warning(action: &str, error: impl std::fmt::Display) {
    eprintln!("[quick-bar] {action}: {error}");
}
