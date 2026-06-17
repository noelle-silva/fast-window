use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::{
    selection_observer::SelectionObserverState,
    toolbar_window::{self, ToolbarState},
};

const CONFIG_FILE: &str = "quick-bar-shortcut.json";
const DEFAULT_SHORTCUT: &str = "control+alt+Q";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShortcutStatus {
    shortcut: String,
    enabled: bool,
    error: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutConfig {
    shortcut: Option<String>,
}

pub(crate) struct QuickBarShortcutState {
    current: Mutex<Option<Shortcut>>,
    status: Mutex<ShortcutStatus>,
}

impl Default for QuickBarShortcutState {
    fn default() -> Self {
        Self {
            current: Mutex::new(None),
            status: Mutex::new(ShortcutStatus {
                shortcut: DEFAULT_SHORTCUT.to_string(),
                enabled: false,
                error: None,
            }),
        }
    }
}

impl QuickBarShortcutState {
    fn set_status(&self, status: ShortcutStatus) -> Result<(), String> {
        let mut guard = self
            .status
            .lock()
            .map_err(|_| "Quick Bar 快捷键状态锁定失败".to_string())?;
        *guard = status;
        Ok(())
    }

    fn status(&self) -> Result<ShortcutStatus, String> {
        self.status
            .lock()
            .map(|status| status.clone())
            .map_err(|_| "Quick Bar 快捷键状态锁定失败".to_string())
    }
}

#[tauri::command]
pub(crate) fn quick_bar_shortcut_status(
    state: tauri::State<'_, Arc<QuickBarShortcutState>>,
) -> Result<ShortcutStatus, String> {
    state.status()
}

#[tauri::command]
pub(crate) fn set_quick_bar_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<QuickBarShortcutState>>,
    toolbar_state: tauri::State<'_, Arc<ToolbarState>>,
    selection_observer_state: tauri::State<'_, Arc<SelectionObserverState>>,
    shortcut: String,
) -> Result<ShortcutStatus, String> {
    set_shortcut(
        &app,
        state.inner(),
        toolbar_state.inner().clone(),
        selection_observer_state.inner().clone(),
        &shortcut,
    )
}

pub(crate) fn install(
    app: &tauri::AppHandle,
    state: &Arc<QuickBarShortcutState>,
    toolbar_state: Arc<ToolbarState>,
    selection_observer_state: Arc<SelectionObserverState>,
) -> Result<(), String> {
    let shortcut = load_shortcut(app)?;
    if let Err(error) = register_initial_shortcut(
        app,
        state,
        toolbar_state,
        selection_observer_state,
        &shortcut,
    ) {
        state.set_status(ShortcutStatus {
            shortcut,
            enabled: false,
            error: Some(error),
        })?;
    }
    Ok(())
}

fn register_initial_shortcut(
    app: &tauri::AppHandle,
    state: &QuickBarShortcutState,
    toolbar_state: Arc<ToolbarState>,
    selection_observer_state: Arc<SelectionObserverState>,
    shortcut: &str,
) -> Result<(), String> {
    let (next, normalized) = parse_shortcut(shortcut)?;
    app.global_shortcut()
        .on_shortcut(
            next,
            shortcut_handler(toolbar_state, selection_observer_state),
        )
        .map_err(|e| format!("注册 Quick Bar 快捷键失败: {e}"))?;
    if let Ok(mut current) = state.current.lock() {
        *current = Some(next);
    }
    state.set_status(ShortcutStatus {
        shortcut: normalized,
        enabled: true,
        error: None,
    })
}

