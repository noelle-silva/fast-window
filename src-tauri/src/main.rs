#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use tauri::{Emitter, EventTarget, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

mod app;
mod browser_stack;
mod clipboard;
mod clipboard_snapshot;
mod clipboard_watch;
mod config_store;
mod core;
mod http_api;
mod host_dialog;
mod host_primitives;
mod migrations;
mod os_actions;
mod process_commands;
mod plugin_files;
mod process_runtime;
mod plugin_files_delete_tree;
mod plugins;
mod sqlite_gateway;
mod tasks;
mod thumbnails;
mod workspace;
mod wake_logic;
mod wallpaper;
mod windowing;

#[cfg(target_os = "windows")]
mod auto_start;

use crate::clipboard::{
    clipboard_read_image_data_url, clipboard_read_text, clipboard_write_image_data_url,
    clipboard_write_text,
};
use crate::clipboard_watch::{clipboard_watch_get, clipboard_watch_start, clipboard_watch_stop};
pub(crate) use crate::core::{
    is_dir_writable, is_http_url, is_https_url, normalize_zip_name, now_ms, parse_sha256_hex_32,
    portable_base_dir_from_env, rand_u32, to_hex_lower,
};
use crate::plugin_files::{
    plugin_files_copy, plugin_files_delete, plugin_files_list_dir, plugin_files_mkdir,
    plugin_files_read_base64, plugin_files_read_stream, plugin_files_read_stream_cancel,
    plugin_files_read_text, plugin_files_rename, plugin_files_stat, plugin_files_thumbnail,
    plugin_files_write_base64, plugin_files_write_stream_cancel, plugin_files_write_stream_chunk,
    plugin_files_write_stream_close, plugin_files_write_stream_open, plugin_files_write_text,
};
use crate::plugin_files_delete_tree::plugin_files_delete_tree;
use crate::plugins::{
    get_data_dir, get_plugins_allow_overwrite_on_update, get_plugins_auto_update_enabled,
    get_plugins_dir, install_plugin_files, list_plugins, open_data_dir, open_data_root_dir,
    open_plugins_dir, plugin_store_install, read_plugin_file, read_plugin_file_base64,
    read_plugins_dir, set_plugin_allow_overwrite_on_update, set_plugin_auto_update_enabled,
};
use crate::sqlite_gateway::{
    plugin_sqlite_batch, plugin_sqlite_close, plugin_sqlite_execute, plugin_sqlite_query,
};
use crate::tasks::{task_cancel, task_create, task_get, task_list};
use crate::wallpaper::{
    cycle_wallpaper, get_plugin_icon_overrides, get_wallpaper_settings,
    remove_plugin_icon_override, remove_wallpaper, remove_wallpaper_item, set_active_wallpaper,
    set_plugin_icon_override, set_wallpaper_image, set_wallpaper_settings, set_wallpaper_view,
};
use browser_stack::*;
pub(crate) use config_store::{
    app_config_path, plugin_default_ref_images_dir, read_app_config_map,
    read_plugin_auto_update_prefs, write_app_config_map, write_plugin_auto_update_prefs,
    write_plugin_library_dir_to_config, write_plugin_output_dir_to_config,
};
use http_api::*;
pub(crate) use os_actions::{open_dir_in_file_manager, open_external_uri, open_external_url};
pub(crate) use plugins::{is_safe_id, query_get_param, safe_relative_path};
pub(crate) use workspace::{
    app_data_dir, app_local_base_dir, app_plugins_dir, ensure_writable_dir,
    resolve_existing_file_in_scope, resolve_plugin_files_root, resolve_plugin_library_dir,
    resolve_plugin_output_dir, resolve_write_path_in_scope,
};
use host_primitives::emit_toast;
use windowing::*;

const DEFAULT_WAKE_SHORTCUT: &str = "control+alt+Space";
const APP_STORAGE_ID: &str = "__app";
const APP_CONFIG_FILE: &str = "app.json";
const PLUGIN_AUTO_UPDATE_PREFS_FILE: &str = "plugins-auto-update.json";
const WAKE_SHORTCUT_KEY: &str = "wakeShortcut";
const AUTO_START_KEY: &str = "autoStart";
const MAIN_WINDOW_BOUNDS_KEY: &str = "mainWindowBounds";
const MAIN_WINDOW_FOCUS_MODE_KEY: &str = "mainWindowFocusMode";
const MAIN_WINDOW_MODE_SHORTCUT_KEY: &str = "mainWindowModeShortcut";
const BROWSER_WINDOW_BOUNDS_KEY: &str = "browserWindowBounds";
const PLUGIN_OUTPUT_DIRS_KEY: &str = "pluginOutputDirs";
const PLUGIN_LIBRARY_DIRS_KEY: &str = "pluginLibraryDirs";
const WEBVIEW_SETTINGS_KEY: &str = "webview";
const PLUGIN_STORE_MAX_ZIP_BYTES: usize = 50 * 1024 * 1024; // 50MB
const PLUGIN_STORE_MAX_EXTRACT_BYTES: usize = 120 * 1024 * 1024; // 120MB
static HTTP_STREAM_ID_SEQ: AtomicU32 = AtomicU32::new(0);

// 避免开发版把“开机启动”写到正式版同一个注册表项里（会导致装了 MSI 以后仍然自启 debug exe）。
#[cfg(debug_assertions)]
const AUTO_START_REG_VALUE: &str = "Fast Window (Dev)";
#[cfg(not(debug_assertions))]
const AUTO_START_REG_VALUE: &str = "Fast Window";

const DATA_DIR_ENV: &str = "FAST_WINDOW_DATA_DIR";
const BROWSER_WINDOW_LABEL: &str = "browser";
const BROWSER_BAR_WINDOW_LABEL: &str = "browser_bar";
const WEBVIEW_SETTINGS_UPDATED_EVENT: &str = "fast-window:webview-settings-updated";
const BROWSER_BAR_HEIGHT: f64 = 40.0;
const BROWSER_STACK_TOTAL_HEIGHT: f64 = 605.0;

#[cfg(windows)]
fn apply_bottom_rounded_corners(window: &tauri::WebviewWindow, radius_dip: f64) {
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
        // r=0：移除 region（恢复矩形窗口）
        if r == 0 {
            let _ = SetWindowRgn(hwnd, None, true);
            return;
        }

        // 先做“全圆角”的 round rect，再把顶部条形区域并回去 => 只保留底部两角圆角
        let round = CreateRoundRectRgn(0, 0, w + 1, h + 1, r * 2, r * 2);
        if round.0 == std::ptr::null_mut() {
            return;
        }
        let top = CreateRectRgn(0, 0, w + 1, r + 1);
        if top.0 == std::ptr::null_mut() {
            let _ = DeleteObject(round.into());
            return;
        }
        let combined = CreateRectRgn(0, 0, 0, 0);
        if combined.0 == std::ptr::null_mut() {
            let _ = DeleteObject(round.into());
            let _ = DeleteObject(top.into());
            return;
        }

        // combined = round OR top
        let ok = CombineRgn(Some(combined), Some(round), Some(top), RGN_OR);
        let _ = DeleteObject(round.into());
        let _ = DeleteObject(top.into());
        if ok == GDI_REGION_TYPE(0) {
            let _ = DeleteObject(combined.into());
            return;
        }

        // 成功后 combined 归系统所有，不能 DeleteObject
        if SetWindowRgn(hwnd, Some(combined), true) == 0 {
            let _ = DeleteObject(combined.into());
        }
    }
}

#[cfg(not(windows))]
fn apply_bottom_rounded_corners(_window: &tauri::WebviewWindow, _radius_dip: f64) {}

fn make_http_stream_id() -> String {
    let stamp = now_ms();
    let seq = HTTP_STREAM_ID_SEQ.fetch_add(1, Ordering::Relaxed);
    let rnd = format!("{:08x}", rand_u32(stamp ^ (seq as u64)));
    format!("httpstream-{stamp}-{seq:08x}-{rnd}")
}

