use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_global_shortcut::Shortcut;

#[derive(Default)]
pub(crate) struct WindowState {
    pub(crate) last_bounds: Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>,
    pub(crate) save_seq: AtomicU64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedWindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

pub(crate) struct BrowserWindowState {
    pub(crate) return_to_plugin_id: Mutex<Option<String>>,
    pub(crate) active: Mutex<bool>,
    pub(crate) ui_mode: Mutex<crate::wake_logic::UiMode>,
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
            return_to_plugin_id: Mutex::new(None),
            active: Mutex::new(false),
            ui_mode: Mutex::new(crate::wake_logic::UiMode::Hidden),
            last_position: Mutex::new(None),
            suppress_hide_until_ms: Mutex::new(0),
            fullscreen: Mutex::new(false),
            restore_bounds: Mutex::new(None),
            // 图钉：默认不启用（维持“失焦自动隐藏”的原交互）。
            pinned: Mutex::new(false),
            // 关闭防抖：我们有两个窗口（顶部栏 + 内容），关闭时需要避免 CloseRequested 互相触发导致循环。
            closing: Mutex::new(false),
            last_bounds: Mutex::new(None),
            save_seq: AtomicU64::new(0),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivatePluginPayload {
    pub(crate) plugin_id: String,
}

pub(crate) struct WakeShortcutState {
    pub(crate) current: Mutex<Shortcut>,
    pub(crate) paused: Mutex<bool>,
}

pub(crate) trait Boundsable {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>>;
    fn inner_size(&self) -> tauri::Result<tauri::PhysicalSize<u32>>;
    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()>;
    fn set_size(&self, size: tauri::PhysicalSize<u32>) -> tauri::Result<()>;
    fn center(&self) -> tauri::Result<()>;
    fn available_monitors(&self) -> tauri::Result<Vec<tauri::Monitor>>;
}

impl Boundsable for tauri::Window {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>> {
        tauri::Window::outer_position(self)
    }

    fn inner_size(&self) -> tauri::Result<tauri::PhysicalSize<u32>> {
        tauri::Window::inner_size(self)
    }

    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()> {
        tauri::Window::set_position(self, position)
    }

    fn set_size(&self, size: tauri::PhysicalSize<u32>) -> tauri::Result<()> {
        tauri::Window::set_size(self, size)
    }

    fn center(&self) -> tauri::Result<()> {
        tauri::Window::center(self)
    }

    fn available_monitors(&self) -> tauri::Result<Vec<tauri::Monitor>> {
        tauri::Window::available_monitors(self)
    }
}

impl Boundsable for tauri::WebviewWindow {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>> {
        tauri::WebviewWindow::outer_position(self)
    }

    fn inner_size(&self) -> tauri::Result<tauri::PhysicalSize<u32>> {
        tauri::WebviewWindow::inner_size(self)
    }

    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()> {
        tauri::WebviewWindow::set_position(self, position)
    }

    fn set_size(&self, size: tauri::PhysicalSize<u32>) -> tauri::Result<()> {
        tauri::WebviewWindow::set_size(self, size)
    }

    fn center(&self) -> tauri::Result<()> {
        tauri::WebviewWindow::center(self)
    }

