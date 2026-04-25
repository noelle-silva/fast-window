use crate::tasks::kinds;
use crate::tasks::model::TaskStatus;
use crate::tasks::state::TaskManagerState;
use std::sync::Arc;

pub(crate) async fn execute_task(
    app: tauri::AppHandle,
    manager: Arc<TaskManagerState>,
    task_id: String,
) {
    struct HandleCleanup {
        manager: Arc<TaskManagerState>,
        task_id: String,
    }
    impl Drop for HandleCleanup {
        fn drop(&mut self) {
            if let Ok(mut handles) = self.manager.handles.lock() {
                handles.remove(&self.task_id);
            }
        }
    }

    let _cleanup = HandleCleanup {
        manager: manager.clone(),
        task_id: task_id.clone(),
    };

    let (plugin_id, kind, payload, cancel_requested) = {
        let mut tasks = match manager.tasks.lock() {
            Ok(v) => v,
            Err(_) => return,
        };
        let Some(rec) = tasks.get_mut(&task_id) else {
            return;
        };
        if rec.status != TaskStatus::Queued {
            return;
        }
        rec.status = TaskStatus::Running;
        rec.started_at_ms = Some(crate::now_ms());
        rec.updated_at_ms = crate::now_ms();
        // payload 可能很大（例如 JSON 内嵌 base64）。任务开始后就不再需要保留它，避免内存长期占用。
        let payload = std::mem::take(&mut rec.payload);
        (
            rec.plugin_id.clone(),
            rec.kind.clone(),
            payload,
            rec.cancel_requested,
        )
    };

    if cancel_requested {
        let mut tasks = match manager.tasks.lock() {
            Ok(v) => v,
            Err(_) => return,
        };
        if let Some(rec) = tasks.get_mut(&task_id) {
            rec.status = TaskStatus::Canceled;
            rec.updated_at_ms = crate::now_ms();
            rec.finished_at_ms = Some(crate::now_ms());
            rec.error = Some("任务已取消".to_string());
        }
        return;
    }

    let result = kinds::run_task_kind(
        &app,
        manager.clone(),
        task_id.clone(),
        plugin_id,
        kind,
        payload,
    )
    .await;

    let mut tasks = match manager.tasks.lock() {
        Ok(v) => v,
        Err(_) => return,
    };
    if let Some(rec) = tasks.get_mut(&task_id) {
        rec.updated_at_ms = crate::now_ms();
        rec.finished_at_ms = Some(crate::now_ms());
        if rec.cancel_requested {
            rec.status = TaskStatus::Canceled;
            rec.error = Some("任务已取消".to_string());
            rec.result = None;
            return;
        }
        match result {
            Ok(value) => {
                rec.status = TaskStatus::Succeeded;
                rec.error = None;
                rec.result = Some(value);
            }
            Err(err) => {
                rec.status = TaskStatus::Failed;
                rec.error = Some(err);
                rec.result = None;
            }
        }
    }
}
