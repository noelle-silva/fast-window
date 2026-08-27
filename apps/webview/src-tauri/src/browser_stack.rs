use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::app_config;

pub(crate) const BROWSER_WINDOW_LABEL: &str = "browser";
pub(crate) const BROWSER_BAR_WINDOW_LABEL: &str = "browser_bar";
pub(crate) const WEBVIEW_SETTINGS_UPDATED_EVENT: &str = "webview:settings-updated";
pub(crate) const BROWSER_BAR_HEIGHT: f64 = 40.0;
pub(crate) const BROWSER_STACK_TOTAL_HEIGHT: f64 = 605.0;

const HIDDEN_POSITION_THRESHOLD: i32 = -9000;
const MIN_CONTENT_SIZE: u32 = 200;
const MIN_WINDOW_HEIGHT: u32 = 200;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedWindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// 浏览栈（顶部栏 + 网页内容）的双窗口状态机。
pub(crate) struct BrowserWindowState {
    pub(crate) active: Mutex<bool>,
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

// ── 主窗口联动（app 语义：主窗口与浏览栈互斥可见） ─────────────────────────────

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
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
            sync_sibling_position(&app, is_bar);
            save_browser_stack_bounds_if_valid(&app);
            schedule_persist_browser_window_bounds(&app);
        }
        tauri::WindowEvent::Resized(_) => {
            if !is_bar {
                sync_bar_size(&app);
                apply_bottom_rounded_corners(&window_for_event, 16.0);
            } else {
                apply_top_rounded_corners(&window_for_event, 16.0);
            }
            save_browser_stack_bounds_if_valid(&app);
            schedule_persist_browser_window_bounds(&app);
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
        _ => {}
    });
}

fn sync_sibling_position(app: &tauri::AppHandle, is_bar: bool) {
    let (Some(bar), Some(content)) = (
        app.get_webview_window(BROWSER_BAR_WINDOW_LABEL),
        app.get_webview_window(BROWSER_WINDOW_LABEL),
    ) else {
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
    let (Some(bar), Some(content)) = (
        app.get_webview_window(BROWSER_BAR_WINDOW_LABEL),
        app.get_webview_window(BROWSER_WINDOW_LABEL),
    ) else {
        return;
    };
    let bar_h = browser_stack_bar_height_px(&bar);
    let content_w = content.inner_size().ok().map(|s| s.width).unwrap_or(0);
    if content_w > 0 {
        let cur_w = bar.inner_size().ok().map(|s| s.width).unwrap_or(0);
        if cur_w != content_w {
            let _ = bar.set_size(tauri::PhysicalSize::new(content_w, bar_h));
        }
    }
}

// ── 窗口状态查询/变更 ──────────────────────────────────────────────────────────

pub(crate) fn browser_stack_set_always_on_top(app: &tauri::AppHandle, enable: bool) {
    if let Some(w) = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        let _ = w.set_always_on_top(enable);
    }
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.set_always_on_top(enable);
    }
}

pub(crate) fn browser_stack_is_pinned(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    state.pinned.lock().ok().map(|g| *g).unwrap_or(false)
}

pub(crate) fn browser_stack_bar_height_px(bar: &tauri::WebviewWindow) -> u32 {
    if let Ok(s) = bar.inner_size() {
        if s.height > 0 {
            return s.height;
        }
    }
    let scale = bar.scale_factor().unwrap_or(1.0);
    (BROWSER_BAR_HEIGHT * scale).round().max(1.0) as u32
}

pub(crate) fn browser_stack_exists(app: &tauri::AppHandle) -> bool {
    app.get_webview_window(BROWSER_BAR_WINDOW_LABEL).is_some()
        && app.get_webview_window(BROWSER_WINDOW_LABEL).is_some()
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
    let bar = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL);
    let content = app.get_webview_window(BROWSER_WINDOW_LABEL);
    bar.as_ref()
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
        || content
            .as_ref()
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false)
}

pub(crate) fn browser_stack_is_visible(app: &tauri::AppHandle) -> bool {
    let bar = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL);
    let content = app.get_webview_window(BROWSER_WINDOW_LABEL);
    bar.as_ref()
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
        && content
            .as_ref()
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
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

// ── 显示/隐藏/关闭 ────────────────────────────────────────────────────────────

