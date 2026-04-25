use std::sync::Arc;
use tauri::AppHandle;
use tauri::Manager;

/// v3 稳定的 process 命令入口（Rust 宿主侧）。
///
/// 设计目标：
/// - 对前端提供稳定命令名，不直接暴露历史遗留 command 名
/// - 保留 v2 兼容：旧命令仍存在，但复用同一套底层实现
/// - 子进程执行框架下沉到 Rust：v3 所需的 run/spawn/kill/wait 最小闭环

#[tauri::command]
pub(crate) fn process_open_external_url(url: String) -> Result<(), String> {
    crate::os_actions::open_external_url(url)
}

#[tauri::command]
pub(crate) fn process_open_external_uri(uri: String) -> Result<(), String> {
    crate::os_actions::open_external_uri(uri)
}

#[tauri::command]
pub(crate) async fn process_open_browser_window(
    app: AppHandle,
    url: String,
    plugin_id: String,
) -> Result<(), String> {
    crate::open_browser_window_impl(app, url, plugin_id).await
}

#[tauri::command]
pub(crate) async fn process_run(
    app: AppHandle,
    plugin_id: String,
    req: crate::process_runtime::ProcessRunReq,
) -> Result<crate::process_runtime::ProcessRunRes, String> {
    crate::process_runtime::process_run(&app, plugin_id, req).await
}

#[tauri::command]
pub(crate) fn process_spawn(
    app: AppHandle,
    plugin_id: String,
    req: crate::process_runtime::ProcessSpawnReq,
) -> Result<crate::process_runtime::ProcessSpawnRes, String> {
    let manager = app
        .state::<Arc<crate::process_runtime::ProcessManagerState>>()
        .inner()
        .clone();
    crate::process_runtime::process_spawn(&app, manager, plugin_id, req)
}

#[tauri::command]
pub(crate) async fn process_kill(
    app: AppHandle,
    plugin_id: String,
    process_id: String,
) -> Result<crate::process_runtime::ProcessKillRes, String> {
    let manager = app
        .state::<Arc<crate::process_runtime::ProcessManagerState>>()
        .inner()
        .clone();
    crate::process_runtime::process_kill(manager, plugin_id, process_id).await
}

#[tauri::command]
pub(crate) async fn process_wait(
    app: AppHandle,
    plugin_id: String,
    process_id: String,
    timeout_ms: Option<u64>,
    forget: Option<bool>,
) -> Result<crate::process_runtime::ProcessWaitRes, String> {
    let manager = app
        .state::<Arc<crate::process_runtime::ProcessManagerState>>()
        .inner()
        .clone();
    crate::process_runtime::process_wait(manager, plugin_id, process_id, timeout_ms, forget).await
}
