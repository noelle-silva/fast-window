use crate::image_codec::{
    decode_image_data_url as decode_data_url_image, encode_rgba_to_png_bytes,
};
use arboard::ImageData;
use std::borrow::Cow;

pub struct ClipboardImageSnapshot {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub fn read_text_clipboard() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard
        .get_text()
        .map_err(|e| format!("读取剪贴板失败: {e}"))
}

pub fn write_text_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard
        .set_text(text.to_string())
        .map_err(|e| format!("写入剪贴板失败: {e}"))
}

pub fn read_image_clipboard() -> Result<Option<ClipboardImageSnapshot>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    let image = match clipboard.get_image() {
        Ok(image) => image,
        Err(_) => return Ok(None),
    };
    let rgba = image.bytes.as_ref();
    let png = encode_rgba_to_png_bytes(rgba, image.width as u32, image.height as u32)?;
    Ok(Some(ClipboardImageSnapshot {
        png,
        width: image.width as u32,
        height: image.height as u32,
    }))
}

pub fn write_image_clipboard_from_data_url(data_url: &str) -> Result<(), String> {
    let bytes =
        decode_data_url_image(data_url).map_err(|e| e.replace("图片需要", "图片剪贴板写入需要"))?;
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
    clipboard
        .set_image(image)
        .map_err(|e| format!("写入图片剪贴板失败: {e}"))
}
