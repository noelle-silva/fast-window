use std::env;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::control_server::{
    post_control_request, random_token, start_control_server, ControlEndpoint, ControlServerConfig,
    FOLDERS_APP_ID,
};
use crate::fw_window::{FwArgs, FwWindowState};

const SINGLE_INSTANCE_BIND_ADDR: &str = "127.0.0.1:0";
const SINGLE_INSTANCE_SERVER_ID: &str = "single-instance";
const INSTANCE_STATE_FILE: &str = "single-instance.json";
const STATE_MAX_AGE_MS: u64 = 12 * 60 * 60 * 1000;
const STATE_REFRESH_INTERVAL_MS: u64 = 5 * 60 * 1000;

static STOP_INSTANCE_STATE_REFRESH: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceState {
    app_id: String,
    desktop_identifier: String,
    server_id: String,
    addr: String,
    token: String,
    pid: u32,
    updated_at: u64,
}

pub(crate) fn forward_to_existing_instance(args: &FwArgs, desktop_identifier: &str) -> bool {
    let Some(state) = read_instance_state(desktop_identifier) else {
        return false;
    };
    if !is_valid_instance_state(&state, desktop_identifier) {
        remove_instance_state(desktop_identifier);
        return false;
    }

    let ok = post_control_request(
        &state.addr,
        &state.token,
        forwarded_action(args),
        args.command.as_deref(),
        FOLDERS_APP_ID,
        SINGLE_INSTANCE_SERVER_ID,
    );
    if !ok {
        remove_instance_state(desktop_identifier);
    }
    ok
}

pub(crate) fn start_single_instance_server(
    app: tauri::AppHandle,
    window_state: Arc<FwWindowState>,
    desktop_identifier: &str,
) -> Result<(), String> {
    let token = random_token("folders-single");
    let endpoint = start_control_server(
        app,
        window_state,
        ControlServerConfig {
            name: "fw-folders-single-instance",
            app_id: FOLDERS_APP_ID,
            server_id: SINGLE_INSTANCE_SERVER_ID,
            bind_addr: SINGLE_INSTANCE_BIND_ADDR,
            token,
            announce_to_stdout: false,
        },
    )?;
    STOP_INSTANCE_STATE_REFRESH.store(false, Ordering::Release);
    write_instance_state(&endpoint, desktop_identifier)?;
    start_instance_state_refresh(endpoint, desktop_identifier.to_string());
    Ok(())
}

pub(crate) fn remove_current_instance_state(desktop_identifier: &str) {
    STOP_INSTANCE_STATE_REFRESH.store(true, Ordering::Release);
    remove_instance_state(desktop_identifier);
}

fn forwarded_action(args: &FwArgs) -> &'static str {
    match args.action.as_str() {
        "hide" => "hide",
        "close" if args.launched => "close",
        _ => "show",
    }
}

