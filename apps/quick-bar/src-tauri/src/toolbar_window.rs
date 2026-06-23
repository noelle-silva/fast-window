use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WindowEvent,
};
use tokio::sync::Notify;

use crate::{
    result_window_preferences::{
        self, ResultWindowCloseMode, ResultWindowDisplayMode, ResultWindowPreferencesState,
        DEFAULT_RESULT_HEIGHT, DEFAULT_RESULT_WIDTH, MIN_RESULT_HEIGHT, MIN_RESULT_WIDTH,
    },
    quick_bar_backend::{ToolbarExternalAction, ToolbarRuntimeCommand, ToolbarRuntimeFacts},
    selection_capture::SelectionCapture,
};

const TOOLBAR_LABEL: &str = "quick-bar-toolbar";
const RESULT_LABEL: &str = "quick-bar-result";
const TOOLBAR_EVENT: &str = "quick-bar-selection";
const TOOLBAR_VISIBILITY_EVENT: &str = "quick-bar-toolbar-visibility";
const RESULT_EVENT: &str = "quick-bar-result";
const RESULT_VISIBILITY_EVENT: &str = "quick-bar-result-visibility";
const TOOLBAR_BOOTSTRAP_CONTENT_WIDTH: u32 = 300;
const TOOLBAR_BOOTSTRAP_CONTENT_HEIGHT: u32 = 58;
const TOOLBAR_SHADOW_SPACE: u32 = 12;
const TOOLBAR_BOOTSTRAP_WIDTH: u32 = TOOLBAR_BOOTSTRAP_CONTENT_WIDTH + TOOLBAR_SHADOW_SPACE * 2;
const TOOLBAR_BOOTSTRAP_HEIGHT: u32 = TOOLBAR_BOOTSTRAP_CONTENT_HEIGHT + TOOLBAR_SHADOW_SPACE * 2;
const TOOLBAR_SHADOW_SPACE_I32: i32 = TOOLBAR_SHADOW_SPACE as i32;
const TOOLBAR_MARGIN: i32 = 10;
const RESULT_READY_TIMEOUT_MS: u64 = 2000;
const RESULT_INTERNAL_DRAG_HIDE_GRACE_MS: u64 = 1200;
const HIDDEN_WINDOW_POSITION: i32 = -100000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolbarPayload {
    selected_text: String,
    anchor_x: i32,
    anchor_y: i32,
    layout_request_id: u64,
}

