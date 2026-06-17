use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, oneshot},
};

use crate::{
    selection_capture::SelectionCapture,
    toolbar_display::{ToolbarDisplayMode, ToolbarDisplayModeState},
    toolbar_window::{self, ToolbarState},
};

#[cfg(all(target_os = "windows", not(debug_assertions)))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const CURRENT_SELECTION_TIMEOUT_MS: u64 = 1500;

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

#[derive(Clone)]
struct SelectionEvidence {
    capture: SelectionCapture,
    program_name: String,
}

struct CurrentSelectionText {
    text: String,
    program_name: String,
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
    CurrentSelection {
        #[serde(rename = "requestId")]
        request_id: u64,
        text: Option<String>,
        #[serde(default, rename = "programName")]
        program_name: String,
    },
    CurrentSelectionError {
        #[serde(rename = "requestId")]
        request_id: u64,
        message: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectionWorkerRequest {
    #[serde(rename = "type")]
    request_type: &'static str,
    request_id: u64,
}

enum SelectionWorkerCommand {
    CurrentSelection {
        request_id: u64,
        responder: oneshot::Sender<Result<Option<CurrentSelectionText>, String>>,
    },
}

pub(crate) struct SelectionObserverState {
    next_request_id: AtomicU64,
    command_sender: Mutex<Option<mpsc::UnboundedSender<SelectionWorkerCommand>>>,
    pending_requests:
        Mutex<HashMap<u64, oneshot::Sender<Result<Option<CurrentSelectionText>, String>>>>,
    latest_evidence: Mutex<Option<SelectionEvidence>>,
}

impl Default for SelectionObserverState {
    fn default() -> Self {
        Self {
            next_request_id: AtomicU64::new(1),
            command_sender: Mutex::new(None),
            pending_requests: Mutex::new(HashMap::new()),
            latest_evidence: Mutex::new(None),
        }
    }
}

impl SelectionObserverState {
    pub(crate) async fn current_capture(&self) -> Result<Option<SelectionCapture>, String> {
        let Some(current) = self.current_selection_text().await? else {
            self.clear_latest_evidence()?;
            return Ok(None);
        };
        let evidence = self.latest_evidence()?;
        let Some(evidence) = evidence else {
            return Ok(None);
        };
        if evidence.capture.text == current.text && evidence.program_name == current.program_name {
            return Ok(Some(SelectionCapture {
                text: current.text,
                anchor_x: evidence.capture.anchor_x,
                anchor_y: evidence.capture.anchor_y,
            }));
        }
        self.clear_latest_evidence()?;
        Ok(None)
    }

    fn remember_observed_selection(
        &self,
        capture: SelectionCapture,
        program_name: String,
    ) -> Result<(), String> {
        let mut latest = self
            .latest_evidence
            .lock()
            .map_err(|_| "取词位置状态锁定失败".to_string())?;
        *latest = Some(SelectionEvidence {
            capture,
            program_name,
        });
        Ok(())
    }

    fn latest_evidence(&self) -> Result<Option<SelectionEvidence>, String> {
        self.latest_evidence
            .lock()
            .map(|latest| latest.clone())
            .map_err(|_| "取词位置状态锁定失败".to_string())
    }

    fn clear_latest_evidence(&self) -> Result<(), String> {
        let mut latest = self
            .latest_evidence
            .lock()
            .map_err(|_| "取词位置状态锁定失败".to_string())?;
        *latest = None;
        Ok(())
    }

    async fn current_selection_text(&self) -> Result<Option<CurrentSelectionText>, String> {
        let sender = self
            .command_sender
            .lock()
            .map_err(|_| "取词小帮手命令状态锁定失败".to_string())?
            .clone()
            .ok_or_else(|| "取词小帮手尚未就绪".to_string())?;
        let request_id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let (responder, receiver) = oneshot::channel();
        sender
            .send(SelectionWorkerCommand::CurrentSelection {
                request_id,
                responder,
            })
            .map_err(|_| "取词小帮手命令通道不可用".to_string())?;
        tokio::time::timeout(
            Duration::from_millis(CURRENT_SELECTION_TIMEOUT_MS),
            receiver,
        )
        .await
        .map_err(|_| {
            let _ = self.remove_pending_request(request_id);
            "取词小帮手响应超时".to_string()
        })?
        .map_err(|_| "取词小帮手响应通道已关闭".to_string())?
    }

    fn set_command_sender(
        &self,
        sender: mpsc::UnboundedSender<SelectionWorkerCommand>,
    ) -> Result<(), String> {
        let mut current = self
            .command_sender
            .lock()
            .map_err(|_| "取词小帮手命令状态锁定失败".to_string())?;
        *current = Some(sender);
        Ok(())
    }

    fn remove_pending_request(
        &self,
        request_id: u64,
    ) -> Result<Option<oneshot::Sender<Result<Option<CurrentSelectionText>, String>>>, String> {
        self.pending_requests
            .lock()
            .map(|mut pending| pending.remove(&request_id))
            .map_err(|_| "取词小帮手响应状态锁定失败".to_string())
    }

    fn complete_current_selection(
        &self,
        request_id: u64,
        result: Result<Option<CurrentSelectionText>, String>,
    ) -> Result<(), String> {
        if let Some(responder) = self.remove_pending_request(request_id)? {
            let _ = responder.send(result);
        }
        Ok(())
    }
}

pub(crate) fn install(
    app: tauri::AppHandle,
    observer_state: Arc<SelectionObserverState>,
    toolbar_state: Arc<ToolbarState>,
    display_mode_state: Arc<ToolbarDisplayModeState>,
) {
    match spawn_worker() {
        Ok((mut child, stdout, stdin)) => {
            if let Err(error) = spawn_stdin_writer(observer_state.clone(), stdin) {
                eprintln!("[quick-bar] 统一取词路线命令通道启动失败: {error}");
            }
            spawn_stdout_reader(
                app,
                observer_state,
                toolbar_state,
                display_mode_state,
                stdout,
            );
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

fn spawn_worker() -> Result<(Child, ChildStdout, ChildStdin), String> {
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
    cmd.stdin(std::process::Stdio::piped());
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
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "取词小帮手 stdin 不可用".to_string())?;
    Ok((child, stdout, stdin))
}

fn spawn_stdin_writer(
    observer_state: Arc<SelectionObserverState>,
    mut stdin: ChildStdin,
) -> Result<(), String> {
    let (sender, mut receiver) = mpsc::unbounded_channel::<SelectionWorkerCommand>();
    observer_state.set_command_sender(sender)?;
    tauri::async_runtime::spawn(async move {
        while let Some(command) = receiver.recv().await {
            match command {
                SelectionWorkerCommand::CurrentSelection {
                    request_id,
                    responder,
                } => {
                    match observer_state.pending_requests.lock() {
                        Ok(mut pending) => {
                            pending.insert(request_id, responder);
                        }
                        Err(_) => {
                            let _ = responder.send(Err("取词小帮手响应状态锁定失败".to_string()));
                            continue;
                        }
                    }
                    let request = SelectionWorkerRequest {
                        request_type: "current-selection",
                        request_id,
                    };
                    let write_result = async {
                        let payload = serde_json::to_string(&request).map_err(|error| {
                            std::io::Error::new(std::io::ErrorKind::Other, error.to_string())
                        })?;
                        stdin.write_all(payload.as_bytes()).await?;
                        stdin.write_all(b"\n").await?;
                        stdin.flush().await
                    }
                    .await;
                    if let Err(error) = write_result {
                        if let Ok(Some(responder)) =
                            observer_state.remove_pending_request(request_id)
                        {
                            let _ = responder.send(Err(format!("发送取词请求失败: {error}")));
                        }
                    }
                }
            }
        }
    });
    Ok(())
}

fn spawn_stdout_reader(
    app: tauri::AppHandle,
    observer_state: Arc<SelectionObserverState>,
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
                &observer_state,
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
    observer_state: &SelectionObserverState,
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
            if let Err(error) =
                observer_state.remember_observed_selection(capture.clone(), program_name.clone())
            {
                eprintln!("[quick-bar] 记录选区位置失败: {error}");
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
        SelectionWorkerMessage::CurrentSelection {
            request_id,
            text,
            program_name,
        } => {
            let current = text.map(|text| CurrentSelectionText { text, program_name });
            if let Err(error) = observer_state.complete_current_selection(request_id, Ok(current)) {
                eprintln!("[quick-bar] 统一取词路线响应失败: {error}");
            }
        }
        SelectionWorkerMessage::CurrentSelectionError {
            request_id,
            message,
        } => {
            if let Err(error) = observer_state.complete_current_selection(request_id, Err(message))
            {
                eprintln!("[quick-bar] 统一取词路线响应失败: {error}");
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
