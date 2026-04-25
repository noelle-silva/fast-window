use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TaskStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskMeta {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) tags: Vec<String>,
}

pub(crate) fn normalize_task_meta(meta: Option<TaskMeta>) -> Result<Option<TaskMeta>, String> {
    const MAX_TAGS: usize = 16;
    const MAX_TAG_LEN: usize = 64;

    let Some(meta) = meta else {
        return Ok(None);
    };

    let mut out: Vec<String> = Vec::new();
    for raw in meta.tags.into_iter() {
        let t = raw.trim();
        if t.is_empty() {
            continue;
        }
        if t.len() > MAX_TAG_LEN {
            return Err("task.meta.tags 单个 tag 过长".to_string());
        }
        if t.contains('\n') || t.contains('\r') {
            return Err("task.meta.tags tag 不允许换行".to_string());
        }
        if !out.iter().any(|x| x == t) {
            out.push(t.to_string());
        }
        if out.len() > MAX_TAGS {
            return Err("task.meta.tags tag 过多".to_string());
        }
    }

    if out.is_empty() {
        return Ok(None);
    }

    Ok(Some(TaskMeta { tags: out }))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskSummary {
    pub(crate) id: String,
    pub(crate) plugin_id: String,
    pub(crate) kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) meta: Option<TaskMeta>,
    pub(crate) status: TaskStatus,
    pub(crate) created_at_ms: u64,
    pub(crate) updated_at_ms: u64,
    pub(crate) started_at_ms: Option<u64>,
    pub(crate) finished_at_ms: Option<u64>,
    pub(crate) cancel_requested: bool,
    pub(crate) error: Option<String>,
    pub(crate) result: Option<Value>,
}

#[derive(Clone)]
pub(crate) struct TaskRecord {
    pub(crate) id: String,
    pub(crate) plugin_id: String,
    pub(crate) kind: String,
    pub(crate) meta: Option<TaskMeta>,
    pub(crate) status: TaskStatus,
    pub(crate) created_at_ms: u64,
    pub(crate) updated_at_ms: u64,
    pub(crate) started_at_ms: Option<u64>,
    pub(crate) finished_at_ms: Option<u64>,
    pub(crate) cancel_requested: bool,
    pub(crate) error: Option<String>,
    pub(crate) payload: Value,
    pub(crate) result: Option<Value>,
}

impl TaskRecord {
    pub(crate) fn summary(&self) -> TaskSummary {
        TaskSummary {
            id: self.id.clone(),
            plugin_id: self.plugin_id.clone(),
            kind: self.kind.clone(),
            meta: self.meta.clone(),
            status: self.status,
            created_at_ms: self.created_at_ms,
            updated_at_ms: self.updated_at_ms,
            started_at_ms: self.started_at_ms,
            finished_at_ms: self.finished_at_ms,
            cancel_requested: self.cancel_requested,
            error: self.error.clone(),
            result: self.result.clone(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskCreateReq {
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) payload: Option<Value>,
    #[serde(default)]
    pub(crate) meta: Option<TaskMeta>,
}

pub(crate) fn is_task_finished(status: TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Succeeded | TaskStatus::Failed | TaskStatus::Canceled
    )
}