pub(crate) async fn open_browser_window_impl(
    app: tauri::AppHandle,
    url: String,
    plugin_id: String,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

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
        if let Ok(mut g) = state.return_to_plugin_id.lock() {
            *g = Some(plugin_id);
        }
        if let Ok(mut g) = state.active.lock() {
            *g = true;
        };
        if let Ok(mut g) = state.closing.lock() {
            *g = false;
        };
    }
    // 首次打开会经历“创建两个窗口 + 定位 + 聚焦”的抖动期，先加门闩避免误隐藏。
    browser_stack_set_suppress_hide(&app, 1500);

    // 进入“浏览栈模式”时隐藏主窗口：快捷键将优先唤醒这个浏览栈。
    // 首次打开时把主窗口位置当作浏览栈初始位置，避免“只顶部栏居中”造成的错位感。
    if !browser_stack_exists(&app) {
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
    hide_main_window(&app);

    if browser_stack_exists(&app) {
        if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
            let _ = w.navigate(parsed);
        }
        browser_stack_show(&app);
        return Ok(());
    }

    let title = "Web";
    let webview_settings = load_webview_settings(&app);
    let video_script = browser_video_injection_script(&webview_settings.video)?;

    let bar = tauri::WebviewWindowBuilder::new(
        &app,
        BROWSER_BAR_WINDOW_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title(title)
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

    let app_ = app.clone();
    let content = tauri::WebviewWindowBuilder::new(
        &app,
        BROWSER_WINDOW_LABEL,
        tauri::WebviewUrl::External(parsed),
    )
    .title(title)
    .initialization_script(video_script)
    .on_new_window(move |url, _features| {
        // 很多网站会用 window.open / target=_blank 打开“新标签页”。
        // 我们没有标签页：把它折叠成“当前窗口跳转”。
        if is_http_url(url.as_str()) {
            if let Some(w) = app_.get_webview_window(BROWSER_WINDOW_LABEL) {
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

    // 初次创建时不要跟随 main（因为 main 已被移到屏幕外隐藏了），用浏览栈的恢复/居中逻辑。
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
        // 兜底：把“实际应用后的尺寸/位置”同步回内存（供 hide/show 使用）
        save_browser_stack_bounds_if_valid(&app);
    } else {
        browser_stack_restore_or_center(&app);
    }

    // 让“网页主体窗口”只有底部两个角是圆角（顶部两个角会和顶部栏拼接，不要圆角）。
    apply_bottom_rounded_corners(&content, 16.0);

    let _ = bar.show();
    let _ = content.show();
    let _ = content.set_focus();
    browser_ui_set_mode(&app, wake_logic::UiMode::BrowserVisible);
    Ok(())
}

#[tauri::command]
async fn close_browser_window(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack_close(&app);
    Ok(())
}

#[tauri::command]
async fn hide_browser_stack(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack_hide(&app);
    Ok(())
}

#[tauri::command]
async fn browser_go_back(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.eval("history.back()");
    }
    Ok(())
}

#[tauri::command]
async fn browser_go_forward(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.eval("history.forward()");
    }
    Ok(())
}

#[tauri::command]
async fn browser_reload(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.eval("location.reload()");
    }
    Ok(())
}

#[tauri::command]
fn get_webview_settings(app: tauri::AppHandle) -> WebviewSettings {
    load_webview_settings(&app)
}

#[tauri::command]
fn set_webview_settings(
    app: tauri::AppHandle,
    settings: WebviewSettings,
) -> Result<WebviewSettings, String> {
    let next = write_webview_settings(&app, settings)?;

    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        if let Ok(script) = browser_video_injection_script(&next.video) {
            let _ = w.eval(&script);
        }
    }

    let _ = app.emit_to(
        EventTarget::webview_window(BROWSER_BAR_WINDOW_LABEL),
        WEBVIEW_SETTINGS_UPDATED_EVENT,
        next.clone(),
    );
    let _ = app.emit_to(
        EventTarget::webview_window("main"),
        WEBVIEW_SETTINGS_UPDATED_EVENT,
        next.clone(),
    );

    Ok(next)
}

#[tauri::command]
fn browser_video_set_rate(app: tauri::AppHandle, rate: f64) -> Result<(), String> {
    let settings = load_webview_settings(&app);
    let r = clamp_video_rate(rate, settings.video.max_rate);

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
fn browser_video_toggle_preset(
    app: tauri::AppHandle,
    shortcut: String,
    rate: f64,
) -> Result<(), String> {
    let key = shortcut.trim();
    if key.is_empty() {
        return Err("shortcut 不能为空".to_string());
    }
    let settings = load_webview_settings(&app);
    let r = clamp_video_rate(rate, settings.video.max_rate);

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
async fn browser_stack_toggle_fullscreen(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<BrowserWindowState>();
    let next = state.fullscreen.lock().ok().map(|g| !*g).unwrap_or(true);
    browser_stack_apply_fullscreen(&app, next)?;
    Ok(())
}

#[tauri::command]
async fn browser_stack_get_pinned(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(browser_stack_is_pinned(&app))
}

#[tauri::command]
async fn browser_stack_toggle_pinned(app: tauri::AppHandle) -> Result<bool, String> {
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
        // 保险：确保窗口处于置顶态
        browser_stack_set_always_on_top(&app, true);
    }
    Ok(next)
}

fn migrate_legacy_plugin_store_files(app: &tauri::AppHandle) -> Result<(), String> {
    let data_root = app_data_dir(app);
    let legacy_dir = data_root.join("plugins");
    if !legacy_dir.is_dir() {
        return Ok(());
    }

    let entries =
        std::fs::read_dir(&legacy_dir).map_err(|e| format!("读取 legacy plugins 目录失败: {e}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    for ent in entries.flatten() {
        let Ok(ty) = ent.file_type() else { continue };
        if !ty.is_file() {
            continue;
        }

        let path = ent.path();
        let Some(name_os) = path.file_name() else {
            continue;
        };
        let name = name_os.to_string_lossy().to_string();
        if !name.to_ascii_lowercase().ends_with(".json") {
            continue;
        }

        // 约定：store 文件名为 `<pluginId>.json` 或 `<pluginId>.<suffix>.json`（pluginId 不含 '.'）
        let plugin_id = name.split('.').next().unwrap_or("").trim().to_string();
        if !is_safe_id(&plugin_id) {
            continue;
        }

        let target_dir = data_root.join(&plugin_id);
        let target = target_dir.join(&name);
        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let legacy_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let target_size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);

        if !target.is_file() {
            let _ = std::fs::copy(&path, &target);
            continue;
        }

        // 若新路径明显是“新生成的空白/默认数据”，而 legacy 有更大体量的数据，则备份后还原。
        // 备份不破坏用户空间：保留新文件到 `.bak-*`，并且不删除 legacy 文件。
        let mut target_looks_blank = target_size > 0 && target_size < 32 * 1024;
        if target_looks_blank {
            // 进一步用 key 数量判断（小文件解析成本低）：少量 key 通常意味着“新初始化默认数据”。
            if let Ok(bytes) = std::fs::read(&target) {
                if let Ok(map) =
                    serde_json::from_slice::<std::collections::HashMap<String, Value>>(&bytes)
                {
                    // 经验阈值：<= 10 个 key 基本就是空白/默认（例如仅 meta/index + 1 个 chat）。
                    if map.len() > 10 {
                        target_looks_blank = false;
                    }
                }
            }
        }

        let legacy_has_more = legacy_size > target_size;
        if target_looks_blank && legacy_has_more && legacy_size > 0 {
            let bak = target_dir.join(format!(".bak-{stamp}-{name}"));
            let _ = std::fs::rename(&target, &bak);
            let _ = std::fs::copy(&path, &target);
        }
    }

    Ok(())
}

fn write_json_map(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let content = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|e| format!("序列化配置失败: {e}"))?;

    let parent = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let tmp = parent.join(format!(".tmp-{name}-{stamp}.json"));

    std::fs::write(&tmp, &content).map_err(|e| format!("写入临时配置失败: {e}"))?;

    // 尽量原子替换，避免写入过程中进程退出导致配置文件半写/空文件。
    match std::fs::rename(&tmp, path) {
        Ok(_) => {}
        Err(_) => {
            // Windows 上 rename 不能覆盖已有文件：先删再试；仍失败则退回 copy。
            if path.exists() {
                let _ = std::fs::remove_file(path);
                if std::fs::rename(&tmp, path).is_ok() {
                    return Ok(());
                }
            }
            std::fs::copy(&tmp, path).map_err(|e| format!("写入配置失败: {e}"))?;
            let _ = std::fs::remove_file(&tmp);
        }
    }
    Ok(())
}

fn read_json_value(path: &Path) -> Result<Value, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("读取配置失败: {e}"))?;
    serde_json::from_str::<Value>(&content).map_err(|e| format!("解析 JSON 失败: {e}"))
}

fn write_json_value(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化配置失败: {e}"))?;

    let parent = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "value".to_string());
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let tmp = parent.join(format!(".tmp-{name}-{stamp}.json"));

    std::fs::write(&tmp, &content).map_err(|e| format!("写入临时配置失败: {e}"))?;

    match std::fs::rename(&tmp, path) {
        Ok(_) => {}
        Err(_) => {
            if path.exists() {
                let _ = std::fs::remove_file(path);
                if std::fs::rename(&tmp, path).is_ok() {
                    return Ok(());
                }
            }
            std::fs::copy(&tmp, path).map_err(|e| format!("写入配置失败: {e}"))?;
            let _ = std::fs::remove_file(&tmp);
        }
    }
    Ok(())
}

static STORAGE_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

