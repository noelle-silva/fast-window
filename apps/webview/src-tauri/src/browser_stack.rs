use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::app_config;

pub(crate) const BROWSER_BAR_WINDOW_LABEL: &str = "browser_bar";
pub(crate) const BROWSER_PAGE_LABEL_PREFIX: &str = "browser-";
pub(crate) const WEBVIEW_SETTINGS_UPDATED_EVENT: &str = "webview:settings-updated";
pub(crate) const BROWSER_PAGES_UPDATED_EVENT: &str = "browser:pages-updated";
pub(crate) const BROWSER_BAR_HEIGHT: f64 = 40.0;
pub(crate) const BROWSER_STACK_TOTAL_HEIGHT: f64 = 605.0;
pub(crate) const BROWSER_BAR_PANEL_MAX_HEIGHT: f64 = 480.0;

const HIDDEN_POSITION_THRESHOLD: i32 = -9000;
const MIN_CONTENT_SIZE: u32 = 200;
const MIN_WINDOW_HEIGHT: u32 = 200;
pub(crate) const DEFAULT_STACK_WIDTH: u32 = 1020;
pub(crate) const DEFAULT_STACK_HEIGHT: u32 = BROWSER_STACK_TOTAL_HEIGHT as u32;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedWindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// 页面图标与收藏条目图标同构（kind: color / image）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserPageIcon {
    #[serde(default = "default_icon_kind")]
    pub(crate) kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) color: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) asset_id: String,
}

fn default_icon_kind() -> String {
    "color".to_string()
}

/// 浏览栈里一个已打开的页面：内容窗口 + 收藏条目信息。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserPage {
    pub(crate) label: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) icon: Option<BrowserPageIcon>,
    #[serde(default = "default_page_rate")]
    pub(crate) rate: f64,
}

fn default_page_rate() -> f64 {
    1.0
}

/// 页面列表事件与查询的统一载荷。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserPagesPayload {
    pub(crate) pages: Vec<BrowserPage>,
    pub(crate) active_label: Option<String>,
}

/// 浏览栈状态机：顶部栏 + 一组页面窗口（内容窗口）。
pub(crate) struct BrowserWindowState {
    pub(crate) active: Mutex<bool>,
    pub(crate) pages: Mutex<Vec<BrowserPage>>,
    pub(crate) active_label: Mutex<Option<String>>,
    pub(crate) next_page_seq: AtomicU64,
    /// 顶部栏下拉面板：None = 收起，Some(逻辑高度) = 展开。
    pub(crate) bar_panel: Mutex<Option<f64>>,
    pub(crate) last_position: Mutex<Option<tauri::PhysicalPosition<i32>>>,
    pub(crate) suppress_hide_until_ms: Mutex<u64>,
    pub(crate) fullscreen: Mutex<bool>,
    pub(crate) restore_bounds:
        Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>,
    pub(crate) pinned: Mutex<bool>,
    pub(crate) closing: Mutex<bool>,
    pub(crate) last_bounds: Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>,
    pub(crate) save_seq: AtomicU64,
}

impl Default for BrowserWindowState {
    fn default() -> Self {
        Self {
            active: Mutex::new(false),
            pages: Mutex::new(Vec::new()),
            active_label: Mutex::new(None),
            next_page_seq: AtomicU64::new(0),
            bar_panel: Mutex::new(None),
            last_position: Mutex::new(None),
            suppress_hide_until_ms: Mutex::new(0),
            fullscreen: Mutex::new(false),
            restore_bounds: Mutex::new(None),
            pinned: Mutex::new(false),
            closing: Mutex::new(false),
            last_bounds: Mutex::new(None),
            save_seq: AtomicU64::new(0),
        }
    }
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

// ── 页面集合访问 ─────────────────────────────────────────────────────────────

pub(crate) fn next_page_label(app: &tauri::AppHandle) -> String {
    let state = app.state::<BrowserWindowState>();
    let seq = state
        .next_page_seq
        .fetch_add(1, Ordering::Relaxed)
        .saturating_add(1);
    format!("{BROWSER_PAGE_LABEL_PREFIX}{seq}")
}

pub(crate) fn register_page(app: &tauri::AppHandle, page: BrowserPage) {
    let state = app.state::<BrowserWindowState>();
    if let Ok(mut g) = state.pages.lock() {
        g.push(page);
    };
}

pub(crate) fn set_active_page(app: &tauri::AppHandle, label: Option<String>) {
    let state = app.state::<BrowserWindowState>();
    if let Ok(mut g) = state.active_label.lock() {
        *g = label;
    };
}

pub(crate) fn active_page_label(app: &tauri::AppHandle) -> Option<String> {
    let state = app.state::<BrowserWindowState>();
    state
        .active_label
        .lock()
        .ok()
        .and_then(|g| g.clone())
}

pub(crate) fn page_labels(app: &tauri::AppHandle) -> Vec<String> {
    let state = app.state::<BrowserWindowState>();
    state
        .pages
        .lock()
        .map(|g| g.iter().map(|p| p.label.clone()).collect())
        .unwrap_or_default()
}

pub(crate) fn has_pages(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    state
        .pages
        .lock()
        .map(|g| !g.is_empty())
        .unwrap_or(false)
}

pub(crate) fn pages_payload(app: &tauri::AppHandle) -> BrowserPagesPayload {
    let state = app.state::<BrowserWindowState>();
    let pages = state.pages.lock().map(|g| g.clone()).unwrap_or_default();
    let active_label = active_page_label(app);
    BrowserPagesPayload {
        pages,
        active_label,
    }
}

pub(crate) fn emit_pages_updated(app: &tauri::AppHandle) {
    let payload = pages_payload(app);
    let _ = app.emit_to(
        tauri::EventTarget::webview_window(BROWSER_BAR_WINDOW_LABEL),
        BROWSER_PAGES_UPDATED_EVENT,
        payload.clone(),
    );
    let _ = app.emit_to(
        tauri::EventTarget::webview_window("main"),
        BROWSER_PAGES_UPDATED_EVENT,
        payload,
    );
}

/// 同步指定页面的倍速事实。
pub(crate) fn browser_stack_set_page_rate(app: &tauri::AppHandle, label: &str, rate: f64) {
    let state = app.state::<BrowserWindowState>();
    if let Ok(mut pages) = state.pages.lock() {
        if let Some(page) = pages.iter_mut().find(|p| p.label == label) {
            page.rate = rate;
        }
    };
}

/// 同步当前页面的倍速事实（前端在速率变化时写回，供切换页面时还原显示）。
pub(crate) fn browser_stack_set_active_page_rate(app: &tauri::AppHandle, rate: f64) {
    let Some(label) = active_page_label(app) else {
        return;
    };
    browser_stack_set_page_rate(app, &label, rate);
}

pub(crate) fn bar_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(BROWSER_BAR_WINDOW_LABEL)
}