#[derive(Clone)]
struct ToolbarContext {
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolbarVisibilityPayload {
    visible: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultVisibilityPayload {
    visible: bool,
}

pub(crate) struct ToolbarState {
    active_context: Mutex<Option<ToolbarContext>>,
    latest_result: Mutex<Option<ResultPayload>>,
    toolbar_layout_request_id: Mutex<u64>,
    toolbar_bounds: Mutex<Option<ToolbarBounds>>,
    result_internal_drag_until: Mutex<Option<Instant>>,
    result_ready: Mutex<bool>,
    result_ready_notify: Notify,
}

#[derive(Clone, Copy)]
struct ToolbarBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Default for ToolbarState {
    fn default() -> Self {
        Self {
            active_context: Mutex::new(None),
            latest_result: Mutex::new(None),
            toolbar_layout_request_id: Mutex::new(0),
            toolbar_bounds: Mutex::new(None),
            result_internal_drag_until: Mutex::new(None),
            result_ready: Mutex::new(false),
            result_ready_notify: Notify::new(),
        }
    }
}

impl ToolbarState {
    fn set_active_context(&self, context: ToolbarContext) -> Result<(), String> {
        let mut active = self
            .active_context
            .lock()
            .map_err(|_| "Quick Bar 浮动条上下文锁定失败".to_string())?;
        *active = Some(context);
        Ok(())
    }

    fn clear_active_context(&self) -> Result<(), String> {
        let mut active = self
            .active_context
            .lock()
            .map_err(|_| "Quick Bar 浮动条上下文锁定失败".to_string())?;
        *active = None;
        Ok(())
    }

    fn active_context(&self) -> Result<Option<ToolbarContext>, String> {
        self.active_context
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Quick Bar 浮动条上下文锁定失败".to_string())
    }

    fn has_active_context(&self) -> Result<bool, String> {
        self.active_context
            .lock()
            .map(|value| value.is_some())
            .map_err(|_| "Quick Bar 浮动条上下文锁定失败".to_string())
    }

    pub(crate) fn runtime_facts_for_action(
        &self,
        action: &ToolbarExternalAction,
    ) -> Result<ToolbarRuntimeFacts, String> {
        let pointer_inside_toolbar = match action {
            ToolbarExternalAction::MouseDown { x, y } => self
                .toolbar_bounds()?
                .is_some_and(|bounds| bounds.contains(*x, *y)),
            ToolbarExternalAction::MouseWheel | ToolbarExternalAction::KeyDown { .. } => false,
        };
        Ok(ToolbarRuntimeFacts {
            has_active_context: self.has_active_context()?,
            pointer_inside_toolbar,
        })
    }

    fn set_toolbar_bounds(&self, bounds: ToolbarBounds) -> Result<(), String> {
        let mut current = self
            .toolbar_bounds
            .lock()
            .map_err(|_| "Quick Bar 浮动条位置状态锁定失败".to_string())?;
        *current = Some(bounds);
        Ok(())
    }

    fn clear_toolbar_bounds(&self) -> Result<(), String> {
        let mut current = self
            .toolbar_bounds
            .lock()
            .map_err(|_| "Quick Bar 浮动条位置状态锁定失败".to_string())?;
        *current = None;
        Ok(())
    }

    fn toolbar_bounds(&self) -> Result<Option<ToolbarBounds>, String> {
        self.toolbar_bounds
            .lock()
            .map(|value| *value)
            .map_err(|_| "Quick Bar 浮动条位置状态锁定失败".to_string())
    }

    fn toolbar_payload(&self) -> Result<Option<ToolbarPayload>, String> {
        let Some(context) = self.active_context()? else {
            return Ok(None);
        };
        Ok(Some(payload_from_context(
            context,
            self.toolbar_layout_request_id()?,
        )))
    }

    fn begin_toolbar_layout(&self) -> Result<u64, String> {
        let mut current = self
            .toolbar_layout_request_id
            .lock()
            .map_err(|_| "Quick Bar 浮动条布局状态锁定失败".to_string())?;
        *current += 1;
        Ok(*current)
    }

    fn cancel_toolbar_layout(&self) -> Result<(), String> {
        let mut current = self
            .toolbar_layout_request_id
            .lock()
            .map_err(|_| "Quick Bar 浮动条布局状态锁定失败".to_string())?;
        *current += 1;
        Ok(())
    }

    fn toolbar_layout_request_id(&self) -> Result<u64, String> {
        self.toolbar_layout_request_id
            .lock()
            .map(|value| *value)
            .map_err(|_| "Quick Bar 浮动条布局状态锁定失败".to_string())
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

    fn mark_result_internal_drag(&self) -> Result<(), String> {
        let mut current = self
            .result_internal_drag_until
            .lock()
            .map_err(|_| "Quick Bar 结果窗内部拖动状态锁定失败".to_string())?;
        *current = Some(Instant::now() + Duration::from_millis(RESULT_INTERNAL_DRAG_HIDE_GRACE_MS));
        Ok(())
    }

    fn is_result_internal_drag_active(&self) -> Result<bool, String> {
        let now = Instant::now();
        let mut current = self
            .result_internal_drag_until
            .lock()
            .map_err(|_| "Quick Bar 结果窗内部拖动状态锁定失败".to_string())?;
        let active = current.map(|until| until > now).unwrap_or(false);
        if !active {
            *current = None;
        }
        Ok(active)
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
    state.toolbar_payload()
}

#[tauri::command]
pub(crate) fn quick_bar_toolbar_ready(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ToolbarState>>,
    layout_request_id: u64,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let state = state.inner().clone();
    if width == 0 || height == 0 {
        return Err("Quick Bar 浮动条尺寸无效".to_string());
    }
    if state.toolbar_layout_request_id()? != layout_request_id {
        return Ok(());
    }
    let context = state
        .active_context()?
        .ok_or_else(|| "Quick Bar 缺少划词上下文，无法显示浮动条".to_string())?;
    let window = app
        .get_webview_window(TOOLBAR_LABEL)
        .ok_or_else(|| "Quick Bar 浮动条窗口不存在".to_string())?;
    let bounds = apply_popup_layout(
        &app,
        &window,
        context.anchor_x - TOOLBAR_SHADOW_SPACE_I32,
        context.anchor_y - TOOLBAR_SHADOW_SPACE_I32,
        width,
        height,
        PopupPlacement::Below,
    )?;
    state.set_toolbar_bounds(bounds)?;
    if let Err(error) = window.set_always_on_top(true) {
        log_window_warning("设置 Quick Bar 浮动条置顶失败", error);
    }
    if let Err(error) = window.set_ignore_cursor_events(false) {
        log_window_warning("恢复 Quick Bar 浮动条鼠标事件失败", error);
    }
    window
        .show()
        .map_err(|e| format!("显示 Quick Bar 浮动条失败: {e}"))?;
    set_toolbar_visibility(&window, true);
    Ok(())
}

#[tauri::command]
pub(crate) fn hide_quick_bar_toolbar(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ToolbarState>>,
) -> Result<(), String> {
    hide_toolbar(&app, state.inner())
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
pub(crate) fn quick_bar_result_drag_started(
    state: tauri::State<'_, Arc<ToolbarState>>,
) -> Result<(), String> {
    state.mark_result_internal_drag()
}

#[tauri::command]
pub(crate) async fn show_quick_bar_result_popup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ToolbarState>>,
    preferences_state: tauri::State<'_, Arc<ResultWindowPreferencesState>>,
    title: String,
) -> Result<(), String> {
    let state = state.inner().clone();
    let preferences_state = preferences_state.inner().clone();
    let context = state
        .active_context()?
        .ok_or_else(|| "Quick Bar 缺少划词上下文，无法显示结果浮窗".to_string())?;
    let result = ResultPayload {
        title: title.trim().to_string(),
        status: "loading".to_string(),
        text: None,
        error_text: None,
    };
    state.set_result(result.clone())?;
    ensure_result_window(&app, Arc::clone(&state), Arc::clone(&preferences_state))?;
    state.wait_result_ready().await?;
    let preferences = preferences_state.preferences()?;
    let result_size = preferences
        .bounds
        .map(|bounds| bounds.size())
        .unwrap_or_else(|| PhysicalSize::new(DEFAULT_RESULT_WIDTH, DEFAULT_RESULT_HEIGHT));
    let window = app
        .get_webview_window(RESULT_LABEL)
        .ok_or_else(|| "Quick Bar 结果浮窗不存在".to_string())?;
    if preferences.display_mode == ResultWindowDisplayMode::Fixed {
        apply_fixed_result_layout(
            &app,
            &window,
            &preferences,
            context.anchor_x,
            context.anchor_y,
        )?;
    } else {
        apply_popup_layout(
            &app,
            &window,
            context.anchor_x,
            context.anchor_y,
            result_size.width,
            result_size.height,
            PopupPlacement::AvoidSelection,
        )?;
    }
    if let Err(error) = window.set_always_on_top(true) {
        log_window_warning("设置 Quick Bar 结果浮窗置顶失败", error);
    }
    if let Err(error) = window.set_ignore_cursor_events(false) {
        log_window_warning("恢复 Quick Bar 结果浮窗鼠标事件失败", error);
    }
    set_result_visibility(&window, true);
    window
        .show()
        .map_err(|e| format!("显示 Quick Bar 结果浮窗失败: {e}"))?;
    if let Err(error) = window.emit(RESULT_EVENT, result) {
        log_window_warning("刷新 Quick Bar 结果浮窗失败", error);
    }
    if let Err(error) = window.set_focus() {
        log_window_warning("聚焦 Quick Bar 结果浮窗失败", error);
    }
    if let Err(error) = hide_toolbar(&app, &state) {
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

pub(crate) fn show_toolbar_from_capture(
    app: &tauri::AppHandle,
    state: &Arc<ToolbarState>,
    capture: SelectionCapture,
) -> Result<u64, String> {
    if let Err(error) = hide_result_popup(app) {
        log_window_warning("隐藏 Quick Bar 结果浮窗失败", error);
    }
    show_toolbar(app, state, context_from_capture(capture))
}

pub(crate) fn apply_toolbar_command(
    app: &tauri::AppHandle,
    state: &Arc<ToolbarState>,
    command: ToolbarRuntimeCommand,
) -> Result<(), String> {
    match command {
        ToolbarRuntimeCommand::None => Ok(()),
        ToolbarRuntimeCommand::Show(capture) => show_toolbar_from_capture(app, state, capture).map(|_| ()),
        ToolbarRuntimeCommand::Hide => hide_toolbar(app, state),
    }
}

pub(crate) fn hide_toolbar(app: &tauri::AppHandle, state: &ToolbarState) -> Result<(), String> {
    state.cancel_toolbar_layout()?;
    state.clear_active_context()?;
    state.clear_toolbar_bounds()?;
    if let Some(window) = app.get_webview_window(TOOLBAR_LABEL) {
        if let Err(error) = window.set_ignore_cursor_events(true) {
            log_window_warning("设置 Quick Bar 浮动条鼠标穿透失败", error);
        }
        set_toolbar_visibility(&window, false);
    }
    Ok(())
}

fn set_toolbar_visibility(window: &WebviewWindow, visible: bool) {
    if let Err(error) = window.emit(
        TOOLBAR_VISIBILITY_EVENT,
        ToolbarVisibilityPayload { visible },
    ) {
        log_window_warning("刷新 Quick Bar 浮动条可见状态失败", error);
    }
}

fn hide_result_popup(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(RESULT_LABEL) {
        set_result_visibility(&window, false);
        if let Err(error) = window.set_ignore_cursor_events(true) {
            log_window_warning("设置 Quick Bar 结果浮窗鼠标穿透失败", error);
        }
        if let Err(error) = window.set_position(PhysicalPosition::new(
            HIDDEN_WINDOW_POSITION,
            HIDDEN_WINDOW_POSITION,
        )) {
            log_window_warning("移出 Quick Bar 结果浮窗失败", error);
        }
        if let Err(error) = window.hide() {
            log_window_warning("隐藏 Quick Bar 结果浮窗失败", error);
        }
    }
    Ok(())
}

fn show_toolbar(
    app: &tauri::AppHandle,
    state: &Arc<ToolbarState>,
    context: ToolbarContext,
) -> Result<u64, String> {
    state.set_active_context(context.clone())?;
    let layout_request_id = state.begin_toolbar_layout()?;
    let payload = payload_from_context(context, layout_request_id);
    let window = ensure_toolbar_window(app, Arc::clone(state))?;
    if let Err(error) = window.emit(TOOLBAR_EVENT, payload) {
        log_window_warning("刷新 Quick Bar 浮动条内容失败", error);
    }
    Ok(layout_request_id)
}

fn ensure_toolbar_window(
    app: &tauri::AppHandle,
    state: Arc<ToolbarState>,
) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(TOOLBAR_LABEL) {
        return Ok(window);
    }

    let window = tauri::WebviewWindowBuilder::new(
        app,
        TOOLBAR_LABEL,
        WebviewUrl::App("index.html?view=toolbar".into()),
    )
    .title("Quick Bar")
    .inner_size(
        TOOLBAR_BOOTSTRAP_WIDTH as f64,
        TOOLBAR_BOOTSTRAP_HEIGHT as f64,
    )
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .shadow(false)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| format!("创建 Quick Bar 浮动条窗口失败: {e}"))?;

    let app_for_focus = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            let _ = hide_toolbar(&app_for_focus, &state);
        }
    });
    Ok(window)
}

fn context_from_capture(capture: SelectionCapture) -> ToolbarContext {
    ToolbarContext {
        selected_text: capture.text,
        anchor_x: capture.anchor_x,
        anchor_y: capture.anchor_y,
    }
}

fn payload_from_context(context: ToolbarContext, layout_request_id: u64) -> ToolbarPayload {
    ToolbarPayload {
        selected_text: context.selected_text,
        anchor_x: context.anchor_x,
        anchor_y: context.anchor_y,
        layout_request_id,
    }
}

impl ToolbarBounds {
    fn contains(self, x: i32, y: i32) -> bool {
        x >= self.x
            && x <= self.x + self.width as i32
            && y >= self.y
            && y <= self.y + self.height as i32
    }
}

fn ensure_result_window(
    app: &tauri::AppHandle,
    state: Arc<ToolbarState>,
    preferences_state: Arc<ResultWindowPreferencesState>,
) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(RESULT_LABEL) {
        return Ok(window);
    }
    state.set_result_ready(false)?;

