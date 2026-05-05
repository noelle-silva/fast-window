use arboard::ImageData;
use base64::Engine as _;
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use std::borrow::Cow;

pub struct ClipboardImageSnapshot {
    pub hash: u32,
    pub png: Vec<u8>,
}

pub fn read_text_clipboard() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard.get_text().map_err(|e| format!("读取剪贴板失败: {e}"))
}

pub fn write_text_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard.set_text(text.to_string()).map_err(|e| format!("写入剪贴板失败: {e}"))
}

pub fn read_image_clipboard() -> Result<Option<ClipboardImageSnapshot>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    let image = match clipboard.get_image() {
        Ok(image) => image,
        Err(_) => return Ok(None),
    };
    let rgba = image.bytes.as_ref();
    let png = encode_rgba_to_png_bytes(rgba, image.width as u32, image.height as u32)?;
    Ok(Some(ClipboardImageSnapshot { hash: hash32_sampled_bytes(rgba), png }))
}

pub fn write_image_clipboard_from_data_url(data_url: &str) -> Result<(), String> {
    let bytes = decode_image_data_url(data_url)?;
    write_image_clipboard_from_bytes(&bytes)
}

pub fn write_image_clipboard_from_bytes(bytes: &[u8]) -> Result<(), String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("解码图片失败: {e}"))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let image = ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(rgba.into_raw()),
    };
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard.set_image(image).map_err(|e| format!("写入图片剪贴板失败: {e}"))
}

fn decode_image_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let raw = data_url.trim();
    if !raw.starts_with("data:image/") {
        return Err("图片剪贴板写入需要 data:image URL".to_string());
    }
    let Some((meta, data)) = raw.split_once(',') else {
        return Err("图片 data URL 无效".to_string());
    };
    if !meta.to_ascii_lowercase().contains(";base64") {
        return Err("图片 data URL 必须使用 base64".to_string());
    }
    base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("图片 base64 解码失败: {e}"))
}

fn encode_rgba_to_png_bytes(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("图片尺寸无效".to_string());
    }
    let expect = width as usize * height as usize * 4;
    if rgba.len() != expect {
        return Err("图片数据长度无效".to_string());
    }
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(rgba, width, height, ColorType::Rgba8.into())
        .map_err(|e| format!("PNG 编码失败: {e}"))?;
    Ok(png)
}

fn hash32_sampled_bytes(bytes: &[u8]) -> u32 {
    let mut h: u32 = 5381;
    let n = bytes.len();
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
