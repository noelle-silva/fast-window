#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::Duration;
use std::sync::Mutex;
use std::path::{Path, PathBuf};

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

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else if ty.is_file() {
            if let Some(parent) = to.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn is_dir_empty(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => true,
    }
}

#[tauri::command]
fn get_plugins_dir(app: tauri::AppHandle) -> String {
    // 统一使用 App 本地数据目录（避免 cwd 漂移），插件默认放到这里
    let base = app.path().app_local_data_dir().unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
    let plugins_dir = base.join("plugins");
    let _ = std::fs::create_dir_all(&plugins_dir);

    // 开发模式：把仓库里的 plugins 同步到本地数据目录（方便开发，且配合 fs scope 收紧）
    #[cfg(debug_assertions)]
    {
        let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
        let repo_plugins = workspace_root.join("plugins");
        if repo_plugins.is_dir() {
            // 每次都覆盖同步：以仓库为真源
            let _ = copy_dir_all(&repo_plugins, &plugins_dir);
        }
    }

    plugins_dir.to_string_lossy().to_string()
}

#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> String {
    // 统一使用 App 本地数据目录（避免 cwd 漂移）
    let base = app.path().app_local_data_dir().unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
    let data_dir = base.join("data");
    let _ = std::fs::create_dir_all(&data_dir);

    // 开发模式：仅在目标目录为空时，把仓库里的 data 迁移一份过来（不覆盖用户数据）
    #[cfg(debug_assertions)]
    {
        if is_dir_empty(&data_dir) {
            let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
            let repo_data = workspace_root.join("data");
            if repo_data.is_dir() {
                let _ = copy_dir_all(&repo_data, &data_dir);
            }
        }
    }

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
