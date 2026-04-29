use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
pub(crate) struct AppLauncherState {
    processes: Mutex<HashMap<String, Arc<AppProcessEntry>>>,
}

struct AppProcessEntry {
    pid: u32,
    started_at_ms: u64,
    child: AsyncMutex<Option<Child>>,
    exit_code: Mutex<Option<i32>>,
}

impl Drop for AppLauncherState {
    fn drop(&mut self) {
        let entries: Vec<Arc<AppProcessEntry>> = self
            .processes
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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppStatusResult {
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

impl AppStatusResult {
    fn stopped() -> Self {
        Self {
            running: false,
            pid: None,
            started_at: None,
            exit_code: None,
        }
    }
}

#[tauri::command]
pub(crate) async fn app_launch(
    _app_handle: AppHandle,
    state: tauri::State<'_, Arc<AppLauncherState>>,
    app_id: String,
    exe_path: String,
    args: Vec<String>,
) -> Result<(), String> {
    let id = app_id.trim().to_string();
    if id.is_empty() {
        return Err("appId 不能为空".to_string());
    }
    if id.len() > 128 || id.contains(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_') {
        return Err("appId 不合法".to_string());
    }

    let path = PathBuf::from(exe_path.trim());
    if !path.is_file() {
        return Err(format!("应用文件不存在: {}", path.display()));
    }

    // 检查是否已在运行：已存在且未退出则跳过，只做一次
    if let Ok(g) = state.processes.lock() {
        if let Some(entry) = g.get(&id).cloned() {
            if entry.exit_code.lock().ok().and_then(|c| *c).is_none() {
                // 进程还在运行，不做重复启动
                return Ok(());
            }
        }
    }

    let mut cmd = Command::new(&path);
    cmd.args(&args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    let child = cmd
        .spawn()
        .map_err(|e| format!("启动应用失败: {e}"))?;
    let pid = child.id().unwrap_or(0);
    let started_at_ms = now_ms();

    let entry = Arc::new(AppProcessEntry {
        pid,
        started_at_ms,
        child: AsyncMutex::new(Some(child)),
        exit_code: Mutex::new(None),
    });

    // spawn reaper
    let entry_reap = entry.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let code = {
                let mut g = entry_reap.child.lock().await;
                if let Some(ch) = g.as_mut() {
                    match ch.try_wait() {
                        Ok(Some(st)) => {
                            let code = st.code();
                            let _ = g.take();
                            Some(code)
                        }
                        Ok(None) => None,
                        Err(_) => {
                            let _ = g.take();
                            None
                        }
                    }
                } else {
                    return;
                }
            };
            if let Some(code) = code {
                if let Ok(mut g) = entry_reap.exit_code.lock() {
                    *g = code;
                }
                return;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    });

    if let Ok(mut g) = state.processes.lock() {
        g.insert(id, entry);
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn app_stop(
    state: tauri::State<'_, Arc<AppLauncherState>>,
    app_id: String,
) -> Result<(), String> {
    let id = app_id.trim().to_string();
    if id.is_empty() {
        return Err("appId 不能为空".to_string());
    }

    let entry = state
        .processes
        .lock()
        .map_err(|_| "进程状态锁定失败".to_string())?
        .get(&id)
        .cloned();

    let Some(entry) = entry else {
        return Ok(());
    };

    {
        let mut g = entry.child.lock().await;
        if let Some(ch) = g.as_mut() {
            ch.start_kill()
                .map_err(|e| format!("停止应用失败: {e}"))?;
            let _ = g.take();
        }
    }

    if let Ok(mut g) = state.processes.lock() {
        g.remove(&id);
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn app_status(
    state: tauri::State<'_, Arc<AppLauncherState>>,
    app_id: String,
) -> Result<AppStatusResult, String> {
    let id = app_id.trim().to_string();
    if id.is_empty() {
        return Err("appId 不能为空".to_string());
    }

    let entry = state
        .processes
        .lock()
        .map_err(|_| "进程状态锁定失败".to_string())?
        .get(&id)
        .cloned();

    let Some(entry) = entry else {
        return Ok(AppStatusResult::stopped());
    };

    let exit_code = entry.exit_code.lock().ok().and_then(|c| *c);
    if exit_code.is_some() {
        return Ok(AppStatusResult::stopped());
    }

    Ok(AppStatusResult {
        running: true,
        pid: Some(entry.pid),
        started_at: Some(entry.started_at_ms),
        exit_code: None,
    })
}

#[tauri::command]
pub(crate) fn app_status_many(
    state: tauri::State<'_, Arc<AppLauncherState>>,
    app_ids: Vec<String>,
) -> Result<HashMap<String, AppStatusResult>, String> {
    let mut out = HashMap::new();
    for id in app_ids {
        let id = id.trim().to_string();
        if id.is_empty() {
            continue;
        }
        let status = app_status_inner(&state, &id)?;
        out.insert(id, status);
    }
    Ok(out)
}

fn app_status_inner(
    state: &Arc<AppLauncherState>,
    id: &str,
) -> Result<AppStatusResult, String> {
    let entry = state
        .processes
        .lock()
        .map_err(|_| "进程状态锁定失败".to_string())?
        .get(id)
        .cloned();

    let Some(entry) = entry else {
        return Ok(AppStatusResult::stopped());
    };

    let exit_code = entry.exit_code.lock().ok().and_then(|c| *c);
    if exit_code.is_some() {
        return Ok(AppStatusResult::stopped());
    }

    Ok(AppStatusResult {
        running: true,
        pid: Some(entry.pid),
        started_at: Some(entry.started_at_ms),
        exit_code: None,
    })
}
