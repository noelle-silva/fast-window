use super::*;

pub(super) fn browser_stack_set_always_on_top(app: &tauri::AppHandle, enable: bool) {
    if let Some(w) = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        let _ = w.set_always_on_top(enable);
    }
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.set_always_on_top(enable);
    }
}

pub(super) fn browser_stack_is_pinned(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    state.pinned.lock().ok().map(|g| *g).unwrap_or(false)
}

pub(super) fn browser_stack_bar_height_px(bar: &tauri::WebviewWindow) -> u32 {
    if let Ok(s) = bar.inner_size() {
        if s.height > 0 {
            return s.height;
        }
    }
    let scale = bar.scale_factor().unwrap_or(1.0);
    (BROWSER_BAR_HEIGHT * scale).round().max(1.0) as u32
}

pub(super) fn browser_stack_exists(app: &tauri::AppHandle) -> bool {
    app.get_webview_window(BROWSER_BAR_WINDOW_LABEL).is_some()
        && app.get_webview_window(BROWSER_WINDOW_LABEL).is_some()
}

pub(super) fn browser_stack_is_visible(app: &tauri::AppHandle) -> bool {
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

pub(super) fn browser_stack_is_focused(app: &tauri::AppHandle) -> bool {
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

pub(super) fn browser_stack_set_suppress_hide(app: &tauri::AppHandle, duration_ms: u64) {
    let state = app.state::<BrowserWindowState>();
    let until = now_ms().saturating_add(duration_ms);
    if let Ok(mut g) = state.suppress_hide_until_ms.lock() {
        *g = (*g).max(until);
    };
}

pub(super) fn browser_stack_should_suppress_hide(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    let until = state
        .suppress_hide_until_ms
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(0);
    now_ms() < until
}

pub(super) fn browser_stack_restore_or_center(app: &tauri::AppHandle) {
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
        // 让“整个浏览栈（顶部栏+网页）”居中，而不是只让顶部栏居中。
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

pub(super) fn browser_stack_show(app: &tauri::AppHandle) {
    if !browser_stack_exists(app) {
        return;
    }
    // 强制不变量：浏览栈可见时，主窗口必须隐藏（避免“两个都响应/抢焦点”的错觉）。
    hide_main_window(app);
    // 显示/聚焦时会有短暂的焦点抖动，避免误触发“失焦隐藏”。
    browser_stack_set_suppress_hide(app, 800);
    browser_stack_restore_or_center(app);
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        apply_bottom_rounded_corners(&w, 16.0);
    }

    if let Some(w) = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        let _ = w.show();
    }
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
    }
    browser_ui_set_mode(app, wake_logic::UiMode::BrowserVisible);
}

pub(super) fn browser_stack_hide(app: &tauri::AppHandle) {
    let bar = match app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        Some(w) => w,
        None => return,
    };
    let content = match app.get_webview_window(BROWSER_WINDOW_LABEL) {
        Some(w) => w,
        None => return,
    };

    let state = app.state::<BrowserWindowState>();
    // 隐藏前先落盘当前边界（避免隐藏时坐标被移到屏幕外导致写入无效值）
    save_browser_stack_bounds_if_valid(app);
    persist_browser_window_bounds(app, &state);
    if let Ok(pos) = bar.outer_position() {
        // 隐藏时会把窗口移到屏幕外（-10000, -10000），不要把这种位置记成“上次位置”
        if pos.x > -9000 && pos.y > -9000 {
            if let Ok(mut g) = state.last_position.lock() {
                *g = Some(pos);
            }
        }
    }

    let _ = bar.set_position(tauri::PhysicalPosition::new(-10000, -10000));
    let _ = content.set_position(tauri::PhysicalPosition::new(-10000, -10000));
    let _ = bar.hide();
    let _ = content.hide();
    browser_ui_set_mode(app, wake_logic::UiMode::Hidden);
}

pub(super) fn browser_stack_hide_to_main(app: &tauri::AppHandle) {
    // “隐藏”只做 UI 切换：保留浏览栈窗口与 session 状态，方便再次唤起继续用。
    browser_stack_hide(app);
    emit_activate_plugin_if_any(app);
    show_main_window(app);
}

pub(super) fn browser_stack_end_session(app: &tauri::AppHandle) {
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
    }
    emit_activate_plugin_if_any(app);
    show_main_window(app);
}

pub(super) fn browser_stack_is_closing(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    state.closing.lock().ok().map(|g| *g).unwrap_or(false)
}

pub(super) fn browser_stack_set_closing(app: &tauri::AppHandle, closing: bool) {
    let state = app.state::<BrowserWindowState>();
    if let Ok(mut g) = state.closing.lock() {
        *g = closing;
    };
}

pub(super) fn browser_stack_close(app: &tauri::AppHandle) {
    // “关闭浏览”应当真正销毁 WebView：否则只是 hide，会导致网页音频继续播放。
    browser_stack_set_closing(app, true);
    browser_stack_end_session(app);

    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        let _ = w.close();
    }
}

pub(super) fn browser_stack_apply_fullscreen(app: &tauri::AppHandle, enable: bool) -> Result<(), String> {
    let bar = app
        .get_webview_window(BROWSER_BAR_WINDOW_LABEL)
        .ok_or_else(|| "顶部栏窗口不存在".to_string())?;
    let content = app
        .get_webview_window(BROWSER_WINDOW_LABEL)
        .ok_or_else(|| "浏览窗口不存在".to_string())?;

    let state = app.state::<BrowserWindowState>();

    // 如果窗口处于“最大化”状态，set_size/set_position 可能会被系统忽略。
    let _ = bar.unmaximize();
    let _ = content.unmaximize();

    if enable {
        // 记录“还原边界”（只记录一次，避免全屏状态下覆盖）
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
        }

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
        // 布局调整期间焦点会抖动，避免误隐藏
        browser_stack_set_suppress_hide(app, 1200);
        let _ = bar.show();
        let _ = content.show();
        let _ = content.set_focus();
        return Ok(());
    }

    // disable
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
            tauri::PhysicalSize::new(1020, BROWSER_STACK_TOTAL_HEIGHT.round().max(200.0) as u32),
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