    let window = tauri::WebviewWindowBuilder::new(
        app,
        RESULT_LABEL,
        WebviewUrl::App("index.html?view=result".into()),
    )
    .title("Quick Bar 结果")
    .inner_size(DEFAULT_RESULT_WIDTH as f64, DEFAULT_RESULT_HEIGHT as f64)
    .min_inner_size(MIN_RESULT_WIDTH as f64, MIN_RESULT_HEIGHT as f64)
    .decorations(false)
    .resizable(true)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .shadow(true)
    .visible(false)
    .build()
    .map_err(|e| format!("创建 Quick Bar 结果浮窗失败: {e}"))?;

    let app_for_event = app.clone();
    let state_for_event = Arc::clone(&state);
    let window_for_event = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            if let Err(error) = result_window_preferences::remember_bounds_from_window(
                &app_for_event,
                &preferences_state,
                &window_for_event,
            ) {
                log_window_warning("记录 Quick Bar 结果窗尺寸位置失败", error);
            }
        }
        WindowEvent::Focused(false) => {
            if state_for_event
                .is_result_internal_drag_active()
                .unwrap_or(false)
            {
                return;
            }
            if preferences_state
                .preferences()
                .map(|preferences| preferences.close_mode == ResultWindowCloseMode::HideOnBlur)
                .unwrap_or(false)
            {
                if let Err(error) = result_window_preferences::remember_bounds_from_window(
                    &app_for_event,
                    &preferences_state,
                    &window_for_event,
                ) {
                    log_window_warning("记录 Quick Bar 结果窗尺寸位置失败", error);
                }
                if let Err(error) = hide_result_popup(&app_for_event) {
                    log_window_warning("隐藏 Quick Bar 结果浮窗失败", error);
                }
            }
        }
        _ => {}
    });

    Ok(window)
}