pub(crate) fn browser_stack_restore_or_center(app: &tauri::AppHandle) {
    let bar = match app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        Some(w) => w,
        None => return,
    };
    let content = match app.get_webview_window(BROWSER_WINDOW_LABEL) {
        Some(w) => w,
        None => return,
    };

    let state = app.state::<BrowserWindowState>();
    let saved = state.last_position.lock().ok().and_then(|g| g.clone());

    if let Some(pos) = saved {
        let _ = bar.set_position(pos);
    } else {
        let bar_size = bar.outer_size().ok();
        let content_size = content.outer_size().ok();
        let total_w = bar_size
            .map(|s| s.width)
            .or_else(|| content_size.map(|s| s.width))
            .unwrap_or(1020);
        let total_h = bar_size
            .map(|s| s.height)
            .unwrap_or(BROWSER_BAR_HEIGHT.round().max(1.0) as u32)
            .saturating_add(content_size.map(|s| s.height).unwrap_or(565));

        let monitor = bar
            .primary_monitor()
            .ok()
            .flatten()
            .or_else(|| bar.current_monitor().ok().flatten());
        if let Some(m) = monitor {
            let wa = *m.work_area();
            let x = wa.position.x + ((wa.size.width as i32 - total_w as i32) / 2);
            let y = wa.position.y + ((wa.size.height as i32 - total_h as i32) / 2);
            let _ = bar.set_position(tauri::PhysicalPosition::new(x, y));
        } else {
            let _ = bar.center();
        }
    }

    let bar_pos = bar.outer_position().ok();
    let bar_h = bar
        .inner_size()
        .ok()
        .map(|s| s.height)
        .unwrap_or(BROWSER_BAR_HEIGHT.round().max(1.0) as u32);
    if let Some(p) = bar_pos {
        let _ = content.set_position(tauri::PhysicalPosition::new(p.x, p.y + bar_h as i32));
    }
}

pub(crate) fn browser_stack_show(app: &tauri::AppHandle) {
    if !browser_stack_exists(app) {
        return;
    }
    hide_main_window(app);
    browser_stack_set_suppress_hide(app, 800);
    browser_stack_restore_or_center(app);
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        apply_bottom_rounded_corners(&w, 16.0);
    }
    if let Some(w) = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        apply_top_rounded_corners(&w, 16.0);
    }

    if let Some(w) = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        let _ = w.show();
    }
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub(crate) fn browser_stack_hide(app: &tauri::AppHandle) {
    let bar = match app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        Some(w) => w,
        None => return,
    };
    let content = match app.get_webview_window(BROWSER_WINDOW_LABEL) {
        Some(w) => w,
        None => return,
    };

    let state = app.state::<BrowserWindowState>();
    save_browser_stack_bounds_if_valid(app);
    persist_browser_window_bounds(app, &state);
    if let Ok(pos) = bar.outer_position() {
        if pos.x > HIDDEN_POSITION_THRESHOLD && pos.y > HIDDEN_POSITION_THRESHOLD {
            if let Ok(mut g) = state.last_position.lock() {
                *g = Some(pos);
            }
        }
    }

    let _ = bar.set_position(tauri::PhysicalPosition::new(-10000, -10000));
    let _ = content.set_position(tauri::PhysicalPosition::new(-10000, -10000));
    let _ = bar.hide();
    let _ = content.hide();
}

pub(crate) fn browser_stack_hide_to_main(app: &tauri::AppHandle) {
    // “隐藏”只做 UI 切换：保留浏览栈窗口与 session 状态，方便再次唤起继续用。
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

    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        let _ = w.close();
    }
    show_main_window(app);
}

