#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::Duration;
use std::sync::Mutex;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use serde::Serialize;
use tauri::{
    Manager, WindowEvent,
    tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent},
    menu::{Menu, MenuItem},
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use serde_json::{Map, Value};

const DEFAULT_WAKE_SHORTCUT: &str = "control+alt+Space";
const APP_CONFIG_FILE: &str = "app.json";
const WAKE_SHORTCUT_KEY: &str = "wakeShortcut";
const AUTO_START_KEY: &str = "autoStart";
const AUTO_START_REG_VALUE: &str = "Fast Window";

#[derive(Default)]
struct WindowState {
    last_position: Mutex<Option<tauri::PhysicalPosition<i32>>>,
}

struct WakeShortcutState {
    current: Mutex<Shortcut>,
    paused: Mutex<bool>,
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

fn app_local_base_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default())
}

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app_local_base_dir(app).join("data")
}

fn app_config_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join(APP_CONFIG_FILE)
}

fn read_json_map(path: &Path) -> Map<String, Value> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return Map::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(&content) else {
        return Map::new();
    };
    match v {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

fn write_json_map(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let content = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(path, content).map_err(|e| format!("写入配置失败: {e}"))?;
    Ok(())
}

#[derive(Clone, Serialize)]
struct AutoStartStatus {
    supported: bool,
    enabled: bool,
    scope: &'static str,
}

fn load_auto_start_pref(app: &tauri::AppHandle) -> Option<bool> {
    let cfg_path = app_config_path(app);
    let map = read_json_map(&cfg_path);

    if map.contains_key(AUTO_START_KEY) {
        return map.get(AUTO_START_KEY).and_then(|v| v.as_bool());
    }
    if map.contains_key("auto_start") {
        return map.get("auto_start").and_then(|v| v.as_bool());
    }
    None
}

#[cfg(target_os = "windows")]
mod auto_start {
    use std::io;

    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

    fn open_run_key(read_only: bool) -> Result<RegKey, String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let flags = if read_only { KEY_READ } else { KEY_READ | KEY_WRITE };
        hkcu.open_subkey_with_flags(RUN_KEY, flags)
            .map_err(|e| format!("打开注册表失败: {e}"))
    }

    fn current_exe_command() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {e}"))?;
        Ok(format!("\"{}\"", exe.to_string_lossy()))
    }

    pub fn is_enabled(value_name: &str) -> bool {
        let Ok(key) = open_run_key(true) else {
            return false;
        };
        key.get_raw_value(value_name).is_ok()
    }

    pub fn set_enabled(value_name: &str, enabled: bool) -> Result<bool, String> {
        let key = open_run_key(false)?;

        if enabled {
            let cmd = current_exe_command()?;
            key.set_value(value_name, &cmd)
                .map_err(|e| format!("写入自启注册表项失败: {e}"))?;
        } else {
            match key.delete_value(value_name) {
                Ok(_) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("删除自启注册表项失败: {e}")),
            }
        }

        Ok(is_enabled(value_name))
    }
}

fn load_wake_shortcut(app: &tauri::AppHandle) -> (Shortcut, String) {
    let cfg_path = app_config_path(app);
    let map = read_json_map(&cfg_path);

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
                raw,
                cfg_path,
                e
            );
            let fallback = Shortcut::from_str(DEFAULT_WAKE_SHORTCUT)
                .expect("DEFAULT_WAKE_SHORTCUT must be parseable");
            (fallback, fallback.to_string())
        }
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<WindowState>();
        restore_or_center(&window, &state);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let state = app.state::<WindowState>();
            save_position_if_valid(&window, &state);
            let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
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
    let base = app_local_base_dir(&app);
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
    let data_dir = app_data_dir(&app);
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
    let mut guard = state.current.lock().map_err(|_| "内部状态锁失败".to_string())?;
    let prev = *guard;
    let was_paused = state.paused.lock().map(|g| *g).unwrap_or(false);

    if prev.id() == next.id() {
        let cfg_path = app_config_path(&app);
        let mut map = read_json_map(&cfg_path);
        map.insert(WAKE_SHORTCUT_KEY.to_string(), Value::String(normalized.clone()));
        write_json_map(&cfg_path, &map)?;
        *guard = next;

        if was_paused {
            app.global_shortcut()
                .on_shortcut(prev, move |app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    toggle_main_window(app);
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
            toggle_main_window(app);
        })
        .map_err(|e| format!("注册全局快捷键失败: {e}"))?;

    let cfg_path = app_config_path(&app);
    let mut map = read_json_map(&cfg_path);
    map.insert(WAKE_SHORTCUT_KEY.to_string(), Value::String(normalized.clone()));
    if let Err(e) = write_json_map(&cfg_path, &map) {
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
    let current = state.current.lock().map_err(|_| "内部状态锁失败".to_string())?;

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
    let current = state.current.lock().map_err(|_| "内部状态锁失败".to_string())?;

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
            toggle_main_window(app);
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
        let cfg_path = app_config_path(&app);
        let mut map = read_json_map(&cfg_path);

        let prev_registry = auto_start::is_enabled(AUTO_START_REG_VALUE);
        let next_registry = auto_start::set_enabled(AUTO_START_REG_VALUE, enabled)?;

        map.insert(AUTO_START_KEY.to_string(), Value::Bool(enabled));
        if let Err(e) = write_json_map(&cfg_path, &map) {
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
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_plugins_dir,
            get_data_dir,
            get_wake_shortcut,
            set_wake_shortcut,
            pause_wake_shortcut,
            resume_wake_shortcut,
            get_auto_start,
            set_auto_start
        ])
        .setup(|app| {
            app.manage(WindowState::default());

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
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            show_main_window(&app);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        show_main_window(app);
                    }
                })
                .build(app)?;

            // 注册全局快捷键（默认：Ctrl+Alt+Space，可在 data/app.json 的 wakeShortcut 配置）
            if let Err(e) = app.global_shortcut().on_shortcut(wake_shortcut, move |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                toggle_main_window(app);
            }) {
                eprintln!("Failed to register wake shortcut {}: {}", wake_shortcut_text, e);
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