pub(crate) fn active_content_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let label = active_page_label(app)?;
    app.get_webview_window(&label)
}

pub(crate) fn content_windows(app: &tauri::AppHandle) -> Vec<tauri::WebviewWindow> {
    page_labels(app)
        .iter()
        .filter_map(|label| app.get_webview_window(label))
        .collect()
}

fn window_is_active_page(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> bool {
    active_page_label(app).as_deref() == Some(window.label())
}

// ── 主窗口联动（app 语义：主窗口与浏览栈互斥可见） ─────────────────────────────

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
}

/// 浏览栈激活期间收起主窗口（open 等入口复用）。
pub(crate) fn browser_stack_hide_main_window(app: &tauri::AppHandle) {
    hide_main_window(app);
}

fn show_main_window(app: &tauri::AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<Arc<crate::fw_window::FwWindowState>>();
    crate::fw_window::show_and_focus(&main, &state);
}

// ── 窗口事件钩子（从宿主 app.rs 同语义移植，按窗口挂载） ────────────────────────

/// 为浏览栈窗口挂载事件钩子：联动位置、防误关、失焦自动隐藏、边界持久化。
pub(crate) fn attach_browser_stack_window_events(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    is_bar: bool,
) {
    let window_for_event = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(_) => {
            if !is_bar && !window_is_active_page(&app, &window_for_event) {
                return;
            }
            sync_sibling_position(&app, is_bar);
            save_browser_stack_bounds_if_valid(&app);
            schedule_persist_browser_window_bounds(&app);
        }
        tauri::WindowEvent::Resized(_) => {
            if is_bar {
                apply_bar_corner_shape(&window_for_event, bar_panel_is_open(&app));
                save_browser_stack_bounds_if_valid(&app);
                schedule_persist_browser_window_bounds(&app);
            } else if window_is_active_page(&app, &window_for_event) {
                sync_bar_size(&app);
                apply_bottom_rounded_corners(&window_for_event, 16.0);
                save_browser_stack_bounds_if_valid(&app);
                schedule_persist_browser_window_bounds(&app);
            }
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if browser_stack_is_closing(&app) {
                return;
            }
            api.prevent_close();
            browser_stack_hide_to_main(&app);
        }
        tauri::WindowEvent::Focused(focused) => {
            if *focused {
                return;
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(120)).await;
                if browser_stack_is_closing(&app) {
                    return;
                }
                if browser_stack_is_pinned(&app) {
                    return;
                }
                if browser_stack_is_focused(&app) {
                    return;
                }
                if browser_stack_should_suppress_hide(&app) {
                    return;
                }
                // 失焦收起后直接退场，不再回退主窗口（焦点留在此前点击处），
                // 由快捷键/托盘/顶部栏按钮按需唤起下一层。
                browser_stack_hide(&app);
            });
        }
        tauri::WindowEvent::Destroyed => {
            if is_bar || browser_stack_is_closing(&app) {
                return;
            }
            let label = window_for_event.label().to_string();
            handle_page_window_destroyed(&app, &label);
        }
        _ => {}
    });
}

/// 页面窗口被销毁（非我方 close_page 路径）时收敛页面集合。
fn handle_page_window_destroyed(app: &tauri::AppHandle, label: &str) {
    let state = app.state::<BrowserWindowState>();
    let was_tracked = state
        .pages
        .lock()
        .map(|g| g.iter().any(|p| p.label == label))
        .unwrap_or(false);
    if !was_tracked {
        return;
    }
    let _ = browser_stack_close_page(app, label);
}

