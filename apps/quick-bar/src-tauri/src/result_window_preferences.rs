use std::{path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const CONFIG_FILE: &str = "quick-bar-result-window.json";
pub(crate) const DEFAULT_RESULT_WIDTH: u32 = 420;
pub(crate) const DEFAULT_RESULT_HEIGHT: u32 = 380;
pub(crate) const MIN_RESULT_WIDTH: u32 = 320;
pub(crate) const MIN_RESULT_HEIGHT: u32 = 220;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResultWindowDisplayMode {
    NearSelection,
    Fixed,
}

impl ResultWindowDisplayMode {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "near-selection" => Ok(Self::NearSelection),
            "fixed" => Ok(Self::Fixed),
            other => Err(format!("Quick Bar 结果窗显示位置不合法: {other}")),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::NearSelection => "near-selection",
            Self::Fixed => "fixed",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResultWindowCloseMode {
    Manual,
    HideOnBlur,
}

impl ResultWindowCloseMode {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "manual" => Ok(Self::Manual),
            "hide-on-blur" => Ok(Self::HideOnBlur),
            other => Err(format!("Quick Bar 结果窗关闭方式不合法: {other}")),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::HideOnBlur => "hide-on-blur",
        }
    }
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultWindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl ResultWindowBounds {
    pub(crate) fn position(self) -> PhysicalPosition<i32> {
        PhysicalPosition::new(self.x, self.y)
    }

    pub(crate) fn size(self) -> PhysicalSize<u32> {
        PhysicalSize::new(self.width, self.height)
    }
}

#[derive(Clone, Copy)]
pub(crate) struct ResultWindowPreferences {
    pub(crate) display_mode: ResultWindowDisplayMode,
    pub(crate) close_mode: ResultWindowCloseMode,
    pub(crate) bounds: Option<ResultWindowBounds>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultWindowPreferencesStatus {
    display_mode: String,
    close_mode: String,
    bounds: Option<ResultWindowBounds>,
    error: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultWindowPreferencesConfig {
    display_mode: Option<String>,
    close_mode: Option<String>,
    bounds: Option<ResultWindowBounds>,
}

pub(crate) struct ResultWindowPreferencesState {
    status: Mutex<ResultWindowPreferencesStatus>,
}

impl Default for ResultWindowPreferencesState {
    fn default() -> Self {
        Self {
            status: Mutex::new(status_from_preferences(default_preferences(), None)),
        }
    }
}

impl ResultWindowPreferencesState {
    pub(crate) fn status(&self) -> Result<ResultWindowPreferencesStatus, String> {
        self.status
            .lock()
            .map(|status| status.clone())
            .map_err(|_| "Quick Bar 结果窗设置状态锁定失败".to_string())
    }

    pub(crate) fn preferences(&self) -> Result<ResultWindowPreferences, String> {
        let status = self.status()?;
        Ok(ResultWindowPreferences {
            display_mode: ResultWindowDisplayMode::parse(&status.display_mode)?,
            close_mode: ResultWindowCloseMode::parse(&status.close_mode)?,
            bounds: status.bounds,
        })
    }

    fn set_status(&self, status: ResultWindowPreferencesStatus) -> Result<(), String> {
        let mut current = self
            .status
            .lock()
            .map_err(|_| "Quick Bar 结果窗设置状态锁定失败".to_string())?;
        *current = status;
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn quick_bar_result_window_preferences(
    state: tauri::State<'_, std::sync::Arc<ResultWindowPreferencesState>>,
) -> Result<ResultWindowPreferencesStatus, String> {
    state.status()
}

#[tauri::command]
pub(crate) fn set_quick_bar_result_window_preferences(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<ResultWindowPreferencesState>>,
    display_mode: String,
    close_mode: String,
) -> Result<ResultWindowPreferencesStatus, String> {
    let current = state.preferences()?;
    let next = ResultWindowPreferences {
        display_mode: ResultWindowDisplayMode::parse(&display_mode)?,
        close_mode: ResultWindowCloseMode::parse(&close_mode)?,
        bounds: current.bounds,
    };
    save_preferences(&app, next)?;
    let status = status_from_preferences(next, None);
    state.set_status(status.clone())?;
    Ok(status)
}

pub(crate) fn install(
    app: &tauri::AppHandle,
    state: &ResultWindowPreferencesState,
) -> Result<(), String> {
    match load_preferences(app) {
        Ok(preferences) => state.set_status(status_from_preferences(preferences, None)),
        Err(error) => state.set_status(status_from_preferences(default_preferences(), Some(error))),
    }
}

pub(crate) fn remember_bounds_from_window(
    app: &tauri::AppHandle,
    state: &ResultWindowPreferencesState,
    window: &WebviewWindow,
) -> Result<(), String> {
    let position = window
        .outer_position()
        .map_err(|e| format!("读取 Quick Bar 结果窗位置失败: {e}"))?;
    let size = window
        .inner_size()
        .map_err(|e| format!("读取 Quick Bar 结果窗尺寸失败: {e}"))?;
    let preferences = state.preferences()?;
    let previous = preferences.bounds;
    let next_bounds = ResultWindowBounds {
        x: if preferences.display_mode == ResultWindowDisplayMode::Fixed {
            position.x
        } else {
            previous.map(|bounds| bounds.x).unwrap_or(position.x)
        },
        y: if preferences.display_mode == ResultWindowDisplayMode::Fixed {
            position.y
        } else {
            previous.map(|bounds| bounds.y).unwrap_or(position.y)
        },
        width: size.width.max(MIN_RESULT_WIDTH),
        height: size.height.max(MIN_RESULT_HEIGHT),
    };
    if !is_valid_bounds(&next_bounds) {
        return Ok(());
    }
    let next = ResultWindowPreferences {
        bounds: Some(next_bounds),
        ..preferences
    };
    save_preferences(app, next)?;
    state.set_status(status_from_preferences(next, None))
}

fn load_preferences(app: &tauri::AppHandle) -> Result<ResultWindowPreferences, String> {
    let path = config_path(app)?;
    if !path.is_file() {
        return Ok(default_preferences());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取结果窗设置失败: {e}"))?;
    let config = serde_json::from_str::<ResultWindowPreferencesConfig>(&text)
        .map_err(|e| format!("解析结果窗设置失败: {e}"))?;
    Ok(ResultWindowPreferences {
        display_mode: config
            .display_mode
            .as_deref()
            .map(ResultWindowDisplayMode::parse)
            .unwrap_or(Ok(ResultWindowDisplayMode::NearSelection))?,
        close_mode: config
            .close_mode
            .as_deref()
            .map(ResultWindowCloseMode::parse)
            .unwrap_or(Ok(ResultWindowCloseMode::Manual))?,
        bounds: config.bounds.filter(is_valid_bounds),
    })
}

fn save_preferences(
    app: &tauri::AppHandle,
    preferences: ResultWindowPreferences,
) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建结果窗设置目录失败: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(&ResultWindowPreferencesConfig {
        display_mode: Some(preferences.display_mode.as_str().to_string()),
        close_mode: Some(preferences.close_mode.as_str().to_string()),
        bounds: preferences.bounds.filter(is_valid_bounds),
    })
    .map_err(|e| format!("序列化结果窗设置失败: {e}"))?;
    std::fs::write(path, format!("{payload}\n")).map_err(|e| format!("保存结果窗设置失败: {e}"))
}

fn status_from_preferences(
    preferences: ResultWindowPreferences,
    error: Option<String>,
) -> ResultWindowPreferencesStatus {
    ResultWindowPreferencesStatus {
        display_mode: preferences.display_mode.as_str().to_string(),
        close_mode: preferences.close_mode.as_str().to_string(),
        bounds: preferences.bounds,
        error,
    }
}

fn default_preferences() -> ResultWindowPreferences {
    ResultWindowPreferences {
        display_mode: ResultWindowDisplayMode::NearSelection,
        close_mode: ResultWindowCloseMode::Manual,
        bounds: None,
    }
}

fn is_valid_bounds(bounds: &ResultWindowBounds) -> bool {
    bounds.width >= MIN_RESULT_WIDTH
        && bounds.height >= MIN_RESULT_HEIGHT
        && bounds.x > -50000
        && bounds.y > -50000
        && bounds.x < 50000
        && bounds.y < 50000
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(CONFIG_FILE))
        .map_err(|e| format!("读取 App 配置目录失败: {e}"))
}
