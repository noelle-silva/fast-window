use base64::engine::general_purpose;
use base64::Engine as _;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::decode_base64_image_payload;
use crate::clipboard_snapshot::read_clipboard_snapshot;

#[tauri::command]
pub(crate) async fn clipboard_read_text(app: tauri::AppHandle) -> Result<String, String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || Ok::<String, String>(app2.clipboard().read_text().unwrap_or_default()))
        .await
        .map_err(|e| format!("读取文本剪贴板失败: {e}"))?
}

#[tauri::command]
pub(crate) async fn clipboard_write_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app2.clipboard()
            .write_text(text)
            .map_err(|e| format!("写入文本剪贴板失败: {e}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("写入文本剪贴板失败: {e}"))?
}

#[tauri::command]
pub(crate) async fn clipboard_write_image_data_url(
    app: tauri::AppHandle,
    data_url: String,
) -> Result<(), String> {
    let raw = data_url;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, _) = decode_base64_image_payload(&raw)?;
        let img = image::load_from_memory(&bytes).map_err(|e| format!("解码图片失败: {e}"))?;
        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();
        let image = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
        app2.clipboard()
            .write_image(&image)
            .map_err(|e| format!("写入图片剪贴板失败: {e}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("写入图片剪贴板失败: {e}"))?
}

#[tauri::command]
pub(crate) async fn clipboard_read_image_data_url(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    let (_text, image) = read_clipboard_snapshot(&app).await?;
    let Some(img) = image else {
        return Ok(None);
    };
    let b64 = general_purpose::STANDARD.encode(img.png);
    Ok(Some(format!("data:image/png;base64,{b64}")))
}
