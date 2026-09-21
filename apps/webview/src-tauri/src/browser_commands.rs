use tauri::{Emitter, Manager};

use crate::browser_data::BrowserDataDir;
use crate::browser_stack::{
    self, active_content_window, apply_bottom_rounded_corners, apply_fullscreen_bounds,
    apply_top_rounded_corners, bar_window, browser_stack_apply_fullscreen, browser_stack_close,
    browser_stack_hide, browser_stack_is_pinned, browser_stack_restore_or_center_bar,
    browser_stack_set_always_on_top, browser_stack_set_suppress_hide, browser_stack_show,
    content_windows, current_stack_bounds, emit_pages_updated, load_browser_window_bounds_from_config,
    next_page_label, register_page, reset_bar_panel, restore_browser_stack_bounds_or_center,
    set_active_page, BrowserPage, BrowserPageIcon, BrowserPagesPayload, BrowserWindowState,
    BROWSER_BAR_HEIGHT, BROWSER_BAR_WINDOW_LABEL, BROWSER_STACK_TOTAL_HEIGHT, DEFAULT_STACK_HEIGHT,
    DEFAULT_STACK_WIDTH, WEBVIEW_SETTINGS_UPDATED_EVENT,
};
use crate::util::is_http_url;
use crate::webview_settings::{self, WebviewSettings};

// ── 浏览栈命令 ───────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) async fn open_browser_window(
    app: tauri::AppHandle,
    url: String,
    name: Option<String>,
    icon: Option<BrowserPageIcon>,
) -> Result<(), String> {
    open_browser_window_impl(app, url, name.unwrap_or_default(), icon).await
}

pub(crate) async fn open_browser_window_impl(
    app: tauri::AppHandle,
    url: String,
    name: String,
    icon: Option<BrowserPageIcon>,
) -> Result<(), String> {
    let mut u = url.trim().to_string();
    if u.chars().any(|c| c.is_whitespace()) {
        return Err("url 不允许包含空白字符，请先进行 URL 编码（例如空格用 %20）".to_string());
    }
    if u.contains('\\') {
        u = u.replace('\\', "/");
    }
    if !is_http_url(&u) {
        return Err("url 必须以 http(s):// 开头".to_string());
    }

    let parsed = tauri::Url::parse(&u).map_err(|e| format!("url 解析失败: {e}"))?;
    let page_name = normalize_page_name(&name, &u);

    {
        let state = app.state::<BrowserWindowState>();
        if let Ok(mut g) = state.active.lock() {
            *g = true;
        };
        if let Ok(mut g) = state.closing.lock() {
            *g = false;
        };
    }
    browser_stack_set_suppress_hide(&app, 1500);

    // 初次打开：把主窗口位置作为浏览栈初始落点，并尝试恢复上次的窗口形态。
    if bar_window(&app).is_none() {
        if let Some(main) = app.get_webview_window("main") {
            if let Ok(pos) = main.outer_position() {
                if pos.x > -9000 && pos.y > -9000 {
                    let state = app.state::<BrowserWindowState>();
                    if let Ok(mut g) = state.last_position.lock() {
                        *g = Some(pos);
                    };
                }
            }
        }
        let state = app.state::<BrowserWindowState>();
        let has_bounds = state
            .last_bounds
            .lock()
            .ok()
            .map(|g| g.is_some())
            .unwrap_or(false);
        if !has_bounds {
            if let Some(bounds) = load_browser_window_bounds_from_config(&app) {
                if let Ok(mut g) = state.last_bounds.lock() {
                    *g = Some(bounds);
                };
            }
        }
    }

    let settings = webview_settings::load(&app);
    let video_script = webview_settings::browser_video_injection_script(&settings.video)?;
    let page_rate =
        webview_settings::clamp_video_rate(settings.video.default_rate, settings.video.max_rate);

    if bar_window(&app).is_none() {
        create_browser_bar_window(&app)?;
        browser_stack_restore_or_center_bar(&app);
    } else if let Some(bar) = bar_window(&app) {
        // 隐藏状态下再次打开收藏：先恢复 bar 位置，再让新页面沿用记忆形态。
        if !bar.is_visible().unwrap_or(false) {
            browser_stack_restore_or_center_bar(&app);
        }
    }
    reset_bar_panel(&app);

    // 新页面形态：活跃窗口实时形态优先，其次 bar 实际位置 + 记忆尺寸。
    let (pos, total) = resolve_new_page_bounds(&app);
    let fullscreen = app
        .state::<BrowserWindowState>()
        .fullscreen
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(false);

    let label = next_page_label(&app);
    let content = create_page_window(&app, &label, parsed, video_script)?;
    browser_stack::attach_browser_stack_window_events(app.clone(), content.clone(), false);

    let Some(bar) = bar_window(&app) else {
        let _ = content.destroy();
        return Err("顶部栏窗口不存在".to_string());
    };
    if fullscreen {
        let _ = apply_fullscreen_bounds(&app, &content);
    } else {
        restore_browser_stack_bounds_or_center(&app, &bar, &content, pos, total);
    }

    if let Some(old) = active_content_window(&app) {
        let _ = old.hide();
    }

    register_page(
        &app,
        BrowserPage {
            label: label.clone(),
            name: page_name,
            icon,
            rate: page_rate,
        },
    );
    set_active_page(&app, Some(label));

    apply_bottom_rounded_corners(&content, 16.0);
    apply_top_rounded_corners(&bar, 16.0);
    browser_stack::browser_stack_hide_main_window(&app);
    let _ = bar.show();

    let _ = content.show();
    let _ = content.set_focus();
    emit_pages_updated(&app);
    Ok(())
}