fn set_shortcut(
    app: &tauri::AppHandle,
    state: &QuickBarShortcutState,
    toolbar_state: Arc<ToolbarState>,
    selection_observer_state: Arc<SelectionObserverState>,
    shortcut: &str,
) -> Result<ShortcutStatus, String> {
    let (next, normalized) = parse_shortcut(shortcut)?;
    let prev = state
        .current
        .lock()
        .map_err(|_| "Quick Bar 快捷键状态锁定失败".to_string())?
        .to_owned();

    if prev.map(|shortcut| shortcut.id()) == Some(next.id()) {
        save_shortcut(app, &normalized)?;
        let status = ShortcutStatus {
            shortcut: normalized,
            enabled: true,
            error: None,
        };
        state.set_status(status.clone())?;
        return Ok(status);
    }

    app.global_shortcut()
        .on_shortcut(
            next,
            shortcut_handler(toolbar_state, selection_observer_state),
        )
        .map_err(|e| format!("注册 Quick Bar 快捷键失败: {e}"))?;

    if let Err(error) = save_shortcut(app, &normalized) {
        let _ = app.global_shortcut().unregister(next);
        return Err(error);
    }

    if let Some(prev) = prev {
        let _ = app.global_shortcut().unregister(prev);
    }
    if let Ok(mut current) = state.current.lock() {
        *current = Some(next);
    }

    let status = ShortcutStatus {
        shortcut: normalized,
        enabled: true,
        error: None,
    };
    state.set_status(status.clone())?;
    Ok(status)
}

fn shortcut_handler(
    toolbar_state: Arc<ToolbarState>,
    selection_observer_state: Arc<SelectionObserverState>,
) -> impl Fn(&tauri::AppHandle, &Shortcut, tauri_plugin_global_shortcut::ShortcutEvent)
       + Send
       + Sync
       + 'static {
    move |app, _shortcut, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }
        let app = app.clone();
        let toolbar_state = toolbar_state.clone();
        let selection_observer_state = selection_observer_state.clone();
        tauri::async_runtime::spawn(async move {
            match selection_observer_state.current_capture().await {
                Ok(Some(capture)) => {
                    if let Err(error) =
                        toolbar_window::show_toolbar_from_capture(&app, &toolbar_state, capture)
                    {
                        eprintln!("[quick-bar] {error}");
                    }
                }
                Ok(None) => {
                    if let Err(error) = toolbar_window::hide_toolbar(&app, &toolbar_state) {
                        eprintln!("[quick-bar] {error}");
                    }
                }
                Err(error) => {
                    if let Err(hide_error) = toolbar_window::hide_toolbar(&app, &toolbar_state) {
                        eprintln!("[quick-bar] {hide_error}");
                    }
                    eprintln!("[quick-bar] {error}");
                }
            }
        });
    }
}

fn parse_shortcut(raw: &str) -> Result<(Shortcut, String), String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err("快捷键不能为空".to_string());
    }
    if !contains_modifier(value) {
        return Err("快捷键至少需要包含 Ctrl、Alt、Shift 或 Super 中的一个".to_string());
    }
    let shortcut = Shortcut::from_str(value).map_err(|e| format!("快捷键格式不合法: {e}"))?;
    Ok((shortcut, shortcut.to_string()))
}

fn contains_modifier(value: &str) -> bool {
    value.split('+').any(|part| {
        matches!(
            part.trim().to_ascii_lowercase().as_str(),
            "ctrl" | "control" | "alt" | "shift" | "super" | "meta" | "cmd" | "command"
        )
    })
}

fn load_shortcut(app: &tauri::AppHandle) -> Result<String, String> {
    let path = config_path(app)?;
    if !path.is_file() {
        return Ok(DEFAULT_SHORTCUT.to_string());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取快捷键配置失败: {e}"))?;
    let config = serde_json::from_str::<ShortcutConfig>(&text)
        .map_err(|e| format!("解析快捷键配置失败: {e}"))?;
    Ok(config
        .shortcut
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_SHORTCUT.to_string()))
}

fn save_shortcut(app: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建快捷键配置目录失败: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(&ShortcutConfig {
        shortcut: Some(shortcut.to_string()),
    })
    .map_err(|e| format!("序列化快捷键配置失败: {e}"))?;
    std::fs::write(path, format!("{payload}\n")).map_err(|e| format!("保存快捷键配置失败: {e}"))
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(CONFIG_FILE))
        .map_err(|e| format!("读取 App 配置目录失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::parse_shortcut;

    #[test]
    fn parses_default_shortcut() {
        assert!(parse_shortcut("control+alt+Q").is_ok());
    }

    #[test]
    fn parses_recorder_style_shortcut() {
        assert!(parse_shortcut("control+shift+Space").is_ok());
    }

    #[test]
    fn rejects_shortcut_without_modifier() {
        assert!(parse_shortcut("Q").is_err());
    }
}
