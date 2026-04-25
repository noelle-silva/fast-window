use crate::tasks::model::{is_task_finished, TaskRecord};
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

const TASKS_RETENTION_LIMIT: usize = 120;
const TASKS_PER_PLUGIN_LIMIT: usize = 40;

#[derive(Default)]
pub(crate) struct TaskManagerState {
    pub(crate) tasks: Mutex<HashMap<String, TaskRecord>>,
    pub(crate) handles: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}

pub(crate) fn lock_tasks<'a>(
    manager: &'a TaskManagerState,
) -> Result<MutexGuard<'a, HashMap<String, TaskRecord>>, String> {
    manager
        .tasks
        .lock()
        .map_err(|_| "任务状态锁定失败".to_string())
}

pub(crate) fn lock_handles<'a>(
    manager: &'a TaskManagerState,
) -> Result<MutexGuard<'a, HashMap<String, tauri::async_runtime::JoinHandle<()>>>, String> {
    manager
        .handles
        .lock()
        .map_err(|_| "任务状态锁定失败".to_string())
}

pub(crate) fn trim_task_records(tasks: &mut HashMap<String, TaskRecord>) {
    if tasks.len() <= TASKS_RETENTION_LIMIT {
        return;
    }
    let mut all: Vec<(String, u64)> = tasks
        .iter()
        .filter(|(_, rec)| is_task_finished(rec.status))
        .map(|(id, rec)| (id.clone(), rec.updated_at_ms))
        .collect();
    all.sort_by(|a, b| b.1.cmp(&a.1));
    for (idx, (id, _)) in all.into_iter().enumerate() {
        if idx < TASKS_RETENTION_LIMIT {
            continue;
        }
        tasks.remove(&id);
    }
}

pub(crate) fn trim_plugin_task_records(tasks: &mut HashMap<String, TaskRecord>, plugin_id: &str) {
    let mut plugin_items: Vec<(String, u64)> = tasks
        .iter()
        .filter(|(_, rec)| rec.plugin_id == plugin_id && is_task_finished(rec.status))
        .map(|(id, rec)| (id.clone(), rec.updated_at_ms))
        .collect();
    if plugin_items.len() <= TASKS_PER_PLUGIN_LIMIT {
        return;
    }
    plugin_items.sort_by(|a, b| b.1.cmp(&a.1));
    for (idx, (id, _)) in plugin_items.into_iter().enumerate() {
        if idx < TASKS_PER_PLUGIN_LIMIT {
            continue;
        }
        tasks.remove(&id);
    }
}

