use crate::plugins::is_safe_id;
use crate::{app_plugins_dir, ensure_writable_dir, resolve_plugin_library_dir, resolve_plugin_output_dir, safe_relative_path};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

const DEFAULT_MAX_LOG_BYTES: usize = 256 * 1024;
const BACKEND_ARGS_LIMIT: usize = 32;
const BACKEND_ARG_LEN_LIMIT: usize = 2048;
const BACKEND_INVOKE_TIMEOUT_MS: u64 = 30_000;
const BACKEND_PENDING_LIMIT: usize = 128;

static BACKEND_RPC_SEQ: AtomicU32 = AtomicU32::new(0);

#[derive(Default)]
pub(crate) struct PluginBackendManagerState {
    entries: Mutex<HashMap<String, Arc<PluginBackendEntry>>>,
}

impl Drop for PluginBackendManagerState {
    fn drop(&mut self) {
        let entries: Vec<Arc<PluginBackendEntry>> = self
            .entries
            .lock()
            .map(|g| g.values().cloned().collect())
            .unwrap_or_default();
        for entry in entries {
            if let Ok(mut child) = entry.child.try_lock() {
                if let Some(ch) = child.as_mut() {
                    let _ = ch.start_kill();
                }
            }
        }
    }
}

struct LogBuf {
    bytes: Vec<u8>,
    truncated: bool,
}

impl LogBuf {
    fn new() -> Self {
        Self { bytes: Vec::new(), truncated: false }
    }

    fn push(&mut self, chunk: &[u8]) {
        if self.truncated {
            return;
        }
        let remain = DEFAULT_MAX_LOG_BYTES.saturating_sub(self.bytes.len());
        if remain == 0 {
            self.truncated = true;
            return;
        }
        if chunk.len() <= remain {
            self.bytes.extend_from_slice(chunk);
            return;
        }
        self.bytes.extend_from_slice(&chunk[..remain]);
        self.truncated = true;
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes).to_string()
    }
}

struct PluginBackendEntry {
    pid: Option<u32>,
    started_at_ms: u64,
    child: AsyncMutex<Option<Child>>,
    stdin: AsyncMutex<Option<tokio::process::ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<BackendRpcResult>>>>,
    exit_code: Mutex<Option<i32>>,
    stdout: Arc<Mutex<LogBuf>>,
    stderr: Arc<Mutex<LogBuf>>,
}

