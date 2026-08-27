use tauri::{Emitter, Manager};

use crate::browser_stack::{
    self, apply_bottom_rounded_corners, apply_top_rounded_corners, browser_stack_apply_fullscreen,
    browser_stack_close, browser_stack_hide, browser_stack_is_pinned,
    browser_stack_restore_or_center, browser_stack_set_always_on_top, browser_stack_set_suppress_hide,
    browser_stack_show, load_browser_window_bounds_from_config, restore_browser_stack_bounds_or_center,
    save_browser_stack_bounds_if_valid, BrowserWindowState, BROWSER_BAR_HEIGHT,
    BROWSER_BAR_WINDOW_LABEL, BROWSER_STACK_TOTAL_HEIGHT, BROWSER_WINDOW_LABEL,
    WEBVIEW_SETTINGS_UPDATED_EVENT,
};
use crate::util::is_http_url;
use crate::webview_settings::{self, WebviewSettings};

// ── 浏览栈命令 ───────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) async fn open_browser_window(
    app: tauri::AppHandle,
    url: String,
) -> Result<(), String> {
    open_browser_window_impl(app, url).await
}

pub(crate) async fn open_browser_window_impl(
    app: tauri::AppHandle,
    url: String,
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

    if !browser_stack::browser_stack_exists(&app) {
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
    }

    if browser_stack::browser_stack_exists(&app) {
        if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
            let _ = w.navigate(parsed);
        }
        browser_stack_show(&app);
        return Ok(());
    }

    let settings = webview_settings::load(&app);
    let video_script = webview_settings::browser_video_injection_script(&settings.video)?;

    let bar = tauri::WebviewWindowBuilder::new(
        &app,
        BROWSER_BAR_WINDOW_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("webview")
    .inner_size(1020.0, BROWSER_BAR_HEIGHT)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|e| format!("创建顶部栏窗口失败: {e}"))?;

    browser_stack::attach_browser_stack_window_events(app.clone(), bar.clone(), true);

    let app_content_events = app.clone();
    let content = tauri::WebviewWindowBuilder::new(
        &app,
        BROWSER_WINDOW_LABEL,
        tauri::WebviewUrl::External(parsed),
    )
    .title("webview")
    .initialization_script(video_script)
    .on_new_window(move |url, _features| {
        if is_http_url(url.as_str()) {
            if let Some(w) = app_content_events.get_webview_window(BROWSER_WINDOW_LABEL) {
                let _ = w.navigate(url);
            }
        } else {
            let _ = open::that(url.as_str());
        }
        tauri::webview::NewWindowResponse::Deny
    })
    .inner_size(
        1020.0,
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
    .visible(false)
    .build()
    .map_err(|e| format!("创建浏览窗口失败: {e}"))?;

    browser_stack::attach_browser_stack_window_events(app.clone(), content.clone(), false);

    let saved = {
        let state = app.state::<BrowserWindowState>();
        state
            .last_bounds
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .or_else(|| load_browser_window_bounds_from_config(&app))
    };
    if let Some((pos, total)) = saved {
        let state = app.state::<BrowserWindowState>();
        if let Ok(mut g) = state.last_bounds.lock() {
            *g = Some((pos, total));
        };
        restore_browser_stack_bounds_or_center(&app, &bar, &content, pos, total);
        if let Ok(p) = bar.outer_position() {
            if p.x > -9000 && p.y > -9000 {
                if let Ok(mut g) = state.last_position.lock() {
                    *g = Some(p);
                }
            }
        }
        save_browser_stack_bounds_if_valid(&app);
    } else {
        browser_stack_restore_or_center(&app);
    }

    apply_top_rounded_corners(&bar, 16.0);
    apply_bottom_rounded_corners(&content, 16.0);

    browser_stack_show(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn close_browser_window(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack_close(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn hide_browser_stack(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack::browser_stack_hide_to_main(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn host_back(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack_hide(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_go_back(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.eval("history.back()");
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_go_forward(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.eval("history.forward()");
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_reload(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
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

    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        if let Ok(script) = webview_settings::browser_video_injection_script(&next.video) {
            let _ = w.eval(&script);
        }
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

#[tauri::command]
pub(crate) fn browser_video_set_rate(app: tauri::AppHandle, rate: f64) -> Result<(), String> {
    let settings = webview_settings::load(&app);
    let r = webview_settings::clamp_video_rate(rate, settings.video.max_rate);

    let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) else {
        return Ok(());
    };

    let js = format!(
        r#"(function () {{
  try {{
    if (window.__fastwindowVideoSpeedToggleState) {{
      window.__fastwindowVideoSpeedToggleState.activeKey = null;
      window.__fastwindowVideoSpeedToggleState.prevRate = null;
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
}})();"#
    );
    let _ = w.eval(&js);
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

    let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) else {
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
