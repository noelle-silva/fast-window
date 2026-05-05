use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::control_server::{
    post_control_request, session_token, start_control_server, ControlEndpoint,
    ControlServerConfig, AI_DRAW_APP_ID,
};
use crate::fw_window::{FwArgs, FwWindowState};

const SINGLE_INSTANCE_BIND_ADDR: &str = "127.0.0.1:0";
const SINGLE_INSTANCE_SERVER_ID: &str = "single-instance";
const INSTANCE_STATE_FILE: &str = "ai-draw-single-instance.json";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceState {
    app_id: String,
    server_id: String,
    addr: String,
    token: String,
    pid: u32,
    updated_at: u64,
}

pub(crate) fn forward_to_existing_instance(args: &FwArgs) -> bool {
    let Some(state) = read_instance_state() else {
        return false;
    };
    if !is_valid_instance_state(&state) {
        remove_instance_state();
        return false;
    }

    let ok = post_control_request(
        &state.addr,
        &state.token,
        forwarded_action(args),
        args.command.as_deref(),
        AI_DRAW_APP_ID,
        SINGLE_INSTANCE_SERVER_ID,
    );
    if !ok {
        remove_instance_state();
    }
    ok
}

pub(crate) fn start_single_instance_server(
    app: tauri::AppHandle,
    window_state: Arc<FwWindowState>,
) -> Result<(), String> {
    let token = session_token();
    let endpoint = start_control_server(
        app,
        window_state,
        ControlServerConfig {
            name: "fw-ai-draw-single-instance",
            app_id: AI_DRAW_APP_ID,
            server_id: SINGLE_INSTANCE_SERVER_ID,
            bind_addr: SINGLE_INSTANCE_BIND_ADDR,
            token,
            announce_to_stdout: false,
        },
    )?;
    write_instance_state(&endpoint)
}

fn forwarded_action(args: &FwArgs) -> &'static str {
    match args.action.as_str() {
        "hide" => "hide",
        "close" if args.launched => "close",
        _ => "show",
    }
}

fn read_instance_state() -> Option<InstanceState> {
    let text = fs::read_to_string(instance_state_path()).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_instance_state(endpoint: &ControlEndpoint) -> Result<(), String> {
    let path = instance_state_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建单实例状态目录失败: {e}"))?;
    }
    let state = InstanceState {
        app_id: AI_DRAW_APP_ID.to_string(),
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

fn remove_instance_state() {
    let _ = fs::remove_file(instance_state_path());
}

fn endpoint_addr(endpoint: &ControlEndpoint) -> String {
    endpoint
        .url
        .strip_prefix("http://")
        .unwrap_or(&endpoint.url)
        .to_string()
}

fn is_valid_instance_state(state: &InstanceState) -> bool {
    state.app_id == AI_DRAW_APP_ID
        && state.server_id == SINGLE_INSTANCE_SERVER_ID
        && !state.addr.trim().is_empty()
        && state.addr.starts_with("127.0.0.1:")
        && !state.token.trim().is_empty()
}

fn instance_state_path() -> PathBuf {
    instance_state_dir().join(INSTANCE_STATE_FILE)
}

fn instance_state_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        if let Some(dir) = env::var_os("LOCALAPPDATA").or_else(|| env::var_os("APPDATA")) {
            return PathBuf::from(dir).join("FastWindow").join("AI Draw");
        }
    }

    if let Some(dir) = env::var_os("XDG_RUNTIME_DIR") {
        return PathBuf::from(dir).join("fast-window").join("ai-draw");
    }

    if cfg!(target_os = "macos") {
        if let Some(home) = env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("FastWindow")
                .join("AI Draw");
        }
    }

    env::temp_dir().join("fast-window-ai-draw")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::SINGLE_INSTANCE_SERVER_ID;
    use super::{forwarded_action, is_valid_instance_state, InstanceState};
    use crate::control_server::AI_DRAW_APP_ID;
    use crate::fw_window::FwArgs;

    fn valid_state() -> InstanceState {
        InstanceState {
            app_id: AI_DRAW_APP_ID.to_string(),
            server_id: SINGLE_INSTANCE_SERVER_ID.to_string(),
            addr: "127.0.0.1:49152".to_string(),
            token: "token".to_string(),
            pid: 123,
            updated_at: 456,
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
    fn validates_dynamic_instance_state_identity() {
        assert!(is_valid_instance_state(&valid_state()));

        let mut wrong_app = valid_state();
        wrong_app.app_id = "other".to_string();
        assert!(!is_valid_instance_state(&wrong_app));

        let mut wrong_addr = valid_state();
        wrong_addr.addr = "0.0.0.0:49152".to_string();
        assert!(!is_valid_instance_state(&wrong_addr));

        let mut empty_token = valid_state();
        empty_token.token = " ".to_string();
        assert!(!is_valid_instance_state(&empty_token));
    }

    #[test]
    fn maps_forwarded_actions_without_closing_standalone_launches() {
        assert_eq!(forwarded_action(&fw_args("toggle", false)), "show");
        assert_eq!(forwarded_action(&fw_args("hide", false)), "hide");
        assert_eq!(forwarded_action(&fw_args("close", false)), "show");
        assert_eq!(forwarded_action(&fw_args("close", true)), "close");
    }
}
