#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::Duration;
use std::sync::Mutex;

use tauri::{
    Manager, WindowEvent,
    tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent},
    menu::{Menu, MenuItem},
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Default)]
struct WindowState {
    last_position: Mutex<Option<tauri::PhysicalPosition<i32>>>,
}

trait Positionable {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>>;
    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()>;
    fn center(&self) -> tauri::Result<()>;
}

impl Positionable for tauri::Window {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>> {
        tauri::Window::outer_position(self)
    }

    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()> {
        tauri::Window::set_position(self, position)
    }

    fn center(&self) -> tauri::Result<()> {
        tauri::Window::center(self)
    }
}

impl Positionable for tauri::WebviewWindow {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>> {
        tauri::WebviewWindow::outer_position(self)
    }

    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()> {
        tauri::WebviewWindow::set_position(self, position)
    }

    fn center(&self) -> tauri::Result<()> {
        tauri::WebviewWindow::center(self)
    }
}

fn save_position_if_valid(window: &impl Positionable, state: &WindowState) {
    if let Ok(pos) = window.outer_position() {
        // 隐藏时会把窗口移到屏幕外（-10000, -10000），不要把这种位置记成“上次位置”
        if pos.x <= -9000 || pos.y <= -9000 {
            return;
        }
        if let Ok(mut guard) = state.last_position.lock() {
            *guard = Some(pos);
        }
    }
}

fn restore_or_center(window: &impl Positionable, state: &WindowState) {
    let last = state
        .last_position
        .lock()
        .ok()
        .and_then(|g| *g);

    if let Some(pos) = last {
        let _ = window.set_position(pos);
    } else {
        let _ = window.center();
    }
}

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
            app.manage(WindowState::default());

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
                                let state = app.state::<WindowState>();
                                restore_or_center(&window, &state);
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
                            let state = app.state::<WindowState>();
                            restore_or_center(&window, &state);
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
                        let state = app_handle.state::<WindowState>();
                        save_position_if_valid(&window, &state);
                        let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
                        let _ = window.hide();
                    } else {
                        let state = app_handle.state::<WindowState>();
                        restore_or_center(&window, &state);
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
            if let WindowEvent::Moved(_) = event {
                let app = window.app_handle();
                let state = app.state::<WindowState>();
                save_position_if_valid(window, &state);
            }
            if let WindowEvent::Focused(focused) = event {
                if !focused {
                    // 失焦后延迟一点再隐藏：避免拖拽/系统瞬时失焦导致窗口“闪退”式消失
                    let window = window.clone();
                    let app = window.app_handle();
                    let state = app.state::<WindowState>();
                    save_position_if_valid(&window, &state);
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(120)).await;
                        if window.is_focused().unwrap_or(false) {
                            return;
                        }
                        // 先移到屏幕外再隐藏，避免系统动画
                        let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
                        let _ = window.hide();
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