fn sync_sibling_position(app: &tauri::AppHandle, is_bar: bool) {
    let (Some(bar), Some(content)) = (bar_window(app), active_content_window(app)) else {
        return;
    };
    let bar_h = browser_stack_bar_height_px(&bar);
    if is_bar {
        if let Some(p) = bar.outer_position().ok() {
            let desired = tauri::PhysicalPosition::new(p.x, p.y + bar_h as i32);
            if content.outer_position().ok() != Some(desired) {
                let _ = content.set_position(desired);
            }
        }
    } else {
        if let Some(p) = content.outer_position().ok() {
            let desired = tauri::PhysicalPosition::new(p.x, p.y - bar_h as i32);
            if bar.outer_position().ok() != Some(desired) {
                let _ = bar.set_position(desired);
            }
        }
    }
}

fn sync_bar_size(app: &tauri::AppHandle) {
    let (Some(_bar), Some(content)) = (bar_window(app), active_content_window(app)) else {
        return;
    };
    let content_w = content.inner_size().ok().map(|s| s.width).unwrap_or(0);
    if content_w > 0 {
        apply_bar_window_layout(app, Some(content_w));
    }
}

// ── 窗口状态查询/变更 ──────────────────────────────────────────────────────────

pub(crate) fn browser_stack_set_always_on_top(app: &tauri::AppHandle, enable: bool) {
    if let Some(w) = bar_window(app) {
        let _ = w.set_always_on_top(enable);
    }
    for content in content_windows(app) {
        let _ = content.set_always_on_top(enable);
    }
}

pub(crate) fn browser_stack_is_pinned(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    state.pinned.lock().ok().map(|g| *g).unwrap_or(false)
}

pub(crate) fn bar_panel_is_open(app: &tauri::AppHandle) -> bool {
    bar_panel_state(app).is_some()
}

fn bar_panel_state(app: &tauri::AppHandle) -> Option<f64> {
    let state = app.state::<BrowserWindowState>();
    state.bar_panel.lock().ok().and_then(|g| *g)
}

/// 顶部栏窗口尺寸的唯一机制：条高固定 + 下拉面板展开高度，宽度可按需同步。
fn apply_bar_window_layout(app: &tauri::AppHandle, width_px: Option<u32>) {
    let Some(bar) = bar_window(app) else {
        return;
    };
    let scale = bar.scale_factor().unwrap_or(1.0).max(0.0001);
    let width = width_px
        .or_else(|| bar.inner_size().ok().map(|s| s.width))
        .unwrap_or_else(|| (DEFAULT_STACK_WIDTH as f64 * scale).round() as u32);
    let (open, panel_height) = match bar_panel_state(app) {
        Some(height) => (true, height),
        None => (false, 0.0),
    };
    let height_logical = BROWSER_BAR_HEIGHT + if open { panel_height } else { 0.0 };
    let _ = bar.set_size(tauri::LogicalSize::new(width as f64 / scale, height_logical));
    apply_bar_corner_shape(&bar, open);
}

/// 条高恒为 BROWSER_BAR_HEIGHT（按缩放换算）；下拉面板展开时窗口临时增高不参与计算。
pub(crate) fn browser_stack_bar_height_px(bar: &tauri::WebviewWindow) -> u32 {
    let scale = bar.scale_factor().unwrap_or(1.0);
    (BROWSER_BAR_HEIGHT * scale).round().max(1.0) as u32
}

pub(crate) fn browser_stack_exists(app: &tauri::AppHandle) -> bool {
    bar_window(app).is_some() && has_pages(app)
}

/// 唤醒偏好：浏览栈存在且处于“活跃”会话时，应唤浏览栈而非主窗口。
pub(crate) fn browser_stack_preferred(app: &tauri::AppHandle) -> bool {
    if !browser_stack_exists(app) {
        return false;
    }
    app.state::<BrowserWindowState>()
        .active
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(false)
}

pub(crate) fn browser_stack_is_focused(app: &tauri::AppHandle) -> bool {
    if let Some(bar) = bar_window(app) {
        if bar.is_focused().ok().unwrap_or(false) {
            return true;
        }
    }
    content_windows(app)
        .iter()
        .any(|w| w.is_focused().ok().unwrap_or(false))
}

pub(crate) fn browser_stack_is_visible(app: &tauri::AppHandle) -> bool {
    let bar_visible = bar_window(app)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    let active_visible = active_content_window(app)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    bar_visible && active_visible
}

pub(crate) fn browser_stack_set_suppress_hide(app: &tauri::AppHandle, duration_ms: u64) {
    let state = app.state::<BrowserWindowState>();
    let until = now_ms().saturating_add(duration_ms);
    if let Ok(mut g) = state.suppress_hide_until_ms.lock() {
        *g = (*g).max(until);
    };
}

pub(crate) fn browser_stack_should_suppress_hide(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    let until = state
        .suppress_hide_until_ms
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(0);
    now_ms() < until
}

pub(crate) fn browser_stack_is_closing(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    state.closing.lock().ok().map(|g| *g).unwrap_or(false)
}

pub(crate) fn browser_stack_set_closing(app: &tauri::AppHandle, closing: bool) {
    let state = app.state::<BrowserWindowState>();
    if let Ok(mut g) = state.closing.lock() {
        *g = closing;
    };
}

// ── 窗口形态（位置/尺寸） ──────────────────────────────────────────────────────