type BackendRpcResult = Result<Value, String>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginBackendStartReq {
    pub(crate) plugin_id: String,
    pub(crate) main: String,
    #[serde(default)]
    pub(crate) args: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) cwd: Option<String>,
    #[serde(default)]
    pub(crate) env: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginBackendStartRes {
    pub(crate) started: bool,
    pub(crate) pid: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginBackendStopRes {
    pub(crate) requested: bool,
    pub(crate) already_stopped: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginBackendStatusRes {
    pub(crate) running: bool,
    pub(crate) pid: Option<u32>,
    pub(crate) started_at_ms: Option<u64>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) stdout_truncated: bool,
    pub(crate) stderr_truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginBackendInvokeReq {
    pub(crate) plugin_id: String,
    pub(crate) method: String,
    #[serde(default)]
    pub(crate) params: Value,
    #[serde(default)]
    pub(crate) timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginBackendInvokeRes {
    pub(crate) result: Value,
}

#[derive(Deserialize)]
struct BackendRpcResponse {
    id: String,
    #[serde(default)]
    ok: Option<bool>,
    #[serde(default)]
    result: Value,
    #[serde(default)]
    error: Option<Value>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

fn plugin_dir(app: &AppHandle, plugin_id: &str) -> PathBuf {
    app_plugins_dir(app).join(plugin_id)
}

fn path_is_within(child: &Path, parent: &Path) -> bool {
    let mut c_it = child.components();
    let mut p_it = parent.components();
    loop {
        match p_it.next() {
            None => return true,
            Some(p) => match c_it.next() {
                None => return false,
                Some(c) => {
                    if c != p {
                        return false;
                    }
                }
            },
        }
    }
}

fn canonicalize_or_same(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn resolve_backend_main(app: &AppHandle, plugin_id: &str, main: &str) -> Result<PathBuf, String> {
    let rel = safe_relative_path(main).map_err(|_| "background.main 路径不合法".to_string())?;
    let root = plugin_dir(app, plugin_id);
    let full = root.join(rel);
    if !full.is_file() {
        return Err("background.main 文件不存在".to_string());
    }
    Ok(full)
}

fn resolve_backend_cwd(app: &AppHandle, plugin_id: &str, cwd: Option<String>) -> Result<PathBuf, String> {
    let plugin_root = plugin_dir(app, plugin_id);
    let raw = cwd.unwrap_or_default();
    let s = raw.trim();
    if s.is_empty() {
        return Ok(plugin_root);
    }

    let p = PathBuf::from(s);
    if p.is_absolute() {
        if !p.is_dir() {
            return Err("background.cwd 不是目录或不存在".to_string());
        }
        let target = canonicalize_or_same(&p);
        let plugin_root = canonicalize_or_same(&plugin_root);
        let output = canonicalize_or_same(&resolve_plugin_output_dir(app, plugin_id));
        let library = canonicalize_or_same(&resolve_plugin_library_dir(app, plugin_id));
        if path_is_within(&target, &plugin_root) || path_is_within(&target, &output) || path_is_within(&target, &library) {
            return Ok(target);
        }
        return Err("background.cwd 不允许超出插件目录/output/library".to_string());
    }

    let rel = safe_relative_path(s).map_err(|_| "background.cwd 相对路径不合法".to_string())?;
    let full = plugin_root.join(rel);
    std::fs::create_dir_all(&full).map_err(|e| format!("创建 background.cwd 失败: {e}"))?;
    ensure_writable_dir(&full)?;
    Ok(full)
}

fn sanitize_args(args: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for raw in args.unwrap_or_default() {
        if raw.len() > BACKEND_ARG_LEN_LIMIT {
            return Err("background.args 单个参数过长".to_string());
        }
        if raw.contains('\n') || raw.contains('\r') || raw.contains('\0') {
            return Err("background.args 参数不合法".to_string());
        }
        out.push(raw);
        if out.len() > BACKEND_ARGS_LIMIT {
            return Err("background.args 参数过多".to_string());
        }
    }
    Ok(out)
}

fn sanitize_env(env: Option<HashMap<String, String>>) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    for (k, v) in env.unwrap_or_default() {
        let key = k.trim().to_string();
        if key.is_empty() || key.len() > 128 || key.contains('\n') || key.contains('\r') || key.contains('\0') || key.contains('=') {
            return Err("background.env key 不合法".to_string());
        }
        if v.len() > 4096 || v.contains('\0') {
            return Err("background.env value 不合法".to_string());
        }
        out.insert(key, v);
    }
    Ok(out)
}

fn runtime_exe_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn bundled_node_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let node_exe = runtime_exe_name("node");
    let candidates = [
        app.path().resource_dir().ok().map(|p| p.join("runtimes").join("node").join(&node_exe)),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("runtimes").join("node").join(&node_exe))),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtimes").join("node").join(&node_exe)),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "宿主内置 Node runtime 不存在：请随宿主分发 runtimes/node/{node_exe}；不会回退到系统 Node"
    ))
}

fn command_for_main(app: &AppHandle, main: &Path) -> Result<(String, Vec<String>), String> {
    let ext = main.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
    if ext == "js" || ext == "mjs" || ext == "cjs" {
        let node = bundled_node_runtime(app)?;
        return Ok((node.to_string_lossy().to_string(), vec![main.to_string_lossy().to_string()]));
    }
    Ok((main.to_string_lossy().to_string(), Vec::new()))
}

async fn read_to_log(mut reader: impl tokio::io::AsyncRead + Unpin, buf: Arc<Mutex<LogBuf>>) {
    let mut chunk = vec![0u8; 8192];
    loop {
        let n = match reader.read(&mut chunk).await {
            Ok(0) => return,
            Ok(n) => n,
            Err(_) => return,
        };
        if let Ok(mut g) = buf.lock() {
            g.push(&chunk[..n]);
        }
    }
}

fn rpc_error_to_string(error: Value) -> String {
    if let Some(s) = error.as_str() {
        return s.to_string();
    }
    if let Some(message) = error.get("message").and_then(|v| v.as_str()) {
        return message.to_string();
    }
    error.to_string()
}