fn read_instance_state(desktop_identifier: &str) -> Option<InstanceState> {
    let text = fs::read_to_string(instance_state_path(desktop_identifier)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_instance_state(
    endpoint: &ControlEndpoint,
    desktop_identifier: &str,
) -> Result<(), String> {
    let path = instance_state_path(desktop_identifier);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建单实例状态目录失败: {e}"))?;
    }
    let state = InstanceState {
        app_id: FOLDERS_APP_ID.to_string(),
        desktop_identifier: desktop_identifier.to_string(),
        server_id: SINGLE_INSTANCE_SERVER_ID.to_string(),
        addr: endpoint_addr(endpoint),
        token: endpoint.token.clone(),
        pid: std::process::id(),
        updated_at: now_ms(),
    };
    let payload =
        serde_json::to_string_pretty(&state).map_err(|e| format!("序列化单实例状态失败: {e}"))?;
    fs::write(path, format!("{payload}\n")).map_err(|e| format!("写入单实例状态失败: {e}"))
}

fn start_instance_state_refresh(endpoint: ControlEndpoint, desktop_identifier: String) {
    let _ = thread::Builder::new()
        .name("fw-folders-single-instance-state".to_string())
        .spawn(move || loop {
            thread::sleep(Duration::from_millis(STATE_REFRESH_INTERVAL_MS));
            if STOP_INSTANCE_STATE_REFRESH.load(Ordering::Acquire) {
                break;
            }
            if let Err(error) = write_instance_state(&endpoint, &desktop_identifier) {
                eprintln!("[folders] 刷新单实例状态失败: {error}");
            }
        });
}

fn remove_instance_state(desktop_identifier: &str) {
    let _ = fs::remove_file(instance_state_path(desktop_identifier));
}

fn endpoint_addr(endpoint: &ControlEndpoint) -> String {
    endpoint
        .url
        .strip_prefix("http://")
        .unwrap_or(&endpoint.url)
        .to_string()
}

fn is_valid_instance_state(state: &InstanceState, desktop_identifier: &str) -> bool {
    state.app_id == FOLDERS_APP_ID
        && state.desktop_identifier == desktop_identifier
        && state.server_id == SINGLE_INSTANCE_SERVER_ID
        && is_loopback_control_addr(&state.addr)
        && !state.token.trim().is_empty()
        && state.pid > 0
        && !state_is_stale(state.updated_at)
}

fn is_loopback_control_addr(addr: &str) -> bool {
    let Ok(addr) = addr.parse::<SocketAddr>() else {
        return false;
    };
    addr.ip().is_loopback() && addr.port() != 0
}

fn state_is_stale(updated_at: u64) -> bool {
    updated_at == 0 || now_ms().saturating_sub(updated_at) > STATE_MAX_AGE_MS
}

fn instance_state_path(desktop_identifier: &str) -> PathBuf {
    instance_state_dir(desktop_identifier).join(INSTANCE_STATE_FILE)
}

fn instance_state_dir(desktop_identifier: &str) -> PathBuf {
    let safe_identifier = safe_path_segment(desktop_identifier);
    if cfg!(target_os = "windows") {
        if let Some(dir) = env::var_os("LOCALAPPDATA").or_else(|| env::var_os("APPDATA")) {
            return PathBuf::from(dir)
                .join("FastWindow")
                .join("RegisteredApps")
                .join(safe_identifier);
        }
    }

    if let Some(dir) = env::var_os("XDG_RUNTIME_DIR") {
        return PathBuf::from(dir)
            .join("fast-window")
            .join("registered-apps")
            .join(safe_identifier);
    }

    if cfg!(target_os = "macos") {
        if let Some(home) = env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("FastWindow")
                .join("RegisteredApps")
                .join(safe_identifier);
        }
    }

    env::temp_dir()
        .join("fast-window-registered-apps")
        .join(safe_identifier)
}

fn safe_path_segment(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::{is_valid_instance_state, InstanceState, SINGLE_INSTANCE_SERVER_ID};
    use crate::control_server::FOLDERS_APP_ID;

    fn valid_state() -> InstanceState {
        InstanceState {
            app_id: FOLDERS_APP_ID.to_string(),
            desktop_identifier: "com.fastwindow.folders.dev".to_string(),
            server_id: SINGLE_INSTANCE_SERVER_ID.to_string(),
            addr: "127.0.0.1:49152".to_string(),
            token: "token".to_string(),
            pid: 123,
            updated_at: super::now_ms(),
        }
    }

    #[test]
    fn validates_identifier_specific_state() {
        assert!(is_valid_instance_state(
            &valid_state(),
            "com.fastwindow.folders.dev"
        ));
        assert!(!is_valid_instance_state(
            &valid_state(),
            "com.fastwindow.folders"
        ));
    }

    #[test]
    fn rejects_invalid_state() {
        let mut state = valid_state();
        state.addr = "127.0.0.1:0".to_string();
        assert!(!is_valid_instance_state(
            &state,
            "com.fastwindow.folders.dev"
        ));

        let mut state = valid_state();
        state.token = " ".to_string();
        assert!(!is_valid_instance_state(
            &state,
            "com.fastwindow.folders.dev"
        ));
    }
}