fn normalize_page_name(name: &str, url: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        url.trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn resolve_new_page_bounds(
    app: &tauri::AppHandle,
) -> (tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>) {
    if active_content_window(app).is_some() {
        if let Some(bounds) = current_stack_bounds(app) {
            return bounds;
        }
    }

    let state = app.state::<BrowserWindowState>();
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
    let pos = bar_window(app)
        .and_then(|bar| bar.outer_position().ok())
        .unwrap_or(tauri::PhysicalPosition::new(0, 0));
    (pos, size)
}

/// 所有浏览窗口统一使用本次会话固定的浏览器数据目录（登录态共享）。
fn apply_browser_data_dir<'a>(
    app: &tauri::AppHandle,
    builder: tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
) -> tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    match app.state::<BrowserDataDir>().path() {
        Some(dir) => builder.data_directory(dir.to_path_buf()),
        None => builder,
    }
}

fn create_browser_bar_window(app: &tauri::AppHandle) -> Result<(), String> {
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        BROWSER_BAR_WINDOW_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("webview")
    .inner_size(DEFAULT_STACK_WIDTH as f64, BROWSER_BAR_HEIGHT)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false);
    let bar = apply_browser_data_dir(app, builder)
        .build()
        .map_err(|e| format!("创建顶部栏窗口失败: {e}"))?;

    browser_stack::attach_browser_stack_window_events(app.clone(), bar, true);
    Ok(())
}