/// 当前窗口形态：bar 位置 + 总尺寸（条高 + 内容高）；实时数据优先，其次记忆。
pub(crate) fn current_stack_bounds(
    app: &tauri::AppHandle,
) -> Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)> {
    if let (Some(bar), Some(content)) = (bar_window(app), active_content_window(app)) {
        let pos = bar.outer_position().ok();
        let size = content.inner_size().ok();
        let visible = content.is_visible().ok().unwrap_or(false);
        if visible {
            if let (Some(pos), Some(size)) = (pos, size) {
                if pos.x > HIDDEN_POSITION_THRESHOLD
                    && pos.y > HIDDEN_POSITION_THRESHOLD
                    && size.width >= MIN_CONTENT_SIZE
                    && size.height >= 150
                {
                    let bar_h = browser_stack_bar_height_px(&bar);
                    return Some((
                        pos,
                        tauri::PhysicalSize::new(size.width, bar_h.saturating_add(size.height)),
                    ));
                }
            }
        }
    }

    let state = app.state::<BrowserWindowState>();
    state.last_bounds.lock().ok().and_then(|g| g.clone())
}

/// 把窗口形态应用到内容窗口（位置换算为 bar 下方）。
pub(crate) fn apply_stack_bounds_to_content(
    app: &tauri::AppHandle,
    content: &tauri::WebviewWindow,
    pos: tauri::PhysicalPosition<i32>,
    total: tauri::PhysicalSize<u32>,
) {
    let bar_h = bar_window(app)
        .map(|bar| browser_stack_bar_height_px(&bar))
        .unwrap_or_else(|| (BROWSER_BAR_HEIGHT * content.scale_factor().unwrap_or(1.0)) as u32);
    let content_h = total.height.saturating_sub(bar_h).max(1);
    let _ = content.set_position(tauri::PhysicalPosition::new(pos.x, pos.y + bar_h as i32));
    let _ = content.set_size(tauri::PhysicalSize::new(total.width, content_h));
}

pub(crate) fn remember_stack_bounds(
    app: &tauri::AppHandle,
    pos: tauri::PhysicalPosition<i32>,
    total: tauri::PhysicalSize<u32>,
) {
    let state = app.state::<BrowserWindowState>();
    if state.fullscreen.lock().ok().map(|g| *g).unwrap_or(false) {
        return;
    }
    if let Ok(mut g) = state.last_bounds.lock() {
        *g = Some((pos, total));
    };
}

// ── 显示/隐藏/关闭 ────────────────────────────────────────────────────────────

/// 恢复 bar 位置（记忆优先，其次按记忆尺寸居中）。
pub(crate) fn browser_stack_restore_or_center_bar(app: &tauri::AppHandle) {
    let Some(bar) = bar_window(app) else {
        return;
    };
    let state = app.state::<BrowserWindowState>();
    let saved_pos = state.last_position.lock().ok().and_then(|g| g.clone());
    if let Some(pos) = saved_pos {
        let size = state
            .last_bounds
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .map(|(_, size)| size)
            .unwrap_or(tauri::PhysicalSize::new(
                DEFAULT_STACK_WIDTH,
                DEFAULT_STACK_HEIGHT,
            ));
        let monitors = bar.available_monitors().unwrap_or_default();
        let on_screen = monitors.is_empty()
            || monitors.iter().any(|m| {
                let wa = *m.work_area();
                rect_intersects(
                    pos,
                    size,
                    wa.position,
                    tauri::PhysicalSize::new(wa.size.width, wa.size.height),
                )
            });
        if on_screen {
            let _ = bar.set_position(pos);
            return;
        }
    }

    let saved_total = state
        .last_bounds
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .map(|(_, size)| size)
        .or_else(|| load_browser_window_bounds_from_config(app).map(|(_, size)| size))
        .unwrap_or(tauri::PhysicalSize::new(
            DEFAULT_STACK_WIDTH,
            DEFAULT_STACK_HEIGHT,
        ));

    let monitor = bar
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| bar.current_monitor().ok().flatten());
    if let Some(m) = monitor {
        let wa = *m.work_area();
        let x = wa.position.x + ((wa.size.width as i32 - saved_total.width as i32) / 2);
        let y = wa.position.y + ((wa.size.height as i32 - saved_total.height as i32) / 2);
        let _ = bar.set_position(tauri::PhysicalPosition::new(x, y));
    } else {
        let _ = bar.center();
    }
}

/// 把指定页面显示为当前页面（应用窗口形态并聚焦）。
pub(crate) fn show_page_window(app: &tauri::AppHandle, label: &str) {
    let Some(target) = app.get_webview_window(label) else {
        return;
    };
    let state = app.state::<BrowserWindowState>();
    let fullscreen = state.fullscreen.lock().ok().map(|g| *g).unwrap_or(false);
    if fullscreen {
        let _ = apply_fullscreen_bounds(app, &target);
    } else if let Some((pos, total)) = current_stack_bounds(app) {
        apply_stack_bounds_to_content(app, &target, pos, total);
    }
    let _ = target.show();
    let _ = target.set_focus();
}

pub(crate) fn browser_stack_show(app: &tauri::AppHandle) {
    if !browser_stack_exists(app) {
        return;
    }
    hide_main_window(app);
    browser_stack_set_suppress_hide(app, 800);
    browser_stack_restore_or_center_bar(app);

    let state = app.state::<BrowserWindowState>();
    let fullscreen = state.fullscreen.lock().ok().map(|g| *g).unwrap_or(false);
    if fullscreen {
        let _ = browser_stack_apply_fullscreen(app, true);
        return;
    }

    if let Some(active) = active_content_window(app) {
        if let Some((pos, total)) = current_stack_bounds(app) {
            apply_stack_bounds_to_content(app, &active, pos, total);
        }
        apply_bottom_rounded_corners(&active, 16.0);
    }
    apply_bar_window_layout(app, None);
    if let Some(bar) = bar_window(app) {
        let _ = bar.show();
    }
    if let Some(active) = active_content_window(app) {
        let _ = active.show();
        let _ = active.set_focus();
    }
}

