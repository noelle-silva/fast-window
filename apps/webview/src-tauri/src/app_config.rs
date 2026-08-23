use std::path::PathBuf;

use serde_json::{Map, Value};

/// webview 倍速设置键（app.json）
pub(crate) const WEBVIEW_SETTINGS_KEY: &str = "webview";
/// 浏览栈窗口边界键（app.json）
pub(crate) const BROWSER_WINDOW_BOUNDS_KEY: &str = "browserWindowBounds";

pub(crate) fn app_config_path(app: &tauri::AppHandle) -> PathBuf {
    crate::data_dir::resolve_data_dir(app)
        .unwrap_or_default()
        .join("app.json")
}

fn read_json_map_opt(path: &PathBuf) -> Option<Map<String, Value>> {
    if !path.is_file() {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let v = serde_json::from_str::<Value>(&content).ok()?;
    match v {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

/// 读取配置 map；不存在或损坏时返回空 map（损坏内容不覆盖，保持快速失败最小化）
pub(crate) fn read_app_config_map(app: &tauri::AppHandle) -> Map<String, Value> {
    read_json_map_opt(&app_config_path(app)).unwrap_or_else(Map::new)
}

/// 读取-修改-写回配置 map
pub(crate) fn update_app_config_map<T>(
    app: &tauri::AppHandle,
    update: impl FnOnce(&mut Map<String, Value>) -> Result<T, String>,
) -> Result<T, String> {
    let path = app_config_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let mut map = read_json_map_opt(&path).unwrap_or_else(Map::new);
    let result = update(&mut map)?;
    let payload = serde_json::to_string_pretty(&Value::Object(map))
        .map_err(|e| format!("序列化应用配置失败: {e}"))?;
    std::fs::write(&path, format!("{payload}\n"))
        .map_err(|e| format!("写入应用配置失败: {e}"))?;
    Ok(result)
}