fn set_result_visibility(window: &WebviewWindow, visible: bool) {
    if let Err(error) = window.emit(RESULT_VISIBILITY_EVENT, ResultVisibilityPayload { visible }) {
        log_window_warning("刷新 Quick Bar 结果窗可见状态失败", error);
    }
}

fn apply_fixed_result_layout(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    preferences: &result_window_preferences::ResultWindowPreferences,
    anchor_x: i32,
    anchor_y: i32,
) -> Result<(), String> {
    let size = preferences
        .bounds
        .map(|bounds| bounds.size())
        .unwrap_or_else(|| PhysicalSize::new(DEFAULT_RESULT_WIDTH, DEFAULT_RESULT_HEIGHT));
    let position = preferences
        .bounds
        .map(|bounds| bounds.position())
        .unwrap_or(popup_position(
            app,
            anchor_x,
            anchor_y,
            size.width,
            size.height,
            PopupPlacement::Center,
        )?);
    window
        .set_size(size)
        .map_err(|e| format!("设置 Quick Bar 结果窗尺寸失败: {e}"))?;
    window
        .set_position(position)
        .map_err(|e| format!("设置 Quick Bar 结果窗位置失败: {e}"))
}

#[derive(Clone, Copy)]
enum PopupPlacement {
    Below,
    AvoidSelection,
    Center,
}