pub(crate) fn browser_stack_hide(app: &tauri::AppHandle) {
    let Some(bar) = bar_window(app) else {
        return;
    };

    save_browser_stack_bounds_if_valid(app);
    let state = app.state::<BrowserWindowState>();
    persist_browser_window_bounds(app, &state);

    if let Ok(pos) = bar.outer_position() {
        if pos.x > HIDDEN_POSITION_THRESHOLD && pos.y > HIDDEN_POSITION_THRESHOLD {
            if let Ok(mut g) = state.last_position.lock() {
                *g = Some(pos);
            }
        }
    }

    reset_bar_panel(app);

    for content in content_windows(app) {
        let _ = content.set_position(tauri::PhysicalPosition::new(-10000, -10000));
        let _ = content.hide();
    }
    let _ = bar.set_position(tauri::PhysicalPosition::new(-10000, -10000));
    let _ = bar.hide();
}

pub(crate) fn browser_stack_hide_to_main(app: &tauri::AppHandle) {
    // “隐藏”只做 UI 切换：保留浏览栈窗口与页面状态，方便再次唤起继续用。
    browser_stack_hide(app);
    show_main_window(app);
}

pub(crate) fn browser_stack_end_session(app: &tauri::AppHandle) {
    browser_stack_hide(app);
    let state = app.state::<BrowserWindowState>();
    if let Ok(mut g) = state.active.lock() {
        *g = false;
    }
    if let Ok(mut g) = state.fullscreen.lock() {
        *g = false;
    }
    if let Ok(mut g) = state.restore_bounds.lock() {
        *g = None;
    };
}

pub(crate) fn browser_stack_close(app: &tauri::AppHandle) {
    // “关闭浏览”应当真正销毁 WebView：否则只是 hide，会导致网页音频继续播放。
    browser_stack_set_closing(app, true);
    browser_stack_end_session(app);
    dispose_stack_windows(app);
    show_main_window(app);
}

/// 浏览栈处于隐藏态时的静默收尾：销毁窗口与状态，但不唤起主窗口。
pub(crate) fn browser_stack_dispose_silently(app: &tauri::AppHandle) {
    browser_stack_set_closing(app, true);
    browser_stack_end_session(app);
    dispose_stack_windows(app);
}

fn dispose_stack_windows(app: &tauri::AppHandle) {
    let windows: Vec<tauri::WebviewWindow> = std::iter::once(bar_window(app))
        .flatten()
        .chain(content_windows(app))
        .collect();

    {
        let state = app.state::<BrowserWindowState>();
        if let Ok(mut g) = state.pages.lock() {
            g.clear();
        };
        if let Ok(mut g) = state.active_label.lock() {
            *g = None;
        };
    }

    for window in windows {
        let _ = window.destroy();
    }

    emit_pages_updated(app);
}

// ── 页面切换 / 单页关闭 / 面板高度 ─────────────────────────────────────────────

pub(crate) fn browser_stack_activate_page(
    app: &tauri::AppHandle,
    label: &str,
) -> Result<(), String> {
    let state = app.state::<BrowserWindowState>();
    let exists = state
        .pages
        .lock()
        .map(|g| g.iter().any(|p| p.label == label))
        .unwrap_or(false);
    if !exists {
        return Err(format!("页面不存在: {label}"));
    }

    let stack_visible = bar_window(app)
        .map(|bar| bar.is_visible().unwrap_or(false))
        .unwrap_or(false);

    if active_page_label(app).as_deref() == Some(label) {
        if !stack_visible {
            return Ok(());
        }
        if let Some(window) = app.get_webview_window(label) {
            if !window.is_visible().unwrap_or(false) {
                show_page_window(app, label);
            }
        }
        return Ok(());
    }

    if stack_visible {
        browser_stack_set_suppress_hide(app, 800);
        save_browser_stack_bounds_if_valid(app);

        if let Some(old) = active_content_window(app) {
            let _ = old.hide();
        }
    }
    set_active_page(app, Some(label.to_string()));
    if stack_visible {
        show_page_window(app, label);
    }
    emit_pages_updated(app);
    Ok(())
}

pub(crate) fn browser_stack_close_page(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let state = app.state::<BrowserWindowState>();
    let (was_active, next_active, empty) = {
        let mut pages = state
            .pages
            .lock()
            .map_err(|_| "页面列表锁定失败".to_string())?;
        let Some(index) = pages.iter().position(|p| p.label == label) else {
            return Err(format!("页面不存在: {label}"));
        };
        pages.remove(index);
        let active = state.active_label.lock().ok().and_then(|g| g.clone());
        let was_active = active.as_deref() == Some(label);
        let next_active = if was_active && !pages.is_empty() {
            Some(pages[index.min(pages.len() - 1)].label.clone())
        } else {
            None
        };
        (was_active, next_active, pages.is_empty())
    };

    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
    }

    let stack_visible = bar_window(app)
        .map(|bar| bar.is_visible().unwrap_or(false))
        .unwrap_or(false);

    if empty {
        if stack_visible {
            browser_stack_close(app);
        } else {
            browser_stack_dispose_silently(app);
        }
        return Ok(());
    }

    if was_active {
        if let Some(next) = next_active {
            set_active_page(app, Some(next.clone()));
            if stack_visible {
                browser_stack_set_suppress_hide(app, 800);
                show_page_window(app, &next);
            }
        }
    }
    emit_pages_updated(app);
    Ok(())
}

