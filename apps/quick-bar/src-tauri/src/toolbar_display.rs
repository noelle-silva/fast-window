use std::{path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const CONFIG_FILE: &str = "quick-bar-display-mode.json";
const DEFAULT_MODE: ToolbarDisplayMode = ToolbarDisplayMode::Shortcut;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ToolbarDisplayMode {
    Shortcut,
    Automatic,
}

impl ToolbarDisplayMode {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "shortcut" => Ok(Self::Shortcut),
            "automatic" => Ok(Self::Automatic),
            other => Err(format!("Quick Bar 显示方式不合法: {other}")),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Shortcut => "shortcut",
            Self::Automatic => "automatic",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolbarDisplayModeStatus {
    mode: String,
    error: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolbarDisplayModeConfig {
    mode: Option<String>,
}

pub(crate) struct ToolbarDisplayModeState {
    status: Mutex<ToolbarDisplayModeStatus>,
}

impl Default for ToolbarDisplayModeState {
    fn default() -> Self {
        Self {
            status: Mutex::new(ToolbarDisplayModeStatus {
                mode: DEFAULT_MODE.as_str().to_string(),
                error: None,
            }),
        }
    }
}

impl ToolbarDisplayModeState {
    fn set_status(&self, status: ToolbarDisplayModeStatus) -> Result<(), String> {
        let mut guard = self
            .status
            .lock()
            .map_err(|_| "Quick Bar 显示方式状态锁定失败".to_string())?;
        *guard = status;
        Ok(())
    }

    pub(crate) fn status(&self) -> Result<ToolbarDisplayModeStatus, String> {
        self.status
            .lock()
            .map(|status| status.clone())
            .map_err(|_| "Quick Bar 显示方式状态锁定失败".to_string())
    }

    pub(crate) fn mode(&self) -> ToolbarDisplayMode {
        self.status()
            .ok()
            .and_then(|status| ToolbarDisplayMode::parse(&status.mode).ok())
            .unwrap_or(DEFAULT_MODE)
    }
}

#[tauri::command]
pub(crate) fn quick_bar_display_mode_status(
    state: tauri::State<'_, std::sync::Arc<ToolbarDisplayModeState>>,
) -> Result<ToolbarDisplayModeStatus, String> {
    state.status()
}

#[tauri::command]
pub(crate) fn set_quick_bar_display_mode(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<ToolbarDisplayModeState>>,
    mode: String,
) -> Result<ToolbarDisplayModeStatus, String> {
    let mode = ToolbarDisplayMode::parse(&mode)?;
    save_mode(&app, mode)?;
    let status = ToolbarDisplayModeStatus {
        mode: mode.as_str().to_string(),
        error: None,
    };
    state.set_status(status.clone())?;
    Ok(status)
}

pub(crate) fn install(
    app: &tauri::AppHandle,
    state: &ToolbarDisplayModeState,
) -> Result<(), String> {
    match load_mode(app) {
        Ok(mode) => state.set_status(ToolbarDisplayModeStatus {
            mode: mode.as_str().to_string(),
            error: None,
        }),
        Err(error) => state.set_status(ToolbarDisplayModeStatus {
            mode: DEFAULT_MODE.as_str().to_string(),
            error: Some(error),
        }),
    }
}

fn load_mode(app: &tauri::AppHandle) -> Result<ToolbarDisplayMode, String> {
    let path = config_path(app)?;
    if !path.is_file() {
        return Ok(DEFAULT_MODE);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取显示方式配置失败: {e}"))?;
    let config = serde_json::from_str::<ToolbarDisplayModeConfig>(&text)
        .map_err(|e| format!("解析显示方式配置失败: {e}"))?;
    config
        .mode
        .as_deref()
        .map(ToolbarDisplayMode::parse)
        .unwrap_or(Ok(DEFAULT_MODE))
}

fn save_mode(app: &tauri::AppHandle, mode: ToolbarDisplayMode) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建显示方式配置目录失败: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(&ToolbarDisplayModeConfig {
        mode: Some(mode.as_str().to_string()),
    })
    .map_err(|e| format!("序列化显示方式配置失败: {e}"))?;
    std::fs::write(path, format!("{payload}\n")).map_err(|e| format!("保存显示方式配置失败: {e}"))
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(CONFIG_FILE))
        .map_err(|e| format!("读取 App 配置目录失败: {e}"))
}