fn storage_lock_for(plugin_id: &str) -> Arc<Mutex<()>> {
    let locks = STORAGE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = locks.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(v) = guard.get(plugin_id) {
        return v.clone();
    }
    let v = Arc::new(Mutex::new(()));
    guard.insert(plugin_id.to_string(), v.clone());
    v
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebviewVideoSpeedPreset {
    label: String,
    rate: f64,
    #[serde(default)]
    shortcut: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebviewVideoSettings {
    default_rate: f64,
    max_rate: f64,
    #[serde(default)]
    presets: Vec<WebviewVideoSpeedPreset>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebviewSettings {
    video: WebviewVideoSettings,
}

impl Default for WebviewVideoSettings {
    fn default() -> Self {
        Self {
            default_rate: 1.0,
            max_rate: 16.0,
            presets: vec![
                WebviewVideoSpeedPreset {
                    label: "1x".to_string(),
                    rate: 1.0,
                    shortcut: None,
                },
                WebviewVideoSpeedPreset {
                    label: "1.5x".to_string(),
                    rate: 1.5,
                    shortcut: None,
                },
                WebviewVideoSpeedPreset {
                    label: "2x".to_string(),
                    rate: 2.0,
                    shortcut: None,
                },
            ],
        }
    }
}

impl Default for WebviewSettings {
    fn default() -> Self {
        Self {
            video: WebviewVideoSettings::default(),
        }
    }
}

fn clamp_video_rate(rate: f64, max_rate: f64) -> f64 {
    let max_rate = if max_rate.is_finite() { max_rate } else { 16.0 };
    let max_rate = max_rate.max(0.25).min(16.0);
    let mut r = if rate.is_finite() { rate } else { 1.0 };
    r = r.max(0.25).min(max_rate);
    (r * 100.0).round() / 100.0
}

fn normalize_shortcut(raw: &str) -> Option<(String, bool)> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }

    let mut has_modifier = false;
    let mut control = false;
    let mut alt = false;
    let mut shift = false;
    let mut super_key = false;

    let parts: Vec<&str> = s
        .split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }

    let code = parts[parts.len() - 1];
    if code.eq_ignore_ascii_case("control")
        || code.eq_ignore_ascii_case("ctrl")
        || code.eq_ignore_ascii_case("alt")
        || code.eq_ignore_ascii_case("shift")
        || code.eq_ignore_ascii_case("super")
        || code.eq_ignore_ascii_case("meta")
        || code.eq_ignore_ascii_case("cmd")
    {
        return None;
    }

    for p in &parts[..parts.len() - 1] {
        if p.eq_ignore_ascii_case("control") || p.eq_ignore_ascii_case("ctrl") {
            control = true;
            has_modifier = true;
        } else if p.eq_ignore_ascii_case("alt") {
            alt = true;
            has_modifier = true;
        } else if p.eq_ignore_ascii_case("shift") {
            shift = true;
            has_modifier = true;
        } else if p.eq_ignore_ascii_case("super")
            || p.eq_ignore_ascii_case("meta")
            || p.eq_ignore_ascii_case("cmd")
        {
            super_key = true;
            has_modifier = true;
        } else {
            return None;
        }
    }

    let mut out: Vec<String> = Vec::new();
    if control {
        out.push("control".to_string());
    }
    if alt {
        out.push("alt".to_string());
    }
    if shift {
        out.push("shift".to_string());
    }
    if super_key {
        out.push("super".to_string());
    }
    out.push(code.to_string());
    Some((out.join("+"), has_modifier))
}

fn sanitize_webview_settings_for_load(mut settings: WebviewSettings) -> WebviewSettings {
    settings.video.max_rate = clamp_video_rate(settings.video.max_rate, 16.0);
    settings.video.default_rate =
        clamp_video_rate(settings.video.default_rate, settings.video.max_rate);

    let mut seen_shortcuts: HashMap<String, ()> = HashMap::new();
    let mut presets: Vec<WebviewVideoSpeedPreset> = Vec::new();
    for mut p in settings.video.presets.into_iter().take(64) {
        p.rate = clamp_video_rate(p.rate, settings.video.max_rate);
        p.label = p.label.trim().to_string();
        if p.label.is_empty() {
            p.label = format!("{}x", p.rate);
        }

        p.shortcut = match p.shortcut.take().and_then(|s| normalize_shortcut(&s)) {
            Some((normalized, _has_modifier)) => {
                if seen_shortcuts.contains_key(&normalized) {
                    None
                } else {
                    seen_shortcuts.insert(normalized.clone(), ());
                    Some(normalized)
                }
            }
            _ => None,
        };

        presets.push(p);
    }

    settings.video.presets = presets;
    settings
}

fn validate_webview_settings_for_save(
    mut settings: WebviewSettings,
) -> Result<WebviewSettings, String> {
    settings.video.max_rate = clamp_video_rate(settings.video.max_rate, 16.0);
    settings.video.default_rate =
        clamp_video_rate(settings.video.default_rate, settings.video.max_rate);

    let mut seen_shortcuts: HashMap<String, ()> = HashMap::new();
    let mut presets: Vec<WebviewVideoSpeedPreset> = Vec::new();
    for (idx, mut p) in settings.video.presets.into_iter().take(64).enumerate() {
        p.rate = clamp_video_rate(p.rate, settings.video.max_rate);
        p.label = p.label.trim().to_string();
        if p.label.is_empty() {
            p.label = format!("{}x", p.rate);
        }

        if let Some(raw) = p.shortcut.take() {
            let raw = raw.trim().to_string();
            if raw.is_empty() {
                p.shortcut = None;
            } else {
                let Some((normalized, has_modifier)) = normalize_shortcut(&raw) else {
                    return Err(format!("预设快捷键格式不合法（第 {} 条）", idx + 1));
                };
                let _ = has_modifier;
                if seen_shortcuts.contains_key(&normalized) {
                    return Err(format!("快捷键重复: {normalized}"));
                }
                seen_shortcuts.insert(normalized.clone(), ());
                p.shortcut = Some(normalized);
            }
        }

        presets.push(p);
    }

    settings.video.presets = presets;
    Ok(settings)
}

fn load_webview_settings(app: &tauri::AppHandle) -> WebviewSettings {
    let map = read_app_config_map(app);
    let v = map
        .get(WEBVIEW_SETTINGS_KEY)
        .cloned()
        .unwrap_or(Value::Null);
    let parsed = serde_json::from_value::<WebviewSettings>(v).unwrap_or_default();
    sanitize_webview_settings_for_load(parsed)
}

fn write_webview_settings(
    app: &tauri::AppHandle,
    settings: WebviewSettings,
) -> Result<WebviewSettings, String> {
    let mut map = read_app_config_map(app);
    let normalized = validate_webview_settings_for_save(settings)?;
    map.insert(
        WEBVIEW_SETTINGS_KEY.to_string(),
        serde_json::to_value(normalized.clone()).map_err(|e| format!("序列化配置失败: {e}"))?,
    );
    write_app_config_map(app, &map)?;
    Ok(normalized)
}