/// 顶部栏下拉面板：展开时窗口在条高之上临时增高，收起时复位。
pub(crate) fn browser_stack_set_bar_panel(
    app: &tauri::AppHandle,
    open: bool,
    panel_height: f64,
) -> Result<(), String> {
    if bar_window(app).is_none() {
        return Err("顶部栏窗口不存在".to_string());
    }
    let extra = panel_height.clamp(0.0, BROWSER_BAR_PANEL_MAX_HEIGHT);
    let open = open && extra > 0.0;

    let state = app.state::<BrowserWindowState>();
    if let Ok(mut g) = state.bar_panel.lock() {
        *g = if open { Some(extra) } else { None };
    };
    apply_bar_window_layout(app, None);
    Ok(())
}

pub(crate) fn reset_bar_panel(app: &tauri::AppHandle) {
    if !bar_panel_is_open(app) {
        return;
    }
    let state = app.state::<BrowserWindowState>();
    if let Ok(mut g) = state.bar_panel.lock() {
        *g = None;
    };
    apply_bar_window_layout(app, None);
}

// ── 全屏 ─────────────────────────────────────────────────────────────────────

pub(crate) fn apply_fullscreen_bounds(
    app: &tauri::AppHandle,
    content: &tauri::WebviewWindow,
) -> Result<(), String> {
    let bar = bar_window(app).ok_or_else(|| "顶部栏窗口不存在".to_string())?;
    reset_bar_panel(app);

    let monitor = bar
        .current_monitor()
        .map_err(|e| format!("读取显示器信息失败: {e}"))?
        .or_else(|| bar.primary_monitor().ok().flatten())
        .ok_or_else(|| "无法获取显示器信息".to_string())?;

    let wa = *monitor.work_area();
    let scale = monitor.scale_factor();
    let bar_h = (BROWSER_BAR_HEIGHT * scale).round().max(1.0) as u32;
    let content_h = wa.size.height.saturating_sub(bar_h).max(1);

    let _ = bar.set_position(wa.position);
    apply_bar_window_layout(app, Some(wa.size.width));

    let _ = content.set_position(tauri::PhysicalPosition::new(
        wa.position.x,
        wa.position.y + bar_h as i32,
    ));
    let _ = content.set_size(tauri::PhysicalSize::new(wa.size.width, content_h));
    apply_bottom_rounded_corners(content, 16.0);
    Ok(())
}

pub(crate) fn browser_stack_apply_fullscreen(
    app: &tauri::AppHandle,
    enable: bool,
) -> Result<(), String> {
    let bar = bar_window(app).ok_or_else(|| "顶部栏窗口不存在".to_string())?;
    let content = active_content_window(app).ok_or_else(|| "浏览窗口不存在".to_string())?;

    let state = app.state::<BrowserWindowState>();

    let _ = bar.unmaximize();
    let _ = content.unmaximize();

    if enable {
        if let Ok(mut g) = state.restore_bounds.lock() {
            if g.is_none() {
                let (pos, total) = current_stack_bounds(app).unwrap_or_else(|| {
                    (
                        state
                            .last_position
                            .lock()
                            .ok()
                            .and_then(|g| g.clone())
                            .unwrap_or(tauri::PhysicalPosition::new(0, 0)),
                        tauri::PhysicalSize::new(DEFAULT_STACK_WIDTH, DEFAULT_STACK_HEIGHT),
                    )
                });
                *g = Some((pos, total));
            }
        };

        if let Ok(mut g) = state.fullscreen.lock() {
            *g = true;
        }
        if let Err(error) = apply_fullscreen_bounds(app, &content) {
            if let Ok(mut g) = state.fullscreen.lock() {
                *g = false;
            }
            return Err(error);
        }
        browser_stack_set_suppress_hide(app, 1200);
        let _ = bar.show();
        let _ = content.show();
        let _ = content.set_focus();
        return Ok(());
    }

    let restore = state.restore_bounds.lock().ok().and_then(|g| g.clone());
    let (pos, total) = if let Some(v) = restore {
        v
    } else {
        let pos = state
            .last_position
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .unwrap_or(tauri::PhysicalPosition::new(0, 0));
        (
            pos,
            tauri::PhysicalSize::new(DEFAULT_STACK_WIDTH, DEFAULT_STACK_HEIGHT),
        )
    };

    if let Ok(mut g) = state.fullscreen.lock() {
        *g = false;
    }
    restore_browser_stack_bounds_or_center(app, &bar, &content, pos, total);
    if let Ok(mut g) = state.restore_bounds.lock() {
        *g = None;
    }
    browser_stack_set_suppress_hide(app, 800);
    let _ = bar.show();
    let _ = content.show();
    let _ = content.set_focus();
    Ok(())
}

// ── 边界持久化 ────────────────────────────────────────────────────────────────

