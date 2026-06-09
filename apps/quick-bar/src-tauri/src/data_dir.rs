use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const CONFIG_FILE: &str = "quick-bar-data-dir.json";
const WRITE_TEST_FILE: &str = ".fw-quick-bar-write-test";

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
struct DataDirConfig {
    data_dir: Option<String>,
}

pub(crate) fn default_data_dir() -> Result<PathBuf, String> {
    crate::app_layout::default_data_dir()
}

pub(crate) fn resolve_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(configured) = load_data_dir_config(app)?
        .data_dir
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return Ok(configured);
    }
    default_data_dir()
}

pub(crate) fn data_dir_status(app: &tauri::AppHandle) -> Result<DataDirStatus, String> {
    let config = load_data_dir_config(app)?;
    let configured = config
        .data_dir
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty());
    let default_data_dir = default_data_dir()?;
    let data_dir = configured
        .clone()
        .unwrap_or_else(|| default_data_dir.clone());
    let writable_result = ensure_writable_dir(&data_dir);
    Ok(DataDirStatus {
        data_dir: data_dir.display().to_string(),
        default_data_dir: default_data_dir.display().to_string(),
        configured_data_dir: configured.map(|path| path.display().to_string()),
        writable: writable_result.is_ok(),
        error: writable_result.err(),
    })
}

pub(crate) fn save_data_dir(app: &tauri::AppHandle, data_dir: &Path) -> Result<(), String> {
    ensure_writable_dir(data_dir)?;
    let config = DataDirConfig {
        data_dir: Some(data_dir.display().to_string()),
    };
    let config_path = data_dir_config_path(app)?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let payload =
        serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(config_path, format!("{payload}\n"))
        .map_err(|e| format!("保存数据目录配置失败: {e}"))
}

pub(crate) fn ensure_writable_dir(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|e| format!("数据目录不可创建: {} ({e})", path.display()))?;
    let test_path = path.join(WRITE_TEST_FILE);
    std::fs::write(&test_path, b"ok")
        .map_err(|e| format!("数据目录不可写: {} ({e})", path.display()))?;
    let _ = std::fs::remove_file(test_path);
    Ok(())
}

fn load_data_dir_config(app: &tauri::AppHandle) -> Result<DataDirConfig, String> {
    let path = data_dir_config_path(app)?;
    if !path.is_file() {
        return Ok(DataDirConfig::default());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取数据目录配置失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("解析数据目录配置失败: {e}"))
}

fn data_dir_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(CONFIG_FILE))
        .map_err(|e| format!("读取 App 配置目录失败: {e}"))
}