fn browser_video_injection_script(video: &WebviewVideoSettings) -> Result<String, String> {
    let json = serde_json::to_string(video).map_err(|e| format!("序列化配置失败: {e}"))?;
    let quoted = serde_json::to_string(&json).map_err(|e| format!("序列化配置失败: {e}"))?;

    Ok(format!(
        r#"(function () {{
  const cfg = JSON.parse({quoted});
  const clamp = (r) => {{
    const max = (Number.isFinite(cfg.maxRate) ? cfg.maxRate : 16);
    const max2 = Math.min(16, Math.max(0.25, max));
    const v = (Number.isFinite(r) ? r : 1);
    return Math.min(max2, Math.max(0.25, v));
  }};

  const normalizeEvent = (e) => {{
    const parts = [];
    if (e.ctrlKey) parts.push('control');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('super');
    const code = typeof e.code === 'string' ? e.code : '';
    if (!code || code === 'Unidentified') return null;
    parts.push(code);
    return parts.join('+');
  }};

  const isEditable = (t) => {{
    try {{
      const el = t && t.nodeType === 1 ? t : null;
      if (!el) return false;
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      if (typeof el.closest === 'function' && el.closest('[contenteditable=\"true\"],[role=\"textbox\"]')) return true;
      return false;
    }} catch (_) {{
      return false;
    }}
  }};

  const applyRate = (rate) => {{
    const r = clamp(rate);
    const list = document.querySelectorAll('video');
    for (const v of list) {{
      try {{
        v.playbackRate = r;
        v.defaultPlaybackRate = r;
      }} catch (_) {{}}
    }}
    return r;
  }};

  const ensure = () => {{
    const r = applyRate(cfg.defaultRate);
    window.__fastwindowVideoSpeedCurrentRate = r;
    window.__fastwindowVideoSpeedToggleState = {{ activeKey: null, prevRate: null }};
  }};

  if (!window.__fastwindowVideoSpeedInstalled) {{
    window.__fastwindowVideoSpeedInstalled = true;

    window.__fastwindowVideoSpeedApplyRate = (rate) => {{
      const r = applyRate(rate);
      window.__fastwindowVideoSpeedCurrentRate = r;
      return r;
    }};

    window.__fastwindowVideoSpeedTogglePreset = (key, rate) => {{
      try {{
        const st = window.__fastwindowVideoSpeedToggleState || {{ activeKey: null, prevRate: null }};
        if (st.activeKey === key) {{
          const back = (typeof st.prevRate === 'number') ? st.prevRate : cfg.defaultRate;
          st.activeKey = null;
          st.prevRate = null;
          window.__fastwindowVideoSpeedToggleState = st;
          return window.__fastwindowVideoSpeedApplyRate(back);
        }}
        const cur = (typeof window.__fastwindowVideoSpeedCurrentRate === 'number')
          ? window.__fastwindowVideoSpeedCurrentRate
          : cfg.defaultRate;
        st.activeKey = key;
        st.prevRate = cur;
        window.__fastwindowVideoSpeedToggleState = st;
        return window.__fastwindowVideoSpeedApplyRate(rate);
      }} catch (_) {{
        return window.__fastwindowVideoSpeedApplyRate(rate);
      }}
    }};

    window.addEventListener('keydown', (e) => {{
      try {{
        if (e.repeat) return;
        if (isEditable(e.target)) return;
        const key = normalizeEvent(e);
        if (!key) return;
        const presets = Array.isArray(window.__fastwindowVideoSpeedConfig?.presets)
          ? window.__fastwindowVideoSpeedConfig.presets
          : [];
        for (const p of presets) {{
          if (!p || typeof p.shortcut !== 'string') continue;
          if (p.shortcut === key && typeof p.rate === 'number') {{
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            window.__fastwindowVideoSpeedTogglePreset(key, p.rate);
            return;
          }}
        }}
      }} catch (_) {{}}
    }}, true);

    let scheduled = false;
    const scheduleApply = () => {{
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {{
        scheduled = false;
        try {{
          if (typeof window.__fastwindowVideoSpeedCurrentRate !== 'number') return;
          applyRate(window.__fastwindowVideoSpeedCurrentRate);
        }} catch (_) {{}}
      }}, 200);
    }};
    const obs = new MutationObserver(scheduleApply);
    obs.observe(document.documentElement || document, {{ childList: true, subtree: true }});
  }}

  window.__fastwindowVideoSpeedConfig = cfg;
  ensure();
}})();"#,
    ))
}

fn decode_base64_image_payload(raw: &str) -> Result<(Vec<u8>, String), String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("图片数据为空".to_string());
    }

    // data URL: data:image/png;base64,....
    if s.starts_with("data:") {
        let base64_pos = s
            .find("base64,")
            .ok_or_else(|| "data URL 缺少 base64,".to_string())?;
        let meta = &s["data:".len()..base64_pos];
        let b64 = &s[(base64_pos + "base64,".len())..];

        let ext = if meta.contains("image/png") {
            "png"
        } else if meta.contains("image/gif") {
            "gif"
        } else if meta.contains("image/jpeg") {
            "jpg"
        } else if meta.contains("image/webp") {
            "webp"
        } else {
            "png"
        };

        if b64.len() > 40 * 1024 * 1024 {
            return Err("图片数据过大".to_string());
        }
        let bytes = general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("base64 解码失败: {e}"))?;
        if bytes.len() > 25 * 1024 * 1024 {
            return Err("图片过大".to_string());
        }
        return Ok((bytes, ext.to_string()));
    }

    if s.len() > 40 * 1024 * 1024 {
        return Err("图片数据过大".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(s)
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("图片过大".to_string());
    }
    Ok((bytes, "png".to_string()))
}

#[tauri::command]
fn plugin_get_output_dir(app: tauri::AppHandle, plugin_id: String) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let dir = resolve_plugin_output_dir(&app, &plugin_id);
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn plugin_get_library_dir(app: tauri::AppHandle, plugin_id: String) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let dir = resolve_plugin_library_dir(&app, &plugin_id);
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn plugin_pick_output_dir(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Option<String>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let picked = host_dialog::pick_folder(&app, "选择输出目录");

    let Some(dir) = picked else {
        return Ok(None);
    };

    ensure_writable_dir(&dir)?;
    write_plugin_output_dir_to_config(&app, &plugin_id, &dir)?;
    Ok(Some(dir.to_string_lossy().to_string()))
}

#[tauri::command]
fn plugin_pick_library_dir(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Option<String>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let picked = host_dialog::pick_folder(&app, "选择库目录");

    let Some(dir) = picked else {
        return Ok(None);
    };

    ensure_writable_dir(&dir)?;
    write_plugin_library_dir_to_config(&app, &plugin_id, &dir)?;
    Ok(Some(dir.to_string_lossy().to_string()))
}

#[tauri::command]
fn plugin_pick_dir(app: tauri::AppHandle, plugin_id: String) -> Result<Option<String>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let picked = host_dialog::pick_folder(&app, "选择文件夹");
    let Some(dir) = picked else {
        return Ok(None);
    };
    Ok(Some(dir.to_string_lossy().to_string()))
}

#[tauri::command]
async fn open_browser_window(
    app: tauri::AppHandle,
    url: String,
    plugin_id: String,
) -> Result<(), String> {
    open_browser_window_impl(app, url, plugin_id).await
}

#[tauri::command]
fn host_dialog_pick_output_dir(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Option<String>, String> {
    // v3 稳定宿主原语：不再依赖 plugin_pick_* 的 command 名
    plugin_pick_output_dir(app, plugin_id)
}

#[tauri::command]
fn host_dialog_pick_library_dir(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Option<String>, String> {
    plugin_pick_library_dir(app, plugin_id)
}

#[tauri::command]
fn host_dialog_pick_dir(app: tauri::AppHandle, plugin_id: String) -> Result<Option<String>, String> {
    plugin_pick_dir(app, plugin_id)
}

#[tauri::command]
fn plugin_open_output_dir(app: tauri::AppHandle, plugin_id: String) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    crate::workspace::open_plugin_output_dir(&app, &plugin_id)
}

#[tauri::command]
fn plugin_open_dir(_app: tauri::AppHandle, plugin_id: String, dir: String) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let s = dir.trim();
    if s.is_empty() {
        return Err("dir 不能为空".to_string());
    }

    let p = PathBuf::from(s);
    crate::workspace::open_absolute_existing_dir(&p)
}

#[tauri::command]
fn path_has_image_ext(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif")
}

fn normalize_image_ext(ext: &str) -> String {
    let e = ext.trim().to_ascii_lowercase();
    if e == "jpeg" {
        "jpg".to_string()
    } else {
        e
    }
}

fn image_ext_from_path(path: &Path) -> Option<String> {
    let ext = path.extension().and_then(|s| s.to_str())?;
    Some(normalize_image_ext(ext))
}

fn resolve_plugin_images_root(
    app: &tauri::AppHandle,
    plugin_id: &str,
    scope: &str,
) -> Result<PathBuf, String> {
    match scope {
        // 插件私有数据：固定在 data/<pluginId>/ref-images（历史目录，保留以避免破坏旧数据）
        "data" => Ok(plugin_default_ref_images_dir(app, plugin_id)),
        // 用户输出目录：可配置（新默认 data/<pluginId>/output；兼容旧目录 output-images）
        "output" => Ok(resolve_plugin_output_dir(app, plugin_id)),
        // 用户库目录：可配置（默认 data/<pluginId>/library）
        "library" => Ok(resolve_plugin_library_dir(app, plugin_id)),
        _ => Err("scope 不支持（仅支持 data/output/library）".to_string()),
    }
}

fn resolve_image_path_in_scope(
    app: &tauri::AppHandle,
    plugin_id: &str,
    scope: &str,
    path: &str,
    must_exist: bool,
) -> Result<(PathBuf, PathBuf), String> {
    let root = resolve_plugin_images_root(app, plugin_id, scope)?;
    ensure_writable_dir(&root)?;
    let root_c = std::fs::canonicalize(&root).map_err(|e| format!("图片目录不可用: {e}"))?;

    let raw = path.trim();
    if raw.is_empty() {
        return Err("图片路径不能为空".to_string());
    }

    let input = PathBuf::from(raw);
    let full = if input.is_absolute() {
        input
    } else {
        let rel = safe_relative_path(raw)?;
        root.join(rel)
    };

    if must_exist {
        if !full.exists() {
            return Err("图片不存在".to_string());
        }
        let full_c = std::fs::canonicalize(&full).map_err(|e| format!("图片路径无效: {e}"))?;
        if !full_c.starts_with(&root_c) {
            return Err("图片路径越界".to_string());
        }
        return Ok((root_c, full_c));
    }

    // must_exist=false：用于写入，full 可能尚不存在；改为校验 parent 目录是否仍在 root 内。
    let parent = full
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| root.clone());
    std::fs::create_dir_all(&parent).map_err(|e| format!("创建目录失败: {e}"))?;
    let parent_c = std::fs::canonicalize(&parent).map_err(|e| format!("目录路径无效: {e}"))?;
    if !parent_c.starts_with(&root_c) {
        return Err("图片路径越界".to_string());
    }
    Ok((root_c, full))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginImagesWriteBase64Req {
    scope: String,
    data_url_or_base64: String,
    rel_path: Option<String>,
    overwrite: Option<bool>,
}