pub(crate) fn load_browser_window_bounds_from_config(
    app: &tauri::AppHandle,
) -> Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)> {
    let map = app_config::read_app_config_map(app);
    let raw = map.get(app_config::BROWSER_WINDOW_BOUNDS_KEY)?.clone();
    let parsed = serde_json::from_value::<PersistedWindowBounds>(raw).ok()?;

    if parsed.x <= HIDDEN_POSITION_THRESHOLD || parsed.y <= HIDDEN_POSITION_THRESHOLD {
        return None;
    }
    if parsed.width < MIN_WINDOW_HEIGHT || parsed.height < MIN_WINDOW_HEIGHT {
        return None;
    }
    if parsed.width > 20000 || parsed.height > 20000 {
        return None;
    }

    Some((
        tauri::PhysicalPosition::new(parsed.x, parsed.y),
        tauri::PhysicalSize::new(parsed.width, parsed.height),
    ))
}

pub(crate) fn persist_browser_window_bounds(
    app: &tauri::AppHandle,
    state: &BrowserWindowState,
) {
    let saved = state.last_bounds.lock().ok().and_then(|g| g.clone());
    let Some((pos, size)) = saved else {
        return;
    };

    let bounds = PersistedWindowBounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    };

    let Ok(v) = serde_json::to_value(bounds) else {
        return;
    };
    let _ = app_config::update_app_config_map(app, |map| {
        map.insert(app_config::BROWSER_WINDOW_BOUNDS_KEY.to_string(), v);
        Ok(())
    });
}

pub(crate) fn schedule_persist_browser_window_bounds(app: &tauri::AppHandle) {
    let state = app.state::<BrowserWindowState>();
    let next = state
        .save_seq
        .fetch_add(1, Ordering::Relaxed)
        .saturating_add(1);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(350)).await;
        let state = app.state::<BrowserWindowState>();
        if state.save_seq.load(Ordering::Relaxed) != next {
            return;
        }
        persist_browser_window_bounds(&app, &state);
    });
}

pub(crate) fn save_browser_stack_bounds_if_valid(app: &tauri::AppHandle) {
    let state = app.state::<BrowserWindowState>();
    if state.fullscreen.lock().ok().map(|g| *g).unwrap_or(false) {
        return;
    }

    let (Some(bar), Some(content)) = (bar_window(app), active_content_window(app)) else {
        return;
    };

    let Ok(pos) = bar.outer_position() else {
        return;
    };
    if pos.x <= HIDDEN_POSITION_THRESHOLD || pos.y <= HIDDEN_POSITION_THRESHOLD {
        return;
    }

    let Ok(content_size) = content.inner_size() else {
        return;
    };
    if content_size.width < MIN_CONTENT_SIZE || content_size.height < 150 {
        return;
    }

    let bar_h = browser_stack_bar_height_px(&bar);
    let total = tauri::PhysicalSize::new(
        content_size.width,
        bar_h.saturating_add(content_size.height),
    );

    if let Ok(mut g) = state.last_bounds.lock() {
        *g = Some((pos, total));
    };
}

pub(crate) fn restore_browser_stack_bounds_or_center(
    app: &tauri::AppHandle,
    bar: &tauri::WebviewWindow,
    content: &tauri::WebviewWindow,
    pos: tauri::PhysicalPosition<i32>,
    total: tauri::PhysicalSize<u32>,
) {
    let monitors = bar.available_monitors().unwrap_or_default();
    let mut next_pos = pos;
    let mut next_total = total;

    if !monitors.is_empty() {
        let mut intersected: Option<tauri::PhysicalRect<i32, u32>> = None;
        for m in &monitors {
            let wa = *m.work_area();
            if rect_intersects(
                next_pos,
                next_total,
                wa.position,
                tauri::PhysicalSize::new(wa.size.width, wa.size.height),
            ) {
                intersected = Some(wa);
                break;
            }
        }

        if let Some(wa) = intersected {
            let max_w = wa.size.width.max(1);
            let max_h = wa.size.height.max(1);
            next_total =
                tauri::PhysicalSize::new(next_total.width.min(max_w), next_total.height.min(max_h));

            let min_x = wa.position.x;
            let min_y = wa.position.y;
            let max_x = wa.position.x + wa.size.width as i32 - next_total.width as i32;
            let max_y = wa.position.y + wa.size.height as i32 - next_total.height as i32;
            next_pos = tauri::PhysicalPosition::new(
                clamp_i32(next_pos.x, min_x, max_x),
                clamp_i32(next_pos.y, min_y, max_y),
            );
        } else {
            if let Some(m) = bar
                .primary_monitor()
                .ok()
                .flatten()
                .or_else(|| bar.current_monitor().ok().flatten())
            {
                let wa = *m.work_area();
                let max_w = wa.size.width.max(1);
                let max_h = wa.size.height.max(1);
                next_total = tauri::PhysicalSize::new(
                    next_total.width.min(max_w),
                    next_total.height.min(max_h),
                );
                let x = wa.position.x + ((wa.size.width as i32 - next_total.width as i32) / 2);
                let y = wa.position.y + ((wa.size.height as i32 - next_total.height as i32) / 2);
                next_pos = tauri::PhysicalPosition::new(x, y);
            } else {
                let _ = bar.center();
                if let Ok(p) = bar.outer_position() {
                    next_pos = p;
                }
            }
        }
    }

    let bar_h = browser_stack_bar_height_px(bar);
    if next_total.height <= bar_h.saturating_add(50) || next_total.width < 200 {
        browser_stack_restore_or_center_bar(app);
        return;
    }

    remember_stack_bounds(app, next_pos, next_total);

    let content_h = next_total.height.saturating_sub(bar_h).max(1);
    let _ = bar.set_position(next_pos);
    apply_bar_window_layout(app, Some(next_total.width));

    let _ = content.set_position(tauri::PhysicalPosition::new(
        next_pos.x,
        next_pos.y + bar_h as i32,
    ));
    let _ = content.set_size(tauri::PhysicalSize::new(next_total.width, content_h));
}

