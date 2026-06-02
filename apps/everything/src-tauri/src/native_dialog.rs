use tauri::Manager;

pub(crate) fn has_native_dialog() -> bool {
    false
}

pub(crate) fn main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())
}