    fn available_monitors(&self) -> tauri::Result<Vec<tauri::Monitor>> {
        tauri::WebviewWindow::available_monitors(self)
    }
}

pub(crate) fn save_bounds_if_valid(window: &impl Boundsable, state: &WindowState) {
    let Ok(pos) = window.outer_position() else {
        return;
    };
    // 隐藏时会把窗口移到屏幕外（-10000, -10000），不要把这种位置记成“上次位置”
    if pos.x <= -9000 || pos.y <= -9000 {
        return;
    }
    // 这里必须用 inner_size：Tauri 的 set_size 更接近“内容区大小”，
    // 如果用 outer_size 保存再用 set_size 恢复，会把边框/阴影重复叠加，导致每次唤醒都变大。
    let Ok(size) = window.inner_size() else {
        return;
    };
    // 极端情况下可能拿到 0；不要写入无效尺寸
    if size.width < 200 || size.height < 150 {
        return;
    }
    if let Ok(mut guard) = state.last_bounds.lock() {
        *guard = Some((pos, size));
    }
}

fn rect_intersects(
    a_pos: tauri::PhysicalPosition<i32>,
    a_size: tauri::PhysicalSize<u32>,
    b_pos: tauri::PhysicalPosition<i32>,
    b_size: tauri::PhysicalSize<u32>,
) -> bool {
    let ax1 = a_pos.x as i64;
    let ay1 = a_pos.y as i64;
    let ax2 = ax1 + a_size.width as i64;
    let ay2 = ay1 + a_size.height as i64;

    let bx1 = b_pos.x as i64;
    let by1 = b_pos.y as i64;
    let bx2 = bx1 + b_size.width as i64;
    let by2 = by1 + b_size.height as i64;

    ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1
}

fn clamp_i32(v: i32, min: i32, max: i32) -> i32 {
    if v < min {
        return min;
    }
    if v > max {
        return max;
    }
    v
}

pub(crate) fn restore_bounds_or_center(window: &impl Boundsable, state: &WindowState) {
    let last = state.last_bounds.lock().ok().and_then(|g| g.clone());

    if let Some((pos, size)) = last {
        let monitors = window.available_monitors().unwrap_or_default();
        if monitors.is_empty() {
            let _ = window.set_size(size);
            let _ = window.set_position(pos);
            return;
        }

        // 防御：之前版本如果把 outer_size 当成 set_size 的参数，会导致配置里记录的尺寸越存越大。
        // 这里按显示器 work area 把恢复尺寸/位置夹回合理范围，避免升级后第一次唤醒还炸屏。
        let mut picked: Option<tauri::PhysicalRect<i32, u32>> = None;
        for m in &monitors {
            let wa = *m.work_area();
            if rect_intersects(
                pos,
                size,
                wa.position,
                tauri::PhysicalSize::new(wa.size.width, wa.size.height),
            ) {
                picked = Some(wa);
                break;
            }
        }

        if let Some(wa) = picked {
            let max_w = wa.size.width.max(1);
            let max_h = wa.size.height.max(1);
            let next_size = tauri::PhysicalSize::new(size.width.min(max_w), size.height.min(max_h));

            let min_x = wa.position.x;
            let min_y = wa.position.y;
            let max_x = wa.position.x + wa.size.width as i32 - next_size.width as i32;
            let max_y = wa.position.y + wa.size.height as i32 - next_size.height as i32;
            let next_pos = tauri::PhysicalPosition::new(
                clamp_i32(pos.x, min_x, max_x),
                clamp_i32(pos.y, min_y, max_y),
            );

            let _ = window.set_size(next_size);
            let _ = window.set_position(next_pos);
            return;
        }
    }

    let _ = window.center();
}

pub(crate) fn load_main_window_bounds_from_config(
    app: &tauri::AppHandle,
) -> Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)> {
    let map = crate::read_app_config_map(app);
    let raw = map.get(crate::MAIN_WINDOW_BOUNDS_KEY)?.clone();
    let parsed = serde_json::from_value::<PersistedWindowBounds>(raw).ok()?;

    if parsed.x <= -9000 || parsed.y <= -9000 {
        return None;
    }
    if parsed.width < 200 || parsed.height < 150 {
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

pub(crate) fn persist_main_window_bounds(app: &tauri::AppHandle, state: &WindowState) {
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

    let mut map = crate::read_app_config_map(app);
    let Ok(v) = serde_json::to_value(bounds) else {
        return;
    };
    map.insert(crate::MAIN_WINDOW_BOUNDS_KEY.to_string(), v);
    if let Err(e) = crate::write_app_config_map(app, &map) {
        eprintln!("[config] failed to persist main window bounds: {e}");
    }
}

pub(crate) fn schedule_persist_main_window_bounds(app: &tauri::AppHandle) {
    let state = app.state::<WindowState>();
    let next = state
        .save_seq
        .fetch_add(1, Ordering::Relaxed)
        .saturating_add(1);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(350)).await;
        let state = app.state::<WindowState>();
        if state.save_seq.load(Ordering::Relaxed) != next {
            return;
        }
        persist_main_window_bounds(&app, &state);
    });
}

pub(crate) fn load_browser_window_bounds_from_config(
    app: &tauri::AppHandle,
) -> Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)> {
    let map = crate::read_app_config_map(app);
    let raw = map.get(crate::BROWSER_WINDOW_BOUNDS_KEY)?.clone();
    let parsed = serde_json::from_value::<PersistedWindowBounds>(raw).ok()?;

    if parsed.x <= -9000 || parsed.y <= -9000 {
        return None;
    }
    if parsed.width < 200 || parsed.height < 200 {
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

pub(crate) fn persist_browser_window_bounds(app: &tauri::AppHandle, state: &BrowserWindowState) {
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

    let mut map = crate::read_app_config_map(app);
    let Ok(v) = serde_json::to_value(bounds) else {
        return;
    };
    map.insert(crate::BROWSER_WINDOW_BOUNDS_KEY.to_string(), v);
    if let Err(e) = crate::write_app_config_map(app, &map) {
        eprintln!("[config] failed to persist browser window bounds: {e}");
    }
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
        app.get_webview_window(crate::BROWSER_BAR_WINDOW_LABEL),
        app.get_webview_window(crate::BROWSER_WINDOW_LABEL),
    ) else {
        return;
    };

    let Ok(pos) = bar.outer_position() else {
        return;
    };
    if pos.x <= -9000 || pos.y <= -9000 {
        return;
    }

    let Ok(content_size) = content.inner_size() else {
        return;
    };
    if content_size.width < 200 || content_size.height < 150 {
        return;
    }

    let bar_h = crate::browser_stack::browser_stack_bar_height_px(&bar);
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
            next_total = tauri::PhysicalSize::new(
                next_total.width.min(max_w),
                next_total.height.min(max_h),
            );

            let min_x = wa.position.x;
            let min_y = wa.position.y;
            let max_x = wa.position.x + wa.size.width as i32 - next_total.width as i32;
            let max_y = wa.position.y + wa.size.height as i32 - next_total.height as i32;
            next_pos = tauri::PhysicalPosition::new(
                clamp_i32(next_pos.x, min_x, max_x),
                clamp_i32(next_pos.y, min_y, max_y),
            );
        } else {
            // 配置位置不在任何屏幕上：保留尺寸，改为居中
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

    let bar_h = crate::browser_stack::browser_stack_bar_height_px(bar);
    if next_total.height <= bar_h.saturating_add(50) || next_total.width < 200 {
        crate::browser_stack::browser_stack_restore_or_center(app);
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
