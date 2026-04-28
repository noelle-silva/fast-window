pub fn read_text_clipboard() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard.get_text().map_err(|e| format!("读取剪贴板失败: {e}"))
}

pub fn write_text_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {e}"))?;
    clipboard.set_text(text.to_string()).map_err(|e| format!("写入剪贴板失败: {e}"))
}
