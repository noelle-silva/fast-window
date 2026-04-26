use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub(crate) fn hash32_sampled_bytes(bytes: &[u8]) -> u32 {
    let n = bytes.len();
    let mut h: u32 = 5381;
    if n > 4096 {
        for &b in &bytes[..2048] {
            h = ((h << 5).wrapping_add(h)) ^ (b as u32);
        }
        for &b in &bytes[(n - 2048)..] {
            h = ((h << 5).wrapping_add(h)) ^ (b as u32);
        }
        return h;
    }
    for &b in bytes {
        h = ((h << 5).wrapping_add(h)) ^ (b as u32);
    }
    h
}

pub(crate) fn encode_rgba_to_png_bytes(
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
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

pub(crate) struct ClipboardImageSnapshot {
    pub(crate) hash: u32,
    pub(crate) png: Vec<u8>,
}

pub(crate) async fn read_clipboard_snapshot(
    app: &tauri::AppHandle,
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
                let hash = hash32_sampled_bytes(rgba);
                let png =
                    encode_rgba_to_png_bytes(rgba, img.width(), img.height()).unwrap_or_default();
                if png.is_empty() {
                    None
                } else {
                    Some(ClipboardImageSnapshot { hash, png })
                }
            }
            None => None,
        }
    })
    .await
    .map_err(|e| format!("读取图片剪贴板失败: {e}"))?;

    Ok((text, image))
}