fn rect_intersects(
    pos: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    other_pos: tauri::PhysicalPosition<i32>,
    other_size: tauri::PhysicalSize<u32>,
) -> bool {
    let pos2 = tauri::PhysicalPosition::new(
        pos.x.saturating_add(size.width as i32),
        pos.y.saturating_add(size.height as i32),
    );
    let other_pos2 = tauri::PhysicalPosition::new(
        other_pos.x.saturating_add(other_size.width as i32),
        other_pos.y.saturating_add(other_size.height as i32),
    );
    !(pos2.x <= other_pos.x
        || pos2.y <= other_pos.y
        || other_pos2.x <= pos.x
        || other_pos2.y <= pos.y)
}

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

// ── Windows 圆角特技（统一内核：按形态裁剪窗口区域） ────────────────────────────

#[derive(Clone, Copy, PartialEq)]
enum CornerShape {
    /// 顶部圆角、底部平边（贴在内容窗口上方）。
    TopRounded,
    /// 底部圆角、顶部平边（贴在顶部栏下方）。
    BottomRounded,
    /// 四角圆角（下拉面板展开时）。
    AllRounded,
}

#[cfg(windows)]
fn apply_rounded_corners_impl(
    window: &tauri::WebviewWindow,
    radius_dip: f64,
    shape: CornerShape,
) {
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, GDI_REGION_TYPE,
        RGN_OR,
    };

    let hwnd = match window.hwnd() {
        Ok(v) => v,
        Err(_) => return,
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = match window.outer_size() {
        Ok(v) => v,
        Err(_) => return,
    };

    let w = size.width as i32;
    let h = size.height as i32;
    if w <= 0 || h <= 0 {
        return;
    }

    let mut r = (radius_dip * scale).round() as i32;
    r = r.max(0).min(w / 2).min(h / 2);

    unsafe {
        if r == 0 {
            let _ = SetWindowRgn(hwnd, None, true);
            return;
        }

        let round = CreateRoundRectRgn(0, 0, w + 1, h + 1, r * 2, r * 2);
        if round.0 == std::ptr::null_mut() {
            return;
        }

        if shape == CornerShape::AllRounded {
            if SetWindowRgn(hwnd, Some(round), true) == 0 {
                let _ = DeleteObject(round.into());
            }
            return;
        }

        // 与圆角相对的平边矩形：顶部圆角时平边贴底，底部圆角时平边贴顶。
        let flat = if shape == CornerShape::TopRounded {
            CreateRectRgn(0, h - r, w + 1, h + 1)
        } else {
            CreateRectRgn(0, 0, w + 1, r + 1)
        };
        if flat.0 == std::ptr::null_mut() {
            let _ = DeleteObject(round.into());
            return;
        }
        let combined = CreateRectRgn(0, 0, 0, 0);
        if combined.0 == std::ptr::null_mut() {
            let _ = DeleteObject(round.into());
            let _ = DeleteObject(flat.into());
            return;
        }

        let ok = CombineRgn(Some(combined), Some(round), Some(flat), RGN_OR);
        let _ = DeleteObject(round.into());
        let _ = DeleteObject(flat.into());
        if ok == GDI_REGION_TYPE(0) {
            let _ = DeleteObject(combined.into());
            return;
        }

        if SetWindowRgn(hwnd, Some(combined), true) == 0 {
            let _ = DeleteObject(combined.into());
        }
    }
}

#[cfg(windows)]
pub(crate) fn apply_bottom_rounded_corners(window: &tauri::WebviewWindow, radius_dip: f64) {
    apply_rounded_corners_impl(window, radius_dip, CornerShape::BottomRounded);
}

#[cfg(windows)]
pub(crate) fn apply_top_rounded_corners(window: &tauri::WebviewWindow, radius_dip: f64) {
    apply_rounded_corners_impl(window, radius_dip, CornerShape::TopRounded);
}

#[cfg(windows)]
pub(crate) fn apply_all_rounded_corners(window: &tauri::WebviewWindow, radius_dip: f64) {
    apply_rounded_corners_impl(window, radius_dip, CornerShape::AllRounded);
}

#[cfg(not(windows))]
pub(crate) fn apply_bottom_rounded_corners(_window: &tauri::WebviewWindow, _radius_dip: f64) {}

#[cfg(not(windows))]
pub(crate) fn apply_top_rounded_corners(_window: &tauri::WebviewWindow, _radius_dip: f64) {}

#[cfg(not(windows))]
pub(crate) fn apply_all_rounded_corners(_window: &tauri::WebviewWindow, _radius_dip: f64) {}

fn apply_bar_corner_shape(bar: &tauri::WebviewWindow, panel_open: bool) {
    if panel_open {
        apply_all_rounded_corners(bar, 16.0);
    } else {
        apply_top_rounded_corners(bar, 16.0);
    }
}
