use base64::Engine as _;
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};

pub struct EncodedImage {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub fn decode_image_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let raw = data_url.trim();
    if !raw.starts_with("data:image/") {
        return Err("图片需要 data:image URL".to_string());
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

pub fn normalize_image_bytes_to_png(bytes: &[u8]) -> Result<EncodedImage, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("解码图片失败: {e}"))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(EncodedImage {
        png: encode_rgba_to_png_bytes(&rgba.into_raw(), width, height)?,
        width,
        height,
    })
}

pub fn encode_rgba_to_png_bytes(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
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

pub fn image_data_url(mime: &str, bytes: &[u8]) -> String {
    let safe_mime = if mime.trim().starts_with("image/") {
        mime.trim()
    } else {
        "image/png"
    };
    format!(
        "data:{safe_mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}