async fn read_stdout_protocol(
    stdout: tokio::process::ChildStdout,
    log: Arc<Mutex<LogBuf>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<BackendRpcResult>>>>,
) {
    let mut reader = BufReader::new(stdout).lines();
    loop {
        let line = match reader.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => return,
            Err(_) => return,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(resp) = serde_json::from_str::<BackendRpcResponse>(trimmed) {
            let tx = pending.lock().ok().and_then(|mut g| g.remove(&resp.id));
            if let Some(tx) = tx {
                let result = match (resp.ok, resp.error) {
                    (Some(false), Some(error)) => Err(rpc_error_to_string(error)),
                    (Some(false), None) => Err("插件后端请求失败".to_string()),
                    (_, Some(error)) => Err(rpc_error_to_string(error)),
                    _ => Ok(resp.result),
                };
                let _ = tx.send(result);
                continue;
            }
        }
        if let Ok(mut g) = log.lock() {
            g.push(line.as_bytes());
            g.push(b"\n");
        }
    }
}

pub(crate) fn plugin_backend_start(
    app: &AppHandle,
    manager: Arc<PluginBackendManagerState>,
    req: PluginBackendStartReq,
) -> Result<PluginBackendStartRes, String> {
    let plugin_id = req.plugin_id.trim().to_string();
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    if let Some(existing) = manager.entries.lock().map_err(|_| "后端状态锁定失败".to_string())?.get(&plugin_id).cloned() {
        let exited = existing.exit_code.lock().ok().and_then(|g| *g).is_some();
        if !exited {
            return Ok(PluginBackendStartRes { started: false, pid: existing.pid });
        }
    }

    let main = resolve_backend_main(app, &plugin_id, &req.main)?;
    let cwd = resolve_backend_cwd(app, &plugin_id, req.cwd)?;
    let extra_args = sanitize_args(req.args)?;
    let extra_env = sanitize_env(req.env)?;
    let (command, mut args) = command_for_main(app, &main)?;
    args.extend(extra_args);

    let output_dir = resolve_plugin_output_dir(app, &plugin_id);
    let library_dir = resolve_plugin_library_dir(app, &plugin_id);
    let _ = ensure_writable_dir(&output_dir);
    let _ = ensure_writable_dir(&library_dir);

    let mut cmd = Command::new(command);
    cmd.args(args);
    cmd.current_dir(cwd);
    cmd.env("FAST_WINDOW_PLUGIN_ID", &plugin_id);
    cmd.env("FAST_WINDOW_PLUGIN_DIR", plugin_dir(app, &plugin_id));
    cmd.env("FAST_WINDOW_PLUGIN_OUTPUT_DIR", output_dir);
    cmd.env("FAST_WINDOW_PLUGIN_LIBRARY_DIR", library_dir);
    if !extra_env.is_empty() {
        cmd.envs(extra_env);
    }
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动插件后端失败: {e}"))?;
    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_buf = Arc::new(Mutex::new(LogBuf::new()));
    let stderr_buf = Arc::new(Mutex::new(LogBuf::new()));
    let pending: Arc<Mutex<HashMap<String, oneshot::Sender<BackendRpcResult>>>> = Arc::new(Mutex::new(HashMap::new()));
    if let Some(out) = stdout {
        let buf = stdout_buf.clone();
        let pending = pending.clone();
        tauri::async_runtime::spawn(async move { read_stdout_protocol(out, buf, pending).await });
    }
    if let Some(err) = stderr {
        let buf = stderr_buf.clone();
        tauri::async_runtime::spawn(async move { read_to_log(err, buf).await });
    }

    let entry = Arc::new(PluginBackendEntry {
        pid,
        started_at_ms: now_ms(),
        child: AsyncMutex::new(Some(child)),
        stdin: AsyncMutex::new(stdin),
        pending: pending.clone(),
        exit_code: Mutex::new(None),
        stdout: stdout_buf,
        stderr: stderr_buf,
    });


    {
        let entry_reap = entry.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let mut found = None;
                {
                    let mut g = entry_reap.child.lock().await;
                    if let Some(ch) = g.as_mut() {
                        if let Ok(Some(st)) = ch.try_wait() {
                            found = Some(st.code());
                            let _ = g.take();
                        }
                    } else {
                        return;
                    }
                }
                if let Some(code) = found {
                    if let Ok(mut g) = entry_reap.exit_code.lock() {
                        *g = code;
                    }
                    return;
                }
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
        });
    }

    manager.entries.lock().map_err(|_| "后端状态锁定失败".to_string())?.insert(plugin_id, entry);
    Ok(PluginBackendStartRes { started: true, pid })
}

