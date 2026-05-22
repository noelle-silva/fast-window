mod clipboard;
mod data_contract;
mod domain;
mod file_clipboard;
mod http_util;
mod image_codec;
mod image_http;
mod image_store;
mod legacy_import;
mod migrations;
mod model;
mod server;
mod service;
mod store;

use crate::service::ClipboardHistoryService;
use crate::store::Store;
use std::env;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn main() {
    if let Err(error) = run() {
        eprintln!("[clipboard-history-backend] fatal {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let data_dir = required_env_path("FW_APP_DATA_DIR")?;
    let token = env::var("FW_APP_SESSION_TOKEN").unwrap_or_default();
    if token.trim().is_empty() {
        return Err("FW_APP_SESSION_TOKEN 未设置".to_string());
    }

    let output_dir = data_contract::output_images_dir(&data_dir);
    let service = Arc::new(Mutex::new(ClipboardHistoryService::warmup(
        Store::new(data_dir),
        output_dir,
    )?));
    let output_dir = service
        .lock()
        .map_err(|_| "剪贴板历史服务锁定失败".to_string())?
        .output_root()
        .to_path_buf();
    start_monitor(service.clone());
    let image_base_url = image_http::start_image_server(output_dir, token.clone())?;
    let url = server::start_server(service, token)?;
    println!(
        "{}",
        serde_json::json!({
            "type": "ready",
            "ipc": {
                "mode": "direct",
                "transport": "local-websocket",
                "url": url,
                "imageBaseUrl": image_base_url,
                "protocolVersion": 1
            }
        })
    );

    loop {
        std::thread::park();
    }
}

fn required_env_path(name: &str) -> Result<PathBuf, String> {
    let value = env::var(name).map_err(|_| format!("{name} 未设置"))?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{name} 未设置"));
    }
    Ok(PathBuf::from(trimmed))
}

fn start_monitor(service: Arc<Mutex<ClipboardHistoryService>>) {
    std::thread::spawn(move || loop {
        let sleep_ms = {
            if let Ok(mut svc) = service.lock() {
                let settings = svc.settings();
                svc.poll_clipboard_once();
                settings.poll_interval.max(200)
            } else {
                1000
            }
        };
        std::thread::sleep(Duration::from_millis(sleep_ms));
    });
}
