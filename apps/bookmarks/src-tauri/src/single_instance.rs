use std::sync::Arc;

use crate::control_server::{post_control_request, start_control_server, ControlServerConfig};
use crate::fw_window::{FwArgs, FwWindowState};

const SINGLE_INSTANCE_ADDR: &str = "127.0.0.1:45631";
const SINGLE_INSTANCE_TOKEN: &str = "fast-window-bookmarks-single-instance-v1";

pub(crate) fn forward_to_existing_instance(args: &FwArgs) -> bool {
    if matches!(args.action.as_str(), "close") {
        return false;
    }
    let action = if args.action == "hide" {
        args.action.as_str()
    } else {
        "show"
    };
    post_control_request(
        SINGLE_INSTANCE_ADDR,
        SINGLE_INSTANCE_TOKEN,
        action,
        args.command.as_deref(),
    )
}

pub(crate) fn start_single_instance_server(
    app: tauri::AppHandle,
    window_state: Arc<FwWindowState>,
) -> Result<(), String> {
    start_control_server(
        app,
        window_state,
        ControlServerConfig {
            name: "fw-bookmarks-single-instance",
            bind_addr: SINGLE_INSTANCE_ADDR,
            token: SINGLE_INSTANCE_TOKEN.to_string(),
            announce_to_stdout: false,
        },
    )
    .map(|_| ())
}
