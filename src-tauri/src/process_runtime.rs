use crate::plugins::is_safe_id;
use crate::{
    ensure_writable_dir, resolve_plugin_library_dir, resolve_plugin_output_dir, safe_relative_path,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;

const PROCESSES_TOTAL_LIMIT: usize = 128;
const PROCESSES_PER_PLUGIN_LIMIT: usize = 16;

const DEFAULT_MAX_OUTPUT_BYTES: usize = 512 * 1024; // per stream
const MAX_MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024; // per stream

static PROCESS_ID_SEQ: AtomicU32 = AtomicU32::new(0);

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ProcessState {
    Running,
    Exited,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessSpawnRes {
    pub(crate) process_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) pid: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessKillRes {
    pub(crate) requested: bool,
    pub(crate) already_exited: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessWaitRes {
    pub(crate) process_id: String,
    pub(crate) state: ProcessState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) stdout_truncated: bool,
    pub(crate) stderr_truncated: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessRunRes {
    pub(crate) exit_code: Option<i32>,
    pub(crate) timed_out: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) stdout_truncated: bool,
    pub(crate) stderr_truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessSpawnReq {
    pub(crate) command: String,
    #[serde(default)]
    pub(crate) args: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) cwd: Option<String>,
    #[serde(default)]
    pub(crate) env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub(crate) max_output_bytes: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessRunReq {
    pub(crate) command: String,
    #[serde(default)]
    pub(crate) args: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) cwd: Option<String>,
    #[serde(default)]
    pub(crate) env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub(crate) timeout_ms: Option<u64>,
    #[serde(default)]
    pub(crate) max_output_bytes: Option<usize>,
}

#[derive(Default)]
pub(crate) struct ProcessManagerState {
    processes: Mutex<HashMap<String, Arc<ProcessEntry>>>,
}

struct OutputBuf {
    bytes: Vec<u8>,
    truncated: bool,
}

impl OutputBuf {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            truncated: false,
        }
    }

    fn push(&mut self, chunk: &[u8], max: usize) {
        if self.truncated {
            return;
        }
        if max == 0 {
            self.truncated = true;
            return;
        }
        let remain = max.saturating_sub(self.bytes.len());
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

    fn to_string_lossy(&self) -> String {
        String::from_utf8_lossy(&self.bytes).to_string()
    }
}

#[derive(Clone)]
struct ExitInfo {
    exit_code: Option<i32>,
}

struct ProcessEntry {
    id: String,
    plugin_id: String,
    created_at_ms: u64,
    child: AsyncMutex<Option<Child>>,
    exit: Mutex<Option<ExitInfo>>,
    stdout: Arc<Mutex<OutputBuf>>,
    stderr: Arc<Mutex<OutputBuf>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

fn make_process_id(plugin_id: &str) -> String {
    let seq = PROCESS_ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("proc-{plugin_id}-{}-{seq}", now_ms())
}

fn sanitize_command(command: &str) -> Result<String, String> {
    let c = command.trim();
    if c.is_empty() {
        return Err("process.command 不能为空".to_string());
    }
    if c.len() > 512 {
        return Err("process.command 过长".to_string());
    }
    if c.contains('\n') || c.contains('\r') {
        return Err("process.command 不允许换行".to_string());
    }
    Ok(c.to_string())
}

fn sanitize_args(args: Option<Vec<String>>) -> Result<Vec<String>, String> {
    const MAX_ARGS: usize = 64;
    const MAX_ARG_LEN: usize = 2048;

    let mut out: Vec<String> = Vec::new();
    for raw in args.unwrap_or_default().into_iter() {
        let a = raw.trim().to_string();
        if a.is_empty() {
            continue;
        }
        if a.len() > MAX_ARG_LEN {
            return Err("process.args 单个参数过长".to_string());
        }
        if a.contains('\n') || a.contains('\r') {
            return Err("process.args 不允许换行".to_string());
        }
        out.push(a);
        if out.len() > MAX_ARGS {
            return Err("process.args 参数过多".to_string());
        }
    }
    Ok(out)
}

fn sanitize_env(env: Option<HashMap<String, String>>) -> Result<HashMap<String, String>, String> {
    const MAX_ENV: usize = 64;
    const MAX_KEY_LEN: usize = 128;
    const MAX_VAL_LEN: usize = 4096;

    let mut out = HashMap::new();
    let Some(env) = env else {
        return Ok(out);
    };
    for (k0, v0) in env.into_iter() {
        let k = k0.trim().to_string();
        if k.is_empty() {
            continue;
        }
        if k.len() > MAX_KEY_LEN {
            return Err("process.env key 过长".to_string());
        }
        if k.contains('\n') || k.contains('\r') || k.contains('\0') || k.contains('=') {
            return Err("process.env key 不合法".to_string());
        }
        let v = v0.to_string();
        if v.len() > MAX_VAL_LEN {
            return Err("process.env value 过长".to_string());
        }
        if v.contains('\0') {
            return Err("process.env value 不合法".to_string());
        }
        out.insert(k, v);
        if out.len() > MAX_ENV {
            return Err("process.env 变量过多".to_string());
        }
    }
    Ok(out)
}

fn resolve_max_output_bytes(max_output_bytes: Option<usize>) -> usize {
    max_output_bytes
        .unwrap_or(DEFAULT_MAX_OUTPUT_BYTES)
        .clamp(0, MAX_MAX_OUTPUT_BYTES)
}

fn path_is_within(child: &Path, parent: &Path) -> bool {
    // 注意：这里用 components 比较，避免简单 starts_with 在大小写/分隔符上产生误判。
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

fn resolve_process_cwd(
    app: &AppHandle,
    plugin_id: &str,
    cwd: Option<String>,
) -> Result<PathBuf, String> {
    // 默认：插件 outputDir（更安全 + 可写）
    let base = resolve_plugin_output_dir(app, plugin_id);
    ensure_writable_dir(&base)?;

    let raw = cwd.unwrap_or_default();
    let s = raw.trim();
    if s.is_empty() {
        return Ok(base);
    }

    let p = PathBuf::from(s);
    if p.is_absolute() {
        if !p.is_dir() {
            return Err("process.cwd 不是目录或不存在".to_string());
        }
        // 绝对路径：仅允许落在 outputDir / libraryDir 下（最小治理，避免随意跑到系统目录）
        let out = canonicalize_or_same(&base);
        let lib = {
            let p = resolve_plugin_library_dir(app, plugin_id);
            let _ = ensure_writable_dir(&p);
            canonicalize_or_same(&p)
        };
        let target = canonicalize_or_same(&p);

        if path_is_within(&target, &out) || path_is_within(&target, &lib) {
            return Ok(target);
        }
        return Err("process.cwd 不允许超出插件工作目录范围（output/library）".to_string());
    }

    // 相对路径：限定在 outputDir 内，并且拒绝 .. 等穿越
    let rel = safe_relative_path(s).map_err(|_| "process.cwd 相对路径不合法".to_string())?;
    let full = base.join(rel);
    std::fs::create_dir_all(&full).map_err(|e| format!("创建 process.cwd 目录失败: {e}"))?;
    ensure_writable_dir(&full)?;
    Ok(full)
}

async fn read_to_buf(
    mut reader: impl tokio::io::AsyncRead + Unpin,
    buf: Arc<Mutex<OutputBuf>>,
    max_bytes: usize,
) {
    let mut chunk = vec![0u8; 8192];
    loop {
        let n = match reader.read(&mut chunk).await {
            Ok(0) => return,
            Ok(n) => n,
            Err(_) => return,
        };
        if let Ok(mut g) = buf.lock() {
            g.push(&chunk[..n], max_bytes);
        }
    }
}

fn trim_records(map: &mut HashMap<String, Arc<ProcessEntry>>) {
    if map.len() <= PROCESSES_TOTAL_LIMIT {
        return;
    }
    // 简单策略：优先删已退出的旧记录；仍超限则再删更旧的（保底）
    let mut ids: Vec<(u64, String, bool)> = map
        .values()
        .map(|e| {
            let exited = e.exit.lock().ok().map(|x| x.is_some()).unwrap_or(false);
            (e.created_at_ms, e.id.clone(), exited)
        })
        .collect();
    ids.sort_by(|a, b| a.0.cmp(&b.0));

    for (_, id, exited) in ids.into_iter() {
        if map.len() <= PROCESSES_TOTAL_LIMIT {
            break;
        }
        if exited {
            map.remove(&id);
        }
    }
    // 还超限：继续按最旧删
    while map.len() > PROCESSES_TOTAL_LIMIT {
        if let Some((_, id)) = map
            .values()
            .map(|e| (e.created_at_ms, e.id.clone()))
            .min_by(|a, b| a.0.cmp(&b.0))
        {
            map.remove(&id);
        } else {
            break;
        }
    }
}

fn count_running_for_plugin(map: &HashMap<String, Arc<ProcessEntry>>, plugin_id: &str) -> usize {
    map.values()
        .filter(|e| e.plugin_id == plugin_id)
        .filter(|e| e.exit.lock().ok().map(|x| x.is_none()).unwrap_or(true))
        .count()
}

pub(crate) fn process_spawn(
    app: &AppHandle,
    manager: Arc<ProcessManagerState>,
    plugin_id: String,
    req: ProcessSpawnReq,
) -> Result<ProcessSpawnRes, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let command = sanitize_command(&req.command)?;
    let args = sanitize_args(req.args)?;
    let env = sanitize_env(req.env)?;
    let max_output_bytes = resolve_max_output_bytes(req.max_output_bytes);
    let cwd = resolve_process_cwd(app, &plugin_id, req.cwd)?;

    let mut cmd = Command::new(&command);
    cmd.args(args);
    cmd.current_dir(cwd);
    if !env.is_empty() {
        cmd.envs(env);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动进程失败: {e}"))?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let process_id = make_process_id(&plugin_id);
    let stdout_buf = Arc::new(Mutex::new(OutputBuf::new()));
    let stderr_buf = Arc::new(Mutex::new(OutputBuf::new()));
    let entry = Arc::new(ProcessEntry {
        id: process_id.clone(),
        plugin_id: plugin_id.clone(),
        created_at_ms: now_ms(),
        child: AsyncMutex::new(Some(child)),
        exit: Mutex::new(None),
        stdout: stdout_buf.clone(),
        stderr: stderr_buf.clone(),
    });

    // 绑定 stdout/stderr 读取任务（读到 EOF 即结束，不依赖 wait 调用）
    if let Some(out) = stdout {
        let buf = stdout_buf.clone();
        let max = max_output_bytes;
        tauri::async_runtime::spawn(async move { read_to_buf(out, buf, max).await });
    }
    if let Some(err) = stderr {
        let buf = stderr_buf.clone();
        let max = max_output_bytes;
        tauri::async_runtime::spawn(async move { read_to_buf(err, buf, max).await });
    }

    // 退出探测：不强依赖前端调用 wait（否则会泄漏记录 & 影响并发上限）。
    {
        let entry_reap = entry.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if entry_reap
                    .exit
                    .lock()
                    .ok()
                    .map(|x| x.is_some())
                    .unwrap_or(false)
                {
                    return;
                }
                let mut found: Option<ExitInfo> = None;
                {
                    let mut g = entry_reap.child.lock().await;
                    if let Some(ch) = g.as_mut() {
                        if let Ok(Some(st)) = ch.try_wait() {
                            found = Some(ExitInfo {
                                exit_code: st.code(),
                            });
                            let _ = g.take();
                        }
                    }
                }
                if let Some(exit) = found {
                    {
                        let mut g = entry_reap.exit.lock().unwrap_or_else(|e| e.into_inner());
                        *g = Some(exit);
                    }
                    // 给 reader 一点点时间把尾巴读完（注意：不要持锁 await）
                    tokio::time::sleep(Duration::from_millis(30)).await;
                    return;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        });
    }

    {
        let mut map = manager
            .processes
            .lock()
            .map_err(|_| "进程状态锁定失败".to_string())?;
        // 先清理一下已退出的记录（按需）
        trim_records(&mut map);
        if count_running_for_plugin(&map, &plugin_id) >= PROCESSES_PER_PLUGIN_LIMIT {
            return Err("该插件同时运行的进程过多，请先 wait/kill 并清理".to_string());
        }
        map.insert(process_id.clone(), entry);
        trim_records(&mut map);
    }

    Ok(ProcessSpawnRes { process_id, pid })
}

pub(crate) async fn process_kill(
    manager: Arc<ProcessManagerState>,
    plugin_id: String,
    process_id: String,
) -> Result<ProcessKillRes, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let pid = process_id.trim().to_string();
    if pid.is_empty() {
        return Err("processId 不能为空".to_string());
    }
    let entry = {
        let map = manager
            .processes
            .lock()
            .map_err(|_| "进程状态锁定失败".to_string())?;
        map.get(&pid).cloned()
    }
    .ok_or_else(|| "进程不存在".to_string())?;
    if entry.plugin_id != plugin_id {
        return Err("进程不存在".to_string());
    }
    let already_exited = entry.exit.lock().ok().map(|x| x.is_some()).unwrap_or(false);
    if already_exited {
        return Ok(ProcessKillRes {
            requested: false,
            already_exited: true,
        });
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

    Ok(ProcessKillRes {
        requested,
        already_exited: false,
    })
}

pub(crate) async fn process_wait(
    manager: Arc<ProcessManagerState>,
    plugin_id: String,
    process_id: String,
    timeout_ms: Option<u64>,
    forget: Option<bool>,
) -> Result<ProcessWaitRes, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let pid = process_id.trim().to_string();
    if pid.is_empty() {
        return Err("processId 不能为空".to_string());
    }
    let entry = {
        let map = manager
            .processes
            .lock()
            .map_err(|_| "进程状态锁定失败".to_string())?;
        map.get(&pid).cloned()
    }
    .ok_or_else(|| "进程不存在".to_string())?;
    if entry.plugin_id != plugin_id {
        return Err("进程不存在".to_string());
    }

    let deadline = timeout_ms
        .filter(|ms| *ms > 0)
        .map(|ms| tokio::time::Instant::now() + Duration::from_millis(ms));

    loop {
        if let Some(exit) = entry.exit.lock().ok().and_then(|g| g.as_ref().cloned()) {
            let (stdout, stdout_truncated) = {
                let g = entry.stdout.lock().unwrap_or_else(|e| e.into_inner());
                (g.to_string_lossy(), g.truncated)
            };
            let (stderr, stderr_truncated) = {
                let g = entry.stderr.lock().unwrap_or_else(|e| e.into_inner());
                (g.to_string_lossy(), g.truncated)
            };

            if forget.unwrap_or(false) {
                let mut map = manager
                    .processes
                    .lock()
                    .map_err(|_| "进程状态锁定失败".to_string())?;
                map.remove(&pid);
            }

            return Ok(ProcessWaitRes {
                process_id: pid,
                state: ProcessState::Exited,
                exit_code: exit.exit_code,
                stdout,
                stderr,
                stdout_truncated,
                stderr_truncated,
            });
        }

        let mut found_exit: Option<ExitInfo> = None;
        {
            let mut g = entry.child.lock().await;
            if let Some(ch) = g.as_mut() {
                match ch.try_wait() {
                    Ok(Some(st)) => {
                        let code = st.code();
                        found_exit = Some(ExitInfo { exit_code: code });
                        // 释放 child 句柄，避免后续重复 kill/wait
                        let _ = g.take();
                    }
                    Ok(None) => {}
                    Err(_) => {}
                }
            }
        }

        if let Some(exit) = found_exit {
            {
                let mut g = entry.exit.lock().unwrap_or_else(|e| e.into_inner());
                *g = Some(exit);
            }
            // 退出后给一点时间让 stdout/stderr reader 收尾（最小治理）
            tokio::time::sleep(Duration::from_millis(30)).await;
            continue;
        }

        if let Some(dl) = deadline {
            if tokio::time::Instant::now() >= dl {
                let (stdout, stdout_truncated) = {
                    let g = entry.stdout.lock().unwrap_or_else(|e| e.into_inner());
                    (g.to_string_lossy(), g.truncated)
                };
                let (stderr, stderr_truncated) = {
                    let g = entry.stderr.lock().unwrap_or_else(|e| e.into_inner());
                    (g.to_string_lossy(), g.truncated)
                };
                return Ok(ProcessWaitRes {
                    process_id: pid,
                    state: ProcessState::Running,
                    exit_code: None,
                    stdout,
                    stderr,
                    stdout_truncated,
                    stderr_truncated,
                });
            }
        }

        tokio::time::sleep(Duration::from_millis(60)).await;
    }
}

pub(crate) async fn process_run(
    app: &AppHandle,
    plugin_id: String,
    req: ProcessRunReq,
) -> Result<ProcessRunRes, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let command = sanitize_command(&req.command)?;
    let args = sanitize_args(req.args)?;
    let env = sanitize_env(req.env)?;
    let max_output_bytes = resolve_max_output_bytes(req.max_output_bytes);
    let cwd = resolve_process_cwd(app, &plugin_id, req.cwd)?;
    let timeout_ms = req.timeout_ms.filter(|ms| *ms > 0).unwrap_or(0);

    let mut cmd = Command::new(&command);
    cmd.args(args);
    cmd.current_dir(cwd);
    if !env.is_empty() {
        cmd.envs(env);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动进程失败: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let out_buf = Arc::new(Mutex::new(OutputBuf::new()));
    let err_buf = Arc::new(Mutex::new(OutputBuf::new()));

    let out_task = stdout.map(|out| {
        let buf = out_buf.clone();
        tauri::async_runtime::spawn(async move { read_to_buf(out, buf, max_output_bytes).await })
    });
    let err_task = stderr.map(|err| {
        let buf = err_buf.clone();
        tauri::async_runtime::spawn(async move { read_to_buf(err, buf, max_output_bytes).await })
    });

    let mut timed_out = false;
    let exit_code: Option<i32> = if timeout_ms > 0 {
        match tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await {
            Ok(Ok(st)) => st.code(),
            Ok(Err(e)) => return Err(format!("等待进程退出失败: {e}")),
            Err(_) => {
                timed_out = true;
                let _ = child.start_kill();
                match tokio::time::timeout(Duration::from_millis(1200), child.wait()).await {
                    Ok(Ok(st)) => st.code(),
                    _ => None,
                }
            }
        }
    } else {
        child
            .wait()
            .await
            .map_err(|e| format!("等待进程退出失败: {e}"))?
            .code()
    };

    if let Some(h) = out_task {
        let _ = tokio::time::timeout(Duration::from_millis(500), h).await;
    }
    if let Some(h) = err_task {
        let _ = tokio::time::timeout(Duration::from_millis(500), h).await;
    }

    let (stdout, stdout_truncated) = {
        let g = out_buf.lock().unwrap_or_else(|e| e.into_inner());
        (g.to_string_lossy(), g.truncated)
    };
    let (stderr, stderr_truncated) = {
        let g = err_buf.lock().unwrap_or_else(|e| e.into_inner());
        (g.to_string_lossy(), g.truncated)
    };

    Ok(ProcessRunRes {
        exit_code,
        timed_out,
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
    })
}