pub(crate) async fn plugin_backend_stop(
    manager: Arc<PluginBackendManagerState>,
    plugin_id: String,
) -> Result<PluginBackendStopRes, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let entry = manager.entries.lock().map_err(|_| "后端状态锁定失败".to_string())?.get(&plugin_id).cloned();
    let Some(entry) = entry else {
        return Ok(PluginBackendStopRes { requested: false, already_stopped: true });
    };

    if entry.exit_code.lock().ok().and_then(|g| *g).is_some() {
        manager.entries.lock().map_err(|_| "后端状态锁定失败".to_string())?.remove(&plugin_id);
        return Ok(PluginBackendStopRes { requested: false, already_stopped: true });
    }

    let mut requested = false;
    {
        let mut g = entry.child.lock().await;
        if let Some(ch) = g.as_mut() {
            if ch.start_kill().is_ok() {
                requested = true;
            }
        }
    }
    manager.entries.lock().map_err(|_| "后端状态锁定失败".to_string())?.remove(&plugin_id);
    Ok(PluginBackendStopRes { requested, already_stopped: false })
}

pub(crate) fn plugin_backend_status(
    manager: Arc<PluginBackendManagerState>,
    plugin_id: String,
) -> Result<PluginBackendStatusRes, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let entry = manager.entries.lock().map_err(|_| "后端状态锁定失败".to_string())?.get(&plugin_id).cloned();
    let Some(entry) = entry else {
        return Ok(PluginBackendStatusRes {
            running: false,
            pid: None,
            started_at_ms: None,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            stdout_truncated: false,
            stderr_truncated: false,
        });
    };
    let exit_code = entry.exit_code.lock().ok().and_then(|g| *g);
    let (stdout, stdout_truncated) = entry.stdout.lock().map(|g| (g.text(), g.truncated)).unwrap_or_default();
    let (stderr, stderr_truncated) = entry.stderr.lock().map(|g| (g.text(), g.truncated)).unwrap_or_default();
    Ok(PluginBackendStatusRes {
        running: exit_code.is_none(),
        pid: entry.pid,
        started_at_ms: Some(entry.started_at_ms),
        exit_code,
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
    })
}

pub(crate) async fn plugin_backend_invoke(
    manager: Arc<PluginBackendManagerState>,
    req: PluginBackendInvokeReq,
) -> Result<PluginBackendInvokeRes, String> {
    let plugin_id = req.plugin_id.trim().to_string();
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let method = req.method.trim().to_string();
    if method.is_empty() || method.len() > 256 || method.contains('\n') || method.contains('\r') {
        return Err("background.invoke method 不合法".to_string());
    }
    let entry = manager
        .entries
        .lock()
        .map_err(|_| "后端状态锁定失败".to_string())?
        .get(&plugin_id)
        .cloned()
        .ok_or_else(|| "插件后端未运行".to_string())?;

    if entry.exit_code.lock().ok().and_then(|g| *g).is_some() {
        return Err("插件后端已退出".to_string());
    }

    let id = format!("rpc-{}-{}", now_ms(), BACKEND_RPC_SEQ.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel::<BackendRpcResult>();
    {
        let mut pending = entry.pending.lock().map_err(|_| "后端请求状态锁定失败".to_string())?;
        if pending.len() >= BACKEND_PENDING_LIMIT {
            return Err("插件后端待处理请求过多".to_string());
        }
        pending.insert(id.clone(), tx);
    }

    let frame = serde_json::json!({
        "id": id,
        "method": method,
        "params": req.params,
    });
    let line = serde_json::to_vec(&frame).map_err(|e| format!("序列化后端请求失败: {e}"))?;

    let write_res = {
        let mut stdin = entry.stdin.lock().await;
        let Some(stdin) = stdin.as_mut() else {
            return Err("插件后端 stdin 不可用".to_string());
        };
        match stdin.write_all(&line).await {
            Ok(()) => match stdin.write_all(b"\n").await {
                Ok(()) => stdin.flush().await,
                Err(e) => Err(e),
            },
            Err(e) => Err(e),
        }
    };
    if let Err(e) = write_res {
        if let Ok(mut pending) = entry.pending.lock() {
            pending.remove(&id);
        }
        return Err(format!("写入插件后端请求失败: {e}"));
    }

    let timeout_ms = req.timeout_ms.unwrap_or(BACKEND_INVOKE_TIMEOUT_MS).clamp(1_000, 15 * 60 * 1000);
    match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
        Ok(Ok(Ok(result))) => Ok(PluginBackendInvokeRes { result }),
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(_)) => Err("插件后端响应通道关闭".to_string()),
        Err(_) => {
            if let Ok(mut pending) = entry.pending.lock() {
                pending.remove(&id);
            }
            Err("插件后端请求超时".to_string())
        }
    }
}
