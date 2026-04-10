use std::path::Path;

use tauri::Url;

#[tauri::command]
pub(crate) fn open_external_url(url: String) -> Result<(), String> {
    let mut u = url.trim().to_string();
    if u.chars().any(|c| c.is_whitespace()) {
        return Err("url 不允许包含空白字符，请先进行 URL 编码（例如空格用 %20）".to_string());
    }
    if u.contains('\\') {
        // 避免 Windows 上被当成路径导致 explorer 打开资源管理器。
        u = u.replace('\\', "/");
    }

    if !crate::is_http_url(&u) {
        return Err("url 必须以 http(s):// 开头".to_string());
    }

    open::that(&u).map_err(|e| format!("打开链接失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn open_external_uri(uri: String) -> Result<(), String> {
    let mut u = uri.trim().to_string();
    if u.is_empty() {
        return Ok(());
    }
    if u.chars().any(|c| c.is_whitespace()) {
        return Err("uri 不允许包含空白字符，请先进行 URL 编码（例如空格用 %20）".to_string());
    }
    if u.contains('\\') {
        u = u.replace('\\', "/");
    }

    let parsed = Url::parse(&u).map_err(|e| format!("uri 解析失败: {e}"))?;
    let scheme = parsed.scheme().to_ascii_lowercase();
    // 避免把 Windows 路径（如 C:/xxx）误判成 scheme。
    if scheme.len() < 2 {
        return Err("uri scheme 不合法（太短）".to_string());
    }
    if scheme == "file" {
        return Err("不允许打开 file:// uri".to_string());
    }
    if scheme == "javascript" {
        return Err("不允许打开 javascript: uri".to_string());
    }

    open::that(parsed.as_str()).map_err(|e| format!("打开失败: {e}"))?;
    Ok(())
}

pub(crate) fn open_dir_in_file_manager(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("当前平台不支持打开文件管理器".to_string())
}

