use std::path::PathBuf;

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickedImage {
    pub(crate) name: String,
    pub(crate) data_url: String,
}

pub(crate) struct AlwaysOnTopGuard {
    window: Option<tauri::WebviewWindow>,
}

impl AlwaysOnTopGuard {
    pub(crate) fn new(app: &tauri::AppHandle) -> Self {
        let mut guard = Self { window: None };
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.set_always_on_top(false);
            guard.window = Some(w);
        }
        guard
    }
}

impl Drop for AlwaysOnTopGuard {
    fn drop(&mut self) {
        if let Some(w) = self.window.take() {
            let _ = w.set_always_on_top(true);
        }
    }
}

pub(crate) fn with_main_window_dialog_focus<T>(app: &tauri::AppHandle, f: impl FnOnce() -> T) -> T {
    let _guard = AlwaysOnTopGuard::new(app);
    f()
}

pub(crate) fn pick_folder(app: &tauri::AppHandle, title: &str) -> Option<PathBuf> {
    with_main_window_dialog_focus(app, || rfd::FileDialog::new().set_title(title).pick_folder())
}

pub(crate) fn pick_image_files(app: &tauri::AppHandle, title: &str) -> Option<Vec<PathBuf>> {
    with_main_window_dialog_focus(app, || {
        rfd::FileDialog::new()
            .set_title(title)
            .add_filter("Image", &["png", "jpg", "jpeg", "webp", "gif"])
            .pick_files()
    })
}

pub(crate) fn confirm(app: &tauri::AppHandle, title: &str, message: &str) -> bool {
    let result = with_main_window_dialog_focus(app, || {
        rfd::MessageDialog::new()
            .set_title(title)
            .set_description(message)
            .set_buttons(rfd::MessageButtons::OkCancel)
            .show()
    });
    matches!(result, rfd::MessageDialogResult::Ok | rfd::MessageDialogResult::Yes)
}

pub(crate) fn images_to_data_urls(
    files: Vec<PathBuf>,
    max_count: usize,
    path_has_image_ext: impl Fn(&PathBuf) -> bool,
    image_mime_by_ext: impl Fn(&PathBuf) -> &'static str,
) -> Result<Vec<PickedImage>, String> {
    const MAX_BYTES: usize = 10 * 1024 * 1024; // 10MB
    let max = max_count.clamp(1, 20);
    let mut out: Vec<PickedImage> = Vec::new();

    for path in files.into_iter().take(max) {
        if !path.is_file() || !path_has_image_ext(&path) {
            continue;
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("读取图片失败: {e}"))?;
        if bytes.len() > MAX_BYTES {
            return Err("图片过大（> 10MB）".to_string());
        }
        let mime = image_mime_by_ext(&path);
        let b64 = general_purpose::STANDARD.encode(bytes);
        let data_url = format!("data:{mime};base64,{b64}");
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("image")
            .to_string();
        out.push(PickedImage { name, data_url });
    }

    Ok(out)
}