fn apply_popup_layout(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    anchor_x: i32,
    anchor_y: i32,
    width: u32,
    height: u32,
    placement: PopupPlacement,
) -> Result<ToolbarBounds, String> {
    let position = popup_position(app, anchor_x, anchor_y, width, height, placement)?;
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| format!("设置 Quick Bar 浮动条尺寸失败: {e}"))?;
    window
        .set_position(position)
        .map_err(|e| format!("设置 Quick Bar 浮动条位置失败: {e}"))?;
    Ok(ToolbarBounds {
        x: position.x,
        y: position.y,
        width,
        height,
    })
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
    let center_x = area.position.x + (area.size.width as i32 - width as i32) / 2;
    let center_y = area.position.y + (area.size.height as i32 - height as i32) / 2;
    let below_y = anchor_y + TOOLBAR_MARGIN;
    let above_y = anchor_y - height as i32 - TOOLBAR_MARGIN;
    let below_fits = below_y <= max_y;
    let mut y = match placement {
        PopupPlacement::Below => below_y,
        PopupPlacement::AvoidSelection if below_fits => below_y,
        PopupPlacement::AvoidSelection => above_y,
        PopupPlacement::Center => center_y,
    };
    if matches!(placement, PopupPlacement::Center) {
        x = center_x;
    }
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
