use base64::engine::general_purpose;
use base64::Engine as _;
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::decode_base64_image_payload;

fn encode_rgba_to_png_bytes(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("图片尺寸无效".to_string());
    }
    let expect = width as usize * height as usize * 4;
    if rgba.len() != expect {
        return Err("图片数据长度无效".to_string());
    }
    let mut png = Vec::<u8>::new();
    let encoder = PngEncoder::new(&mut png);
    encoder
        .write_image(rgba, width, height, ColorType::Rgba8.into())
        .map_err(|e| format!("PNG 编码失败: {e}"))?;
    Ok(png)
}

struct ClipboardImageSnapshot {
    png: Vec<u8>,
}

async fn read_clipboard_snapshot(
    app: &AppHandle,
) -> Result<(String, Option<ClipboardImageSnapshot>), String> {
    let app_text = app.clone();
    let text = tauri::async_runtime::spawn_blocking(move || {
        app_text.clipboard().read_text().unwrap_or_default()
    })
    .await
    .map_err(|e| format!("读取文本剪贴板失败: {e}"))?;

    let app_image = app.clone();
    let image = tauri::async_runtime::spawn_blocking(move || {
        let image = app_image.clipboard().read_image().ok();
        match image {
            Some(img) => {
                let rgba = img.rgba();
                let png = encode_rgba_to_png_bytes(rgba, img.width(), img.height()).unwrap_or_default();
                if png.is_empty() {
                    None
                } else {
                    Some(ClipboardImageSnapshot { png })
                }
            }
            None => None,
        }
    })
    .await
    .map_err(|e| format!("读取图片剪贴板失败: {e}"))?;

    Ok((text, image))
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