#[tauri::command]
fn plugin_images_write_base64(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginImagesWriteBase64Req,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let scope = req.scope.trim().to_string();
    let data = req.data_url_or_base64;
    let rel_path = req
        .rel_path
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let overwrite = req.overwrite.unwrap_or(false);

    let (bytes, payload_ext) = decode_base64_image_payload(&data)?;
    let payload_ext = normalize_image_ext(&payload_ext);

    if let Some(rp) = rel_path {
        let rel = safe_relative_path(&rp)?;
        if !path_has_image_ext(&rel) {
            return Err("不支持的图片类型（仅支持 png/jpg/jpeg/webp/gif）".to_string());
        }
        let Some(rel_ext) = image_ext_from_path(&rel) else {
            return Err("图片路径缺少后缀".to_string());
        };
        if rel_ext != payload_ext {
            return Err("图片类型与目标后缀不一致".to_string());
        }

        let (_root_c, full) = resolve_image_path_in_scope(&app, &plugin_id, &scope, &rp, false)?;
        if full.exists() && !overwrite {
            return Err("图片已存在（overwrite=false）".to_string());
        }
        std::fs::write(&full, bytes).map_err(|e| format!("写入图片失败: {e}"))?;
        return Ok(full.to_string_lossy().to_string());
    }

    let root = resolve_plugin_images_root(&app, &plugin_id, &scope)?;
    ensure_writable_dir(&root)?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let filename = format!("image-{stamp}.{payload_ext}");
    let full = root.join(filename);

    std::fs::write(&full, bytes).map_err(|e| format!("写入图片失败: {e}"))?;
    Ok(full.to_string_lossy().to_string())
}

fn image_mime_by_ext(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginImagesListReq {
    scope: String,
    dir: Option<String>,
}

#[tauri::command]
fn plugin_images_list(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginImagesListReq,
) -> Result<Vec<String>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let scope = req.scope.trim().to_string();
    let root = resolve_plugin_images_root(&app, &plugin_id, &scope)?;
    ensure_writable_dir(&root)?;
    let root_c = std::fs::canonicalize(&root).map_err(|e| format!("图片目录不可用: {e}"))?;

    let dir_rel = req
        .dir
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let dir = if let Some(dr) = dir_rel {
        let rel = safe_relative_path(&dr)?;
        let full = root.join(rel);
        std::fs::create_dir_all(&full).map_err(|e| format!("创建目录失败: {e}"))?;
        let full_c = std::fs::canonicalize(&full).map_err(|e| format!("目录路径无效: {e}"))?;
        if !full_c.starts_with(&root_c) {
            return Err("目录路径越界".to_string());
        }
        full_c
    } else {
        root_c.clone()
    };

    let mut items: Vec<(SystemTime, PathBuf)> = Vec::new();
    let rd = std::fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let path = entry.path();
        if !path.is_file() || !path_has_image_ext(&path) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(UNIX_EPOCH);
        items.push((modified, path));
    }

    items.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(items
        .into_iter()
        .map(|(_, p)| p.to_string_lossy().to_string())
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginImagesReadReq {
    scope: String,
    path: String,
}

#[tauri::command]
fn plugin_images_read(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginImagesReadReq,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let scope = req.scope.trim().to_string();
    let (_root_c, full_c) = resolve_image_path_in_scope(&app, &plugin_id, &scope, &req.path, true)?;

    if !full_c.is_file() {
        return Err("图片不存在".to_string());
    }
    if !path_has_image_ext(&full_c) {
        return Err("不支持的图片类型".to_string());
    }

    let bytes = std::fs::read(&full_c).map_err(|e| format!("读取图片失败: {e}"))?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("图片过大".to_string());
    }
    let mime = image_mime_by_ext(&full_c);
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginImagesDeleteReq {
    scope: String,
    path: String,
}

#[tauri::command]
fn plugin_images_delete(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginImagesDeleteReq,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let scope = req.scope.trim().to_string();
    let (root_c, full_c) = resolve_image_path_in_scope(&app, &plugin_id, &scope, &req.path, true)?;

    if !full_c.is_file() {
        return Err("图片不存在".to_string());
    }
    if !path_has_image_ext(&full_c) {
        return Err("不支持的图片类型".to_string());
    }

    std::fs::remove_file(&full_c).map_err(|e| format!("删除图片失败: {e}"))?;

    // 仅清理 plugin 私有 data scope 产生的空目录；output scope 不做清理（避免误删用户目录结构）。
    if scope == "data" {
        let mut cur = full_c.parent().map(|p| p.to_path_buf());
        while let Some(dir) = cur {
            if dir == root_c {
                break;
            }
            let Ok(mut rd) = std::fs::read_dir(&dir) else {
                break;
            };
            if rd.next().is_some() {
                break;
            }
            let _ = std::fs::remove_dir(&dir);
            cur = dir.parent().map(|p| p.to_path_buf());
        }
    }

    Ok(())
}

#[tauri::command]
fn plugin_pick_images(
    app: tauri::AppHandle,
    plugin_id: String,
    max_count: Option<usize>,
) -> Result<Vec<host_dialog::PickedImage>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let max = max_count.unwrap_or(8);
    let picked = host_dialog::pick_image_files(&app, "选择图片");
    let Some(files) = picked else { return Ok(vec![]); };

    host_dialog::images_to_data_urls(files, max, |p| path_has_image_ext(p), |p| image_mime_by_ext(p))
}

#[tauri::command]
fn host_dialog_pick_images(
    app: tauri::AppHandle,
    plugin_id: String,
    max_count: Option<usize>,
) -> Result<Vec<host_dialog::PickedImage>, String> {
    plugin_pick_images(app, plugin_id, max_count)
}

#[tauri::command]
fn host_dialog_confirm(app: tauri::AppHandle, plugin_id: String, message: String) -> Result<bool, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let msg = message.trim();
    if msg.is_empty() {
        return Err("message 不能为空".to_string());
    }
    Ok(host_dialog::confirm(&app, "确认", msg))
}

#[cfg(debug_assertions)]
fn same_path(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

#[derive(Clone, Serialize)]
struct AutoStartStatus {
    supported: bool,
    enabled: bool,
    scope: &'static str,
}

fn load_auto_start_pref(app: &tauri::AppHandle) -> Option<bool> {
    let map = read_app_config_map(app);

    if map.contains_key(AUTO_START_KEY) {
        return map.get(AUTO_START_KEY).and_then(|v| v.as_bool());
    }
    if map.contains_key("auto_start") {
        return map.get("auto_start").and_then(|v| v.as_bool());
    }
    None
}

pub(crate) fn load_main_window_focus_mode_pref(app: &tauri::AppHandle) -> MainWindowFocusMode {
    let map = read_app_config_map(app);
    let raw = map
        .get(MAIN_WINDOW_FOCUS_MODE_KEY)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if raw.eq_ignore_ascii_case("autoHide") || raw.eq_ignore_ascii_case("autohide") {
        return MainWindowFocusMode::AutoHide;
    }
    if raw.eq_ignore_ascii_case("normal") {
        return MainWindowFocusMode::Normal;
    }
    if raw.eq_ignore_ascii_case("alwaysOnTop") || raw.eq_ignore_ascii_case("alwaysontop") {
        return MainWindowFocusMode::AlwaysOnTop;
    }

    // 兼容上一版（短暂存在过的 bool 开关）：true => Normal；false/缺失 => AutoHide
    if map.contains_key("mainWindowKeepVisibleOnBlur") {
        if map
            .get("mainWindowKeepVisibleOnBlur")
            .and_then(|v| v.as_bool())
            == Some(true)
        {
            return MainWindowFocusMode::Normal;
        }
    }

    MainWindowFocusMode::AutoHide
}

fn load_main_window_mode_shortcut(app: &tauri::AppHandle) -> (Option<Shortcut>, String) {
    let cfg_path = app_config_path(app);
    let map = read_app_config_map(app);
    let raw = map
        .get(MAIN_WINDOW_MODE_SHORTCUT_KEY)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if raw.is_empty() {
        return (None, "-".to_string());
    }

    match Shortcut::from_str(raw.trim()) {
        Ok(s) => (Some(s), s.to_string()),
        Err(e) => {
            eprintln!(
                "[config] invalid mainWindowModeShortcut \"{}\" in {:?}: {}",
                raw, cfg_path, e
            );
            (None, "-".to_string())
        }
    }
}

fn load_wake_shortcut(app: &tauri::AppHandle) -> (Shortcut, String) {
    let cfg_path = app_config_path(app);
    let map = read_app_config_map(app);

    let raw = map
        .get(WAKE_SHORTCUT_KEY)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            map.get("wake_shortcut")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| DEFAULT_WAKE_SHORTCUT.to_string());

    match Shortcut::from_str(raw.trim()) {
        Ok(s) => (s, s.to_string()),
        Err(e) => {
            eprintln!(
                "[config] invalid wakeShortcut \"{}\" in {:?}: {}",
                raw, cfg_path, e
            );
            let fallback = Shortcut::from_str(DEFAULT_WAKE_SHORTCUT)
                .expect("DEFAULT_WAKE_SHORTCUT must be parseable");
            (fallback, fallback.to_string())
        }
    }
}

