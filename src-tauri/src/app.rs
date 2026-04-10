use super::*;

use crate::plugins::{
    get_data_dir, get_plugins_allow_overwrite_on_update, get_plugins_auto_update_enabled,
    get_plugins_dir, install_plugin_files, list_plugins, open_data_dir, open_data_root_dir,
    open_plugins_dir, plugin_store_install, read_plugin_file, read_plugin_file_base64,
    read_plugins_dir, set_plugin_allow_overwrite_on_update, set_plugin_auto_update_enabled,
};
use crate::tasks::{task_cancel, task_create, task_get, task_list};
use crate::wallpaper::{
    get_plugin_icon_overrides, get_wallpaper_settings, read_wallpaper_config,
    remove_plugin_icon_override, remove_wallpaper, remove_wallpaper_item, resolve_wallpaper_item,
    cycle_wallpaper, set_active_wallpaper, set_plugin_icon_override, set_wallpaper_image,
    set_wallpaper_settings, set_wallpaper_view,
};
use crate::clipboard::{clipboard_read_image_data_url, clipboard_write_image_data_url};

pub(crate) fn run() {
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![
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
            clipboard_write_image_data_url,
            clipboard_read_image_data_url,
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
            plugin_open_output_dir,
            plugin_open_dir,
            plugin_files_list_dir,
            plugin_files_read_text,
            plugin_files_write_text,
            plugin_files_read_base64,
            plugin_files_write_base64,
            plugin_files_rename,
            plugin_files_delete,
            plugin_images_write_base64,
            plugin_images_list,
            plugin_images_read,
            plugin_images_delete,
            plugin_pick_images,
            task_create,
            task_get,
            task_list,
            task_cancel,
            get_wake_shortcut,
            set_wake_shortcut,
            pause_wake_shortcut,
            resume_wake_shortcut,
            get_auto_start,
            set_auto_start
        ])
        .setup(|app| {
            app.manage(WindowState::default());
            app.manage(Arc::new(TaskManagerState::default()));
            app.manage(Arc::new(HttpStreamManagerState::default()));
            app.manage(BrowserWindowState::default());

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
                            let desired =
                                tauri::PhysicalPosition::new(p.x, p.y + bar_h as i32);
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
                        let content_w = content
                            .inner_size()
                            .ok()
                            .map(|s| s.width)
                            .unwrap_or(0);
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
