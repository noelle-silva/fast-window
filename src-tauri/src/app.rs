use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::browser_stack::{
    browser_stack_bar_height_px, browser_stack_hide, browser_stack_hide_to_main,
    browser_stack_is_closing, browser_stack_is_focused, browser_stack_is_pinned,
    browser_stack_should_suppress_hide,
};
use crate::clipboard_watch::ClipboardWatchManagerState;
use crate::http_api::HttpStreamManagerState;
use crate::plugin_assets::plugin_asset_protocol_response;
use crate::plugin_backend_runtime::PluginBackendManagerState;
use crate::process_runtime::ProcessManagerState;
use crate::sqlite_gateway::SqliteConnManager;
use crate::tasks::TaskManagerState;
use crate::wallpaper::{read_wallpaper_config, resolve_wallpaper_item};
use crate::windowing::{
    load_browser_window_bounds_from_config, load_main_window_bounds_from_config,
    persist_main_window_bounds, restore_bounds_or_center, save_bounds_if_valid,
    save_browser_stack_bounds_if_valid, schedule_persist_browser_window_bounds,
    schedule_persist_main_window_bounds, BrowserWindowState, MainWindowFocusMode, WindowState,
};
use crate::{
    app_data_dir, apply_bottom_rounded_corners, browser_ui_set_mode,
    handle_main_window_mode_shortcut, handle_wake_shortcut, image_mime_by_ext,
    load_auto_start_pref, load_main_window_focus_mode_pref, load_main_window_mode_shortcut,
    load_wake_shortcut, migrate_legacy_plugin_store_files, query_get_param, safe_relative_path,
    show_main_window, MainWindowModeShortcutState, WakeShortcutState, APP_STORAGE_ID,
    AUTO_START_REG_VALUE, BROWSER_BAR_HEIGHT, BROWSER_BAR_WINDOW_LABEL, BROWSER_WINDOW_LABEL,
};
use crate::{migrations, wake_logic};

#[cfg(target_os = "windows")]
use crate::auto_start;

