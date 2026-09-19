//! 商店安装/更新任务：宿主侧的任务状态机。
//!
//! 职责边界：
//! - 本模块拥有「一次商店操作」的生命周期（阶段、进度、取消、结果），并把状态
//!   通过事件广播给任意界面；
//! - 下载、解压、写入安装等物理动作仍由 `app_installer` 提供；
//! - 取消信号与进度上报通过 `PackageTaskObserver` 注入物理动作，而不是让物理
//!   动作反向依赖任务模型。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::app_installer::{
    self, AppStoreInstallRequest, AppStoreUpdateRequest, ExtractedAppPackage, PackageTaskObserver,
    TASK_CANCELED_MESSAGE,
};
use crate::app_lifecycle::{stop_registered_app_for_update, AppLifecycleManager};
use crate::host_primitives::emit_toast;
use crate::{is_safe_id, now_ms};

pub(crate) const STORE_TASKS_CHANGED_EVENT: &str = "fast-window:app-store-tasks-changed";

/// 进度事件的最小节流间隔；阶段与结束状态不受节流，始终即时广播。
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(120);

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StoreTaskAction {
    Install,
    Update,
}

impl StoreTaskAction {
    fn label(self) -> &'static str {
        match self {
            Self::Install => "安装",
            Self::Update => "更新",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StoreTaskPhase {
    Downloading,
    Extracting,
    Applying,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StoreTaskStatus {
    Running,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoreTaskProgress {
    done: u64,
    total: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoreTaskSnapshot {
    app_id: String,
    app_name: String,
    action: StoreTaskAction,
    phase: StoreTaskPhase,
    status: StoreTaskStatus,
    cancel_requested: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<StoreTaskProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    started_at_ms: u64,
    updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    finished_at_ms: Option<u64>,
}

/// 任务事件载荷：更新携带任务快照，清除携带被移除的条目 id，两者互斥。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoreTasksChangedPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    task: Option<StoreTaskSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    removed_app_id: Option<String>,
}

struct StoreTaskEntry {
    snapshot: StoreTaskSnapshot,
    cancel: Arc<AtomicBool>,
    last_progress_emit: Option<Instant>,
}

/// 任务注册表：按应用 id 索引，同一条目同时只允许一个进行中任务。
/// 已结束任务保留到用户清除或同条目新任务替换为止。
#[derive(Default)]
pub(crate) struct StoreTaskManager {
    tasks: Mutex<HashMap<String, StoreTaskEntry>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoreTaskStartRequest {
    action: StoreTaskAction,
    url: String,
    expected_sha256: String,
    expected_id: String,
    expected_version: String,
    app_name: String,
    #[serde(default)]
    install_dir: Option<String>,
}

/// 启动前的完整执行计划：准备阶段失败会在创建任务之前直接返回错误。
struct StoreTaskPlan {
    app_id: String,
    app_name: String,
    action: StoreTaskAction,
    install_req: AppStoreInstallRequest,
    app_container: PathBuf,
    existing_record: Option<Value>,
    registry_id: Option<String>,
}

fn build_plan(app: &AppHandle, req: StoreTaskStartRequest) -> Result<StoreTaskPlan, String> {
    let app_name = req.app_name.trim().to_string();
    if app_name.is_empty() {
        return Err("appName 不能为空".to_string());
    }

    match req.action {
        StoreTaskAction::Install => {
            let install_dir = req
                .install_dir
                .map(|dir| dir.trim().to_string())
                .filter(|dir| !dir.is_empty())
                .ok_or_else(|| "installDir 不能为空".to_string())?;
            let prepared = app_installer::prepare_install_target(
                app,
                AppStoreInstallRequest {
                    url: req.url,
                    expected_sha256: req.expected_sha256,
                    expected_id: req.expected_id,
                    expected_version: req.expected_version,
                    install_dir,
                },
            )?;
            Ok(StoreTaskPlan {
                app_id: prepared.req.expected_id.clone(),
                app_name,
                action: StoreTaskAction::Install,
                install_req: prepared.req,
                app_container: prepared.app_container,
                existing_record: None,
                registry_id: None,
            })
        }
        StoreTaskAction::Update => {
            let prepared = app_installer::prepare_update_target(
                app,
                AppStoreUpdateRequest {
                    url: req.url,
                    expected_sha256: req.expected_sha256,
                    expected_id: req.expected_id,
                    expected_version: req.expected_version,
                },
            )?;
            Ok(StoreTaskPlan {
                app_id: prepared.install_req.expected_id.clone(),
                app_name,
                action: StoreTaskAction::Update,
                install_req: prepared.install_req,
                app_container: prepared.app_container,
                existing_record: Some(prepared.existing_record),
                registry_id: Some(prepared.registry_id),
            })
        }
    }
}

impl StoreTaskManager {
    fn lock_tasks(&self) -> Result<MutexGuard<'_, HashMap<String, StoreTaskEntry>>, String> {
        self.tasks
            .lock()
            .map_err(|_| "商店任务状态锁定失败".to_string())
    }

    fn begin(&self, app: &AppHandle, plan: &StoreTaskPlan) -> Result<StoreTaskSnapshot, String> {
        let now = now_ms();
        let mut tasks = self.lock_tasks()?;
        if let Some(existing) = tasks.get(&plan.app_id) {
            if existing.snapshot.status == StoreTaskStatus::Running {
                return Err(format!("{} 已有进行中的任务", plan.app_name));
            }
        }
        let snapshot = StoreTaskSnapshot {
            app_id: plan.app_id.clone(),
            app_name: plan.app_name.clone(),
            action: plan.action,
            phase: StoreTaskPhase::Downloading,
            status: StoreTaskStatus::Running,
            cancel_requested: false,
            progress: None,
            error: None,
            started_at_ms: now,
            updated_at_ms: now,
            finished_at_ms: None,
        };
        tasks.insert(
            plan.app_id.clone(),
            StoreTaskEntry {
                snapshot: snapshot.clone(),
                cancel: Arc::new(AtomicBool::new(false)),
                last_progress_emit: None,
            },
        );
        drop(tasks);
        emit_task_changed(app, snapshot.clone());
        Ok(snapshot)
    }

    fn cancel(&self, app: &AppHandle, app_id: &str) -> Result<StoreTaskSnapshot, String> {
        let mut tasks = self.lock_tasks()?;
        let entry = tasks
            .get_mut(app_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if entry.snapshot.status != StoreTaskStatus::Running {
            return Err("任务已结束，无法取消".to_string());
        }
        if entry.snapshot.phase == StoreTaskPhase::Applying {
            return Err("正在写入文件，无法取消".to_string());
        }
        if !entry.snapshot.cancel_requested {
            entry.snapshot.cancel_requested = true;
            entry.snapshot.updated_at_ms = now_ms();
            entry.cancel.store(true, Ordering::Relaxed);
            let snapshot = entry.snapshot.clone();
            drop(tasks);
            emit_task_changed(app, snapshot.clone());
            return Ok(snapshot);
        }
        Ok(entry.snapshot.clone())
    }

    fn set_phase(&self, app: &AppHandle, app_id: &str, phase: StoreTaskPhase) {
        let snapshot = match self.lock_tasks() {
            Ok(mut tasks) => match tasks.get_mut(app_id) {
                Some(entry) if entry.snapshot.status == StoreTaskStatus::Running => {
                    entry.snapshot.phase = phase;
                    entry.snapshot.progress = None;
                    entry.snapshot.updated_at_ms = now_ms();
                    entry.last_progress_emit = None;
                    Some(entry.snapshot.clone())
                }
                _ => None,
            },
            Err(_) => None,
        };
        if let Some(snapshot) = snapshot {
            emit_task_changed(app, snapshot);
        }
    }

    fn report_progress(&self, app: &AppHandle, app_id: &str, done: u64, total: Option<u64>) {
        let now = Instant::now();
        let mut snapshot = None;
        match self.lock_tasks() {
            Ok(mut tasks) => {
                let Some(entry) = tasks.get_mut(app_id) else {
                    return;
                };
                if entry.snapshot.status != StoreTaskStatus::Running {
                    return;
                }
                entry.snapshot.progress = Some(StoreTaskProgress { done, total });
                entry.snapshot.updated_at_ms = now_ms();
                let due = match entry.last_progress_emit {
                    None => true,
                    Some(last) => now.duration_since(last) >= PROGRESS_EMIT_INTERVAL,
                };
                if due {
                    entry.last_progress_emit = Some(now);
                    snapshot = Some(entry.snapshot.clone());
                }
            }
            Err(_) => return,
        }
        if let Some(snapshot) = snapshot {
            emit_task_changed(app, snapshot);
        }
    }

    fn finish(
        &self,
        app: &AppHandle,
        app_id: &str,
        status: StoreTaskStatus,
        error: Option<String>,
    ) {
        let snapshot = match self.lock_tasks() {
            Ok(mut tasks) => match tasks.get_mut(app_id) {
                Some(entry) => {
                    entry.snapshot.status = status;
                    entry.snapshot.error = error;
                    entry.snapshot.progress = None;
                    let now = now_ms();
                    entry.snapshot.updated_at_ms = now;
                    entry.snapshot.finished_at_ms = Some(now);
                    Some(entry.snapshot.clone())
                }
                None => None,
            },
            Err(_) => None,
        };
        if let Some(snapshot) = snapshot {
            emit_task_changed(app, snapshot);
        }
    }

    fn list(&self) -> Vec<StoreTaskSnapshot> {
        match self.lock_tasks() {
            Ok(tasks) => tasks
                .values()
                .map(|entry| entry.snapshot.clone())
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    fn dismiss(&self, app: &AppHandle, app_id: &str) -> Result<(), String> {
        let mut tasks = self.lock_tasks()?;
        let entry = tasks
            .get(app_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if entry.snapshot.status == StoreTaskStatus::Running {
            return Err("任务进行中，无法清除".to_string());
        }
        tasks.remove(app_id);
        drop(tasks);
        emit_tasks_changed(
            app,
            StoreTasksChangedPayload {
                task: None,
                removed_app_id: Some(app_id.to_string()),
            },
        );
        Ok(())
    }

    fn cancel_flag(&self, app_id: &str) -> Option<Arc<AtomicBool>> {
        self.lock_tasks()
            .ok()?
            .get(app_id)
            .map(|entry| entry.cancel.clone())
    }
}

fn emit_task_changed(app: &AppHandle, task: StoreTaskSnapshot) {
    emit_tasks_changed(
        app,
        StoreTasksChangedPayload {
            task: Some(task),
            removed_app_id: None,
        },
    );
}

fn emit_tasks_changed(app: &AppHandle, payload: StoreTasksChangedPayload) {
    let _ = app.emit(STORE_TASKS_CHANGED_EVENT, payload);
}

fn normalize_task_app_id(raw: &str) -> Result<String, String> {
    let id = raw.trim().to_string();
    if !is_safe_id(&id) {
        return Err("appId 不合法".to_string());
    }
    Ok(id)
}

fn ensure_not_canceled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err(TASK_CANCELED_MESSAGE.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn app_store_task_start(
    app: AppHandle,
    manager: tauri::State<'_, Arc<StoreTaskManager>>,
    lifecycle: tauri::State<'_, Arc<AppLifecycleManager>>,
    req: StoreTaskStartRequest,
) -> Result<StoreTaskSnapshot, String> {
    let plan = build_plan(&app, req)?;
    let manager = manager.inner().clone();
    let snapshot = manager.begin(&app, &plan)?;
    let lifecycle = lifecycle.inner().clone();
    tauri::async_runtime::spawn(run_store_task(app, manager, lifecycle, plan));
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn app_store_task_cancel(
    app: AppHandle,
    manager: tauri::State<'_, Arc<StoreTaskManager>>,
    app_id: String,
) -> Result<StoreTaskSnapshot, String> {
    let id = normalize_task_app_id(&app_id)?;
    manager.inner().cancel(&app, &id)
}

#[tauri::command]
pub(crate) fn app_store_task_list(
    manager: tauri::State<'_, Arc<StoreTaskManager>>,
) -> Vec<StoreTaskSnapshot> {
    manager.inner().list()
}

#[tauri::command]
pub(crate) fn app_store_task_dismiss(
    app: AppHandle,
    manager: tauri::State<'_, Arc<StoreTaskManager>>,
    app_id: String,
) -> Result<(), String> {
    let id = normalize_task_app_id(&app_id)?;
    manager.inner().dismiss(&app, &id)
}

async fn run_store_task(
    app: AppHandle,
    manager: Arc<StoreTaskManager>,
    lifecycle: Arc<AppLifecycleManager>,
    plan: StoreTaskPlan,
) {
    let app_id = plan.app_id.clone();
    let Some(cancel) = manager.cancel_flag(&app_id) else {
        return;
    };
    let observer = PackageTaskObserver::new(cancel.clone(), {
        let app = app.clone();
        let manager = manager.clone();
        let app_id = app_id.clone();
        Arc::new(move |done, total| manager.report_progress(&app, &app_id, done, total))
    });

    let result = run_store_task_steps(&app, &manager, &lifecycle, &plan, &observer, &cancel).await;

    match result {
        Ok(()) => {
            manager.finish(&app, &app_id, StoreTaskStatus::Succeeded, None);
            emit_toast(
                &app,
                format!("已{}应用：{}", plan.action.label(), plan.app_name),
            );
        }
        Err(_) if cancel.load(Ordering::Relaxed) => {
            manager.finish(&app, &app_id, StoreTaskStatus::Canceled, None);
        }
        Err(error) => {
            manager.finish(&app, &app_id, StoreTaskStatus::Failed, Some(error.clone()));
            emit_toast(
                &app,
                format!(
                    "应用{}失败：{}（{}）",
                    plan.action.label(),
                    plan.app_name,
                    error
                ),
            );
        }
    }
}

async fn run_store_task_steps(
    app: &AppHandle,
    manager: &Arc<StoreTaskManager>,
    lifecycle: &Arc<AppLifecycleManager>,
    plan: &StoreTaskPlan,
    observer: &PackageTaskObserver,
    cancel: &AtomicBool,
) -> Result<(), String> {
    ensure_not_canceled(cancel)?;
    manager.set_phase(app, &plan.app_id, StoreTaskPhase::Downloading);
    let zip_path = app_installer::download_app_package(&plan.install_req, observer).await?;
    ensure_not_canceled(cancel)?;

    manager.set_phase(app, &plan.app_id, StoreTaskPhase::Extracting);
    let extract_result = spawn_extract(plan, observer, zip_path.clone()).await;
    let _ = tokio::fs::remove_file(&zip_path).await;
    let package = extract_result?;
    ensure_not_canceled(cancel)?;

    manager.set_phase(app, &plan.app_id, StoreTaskPhase::Applying);
    if let Some(registry_id) = plan.registry_id.as_deref() {
        let _ = stop_registered_app_for_update(lifecycle, registry_id).await?;
    }
    app_installer::install_extracted_app_package(
        app,
        package,
        plan.app_container.clone(),
        plan.existing_record.clone(),
    )
    .await?;
    Ok(())
}

async fn spawn_extract(
    plan: &StoreTaskPlan,
    observer: &PackageTaskObserver,
    zip_path: PathBuf,
) -> Result<ExtractedAppPackage, String> {
    let apps_dir = PathBuf::from(plan.install_req.install_dir.trim());
    let expected_id = plan.install_req.expected_id.clone();
    let expected_version = plan.install_req.expected_version.clone();
    let observer = observer.clone();
    tokio::task::spawn_blocking(move || {
        app_installer::extract_app_package(
            &apps_dir,
            &zip_path,
            &expected_id,
            &expected_version,
            &observer,
        )
    })
    .await
    .map_err(|_| "安装应用失败: 后台任务异常退出".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_serializes_to_frontend_contract() {
        let snapshot = StoreTaskSnapshot {
            app_id: "demo-app".to_string(),
            app_name: "Demo".to_string(),
            action: StoreTaskAction::Install,
            phase: StoreTaskPhase::Downloading,
            status: StoreTaskStatus::Running,
            cancel_requested: false,
            progress: Some(StoreTaskProgress {
                done: 512,
                total: Some(2048),
            }),
            error: None,
            started_at_ms: 1,
            updated_at_ms: 2,
            finished_at_ms: None,
        };

        let value = serde_json::to_value(&snapshot).expect("快照应可序列化");
        assert_eq!(value["appId"], "demo-app");
        assert_eq!(value["action"], "install");
        assert_eq!(value["phase"], "downloading");
        assert_eq!(value["status"], "running");
        assert_eq!(value["cancelRequested"], false);
        assert_eq!(value["progress"]["done"], 512);
        assert_eq!(value["progress"]["total"], 2048);
        assert!(value.get("error").is_none());
        assert!(value.get("finishedAtMs").is_none());
    }

    #[test]
    fn changed_payload_removes_task() {
        let payload = StoreTasksChangedPayload {
            task: None,
            removed_app_id: Some("demo-app".to_string()),
        };
        let value = serde_json::to_value(&payload).expect("载荷应可序列化");
        assert_eq!(value["removedAppId"], "demo-app");
        assert!(value.get("task").is_none());
    }
}
