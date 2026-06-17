use std::{path::PathBuf, sync::Arc};

use serde::Deserialize;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, ChildStdout, Command},
};

use crate::{
    selection_capture::SelectionCapture,
    toolbar_display::{ToolbarDisplayMode, ToolbarDisplayModeState},
    toolbar_window::{self, ToolbarState},
};

#[cfg(all(target_os = "windows", not(debug_assertions)))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, PartialEq, Eq)]
struct SelectionSignature {
    text: String,
    anchor_x: i32,
    anchor_y: i32,
}

impl SelectionSignature {
    fn from_capture(capture: &SelectionCapture) -> Self {
        Self {
            text: capture.text.clone(),
            anchor_x: capture.anchor_x,
            anchor_y: capture.anchor_y,
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum SelectionWorkerMessage {
    Ready,
    Status {
        status: String,
    },
    Error {
        message: String,
    },
    SelectionMissed {
        reason: String,
        #[serde(default, rename = "programName")]
        program_name: String,
    },
    Selection {
        text: String,
        #[serde(rename = "anchorX")]
        anchor_x: i32,
        #[serde(rename = "anchorY")]
        anchor_y: i32,
        #[serde(default, rename = "programName")]
        program_name: String,
    },
}

pub(crate) fn install(
    app: tauri::AppHandle,
    toolbar_state: Arc<ToolbarState>,
    display_mode_state: Arc<ToolbarDisplayModeState>,
) {
    match spawn_worker() {
        Ok((mut child, stdout)) => {
            spawn_stdout_reader(app, toolbar_state, display_mode_state, stdout);
            tauri::async_runtime::spawn(async move {
                match child.wait().await {
                    Ok(status) => eprintln!("[quick-bar] 统一取词路线已退出: {status}"),
                    Err(error) => eprintln!("[quick-bar] 统一取词路线退出状态读取失败: {error}"),
                }
            });
        }
        Err(error) => eprintln!("[quick-bar] 统一取词路线启动失败: {error}"),
    }
}

fn spawn_worker() -> Result<(Child, ChildStdout), String> {
    let app_dir = resolve_app_dir()?;
    let worker = app_dir.join("scripts").join("selection-hook-worker.cjs");
    if !worker.is_file() {
        return Err(format!("取词小帮手不存在: {}", worker.display()));
    }

    let node =
        std::env::var("QUICK_BAR_SELECTION_HOOK_NODE").unwrap_or_else(|_| "node".to_string());
    let mut cmd = Command::new(node);
    cmd.arg(worker);
    cmd.current_dir(app_dir);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::inherit());
    cmd.kill_on_drop(true);
    hide_worker_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("取词小帮手启动失败: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "取词小帮手 stdout 不可用".to_string())?;
    Ok((child, stdout))
}

fn spawn_stdout_reader(
    app: tauri::AppHandle,
    toolbar_state: Arc<ToolbarState>,
    display_mode_state: Arc<ToolbarDisplayModeState>,
    stdout: ChildStdout,
) {
    tauri::async_runtime::spawn(async move {
        let mut last_signature = None;
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(message) = serde_json::from_str::<SelectionWorkerMessage>(&line) else {
                eprintln!("[quick-bar] 统一取词路线输出不可解析: {line}");
                continue;
            };
            handle_worker_message(
                &app,
                &toolbar_state,
                &display_mode_state,
                &mut last_signature,
                message,
            );
        }
    });
}

fn handle_worker_message(
    app: &tauri::AppHandle,
    toolbar_state: &Arc<ToolbarState>,
    display_mode_state: &ToolbarDisplayModeState,
    last_signature: &mut Option<SelectionSignature>,
    message: SelectionWorkerMessage,
) {
    match message {
        SelectionWorkerMessage::Ready => eprintln!("[quick-bar] 统一取词路线已就绪"),
        SelectionWorkerMessage::Status { status } => {
            eprintln!("[quick-bar] 统一取词路线状态: {status}")
        }
        SelectionWorkerMessage::Error { message } => {
            eprintln!("[quick-bar] 统一取词路线错误: {message}")
        }
        SelectionWorkerMessage::SelectionMissed {
            reason,
            program_name,
        } => {
            eprintln!("[quick-bar] 统一取词路线未接入选区: {program_name} {reason}")
        }
        SelectionWorkerMessage::Selection {
            text,
            anchor_x,
            anchor_y,
            program_name,
        } => {
            let capture = SelectionCapture {
                text,
                anchor_x,
                anchor_y,
            };
            let signature = SelectionSignature::from_capture(&capture);
            if last_signature.as_ref() == Some(&signature) {
                return;
            }
            *last_signature = Some(signature);
            if let Err(error) = toolbar_window::remember_selection(toolbar_state, capture.clone()) {
                eprintln!("[quick-bar] 记录选区失败: {error}");
                return;
            }
            eprintln!("[quick-bar] 已接入选区: {program_name}");
            if display_mode_state.mode() == ToolbarDisplayMode::Automatic {
                if let Err(error) =
                    toolbar_window::show_toolbar_from_capture(app, toolbar_state, capture)
                {
                    eprintln!("[quick-bar] 显示浮动条失败: {error}");
                }
            }
        }
    }
}

fn resolve_app_dir() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Some(dir) = option_env!("CARGO_MANIFEST_DIR") {
        if let Some(app_dir) = PathBuf::from(dir).parent() {
            candidates.push(app_dir.to_path_buf());
        }
    }
    if let Ok(current) = std::env::current_dir() {
        candidates.push(current.join("apps").join("quick-bar"));
        candidates.push(current);
    }

    for candidate in candidates {
        if candidate.join("package.json").is_file()
            && candidate
                .join("scripts")
                .join("selection-hook-worker.cjs")
                .is_file()
        {
            return Ok(candidate);
        }
    }

    Err("没有找到 Quick Bar 取词目录".to_string())
}

fn hide_worker_console(cmd: &mut Command) {
    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(all(target_os = "windows", not(debug_assertions))))]
    {
        let _ = cmd;
    }
}
