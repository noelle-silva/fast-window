use std::path::{Component, Path, PathBuf};

use tauri::http::{header, Response, StatusCode, Uri};

use crate::{app_plugins_dir, is_safe_id};
use crate::plugins::safe_relative_path_no_curdir;

fn text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap()
}

fn plugin_asset_mime_by_ext(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn percent_decode_path(raw: &str) -> Result<String, String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("插件资源 URL 编码不合法".to_string());
            }
            let hi = hex_val(bytes[i + 1]).ok_or_else(|| "插件资源 URL 编码不合法".to_string())?;
            let lo = hex_val(bytes[i + 2]).ok_or_else(|| "插件资源 URL 编码不合法".to_string())?;
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "插件资源 URL 编码不是 UTF-8".to_string())
}

fn parse_plugin_asset_uri(uri: &Uri) -> Result<(String, String), String> {
    if uri.host().unwrap_or("") != "asset" {
        return Err("插件资源 host 不合法".to_string());
    }

    let raw_path = uri.path().trim_start_matches('/');
    let Some((raw_plugin_id, raw_asset_path)) = raw_path.split_once('/') else {
        return Err("插件资源路径不合法".to_string());
    };

    let plugin_id = percent_decode_path(raw_plugin_id)?.trim().to_string();
    let asset_path = percent_decode_path(raw_asset_path)?.trim().to_string();
    if plugin_id.is_empty() || asset_path.is_empty() {
        return Err("插件资源路径不合法".to_string());
    }
    Ok((plugin_id, asset_path))
}

fn is_public_plugin_asset_path(rel: &Path) -> bool {
    match rel.components().next() {
        Some(Component::Normal(first)) => {
            let first = first.to_string_lossy();
            first == "ui" || first == "assets" || first == "shared"
        }
        _ => false,
    }
}

fn resolve_plugin_asset_file(
    app: &tauri::AppHandle,
    plugin_id: &str,
    path: &str,
) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let rel = safe_relative_path_no_curdir(path)?;
    if !is_public_plugin_asset_path(&rel) {
        return Err("插件资源路径不允许访问".to_string());
    }

    let plugin_dir = app_plugins_dir(app).join(plugin_id);
    let full = plugin_dir.join(rel);
    let plugin_root = std::fs::canonicalize(&plugin_dir)
        .map_err(|e| format!("插件目录不可用: {e}"))?;
    let full = std::fs::canonicalize(&full)
        .map_err(|e| format!("插件资源不存在: {e}"))?;
    if !full.starts_with(&plugin_root) {
        return Err("插件资源路径越界".to_string());
    }
    if !full.is_file() {
        return Err("插件资源不存在".to_string());
    }
    Ok(full)
}

pub(crate) fn plugin_asset_protocol_response(
    app: &tauri::AppHandle,
    uri: &Uri,
) -> Response<Vec<u8>> {
    let (plugin_id, path) = match parse_plugin_asset_uri(uri) {
        Ok(v) => v,
        Err(_) => return text_response(StatusCode::BAD_REQUEST, "plugin asset path is invalid"),
    };

    let full = match resolve_plugin_asset_file(app, &plugin_id, &path) {
        Ok(v) => v,
        Err(_) => return text_response(StatusCode::NOT_FOUND, "plugin asset not found"),
    };
    let Ok(bytes) = std::fs::read(&full) else {
        return text_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to read plugin asset");
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, plugin_asset_mime_by_ext(&full))
        .header(header::CACHE_CONTROL, "no-store")
        .body(bytes)
        .unwrap()
}
