#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    Manager, WindowEvent,
    tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent},
    menu::{Menu, MenuItem},
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[tauri::command]
fn get_plugins_dir() -> String {
    let cwd = std::env::current_dir().unwrap_or_default();
    // 开发模式下 cwd 是 src-tauri，需要返回上级目录的 plugins
    let plugins_dir = cwd.parent().map(|p| p.join("plugins")).unwrap_or_else(|| cwd.join("plugins"));
    plugins_dir.to_string_lossy().to_string()
}

#[tauri::command]
fn get_data_dir() -> String {
    let cwd = std::env::current_dir().unwrap_or_default();
    let data_dir = cwd.parent().map(|p| p.join("data")).unwrap_or_else(|| cwd.join("data"));
    // 确保目录存在
    let _ = std::fs::create_dir_all(&data_dir);
    data_dir.to_string_lossy().to_string()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_plugins_dir, get_data_dir])
        .setup(|app| {
            // 创建托盘菜单
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // 创建系统托盘
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.center();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.center();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // 注册全局快捷键 Ctrl+Alt+Space
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
            let app_handle = app.handle().clone();

            if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                // 只响应按下事件，忽略释放事件
                if event.state != ShortcutState::Pressed {
                    return;
                }

                if let Some(window) = app_handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        // 先移到屏幕外再隐藏，避免系统动画
                        let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
                        let _ = window.hide();
                    } else {
                        let _ = window.center();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }) {
                eprintln!("Failed to register shortcut Ctrl+Alt+Space: {}", e);
            }

            Ok(())
        })
        // 监听窗口事件：失焦时隐藏
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(focused) = event {
                if !focused {
                    // 先移到屏幕外再隐藏，避免系统动画
                    let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