fn browser_ui_get_mode(app: &tauri::AppHandle) -> wake_logic::UiMode {
    let state = app.state::<BrowserWindowState>();
    state
        .ui_mode
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(wake_logic::UiMode::Hidden)
}

fn browser_ui_set_mode(app: &tauri::AppHandle, mode: wake_logic::UiMode) {
    let state = app.state::<BrowserWindowState>();
    let _ = state.ui_mode.lock().map(|mut g| {
        *g = mode;
    });
}

fn show_main_window(app: &tauri::AppHandle) {
    // 强制不变量：主窗口与浏览栈不允许同时可见。
    // 任何入口（托盘菜单/窗口事件/命令）只要要显示主窗口，就先把浏览栈隐藏起来。
    browser_stack_hide(app);
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<WindowState>();
        restore_bounds_or_center(&window, &state);
        let _ = window.show();
        let _ = window.set_focus();
    }
    browser_ui_set_mode(app, wake_logic::UiMode::MainVisible);
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<WindowState>();
        save_bounds_if_valid(&window, &state);
        persist_main_window_bounds(app, &state);
        let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
        let _ = window.hide();
    }
    browser_ui_set_mode(app, wake_logic::UiMode::Hidden);
}

fn handle_wake_shortcut(app: &tauri::AppHandle) {
    let state = app.state::<BrowserWindowState>();
    let mode = browser_ui_get_mode(app);
    let browser_active = state.active.lock().ok().map(|g| *g).unwrap_or(false);
    let browser_exists = browser_stack_exists(app);
    let browser_visible = browser_exists && browser_stack_is_visible(app);
    let browser_focused = browser_exists && browser_stack_is_focused(app);
    let main_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    let (next_mode, action) = wake_logic::decide(
        wake_logic::Snapshot {
            mode,
            browser_active,
            browser_exists,
            browser_visible,
            browser_focused,
            main_visible,
        },
        wake_logic::WakeEvent::WakeKey,
    );

    match action {
        wake_logic::WakeAction::ShowBrowser => {
            hide_main_window(app);
            browser_stack_show(app);
        }
        wake_logic::WakeAction::HideBrowser => {
            browser_stack_hide(app);
            hide_main_window(app);
        }
        wake_logic::WakeAction::ShowMain => {
            browser_stack_hide(app);
            show_main_window(app);
        }
        wake_logic::WakeAction::HideMain => {
            hide_main_window(app);
        }
    }

    browser_ui_set_mode(app, next_mode);
}

fn storage_file_path(app: &tauri::AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    // 统一：每个插件的数据都放在 data/<pluginId>/ 目录内，避免 data 根目录杂乱。
    // legacy：历史遗留存储文件（对象 map）。新版存储使用 storage/<key>.json。
    Ok(app_data_dir(app).join(plugin_id).join("storage.json"))
}

fn storage_flat_legacy_file_path(
    app: &tauri::AppHandle,
    plugin_id: &str,
) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    Ok(app_data_dir(app).join(format!("{plugin_id}.json")))
}

fn storage_kv_dir_path(app: &tauri::AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    Ok(app_data_dir(app).join(plugin_id).join("storage"))
}

fn storage_value_path(
    app: &tauri::AppHandle,
    plugin_id: &str,
    key: &str,
) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let k = key.replace('\\', "/");
    if k.trim().is_empty() {
        return Err("key 不能为空".to_string());
    }
    if k.ends_with('/') {
        return Err("key 不允许以 / 结尾".to_string());
    }
    let rel = safe_relative_path(&k)?;
    let dir = storage_kv_dir_path(app, plugin_id)?;
    let mut full = dir.join(rel);

    let name = full
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "value".to_string());
    full.set_file_name(format!("{name}.json"));
    Ok(full)
}

fn read_json_object_map(path: &Path) -> Option<Map<String, Value>> {
    let v = read_json_value(path).ok()?;
    match v {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

fn read_legacy_storage_value(app: &tauri::AppHandle, plugin_id: &str, key: &str) -> Option<Value> {
    let legacy_storage_json = storage_file_path(app, plugin_id).ok();
    if let Some(p) = legacy_storage_json.as_ref().filter(|p| p.is_file()) {
        if let Some(map) = read_json_object_map(p) {
            if let Some(v) = map.get(key) {
                return Some(v.clone());
            }
        }
    }

    let legacy_flat = storage_flat_legacy_file_path(app, plugin_id).ok();
    if let Some(p) = legacy_flat.as_ref().filter(|p| p.is_file()) {
        if let Some(map) = read_json_object_map(p) {
            if let Some(v) = map.get(key) {
                return Some(v.clone());
            }
        }
    }

    None
}

fn read_legacy_storage_all(app: &tauri::AppHandle, plugin_id: &str) -> Vec<Map<String, Value>> {
    let mut out: Vec<Map<String, Value>> = Vec::new();

    if let Ok(p) = storage_file_path(app, plugin_id) {
        if p.is_file() {
            if let Some(map) = read_json_object_map(&p) {
                out.push(map);
            }
        }
    }

    if let Ok(p) = storage_flat_legacy_file_path(app, plugin_id) {
        if p.is_file() {
            if let Some(map) = read_json_object_map(&p) {
                out.push(map);
            }
        }
    }

    out
}

fn remove_key_from_legacy_storage(app: &tauri::AppHandle, plugin_id: &str, key: &str) {
    let paths = [
        storage_file_path(app, plugin_id).ok(),
        storage_flat_legacy_file_path(app, plugin_id).ok(),
    ];

    for p in paths.into_iter().flatten() {
        if !p.is_file() {
            continue;
        }
        let Some(mut map) = read_json_object_map(&p) else {
            continue;
        };
        if map.remove(key).is_none() {
            continue;
        }
        if map.is_empty() {
            let _ = std::fs::remove_file(&p);
            continue;
        }
        let _ = write_json_value(&p, &Value::Object(map));
    }
}

fn storage_walk_json_files(root: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if !root.is_dir() {
        return out;
    }
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(cur) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&cur) else {
            continue;
        };
        for ent in entries.flatten() {
            let p = ent.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            if !p.is_file() {
                continue;
            }
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            out.push(p);
        }
    }
    out
}

fn storage_file_key_from_value_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut s = rel.to_string_lossy().replace('\\', "/");
    if !s.ends_with(".json") {
        return None;
    }
    s.truncate(s.len().saturating_sub(5));
    Some(s)
}

fn storage_cleanup_empty_dirs(storage_root: &Path, from_file: &Path) {
    let mut cur = from_file.parent().map(|p| p.to_path_buf());
    while let Some(dir) = cur {
        if dir == storage_root {
            break;
        }
        let Ok(mut rd) = std::fs::read_dir(&dir) else {
            break;
        };
        if rd.next().is_some() {
            break;
        }
        let _ = std::fs::remove_dir(&dir);
        cur = dir.parent().map(|p| p.to_path_buf());
    }
}

#[tauri::command]
fn storage_get(
    app: tauri::AppHandle,
    plugin_id: String,
    key: String,
) -> Result<Option<Value>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let lock = storage_lock_for(&plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());

    let vp = storage_value_path(&app, &plugin_id, &key)?;
    if !vp.is_file() {
        return Ok(read_legacy_storage_value(&app, &plugin_id, &key));
    }
    read_json_value(&vp).map(Some)
}

#[tauri::command]
fn storage_set(
    app: tauri::AppHandle,
    plugin_id: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let lock = storage_lock_for(&plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());

    let vp = storage_value_path(&app, &plugin_id, &key)?;
    write_json_value(&vp, &value)
}

#[tauri::command]
fn storage_remove(app: tauri::AppHandle, plugin_id: String, key: String) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let lock = storage_lock_for(&plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());

    let storage_root = storage_kv_dir_path(&app, &plugin_id)?;
    let vp = storage_value_path(&app, &plugin_id, &key)?;
    if vp.exists() {
        let _ = std::fs::remove_file(&vp);
        storage_cleanup_empty_dirs(&storage_root, &vp);
    }

    // 兼容 legacy：允许移除旧 map 中的 key，避免“删不掉”。
    remove_key_from_legacy_storage(&app, &plugin_id, &key);
    Ok(())
}

