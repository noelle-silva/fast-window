use crate::plugins::is_safe_id;
use crate::tasks::executor::execute_task;
use crate::tasks::kinds;
use crate::tasks::model::{
    is_task_finished, normalize_task_meta, TaskCreateReq, TaskRecord, TaskStatus, TaskSummary,
};
use crate::tasks::state::{
    lock_handles, lock_tasks, trim_plugin_task_records, trim_task_records, TaskManagerState,
};
use crate::tasks::util::make_task_id;
use serde_json::Value;
use std::sync::Arc;
use tauri::Manager;

#[tauri::command]
pub(crate) fn task_create(
    app: tauri::AppHandle,
    plugin_id: String,
    req: TaskCreateReq,
) -> Result<TaskSummary, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let kind_raw = req.kind.trim().to_string();
    kinds::validate_task_kind(&kind_raw)?;

    let meta = normalize_task_meta(req.meta)?;
    let mut payload = req.payload.unwrap_or(Value::Null);
    payload = kinds::normalize_payload_for_kind(&kind_raw, payload)?;
    kinds::validate_payload_if_supported(&kind_raw, &payload)?;

    let manager = app.state::<Arc<TaskManagerState>>().inner().clone();
    let now = crate::now_ms();
    let task_id = make_task_id();

    let record = TaskRecord {
        id: task_id.clone(),
        plugin_id: plugin_id.clone(),
        kind: kind_raw,
        meta,
        status: TaskStatus::Queued,
        created_at_ms: now,
        updated_at_ms: now,
        started_at_ms: None,
        finished_at_ms: None,
        cancel_requested: false,
        error: None,
        payload,
        result: None,
    };

    {
        let mut tasks = lock_tasks(manager.as_ref())?;
        tasks.insert(task_id.clone(), record.clone());
        trim_plugin_task_records(&mut tasks, &plugin_id);
        trim_task_records(&mut tasks);
    }

    let app_clone = app.clone();
    let manager_clone = manager.clone();
    let handle = tauri::async_runtime::spawn(async move {
        execute_task(app_clone, manager_clone, task_id).await;
    });
    {
        let mut handles = lock_handles(manager.as_ref())?;
        handles.insert(record.id.clone(), handle);
    }

    Ok(record.summary())
}

#[tauri::command]
pub(crate) fn task_get(
    app: tauri::AppHandle,
    plugin_id: String,
    task_id: String,
) -> Result<Option<TaskSummary>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let task_id = task_id.trim();
    if task_id.is_empty() {
        return Ok(None);
    }
    let manager = app.state::<Arc<TaskManagerState>>().inner().clone();
    let tasks = lock_tasks(manager.as_ref())?;
    let item = tasks.get(task_id).filter(|rec| rec.plugin_id == plugin_id);
    Ok(item.map(|rec| rec.summary()))
}

#[tauri::command]
pub(crate) fn task_list(
    app: tauri::AppHandle,
    plugin_id: String,
    limit: Option<usize>,
) -> Result<Vec<TaskSummary>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let max = limit.unwrap_or(20).clamp(1, 200);
    let manager = app.state::<Arc<TaskManagerState>>().inner().clone();
    let tasks = lock_tasks(manager.as_ref())?;

    let mut list: Vec<TaskSummary> = tasks
        .values()
        .filter(|rec| rec.plugin_id == plugin_id)
        .map(|rec| rec.summary())
        .collect();
    list.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    if list.len() > max {
        list.truncate(max);
    }
    Ok(list)
}

#[tauri::command]
pub(crate) fn task_cancel(
    app: tauri::AppHandle,
    plugin_id: String,
    task_id: String,
) -> Result<TaskSummary, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let tid = task_id.trim();
    if tid.is_empty() {
        return Err("taskId 不能为空".to_string());
    }
    let manager = app.state::<Arc<TaskManagerState>>().inner().clone();
    let mut tasks = lock_tasks(manager.as_ref())?;
    let rec = tasks.get_mut(tid).ok_or_else(|| "任务不存在".to_string())?;
    if rec.plugin_id != plugin_id {
        return Err("任务不存在".to_string());
    }
    if is_task_finished(rec.status) {
        return Ok(rec.summary());
    }
    rec.cancel_requested = true;
    rec.updated_at_ms = crate::now_ms();
    if rec.status == TaskStatus::Queued {
        rec.status = TaskStatus::Canceled;
        rec.finished_at_ms = Some(crate::now_ms());
        rec.error = Some("任务已取消".to_string());
        rec.result = None;
        return Ok(rec.summary());
    }
    if rec.status == TaskStatus::Running {
        rec.status = TaskStatus::Canceled;
        rec.finished_at_ms = Some(crate::now_ms());
        rec.error = Some("任务已取消".to_string());
        rec.result = None;

        let handle = {
            let mut handles = lock_handles(manager.as_ref())?;
            handles.remove(tid)
        };
        if let Some(h) = handle {
            h.abort();
        }
    }
    Ok(rec.summary())
}
