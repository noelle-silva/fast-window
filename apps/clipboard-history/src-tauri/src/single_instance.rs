use std::env;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::control_server::{
    post_control_request, session_token, start_control_server, ControlEndpoint,
    ControlServerConfig, CLIPBOARD_HISTORY_APP_ID,
};
use crate::fw_window::{FwArgs, FwWindowState};

const SINGLE_INSTANCE_SERVER_ID: &str = "single-instance";
const INSTANCE_STATE_FILE: &str = "single-instance.json";
const SINGLE_INSTANCE_BIND_ADDR: &str = "127.0.0.1:0";
const STATE_MAX_AGE_MS: u64 = 12 * 60 * 60 * 1000;

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
        CLIPBOARD_HISTORY_APP_ID,
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
    let endpoint = start_control_server(
        app,
        window_state,
        ControlServerConfig {
            name: "fw-clipboard-history-single-instance",
            app_id: CLIPBOARD_HISTORY_APP_ID,
            server_id: SINGLE_INSTANCE_SERVER_ID,
            bind_addr: SINGLE_INSTANCE_BIND_ADDR,
            token: session_token(),
            announce_to_stdout: false,
        },
    )?;
    write_instance_state(&endpoint, desktop_identifier)
}

pub(crate) fn remove_current_instance_state(desktop_identifier: &str) {
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
        app_id: CLIPBOARD_HISTORY_APP_ID.to_string(),
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
    state.app_id == CLIPBOARD_HISTORY_APP_ID
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
    use super::{
        forwarded_action, is_valid_instance_state, InstanceState, SINGLE_INSTANCE_SERVER_ID,
    };
    use crate::control_server::CLIPBOARD_HISTORY_APP_ID;
    use crate::fw_window::FwArgs;

    fn valid_state() -> InstanceState {
        InstanceState {
            app_id: CLIPBOARD_HISTORY_APP_ID.to_string(),
            desktop_identifier: "com.fastwindow.clipboardhistory.dev".to_string(),
            server_id: SINGLE_INSTANCE_SERVER_ID.to_string(),
            addr: "127.0.0.1:49152".to_string(),
            token: "token".to_string(),
            pid: 123,
            updated_at: super::now_ms(),
        }
    }

    fn fw_args(action: &str, launched: bool) -> FwArgs {
        FwArgs {
            launched,
            action: action.to_string(),
            command: None,
            mode: "default".to_string(),
            x: None,
            y: None,
            width: None,
            height: None,
        }
    }

    #[test]
    fn validates_instance_state_identity() {
        assert!(is_valid_instance_state(
            &valid_state(),
            "com.fastwindow.clipboardhistory.dev"
        ));

        assert!(!is_valid_instance_state(
            &valid_state(),
            "com.fastwindow.clipboardhistory"
        ));

        let mut wrong_app = valid_state();
        wrong_app.app_id = "other".to_string();
        assert!(!is_valid_instance_state(
            &wrong_app,
            "com.fastwindow.clipboardhistory.dev"
        ));

        let mut wrong_server = valid_state();
        wrong_server.server_id = "fw-control".to_string();
        assert!(!is_valid_instance_state(
            &wrong_server,
            "com.fastwindow.clipboardhistory.dev"
        ));

        let mut empty_token = valid_state();
        empty_token.token = " ".to_string();
        assert!(!is_valid_instance_state(
            &empty_token,
            "com.fastwindow.clipboardhistory.dev"
        ));

        let mut external_addr = valid_state();
        external_addr.addr = "192.168.1.10:49152".to_string();
        assert!(!is_valid_instance_state(
            &external_addr,
            "com.fastwindow.clipboardhistory.dev"
        ));

        let mut zero_port = valid_state();
        zero_port.addr = "127.0.0.1:0".to_string();
        assert!(!is_valid_instance_state(
            &zero_port,
            "com.fastwindow.clipboardhistory.dev"
        ));

        let mut malformed_addr = valid_state();
        malformed_addr.addr = "not-an-addr".to_string();
        assert!(!is_valid_instance_state(
            &malformed_addr,
            "com.fastwindow.clipboardhistory.dev"
        ));

        let mut missing_pid = valid_state();
        missing_pid.pid = 0;
        assert!(!is_valid_instance_state(
            &missing_pid,
            "com.fastwindow.clipboardhistory.dev"
        ));

        let mut stale = valid_state();
        stale.updated_at = 1;
        assert!(!is_valid_instance_state(
            &stale,
            "com.fastwindow.clipboardhistory.dev"
        ));
    }

    #[test]
    fn maps_forwarded_actions_without_closing_standalone_launches() {
        assert_eq!(forwarded_action(&fw_args("toggle", false)), "show");
        assert_eq!(forwarded_action(&fw_args("hide", false)), "hide");
        assert_eq!(forwarded_action(&fw_args("close", false)), "show");
        assert_eq!(forwarded_action(&fw_args("close", true)), "close");
    }
}
