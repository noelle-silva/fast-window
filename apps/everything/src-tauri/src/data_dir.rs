use std::path::{Path, PathBuf};

use serde::Serialize;

const WRITE_TEST_FILE: &str = ".fw-everything-write-test";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DataDirStatus {
    pub(crate) data_dir: String,
    pub(crate) default_data_dir: String,
    pub(crate) writable: bool,
    pub(crate) error: Option<String>,
}

pub(crate) fn default_data_dir() -> Result<PathBuf, String> {
    crate::app_layout::default_data_dir()
}

pub(crate) fn resolve_data_dir(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    default_data_dir()
}

pub(crate) fn data_dir_status(
    _app: &tauri::AppHandle,
    runtime_error: Option<String>,
) -> Result<DataDirStatus, String> {
    let default_data_dir = default_data_dir()?;
    let data_dir = default_data_dir.clone();
    let writable_result = ensure_writable_dir(&data_dir);
    let writable_error = writable_result.as_ref().err().cloned();
    Ok(DataDirStatus {
        data_dir: data_dir.display().to_string(),
        default_data_dir: default_data_dir.display().to_string(),
        writable: writable_result.is_ok() && runtime_error.is_none(),
        error: runtime_error.or(writable_error),
    })
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