fn create_page_window(
    app: &tauri::AppHandle,
    label: &str,
    url: tauri::Url,
    video_script: String,
) -> Result<tauri::WebviewWindow, String> {
    let app_content_events = app.clone();
    let content_label = label.to_string();
    let builder = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::External(url))
        .title("webview")
        .initialization_script(video_script)
        .on_new_window(move |url, _features| {
            if is_http_url(url.as_str()) {
                if let Some(w) = app_content_events.get_webview_window(&content_label) {
                    let _ = w.navigate(url);
                }
            } else {
                let _ = open::that(url.as_str());
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .inner_size(
            DEFAULT_STACK_WIDTH as f64,
            (BROWSER_STACK_TOTAL_HEIGHT - BROWSER_BAR_HEIGHT).max(200.0),
        )
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false);
    apply_browser_data_dir(app, builder)
        .build()
        .map_err(|e| format!("创建浏览窗口失败: {e}"))
}

#[tauri::command]
pub(crate) async fn close_browser_window(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack_close(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn hide_browser_stack(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack::browser_stack_hide(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_stack_return_to_main(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack::browser_stack_hide_to_main(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_stack_show_active(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack_show(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_stack_pages(
    app: tauri::AppHandle,
) -> Result<BrowserPagesPayload, String> {
    Ok(browser_stack::pages_payload(&app))
}

#[tauri::command]
pub(crate) async fn browser_stack_activate_page(
    app: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("label 不能为空".to_string());
    }
    browser_stack::browser_stack_activate_page(&app, label)
}

#[tauri::command]
pub(crate) async fn browser_stack_close_page(
    app: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("label 不能为空".to_string());
    }
    browser_stack::browser_stack_close_page(&app, label)
}

#[tauri::command]
pub(crate) async fn browser_stack_set_bar_panel(
    app: tauri::AppHandle,
    open: bool,
    panel_height: f64,
) -> Result<(), String> {
    browser_stack::browser_stack_set_bar_panel(&app, open, panel_height)
}

#[tauri::command]
pub(crate) async fn browser_stack_set_active_rate(
    app: tauri::AppHandle,
    rate: f64,
) -> Result<(), String> {
    let settings = webview_settings::load(&app);
    let clamped = webview_settings::clamp_video_rate(rate, settings.video.max_rate);
    browser_stack::browser_stack_set_active_page_rate(&app, clamped);
    Ok(())
}

#[tauri::command]
pub(crate) async fn host_back(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack_hide(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_go_back(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = active_content_window(&app) {
        let _ = w.eval("history.back()");
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_go_forward(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = active_content_window(&app) {
        let _ = w.eval("history.forward()");
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_reload(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = active_content_window(&app) {
        let _ = w.eval("location.reload()");
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_stack_toggle_fullscreen(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<BrowserWindowState>();
    let next = state.fullscreen.lock().ok().map(|g| !*g).unwrap_or(true);
    browser_stack_apply_fullscreen(&app, next)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_stack_get_pinned(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(browser_stack_is_pinned(&app))
}

#[tauri::command]
pub(crate) async fn browser_stack_toggle_pinned(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<BrowserWindowState>();
    let next = {
        let mut g = state
            .pinned
            .lock()
            .map_err(|_| "浏览窗口状态锁定失败".to_string())?;
        *g = !*g;
        *g
    };
    if next {
        browser_stack_set_always_on_top(&app, true);
    }
    Ok(next)
}

// ── 视频倍速命令 ─────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn get_webview_settings(app: tauri::AppHandle) -> WebviewSettings {
    webview_settings::load(&app)
}

#[tauri::command]
pub(crate) fn set_webview_settings(
    app: tauri::AppHandle,
    settings: WebviewSettings,
) -> Result<WebviewSettings, String> {
    let next = webview_settings::save(&app, settings)?;

    if let Ok(script) = webview_settings::browser_video_injection_script(&next.video) {
        for w in content_windows(&app) {
            let _ = w.eval(&script);
        }
    }

    // 记录即真相：重注入会把页面速率重置为新默认值，这里按各页记录恢复（并按新上限夹取）。
    for page in browser_stack::pages_payload(&app).pages {
        let rate = webview_settings::clamp_video_rate(page.rate, next.video.max_rate);
        if let Some(w) = app.get_webview_window(&page.label) {
            let _ = w.eval(&video_rate_apply_script(rate));
        }
        browser_stack::browser_stack_set_page_rate(&app, &page.label, rate);
    }

    let _ = app.emit_to(
        tauri::EventTarget::webview_window(BROWSER_BAR_WINDOW_LABEL),
        WEBVIEW_SETTINGS_UPDATED_EVENT,
        next.clone(),
    );
    let _ = app.emit_to(
        tauri::EventTarget::webview_window("main"),
        WEBVIEW_SETTINGS_UPDATED_EVENT,
        next.clone(),
    );

    Ok(next)
}

fn video_rate_apply_script(rate: f64) -> String {
    format!(
        r#"(function () {{
  try {{
    if (window.__fastwindowVideoSpeedToggleState) {{
      window.__fastwindowVideoSpeedToggleState.activeKey = null;
      window.__fastwindowVideoSpeedToggleState.prevRate = null;
    }}
    if (typeof window.__fastwindowVideoSpeedApplyRate === 'function') {{
      window.__fastwindowVideoSpeedApplyRate({rate});
      return;
    }}
    const list = document.querySelectorAll('video');
    for (const v of list) {{
      try {{
        v.playbackRate = {rate};
        v.defaultPlaybackRate = {rate};
      }} catch (_) {{}}
    }}
    window.__fastwindowVideoSpeedCurrentRate = {rate};
  }} catch (_) {{}}
}})();"#
    )
}

#[tauri::command]
pub(crate) fn browser_video_set_rate(app: tauri::AppHandle, rate: f64) -> Result<(), String> {
    let settings = webview_settings::load(&app);
    let r = webview_settings::clamp_video_rate(rate, settings.video.max_rate);

    let Some(w) = active_content_window(&app) else {
        return Ok(());
    };

    let _ = w.eval(&video_rate_apply_script(r));
    Ok(())
}

#[tauri::command]
pub(crate) fn browser_video_toggle_preset(
    app: tauri::AppHandle,
    shortcut: String,
    rate: f64,
) -> Result<(), String> {
    let key = shortcut.trim();
    if key.is_empty() {
        return Err("shortcut 不能为空".to_string());
    }
    let settings = webview_settings::load(&app);
    let r = webview_settings::clamp_video_rate(rate, settings.video.max_rate);

    let Some(w) = active_content_window(&app) else {
        return Ok(());
    };

    let key_js = serde_json::to_string(&key).map_err(|e| format!("序列化快捷键失败: {e}"))?;
    let js = format!(
        r#"(function () {{
  try {{
    if (typeof window.__fastwindowVideoSpeedTogglePreset === 'function') {{
      window.__fastwindowVideoSpeedTogglePreset({key_js}, {r});
      return;
    }}
    if (typeof window.__fastwindowVideoSpeedApplyRate === 'function') {{
      window.__fastwindowVideoSpeedApplyRate({r});
      return;
    }}
    const list = document.querySelectorAll('video');
    for (const v of list) {{
      try {{
        v.playbackRate = {r};
        v.defaultPlaybackRate = {r};
      }} catch (_) {{}}
    }}
    window.__fastwindowVideoSpeedCurrentRate = {r};
  }} catch (_) {{}}
}})();"#,
    );
    let _ = w.eval(&js);
    Ok(())
}

#[tauri::command]
pub(crate) fn window_start_dragging(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| format!("拖拽失败: {e}"))
}