#[tauri::command]
fn storage_get_all(app: tauri::AppHandle, plugin_id: String) -> Result<Map<String, Value>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let lock = storage_lock_for(&plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());

    let mut out: Map<String, Value> = Map::new();
    let storage_root = storage_kv_dir_path(&app, &plugin_id)?;
    for p in storage_walk_json_files(&storage_root) {
        let Some(key) = storage_file_key_from_value_path(&storage_root, &p) else {
            continue;
        };
        let v = read_json_value(&p)?;
        out.insert(key, v);
    }

    // 兼容 legacy：只补齐“新存储中不存在的 key”。
    for legacy in read_legacy_storage_all(&app, &plugin_id) {
        for (k, v) in legacy {
            if out.contains_key(&k) {
                continue;
            }
            out.insert(k, v);
        }
    }

    Ok(out)
}

#[tauri::command]
fn storage_set_all(
    app: tauri::AppHandle,
    plugin_id: String,
    data: Map<String, Value>,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let lock = storage_lock_for(&plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());
    let storage_root = storage_kv_dir_path(&app, &plugin_id)?;
    if storage_root.exists() {
        std::fs::remove_dir_all(&storage_root).map_err(|e| format!("清空插件存储失败: {e}"))?;
    }
    std::fs::create_dir_all(&storage_root).map_err(|e| format!("创建插件存储目录失败: {e}"))?;

    // 新逻辑：全部按 key->文件存储
    for (k, v) in data {
        let vp = storage_value_path(&app, &plugin_id, &k)?;
        write_json_value(&vp, &v)?;
    }

    // setAll 是“权威覆盖”：写入成功后清理 legacy 文件，避免后续 getAll 混入旧数据。
    if let Ok(p) = storage_file_path(&app, &plugin_id) {
        let _ = std::fs::remove_file(&p);
    }
    if let Ok(p) = storage_flat_legacy_file_path(&app, &plugin_id) {
        let _ = std::fs::remove_file(&p);
    }

    Ok(())
}

#[tauri::command]
fn storage_migrate(app: tauri::AppHandle, plugin_id: String) -> Result<bool, String> {
    migrations::migrate_plugin_storage(&app, &plugin_id)
}

#[tauri::command]
fn get_wake_shortcut(app: tauri::AppHandle) -> String {
    let state = app.state::<WakeShortcutState>();
    state
        .current
        .lock()
        .map(|s| s.to_string())
        .unwrap_or_else(|_| DEFAULT_WAKE_SHORTCUT.to_string())
}

#[tauri::command]
fn set_wake_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    let raw = shortcut.trim();
    if raw.is_empty() {
        return Err("快捷键不能为空".to_string());
    }

    let next = Shortcut::from_str(raw).map_err(|e| format!("快捷键格式不合法: {e}"))?;
    let normalized = next.to_string();

    let state = app.state::<WakeShortcutState>();
    let mut guard = state
        .current
        .lock()
        .map_err(|_| "内部状态锁失败".to_string())?;
    let prev = *guard;
    let was_paused = state.paused.lock().map(|g| *g).unwrap_or(false);

    if prev.id() == next.id() {
        let mut map = read_app_config_map(&app);
        map.insert(
            WAKE_SHORTCUT_KEY.to_string(),
            Value::String(normalized.clone()),
        );
        write_app_config_map(&app, &map)?;
        *guard = next;

        if was_paused {
            app.global_shortcut()
                .on_shortcut(prev, move |app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    handle_wake_shortcut(app);
                })
                .map_err(|e| format!("注册全局快捷键失败: {e}"))?;

            if let Ok(mut p) = state.paused.lock() {
                *p = false;
            }
        }
        return Ok(normalized);
    }

    // 先尝试注册新快捷键：避免先删后加导致用户短暂失去可用热键。
    app.global_shortcut()
        .on_shortcut(next, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            handle_wake_shortcut(app);
        })
        .map_err(|e| format!("注册全局快捷键失败: {e}"))?;

    let mut map = read_app_config_map(&app);
    map.insert(
        WAKE_SHORTCUT_KEY.to_string(),
        Value::String(normalized.clone()),
    );
    if let Err(e) = write_app_config_map(&app, &map) {
        let _ = app.global_shortcut().unregister(next);
        return Err(e);
    }

    let _ = app.global_shortcut().unregister(prev);
    *guard = next;
    if let Ok(mut p) = state.paused.lock() {
        *p = false;
    }
    Ok(normalized)
}

#[tauri::command]
fn pause_wake_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<WakeShortcutState>();
    let current = state
        .current
        .lock()
        .map_err(|_| "内部状态锁失败".to_string())?;

    if let Ok(mut p) = state.paused.lock() {
        if *p {
            return Ok(());
        }
        let _ = app.global_shortcut().unregister(*current);
        *p = true;
    }

    Ok(())
}

#[tauri::command]
fn resume_wake_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<WakeShortcutState>();
    let current = state
        .current
        .lock()
        .map_err(|_| "内部状态锁失败".to_string())?;

    let mut should_resume = false;
    if let Ok(p) = state.paused.lock() {
        should_resume = *p;
    }
    if !should_resume {
        return Ok(());
    }

    app.global_shortcut()
        .on_shortcut(*current, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            handle_wake_shortcut(app);
        })
        .map_err(|e| format!("注册全局快捷键失败: {e}"))?;

    if let Ok(mut p) = state.paused.lock() {
        *p = false;
    }
    Ok(())
}

fn main_window_focus_mode_title(mode: MainWindowFocusMode) -> &'static str {
    match mode {
        MainWindowFocusMode::AutoHide => "默认模式",
        MainWindowFocusMode::Normal => "窗口模式",
        MainWindowFocusMode::AlwaysOnTop => "置顶模式",
    }
}

fn apply_main_window_focus_mode(app: &tauri::AppHandle, mode: MainWindowFocusMode) {
    let state = app.state::<WindowState>();
    let mut g = state.focus_mode.lock().unwrap_or_else(|e| e.into_inner());
    *g = mode;

    if let Some(w) = app.get_webview_window("main") {
        // 默认窗口配置本身是 alwaysOnTop=true（tauri.conf.json）。
        // 这里仅在“窗口模式”时取消置顶；其余模式保持与历史一致（仍为置顶）。
        let _ = w.set_always_on_top(mode != MainWindowFocusMode::Normal);
    }
}

fn persist_main_window_focus_mode(
    app: &tauri::AppHandle,
    mode: MainWindowFocusMode,
) -> Result<(), String> {
    let mut map = read_app_config_map(app);

    // 清理 legacy（上一版 bool key）
    map.remove("mainWindowKeepVisibleOnBlur");

    if mode == MainWindowFocusMode::AutoHide {
        // 默认行为：不写配置（避免污染用户空间）
        map.remove(MAIN_WINDOW_FOCUS_MODE_KEY);
    } else {
        let v = match mode {
            MainWindowFocusMode::AutoHide => "autoHide",
            MainWindowFocusMode::Normal => "normal",
            MainWindowFocusMode::AlwaysOnTop => "alwaysOnTop",
        };
        map.insert(
            MAIN_WINDOW_FOCUS_MODE_KEY.to_string(),
            Value::String(v.to_string()),
        );
    }

    write_app_config_map(app, &map)
}

fn cycle_main_window_focus_mode_internal(
    app: &tauri::AppHandle,
) -> Result<MainWindowFocusMode, String> {
    let state = app.state::<WindowState>();
    let cur = state.focus_mode.lock().map(|g| *g).unwrap_or_default();
    let next = match cur {
        MainWindowFocusMode::AutoHide => MainWindowFocusMode::Normal,
        MainWindowFocusMode::Normal => MainWindowFocusMode::AlwaysOnTop,
        MainWindowFocusMode::AlwaysOnTop => MainWindowFocusMode::AutoHide,
    };
    persist_main_window_focus_mode(app, next)?;
    apply_main_window_focus_mode(app, next);
    Ok(next)
}

pub(crate) fn handle_main_window_mode_shortcut(app: &tauri::AppHandle) {
    match cycle_main_window_focus_mode_internal(app) {
        Ok(next) => emit_toast(
            app,
            format!("已切换到：{}", main_window_focus_mode_title(next)),
        ),
        Err(e) => emit_toast(app, format!("切换模式失败：{e}")),
    }
}

#[tauri::command]
fn get_main_window_focus_mode(app: tauri::AppHandle) -> MainWindowFocusMode {
    let state = app.state::<WindowState>();
    state.focus_mode.lock().map(|g| *g).unwrap_or_default()
}

#[tauri::command]
fn set_main_window_focus_mode(
    app: tauri::AppHandle,
    mode: MainWindowFocusMode,
) -> Result<MainWindowFocusMode, String> {
    persist_main_window_focus_mode(&app, mode)?;
    apply_main_window_focus_mode(&app, mode);
    Ok(mode)
}