pub(crate) fn builder_base() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .register_uri_scheme_protocol("plugin", |ctx, request| {
            plugin_asset_protocol_response(ctx.app_handle(), request.uri())
        })
        .register_uri_scheme_protocol("wallpaper", |ctx, request| {
            let app = ctx.app_handle();
            let cfg = match read_wallpaper_config(app) {
                Ok(v) => v,
                Err(e) => {
                    return tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                        .header(
                            tauri::http::header::CONTENT_TYPE,
                            "text/plain; charset=utf-8",
                        )
                        .body(
                            format!("failed to load wallpaper config: {e}")
                                .as_bytes()
                                .to_vec(),
                        )
                        .unwrap();
                }
            };

            let want_id = query_get_param(request.uri(), "id")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let Some(it) = resolve_wallpaper_item(app, &cfg, want_id.as_deref()) else {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(
                        tauri::http::header::CONTENT_TYPE,
                        "text/plain; charset=utf-8",
                    )
                    .body(b"wallpaper not set".to_vec())
                    .unwrap();
            };
            let Some(rel) = safe_relative_path(&it.rel_path).ok() else {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(
                        tauri::http::header::CONTENT_TYPE,
                        "text/plain; charset=utf-8",
                    )
                    .body(b"wallpaper not set".to_vec())
                    .unwrap();
            };
            let full = app_data_dir(app).join(rel);
            if !full.is_file() {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(
                        tauri::http::header::CONTENT_TYPE,
                        "text/plain; charset=utf-8",
                    )
                    .body(b"wallpaper file not found".to_vec())
                    .unwrap();
            }
            let Ok(bytes) = std::fs::read(&full) else {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                    .header(
                        tauri::http::header::CONTENT_TYPE,
                        "text/plain; charset=utf-8",
                    )
                    .body(b"failed to read wallpaper".to_vec())
                    .unwrap();
            };

            let mime = image_mime_by_ext(&full);
            tauri::http::Response::builder()
                .status(tauri::http::StatusCode::OK)
                .header(tauri::http::header::CONTENT_TYPE, mime)
                .header(tauri::http::header::CACHE_CONTROL, "no-store")
                .body(bytes)
                .unwrap()
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
}

pub(crate) fn builder_tail(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .setup(|app| {
            app.manage(WindowState::default());
            app.manage(Arc::new(TaskManagerState::default()));
            app.manage(Arc::new(ClipboardWatchManagerState::default()));
            app.manage(Arc::new(HttpStreamManagerState::default()));
            app.manage(Arc::new(SqliteConnManager::default()));
            app.manage(Arc::new(ProcessManagerState::default()));
            app.manage(Arc::new(PluginBackendManagerState::default()));
            app.manage(BrowserWindowState::default());

            // 主窗口行为：三档“焦点模式”（默认：失焦自动隐藏）。
            {
                let pref = load_main_window_focus_mode_pref(app.handle());
                let state = app.state::<WindowState>();
                let mut g = state.focus_mode.lock().unwrap_or_else(|e| e.into_inner());
                *g = pref;

                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_always_on_top(pref != MainWindowFocusMode::Normal);
                }
            }

            // store legacy 还原：历史上插件用 `plugins/<id>.json` 落盘到 data/plugins/；
            // 现在收敛到 data/<pluginId>/ 下。由于 tauri-plugin-store 会静默忽略 load 错误，
            // 若不提前还原，插件可能初始化默认数据并覆盖用户的旧数据文件。
            let _ = migrate_legacy_plugin_store_files(app.handle());

            // 主窗口尺寸/位置：从配置恢复（跨重启记住）
            if let Some(saved) = load_main_window_bounds_from_config(app.handle()) {
                let state = app.state::<WindowState>();
                if let Ok(mut g) = state.last_bounds.lock() {
                    *g = Some(saved);
                }
                if let Some(w) = app.get_webview_window("main") {
                    restore_bounds_or_center(&w, &state);
                }
            }

            // 浏览窗口尺寸/位置：从配置预载（真正恢复发生在首次打开“浏览栈”时）
            if let Some(saved) = load_browser_window_bounds_from_config(app.handle()) {
                let state = app.state::<BrowserWindowState>();
                if let Ok(mut g) = state.last_bounds.lock() {
                    *g = Some(saved);
                };
            }

            // 宿主数据迁移：仅迁移宿主私有存储（__app）。插件数据由插件自行调用 storage.migrate 处理。
            let _ = migrations::migrate_plugin_storage(app.handle(), APP_STORAGE_ID);
            let _ = migrations::migrate_host_files_into_app_dir(app.handle());

            // Release：把 MSI 随包的内置插件“种子”拷到可写的插件目录（仅拷缺失项，不覆盖用户已有插件）。
            // Release/MSI：不再做任何随包插件初始化（纯净宿主）。

            let (wake_shortcut, wake_shortcut_text) = load_wake_shortcut(app.handle());
            app.manage(WakeShortcutState {
                current: Mutex::new(wake_shortcut),
                paused: Mutex::new(false),
            });

            let (mode_shortcut, mode_shortcut_text) = load_main_window_mode_shortcut(app.handle());
            app.manage(MainWindowModeShortcutState {
                current: Mutex::new(mode_shortcut),
                paused: Mutex::new(false),
            });

            // 仅当配置文件显式设置过 autoStart 时，才同步到系统自启（避免默认行为影响用户空间）。
            #[cfg(target_os = "windows")]
            {
                if let Some(pref) = load_auto_start_pref(app.handle()) {
                    let _ = auto_start::set_enabled(AUTO_START_REG_VALUE, pref);
                } else {
                    // 兼容历史遗留：用户可能在开发版开过自启（Run 项指向 target\\debug）。
                    // 这里不“开启”自启，只在它已存在时把路径修正到当前 exe。
                    let _ = auto_start::ensure_enabled_points_to_current_exe(AUTO_START_REG_VALUE);
                }
            }

            // 创建托盘菜单
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // 创建系统托盘
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let state = app.state::<WindowState>();
                            save_bounds_if_valid(&w, &state);
                            persist_main_window_bounds(app, &state);
                        }
                        app.exit(0);
                    }
                    "show" => {
                        show_main_window(&app);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        show_main_window(app);
                    }
                })
                .build(app)?;

            // 注册全局快捷键（默认：Ctrl+Alt+Space，可在 data/app.json 的 wakeShortcut 配置）
            if let Err(e) =
                app.global_shortcut()
                    .on_shortcut(wake_shortcut, move |app, _shortcut, event| {
                        if event.state != ShortcutState::Pressed {
                            return;
                        }
                        handle_wake_shortcut(app);
                    })
            {
                eprintln!(
                    "Failed to register wake shortcut {}: {}",
                    wake_shortcut_text, e
                );
            }

            if let Some(s) = mode_shortcut {
                if let Err(e) =
                    app.global_shortcut()
                        .on_shortcut(s, move |app, _shortcut, event| {
                            if event.state != ShortcutState::Pressed {
                                return;
                            }
                            handle_main_window_mode_shortcut(app);
                        })
                {
                    eprintln!(
                        "Failed to register mainWindowModeShortcut {}: {}",
                        mode_shortcut_text, e
                    );
                }
            }

            Ok(())
        })
        // 监听窗口事件：失焦时隐藏
        .on_window_event(|window, event| {
            // 仅 main 窗口需要“失焦自动隐藏/拦截关闭”；其它窗口按普通窗口行为处理。
            if window.label() == BROWSER_BAR_WINDOW_LABEL {
                let app = window.app_handle();
                if let WindowEvent::Moved(_) = event {
                    if let (Some(bar), Some(content)) = (
                        app.get_webview_window(BROWSER_BAR_WINDOW_LABEL),
                        app.get_webview_window(BROWSER_WINDOW_LABEL),
                    ) {
                        let bar_pos = bar.outer_position().ok();
                        let bar_h = bar
                            .inner_size()
                            .ok()
                            .map(|s| s.height)
                            .unwrap_or(BROWSER_BAR_HEIGHT.round().max(1.0) as u32);
                        if let Some(p) = bar_pos {
                            let desired = tauri::PhysicalPosition::new(p.x, p.y + bar_h as i32);
                            let cur = content.outer_position().ok();
                            if cur != Some(desired) {
                                let _ = content.set_position(desired);
                            }
                        }
                    }
                    save_browser_stack_bounds_if_valid(app);
                    schedule_persist_browser_window_bounds(app);
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if browser_stack_is_closing(app) {
                        return;
                    }
                    api.prevent_close();
                    browser_stack_hide_to_main(app);
                }
                if let WindowEvent::Focused(focused) = event {
                    if !focused {
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
                            browser_stack_hide(&app);
                        });
                    }
                }
                return;
            }
            if window.label() == BROWSER_WINDOW_LABEL {
                let app = window.app_handle();
                if let WindowEvent::Moved(_) = event {
                    if let (Some(bar), Some(content)) = (
                        app.get_webview_window(BROWSER_BAR_WINDOW_LABEL),
                        app.get_webview_window(BROWSER_WINDOW_LABEL),
                    ) {
                        let content_pos = content.outer_position().ok();
                        let bar_h = browser_stack_bar_height_px(&bar);
                        if let Some(p) = content_pos {
                            let desired = tauri::PhysicalPosition::new(p.x, p.y - bar_h as i32);
                            let cur = bar.outer_position().ok();
                            if cur != Some(desired) {
                                let _ = bar.set_position(desired);
                            }
                        }
                    }
                    save_browser_stack_bounds_if_valid(app);
                    schedule_persist_browser_window_bounds(app);
                }
                if let WindowEvent::Resized(_) = event {
                    if let (Some(bar), Some(content)) = (
                        app.get_webview_window(BROWSER_BAR_WINDOW_LABEL),
                        app.get_webview_window(BROWSER_WINDOW_LABEL),
                    ) {
                        let bar_h = browser_stack_bar_height_px(&bar);
                        let content_w = content.inner_size().ok().map(|s| s.width).unwrap_or(0);
                        if content_w > 0 {
                            let cur_w = bar.inner_size().ok().map(|s| s.width).unwrap_or(0);
                            if cur_w != content_w {
                                let _ = bar.set_size(tauri::PhysicalSize::new(content_w, bar_h));
                            }
                        }
                        apply_bottom_rounded_corners(&content, 16.0);
                    }
                    save_browser_stack_bounds_if_valid(app);
                    schedule_persist_browser_window_bounds(app);
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if browser_stack_is_closing(app) {
                        return;
                    }
                    api.prevent_close();
                    browser_stack_hide_to_main(app);
                }
                if let WindowEvent::Focused(focused) = event {
                    if !focused {
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
                            browser_stack_hide(&app);
                        });
                    }
                }
                return;
            }
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let state = app.state::<WindowState>();
                save_bounds_if_valid(window, &state);
                persist_main_window_bounds(&app, &state);
                let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
                let _ = window.hide();
                browser_ui_set_mode(&app, wake_logic::UiMode::Hidden);
                return;
            }
            if let WindowEvent::Moved(_) = event {
                let app = window.app_handle();
                let state = app.state::<WindowState>();
                save_bounds_if_valid(window, &state);
                schedule_persist_main_window_bounds(app);
            }
            if let WindowEvent::Resized(_) = event {
                let app = window.app_handle();
                let state = app.state::<WindowState>();
                save_bounds_if_valid(window, &state);
                schedule_persist_main_window_bounds(app);
            }
            if let WindowEvent::Focused(focused) = event {
                if !focused {
                    // 失焦后延迟一点再隐藏：避免拖拽/系统瞬时失焦导致窗口“闪退”式消失
                    let window = window.clone();
                    let app = window.app_handle().clone();
                    let state = app.state::<WindowState>();
                    let mode = state.focus_mode.lock().map(|g| *g).unwrap_or_default();
                    if mode != MainWindowFocusMode::AutoHide {
                        return;
                    }
                    save_bounds_if_valid(&window, &state);
                    persist_main_window_bounds(&app, &state);
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(120)).await;
                        if window.is_focused().unwrap_or(false) {
                            return;
                        }
                        // 先移到屏幕外再隐藏，避免系统动画
                        let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
                        let _ = window.hide();
                        browser_ui_set_mode(&app, wake_logic::UiMode::Hidden);
                    });
                }
            }
        })
}