pub(crate) fn browser_stack_apply_fullscreen(
    app: &tauri::AppHandle,
    enable: bool,
) -> Result<(), String> {
    let bar = app
        .get_webview_window(BROWSER_BAR_WINDOW_LABEL)
        .ok_or_else(|| "顶部栏窗口不存在".to_string())?;
    let content = app
        .get_webview_window(BROWSER_WINDOW_LABEL)
        .ok_or_else(|| "浏览窗口不存在".to_string())?;

    let state = app.state::<BrowserWindowState>();

    let _ = bar.unmaximize();
    let _ = content.unmaximize();

    if enable {
        if let Ok(mut g) = state.restore_bounds.lock() {
            if g.is_none() {
                let pos = bar
                    .outer_position()
                    .unwrap_or(tauri::PhysicalPosition::new(0, 0));
                let bar_size = bar
                    .outer_size()
                    .unwrap_or(tauri::PhysicalSize::new(1020, BROWSER_BAR_HEIGHT as u32));
                let content_size = content.outer_size().unwrap_or(tauri::PhysicalSize::new(
                    1020,
                    (BROWSER_STACK_TOTAL_HEIGHT - BROWSER_BAR_HEIGHT) as u32,
                ));
                let total = tauri::PhysicalSize::new(
                    bar_size.width,
                    bar_size.height.saturating_add(content_size.height),
                );
                *g = Some((pos, total));
            }
        };

        let monitor = bar
            .current_monitor()
            .map_err(|e| format!("读取显示器信息失败: {e}"))?
            .or_else(|| bar.primary_monitor().ok().flatten())
            .ok_or_else(|| "无法获取显示器信息".to_string())?;

        let wa = *monitor.work_area();
        let pos = wa.position;
        let size = wa.size;

        let scale = monitor.scale_factor();
        let bar_h = (BROWSER_BAR_HEIGHT * scale).round().max(1.0) as u32;
        let content_h = size.height.saturating_sub(bar_h).max(1);

        let _ = bar.set_position(pos);
        let _ = bar.set_size(tauri::PhysicalSize::new(size.width, bar_h));

        let _ = content.set_position(tauri::PhysicalPosition::new(pos.x, pos.y + bar_h as i32));
        let _ = content.set_size(tauri::PhysicalSize::new(size.width, content_h));
        apply_bottom_rounded_corners(&content, 16.0);

        if let Ok(mut g) = state.fullscreen.lock() {
            *g = true;
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
            tauri::PhysicalSize::new(
                1020,
                BROWSER_STACK_TOTAL_HEIGHT.round().max(200.0) as u32,
            ),
        )
    };

    let scale = bar.scale_factor().unwrap_or(1.0);
    let bar_h = (BROWSER_BAR_HEIGHT * scale).round().max(1.0) as u32;
    let content_h = total.height.saturating_sub(bar_h).max(1);

    let _ = bar.set_position(pos);
    let _ = bar.set_size(tauri::PhysicalSize::new(total.width, bar_h));

    let _ = content.set_position(tauri::PhysicalPosition::new(pos.x, pos.y + bar_h as i32));
    let _ = content.set_size(tauri::PhysicalSize::new(total.width, content_h));
    apply_bottom_rounded_corners(&content, 16.0);

    if let Ok(mut g) = state.fullscreen.lock() {
        *g = false;
    }
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

    let (Some(bar), Some(content)) = (
        app.get_webview_window(BROWSER_BAR_WINDOW_LABEL),
        app.get_webview_window(BROWSER_WINDOW_LABEL),
    ) else {
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
        browser_stack_restore_or_center(app);
        return;
    }

    let content_h = next_total.height.saturating_sub(bar_h).max(1);
    let _ = bar.set_position(next_pos);
    let _ = bar.set_size(tauri::PhysicalSize::new(next_total.width, bar_h));

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

// ── Windows 圆角特技（统一内核：保留一侧平边，另一侧两角圆） ────────────────────

#[cfg(windows)]
fn apply_rounded_corners_impl(
    window: &tauri::WebviewWindow,
    radius_dip: f64,
    rounded_bottom: bool,
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
        // 与圆角相对的平边矩形：圆角边为 bottom 时平边贴顶，反之贴底。
        let flat = if rounded_bottom {
            CreateRectRgn(0, 0, w + 1, r + 1)
        } else {
            CreateRectRgn(0, h - r, w + 1, h + 1)
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
    apply_rounded_corners_impl(window, radius_dip, true);
}

#[cfg(windows)]
pub(crate) fn apply_top_rounded_corners(window: &tauri::WebviewWindow, radius_dip: f64) {
    apply_rounded_corners_impl(window, radius_dip, false);
}

#[cfg(not(windows))]
pub(crate) fn apply_bottom_rounded_corners(_window: &tauri::WebviewWindow, _radius_dip: f64) {}

#[cfg(not(windows))]
pub(crate) fn apply_top_rounded_corners(_window: &tauri::WebviewWindow, _radius_dip: f64) {}