#[tauri::command]
fn cycle_main_window_focus_mode(app: tauri::AppHandle) -> Result<MainWindowFocusMode, String> {
    let next = cycle_main_window_focus_mode_internal(&app)?;
    emit_toast(
        &app,
        format!("已切换到：{}", main_window_focus_mode_title(next)),
    );
    Ok(next)
}

#[tauri::command]
fn get_main_window_mode_shortcut(app: tauri::AppHandle) -> String {
    let state = app.state::<MainWindowModeShortcutState>();
    state
        .current
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.to_string()))
        .unwrap_or_else(|| "".to_string())
}

#[tauri::command]
fn set_main_window_mode_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
) -> Result<String, String> {
    let raw = shortcut.trim();

    let state = app.state::<MainWindowModeShortcutState>();
    let prev = state.current.lock().ok().and_then(|g| *g);

    // 空字符串：视为“禁用快捷键”
    if raw.is_empty() {
        if let Some(s) = prev {
            let _ = app.global_shortcut().unregister(s);
        }
        let mut map = read_app_config_map(&app);
        map.remove(MAIN_WINDOW_MODE_SHORTCUT_KEY);
        if let Err(e) = write_app_config_map(&app, &map) {
            return Err(e);
        }

        if let Ok(mut g) = state.current.lock() {
            *g = None;
        }
        if let Ok(mut p) = state.paused.lock() {
            *p = false;
        }
        return Ok("".to_string());
    }

    let next = Shortcut::from_str(raw).map_err(|e| format!("快捷键格式不合法: {e}"))?;
    let normalized = next.to_string();

    // 先尝试注册新快捷键：避免先删后加导致用户短暂失去可用热键。
    app.global_shortcut()
        .on_shortcut(next, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            handle_main_window_mode_shortcut(app);
        })
        .map_err(|e| format!("注册全局快捷键失败: {e}"))?;

    let mut map = read_app_config_map(&app);
    map.insert(
        MAIN_WINDOW_MODE_SHORTCUT_KEY.to_string(),
        Value::String(normalized.clone()),
    );
    if let Err(e) = write_app_config_map(&app, &map) {
        let _ = app.global_shortcut().unregister(next);
        return Err(e);
    }

    if let Some(s) = prev {
        let _ = app.global_shortcut().unregister(s);
    }

    if let Ok(mut g) = state.current.lock() {
        *g = Some(next);
    }
    if let Ok(mut p) = state.paused.lock() {
        *p = false;
    }
    Ok(normalized)
}

#[tauri::command]
fn pause_main_window_mode_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<MainWindowModeShortcutState>();
    let current = state
        .current
        .lock()
        .map_err(|_| "内部状态锁失败".to_string())?
        .clone();

    if let Ok(mut p) = state.paused.lock() {
        if *p {
            return Ok(());
        }
        if let Some(s) = current {
            let _ = app.global_shortcut().unregister(s);
        }
        *p = true;
    }

    Ok(())
}

#[tauri::command]
fn resume_main_window_mode_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<MainWindowModeShortcutState>();
    let current = state
        .current
        .lock()
        .map_err(|_| "内部状态锁失败".to_string())?
        .clone();

    let mut should_resume = false;
    if let Ok(p) = state.paused.lock() {
        should_resume = *p;
    }
    if !should_resume {
        return Ok(());
    }

    let Some(s) = current else {
        if let Ok(mut p) = state.paused.lock() {
            *p = false;
        }
        return Ok(());
    };

    app.global_shortcut()
        .on_shortcut(s, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            handle_main_window_mode_shortcut(app);
        })
        .map_err(|e| format!("注册全局快捷键失败: {e}"))?;

    if let Ok(mut p) = state.paused.lock() {
        *p = false;
    }
    Ok(())
}

#[tauri::command]
fn get_auto_start(_app: tauri::AppHandle) -> AutoStartStatus {
    #[cfg(target_os = "windows")]
    {
        return AutoStartStatus {
            supported: true,
            enabled: auto_start::is_enabled(AUTO_START_REG_VALUE),
            scope: "currentUser",
        };
    }

    #[cfg(not(target_os = "windows"))]
    AutoStartStatus {
        supported: false,
        enabled: false,
        scope: "unsupported",
    }
}

#[tauri::command]
fn set_auto_start(app: tauri::AppHandle, enabled: bool) -> Result<AutoStartStatus, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = enabled;
        return Err("当前平台不支持开机自启设置".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut map = read_app_config_map(&app);

        let prev_registry = auto_start::is_enabled(AUTO_START_REG_VALUE);
        let next_registry = auto_start::set_enabled(AUTO_START_REG_VALUE, enabled)?;

        map.insert(AUTO_START_KEY.to_string(), Value::Bool(enabled));
        if let Err(e) = write_app_config_map(&app, &map) {
            let _ = auto_start::set_enabled(AUTO_START_REG_VALUE, prev_registry);
            return Err(e);
        }

        Ok(AutoStartStatus {
            supported: true,
            enabled: next_registry,
            scope: "currentUser",
        })
    }
}

fn main() {
    let builder = app::builder_base().invoke_handler(tauri::generate_handler![
        get_plugins_dir,
        get_data_dir,
        get_wallpaper_settings,
        set_wallpaper_settings,
        set_wallpaper_view,
        set_wallpaper_image,
        remove_wallpaper,
        set_active_wallpaper,
        remove_wallpaper_item,
        cycle_wallpaper,
        open_data_root_dir,
        open_data_dir,
        open_plugins_dir,
        list_plugins,
        read_plugin_file,
        read_plugin_file_base64,
        set_plugin_auto_update_enabled,
        get_plugins_auto_update_enabled,
        set_plugin_allow_overwrite_on_update,
        get_plugins_allow_overwrite_on_update,
        read_plugins_dir,
        install_plugin_files,
        plugin_store_install,
        // v3 稳定 process 命令入口（v2 旧命令仍保留在后面）
        process_commands::process_open_external_url,
        process_commands::process_open_external_uri,
        process_commands::process_open_browser_window,
        process_commands::process_run,
        process_commands::process_spawn,
        process_commands::process_kill,
        process_commands::process_wait,
        open_external_url,
        open_external_uri,
        open_browser_window,
        close_browser_window,
        hide_browser_stack,
        browser_go_back,
        browser_go_forward,
        browser_reload,
        get_webview_settings,
        set_webview_settings,
        browser_video_set_rate,
        browser_video_toggle_preset,
        browser_stack_toggle_fullscreen,
        browser_stack_get_pinned,
        browser_stack_toggle_pinned,
        http_request,
        http_request_base64,
        http_request_stream,
        http_request_stream_cancel,
        gateway_test_channel,
        clipboard_read_text,
        clipboard_write_text,
        clipboard_write_image_data_url,
        clipboard_read_image_data_url,
        clipboard_watch_start,
        clipboard_watch_get,
        clipboard_watch_stop,
        storage_get,
        storage_set,
        storage_remove,
        storage_get_all,
        storage_set_all,
        storage_migrate,
        get_plugin_icon_overrides,
        set_plugin_icon_override,
        remove_plugin_icon_override,
        plugin_get_output_dir,
        plugin_get_library_dir,
        plugin_pick_output_dir,
        plugin_pick_library_dir,
        plugin_pick_dir,
        host_dialog_pick_output_dir,
        host_dialog_pick_library_dir,
        host_dialog_pick_dir,
        plugin_open_output_dir,
        plugin_open_dir,
        plugin_files_list_dir,
        plugin_files_stat,
        plugin_files_mkdir,
        plugin_files_read_text,
        plugin_files_write_text,
        plugin_files_read_base64,
        plugin_files_read_stream,
        plugin_files_read_stream_cancel,
        plugin_files_thumbnail,
        plugin_files_write_base64,
        plugin_files_write_stream_open,
        plugin_files_write_stream_chunk,
        plugin_files_write_stream_close,
        plugin_files_write_stream_cancel,
        plugin_files_rename,
        plugin_files_copy,
        plugin_files_delete,
        plugin_files_delete_tree,
        plugin_images_write_base64,
        plugin_images_list,
        plugin_images_read,
        plugin_images_delete,
        plugin_pick_images,
        host_dialog_pick_images,
        host_dialog_confirm,
        plugin_sqlite_execute,
        plugin_sqlite_query,
        plugin_sqlite_batch,
        plugin_sqlite_close,
        task_create,
        task_get,
        task_list,
        task_cancel,
        get_wake_shortcut,
        set_wake_shortcut,
        pause_wake_shortcut,
        resume_wake_shortcut,
        get_main_window_focus_mode,
        set_main_window_focus_mode,
        cycle_main_window_focus_mode,
        get_main_window_mode_shortcut,
        set_main_window_mode_shortcut,
        pause_main_window_mode_shortcut,
        resume_main_window_mode_shortcut,
        get_auto_start,
        set_auto_start,
        // v3 host 原语（稳定入口）
        host_primitives::host_toast,
        host_primitives::host_activate_plugin
    ]);
    app::builder_tail(builder)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
