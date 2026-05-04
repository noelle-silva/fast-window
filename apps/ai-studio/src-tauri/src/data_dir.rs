use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const CONFIG_FILE: &str = "ai-studio-settings.json";
const WRITE_TEST_FILE: &str = ".fw-ai-studio-write-test";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DataDirStatus {
    pub(crate) data_dir: String,
    pub(crate) default_data_dir: String,
    pub(crate) configured_data_dir: Option<String>,
    pub(crate) writable: bool,
    pub(crate) error: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStudioSettings {
    data_dir: Option<String>,
}

pub(crate) fn default_data_dir(app: &tauri::AppHandle) -> PathBuf {
    resource_or_exe_dir(app).join("data")
}

pub(crate) fn resolve_data_dir(app: &tauri::AppHandle) -> PathBuf {
    load_settings(app)
        .data_dir
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| default_data_dir(app))
}

pub(crate) fn data_dir_status(app: &tauri::AppHandle, runtime_error: Option<String>) -> DataDirStatus {
    let settings = load_settings(app);
    let configured = settings
        .data_dir
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty());
    let data_dir = configured.clone().unwrap_or_else(|| default_data_dir(app));
    let writable_result = ensure_writable_dir(&data_dir);
    let writable_error = writable_result.as_ref().err().cloned();
    DataDirStatus {
        data_dir: data_dir.display().to_string(),
        default_data_dir: default_data_dir(app).display().to_string(),
        configured_data_dir: configured.map(|path| path.display().to_string()),
        writable: writable_result.is_ok() && runtime_error.is_none(),
        error: runtime_error.or(writable_error),
    }
}

pub(crate) fn save_data_dir(app: &tauri::AppHandle, data_dir: &Path) -> Result<(), String> {
    ensure_writable_dir(data_dir)?;
    let settings = AiStudioSettings {
        data_dir: Some(data_dir.display().to_string()),
    };
    let config_path = settings_path(app)?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(&settings).map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(config_path, format!("{payload}\n")).map_err(|e| format!("保存数据目录配置失败: {e}"))
}

pub(crate) fn ensure_writable_dir(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| format!("数据目录不可创建: {} ({e})", path.display()))?;
    let test_path = path.join(WRITE_TEST_FILE);
    std::fs::write(&test_path, b"ok").map_err(|e| format!("数据目录不可写: {} ({e})", path.display()))?;
    let _ = std::fs::remove_file(test_path);
    Ok(())
}

fn load_settings(app: &tauri::AppHandle) -> AiStudioSettings {
    let Ok(path) = settings_path(app) else {
        return AiStudioSettings::default();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return AiStudioSettings::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(CONFIG_FILE))
        .map_err(|e| format!("读取 App 配置目录失败: {e}"))
}

fn resource_or_exe_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .ok()
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(Path::to_path_buf))
        })
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
}
