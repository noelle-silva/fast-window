use super::*;

use image::codecs::png::PngEncoder;
use image::ColorType;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const TASKS_RETENTION_LIMIT: usize = 120;
const TASKS_PER_PLUGIN_LIMIT: usize = 40;
static TASK_ID_SEQ: AtomicU32 = AtomicU32::new(0);

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
    tags: Vec<String>,
}

fn normalize_task_meta(meta: Option<TaskMeta>) -> Result<Option<TaskMeta>, String> {
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
    id: String,
    plugin_id: String,
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    meta: Option<TaskMeta>,
    status: TaskStatus,
    created_at_ms: u64,
    updated_at_ms: u64,
    started_at_ms: Option<u64>,
    finished_at_ms: Option<u64>,
    cancel_requested: bool,
    error: Option<String>,
    result: Option<Value>,
}

#[derive(Clone)]
struct TaskRecord {
    id: String,
    plugin_id: String,
    kind: String,
    meta: Option<TaskMeta>,
    status: TaskStatus,
    created_at_ms: u64,
    updated_at_ms: u64,
    started_at_ms: Option<u64>,
    finished_at_ms: Option<u64>,
    cancel_requested: bool,
    error: Option<String>,
    payload: Value,
    result: Option<Value>,
}

impl TaskRecord {
    fn summary(&self) -> TaskSummary {
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

#[derive(Default)]
pub(crate) struct TaskManagerState {
    tasks: Mutex<HashMap<String, TaskRecord>>,
    handles: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskCreateReq {
    kind: String,
    #[serde(default)]
    payload: Option<Value>,
    #[serde(default)]
    meta: Option<TaskMeta>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardWatchTaskPayload {
    interval_ms: Option<u64>,
    max_history: Option<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardSnapshotItem {
    r#type: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    time: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardWatchTaskResult {
    items: Vec<ClipboardSnapshotItem>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

fn rand_u32(seed: u64) -> u32 {
    let mut x = (seed as u32).wrapping_mul(1664525).wrapping_add(1013904223);
    x ^= x << 13;
    x ^= x >> 17;
    x ^ (x << 5)
}

fn hash32_sampled_bytes(bytes: &[u8]) -> u32 {
    let n = bytes.len();
    let mut h: u32 = 5381;
    if n > 4096 {
        for &b in &bytes[..2048] {
            h = ((h << 5).wrapping_add(h)) ^ (b as u32);
        }
        for &b in &bytes[(n - 2048)..] {
            h = ((h << 5).wrapping_add(h)) ^ (b as u32);
        }
        return h;
    }
    for &b in bytes {
        h = ((h << 5).wrapping_add(h)) ^ (b as u32);
    }
    h
}

fn make_task_id() -> String {
    let stamp = now_ms();
    let seq = TASK_ID_SEQ.fetch_add(1, Ordering::Relaxed);
    let rnd = format!("{:08x}", rand_u32(stamp ^ (seq as u64)));
    format!("task-{stamp}-{seq:08x}-{rnd}")
}

fn is_task_finished(status: TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Succeeded | TaskStatus::Failed | TaskStatus::Canceled
    )
}

fn trim_task_records(tasks: &mut HashMap<String, TaskRecord>) {
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

fn trim_plugin_task_records(tasks: &mut HashMap<String, TaskRecord>, plugin_id: &str) {
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

fn encode_rgba_to_png_bytes(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("图片尺寸无效".to_string());
    }
    let expect = width as usize * height as usize * 4;
    if rgba.len() != expect {
        return Err("图片数据长度无效".to_string());
    }
    let mut png = Vec::<u8>::new();
    let encoder = PngEncoder::new(&mut png);
    encoder
        .write_image(rgba, width, height, ColorType::Rgba8.into())
        .map_err(|e| format!("PNG 编码失败: {e}"))?;
    Ok(png)
}

struct ClipboardImageSnapshot {
    hash: u32,
    png: Vec<u8>,
}

async fn read_clipboard_snapshot(
    app: &tauri::AppHandle,
) -> Result<(String, Option<ClipboardImageSnapshot>), String> {
    let app_text = app.clone();
    let text = tauri::async_runtime::spawn_blocking(move || {
        app_text.clipboard().read_text().unwrap_or_default()
    })
    .await
    .map_err(|e| format!("读取文本剪贴板失败: {e}"))?;

    let app_image = app.clone();
    let image = tauri::async_runtime::spawn_blocking(move || {
        let image = app_image.clipboard().read_image().ok();
        match image {
            Some(img) => {
                let rgba = img.rgba();
                let hash = hash32_sampled_bytes(rgba);
                let png =
                    encode_rgba_to_png_bytes(rgba, img.width(), img.height()).unwrap_or_default();
                if png.is_empty() {
                    None
                } else {
                    Some(ClipboardImageSnapshot { hash, png })
                }
            }
            None => None,
        }
    })
    .await
    .map_err(|e| format!("读取图片剪贴板失败: {e}"))?;

    Ok((text, image))
}

async fn run_clipboard_watch_task(
    app: &tauri::AppHandle,
    payload: ClipboardWatchTaskPayload,
    manager: Arc<TaskManagerState>,
    task_id: String,
    plugin_id: String,
) -> Result<Value, String> {
    let interval_ms = payload.interval_ms.unwrap_or(1000).clamp(200, 15_000);
    let max_history = payload.max_history.unwrap_or(50).clamp(10, 1000);

    let out_dir = resolve_plugin_output_dir(app, &plugin_id);
    ensure_writable_dir(&out_dir)?;

    let mut items: Vec<ClipboardSnapshotItem> = Vec::new();
    let mut last_text = String::new();
    let mut last_image_hash: u32 = 0;

    loop {
        {
            let tasks = manager
                .tasks
                .lock()
                .map_err(|_| "任务状态锁定失败".to_string())?;
            let Some(rec) = tasks.get(&task_id) else {
                break;
            };
            if rec.cancel_requested {
                break;
            }
            drop(tasks);
        }

        let (text, image) = read_clipboard_snapshot(app).await?;
        let now = now_ms();
        let mut latest_item: Option<ClipboardSnapshotItem> = None;

        let text_trim = text.trim().to_string();
        if text_trim.is_empty() {
            last_text.clear();
        }
        if !text_trim.is_empty() && text_trim != last_text {
            last_text = text_trim.clone();
            let snapshot = ClipboardSnapshotItem {
                r#type: "text".to_string(),
                content: text_trim,
                path: None,
                time: now,
            };
            latest_item = Some(snapshot.clone());
            items.insert(0, snapshot);
            if items.len() > max_history {
                items.truncate(max_history);
            }
        }

        if image.is_none() {
            last_image_hash = 0;
        }
        if let Some(img) = image {
            if img.hash == last_image_hash {
                // same image
            } else {
                last_image_hash = img.hash;
                let hash_hex = format!("{:08x}", img.hash);
                let filename = format!("clipboard-image-{hash_hex}.png");
                let full = out_dir.join(filename);
                std::fs::write(&full, img.png).map_err(|e| format!("写入图片失败: {e}"))?;
                let full_path = full.to_string_lossy().to_string();
                let snapshot = ClipboardSnapshotItem {
                    r#type: "image".to_string(),
                    content: format!("img:{hash_hex}"),
                    path: Some(full_path),
                    time: now,
                };
                latest_item = Some(snapshot.clone());
                items.insert(0, snapshot);
                if items.len() > max_history {
                    items.truncate(max_history);
                }
            }
        }

        if let Some(latest) = latest_item {
            let mut tasks = manager
                .tasks
                .lock()
                .map_err(|_| "任务状态锁定失败".to_string())?;
            let Some(rec) = tasks.get_mut(&task_id) else {
                break;
            };
            if rec.cancel_requested {
                break;
            }
            rec.result = Some(serde_json::json!({
                "latest": latest,
                "items": items.clone()
            }));
            rec.updated_at_ms = now_ms();
        }

        tokio::time::sleep(Duration::from_millis(interval_ms)).await;
    }

    serde_json::to_value(ClipboardWatchTaskResult { items })
        .map_err(|e| format!("任务结果序列化失败: {e}"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestTaskPayload {
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    body_base64: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestTaskResult {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

async fn run_http_request_task(payload: HttpRequestTaskPayload) -> Result<Value, String> {
    let req = HttpRequest {
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        body: payload.body,
        body_base64: payload.body_base64,
        timeout_ms: payload.timeout_ms,
    };
    let resp = http_request(req).await?;
    serde_json::to_value(HttpRequestTaskResult {
        status: resp.status,
        headers: resp.headers,
        body: resp.body,
    })
    .map_err(|e| format!("任务结果序列化失败: {e}"))
}

async fn execute_task(app: tauri::AppHandle, manager: Arc<TaskManagerState>, task_id: String) {
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
        rec.started_at_ms = Some(now_ms());
        rec.updated_at_ms = now_ms();
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
            rec.updated_at_ms = now_ms();
            rec.finished_at_ms = Some(now_ms());
            rec.error = Some("任务已取消".to_string());
        }
        return;
    }

    let fail_invalid_payload = |message: String| {
        let mut tasks = match manager.tasks.lock() {
            Ok(v) => v,
            Err(_) => return,
        };
        if let Some(rec) = tasks.get_mut(&task_id) {
            rec.status = TaskStatus::Failed;
            rec.updated_at_ms = now_ms();
            rec.finished_at_ms = Some(now_ms());
            rec.error = Some(message);
        }
    };

    let result = match kind.as_str() {
        "http.request" => {
            let payload: HttpRequestTaskPayload = match serde_json::from_value(payload) {
                Ok(v) => v,
                Err(e) => {
                    fail_invalid_payload(format!("任务参数无效: {e}"));
                    return;
                }
            };
            run_http_request_task(payload).await
        }
        "clipboard.watch" => {
            let payload: ClipboardWatchTaskPayload = match serde_json::from_value(payload) {
                Ok(v) => v,
                Err(e) => {
                    fail_invalid_payload(format!("任务参数无效: {e}"));
                    return;
                }
            };
            run_clipboard_watch_task(&app, payload, manager.clone(), task_id.clone(), plugin_id)
                .await
        }
        _ => Err(format!("不支持的任务类型: {kind}")),
    };

    let mut tasks = match manager.tasks.lock() {
        Ok(v) => v,
        Err(_) => return,
    };
    if let Some(rec) = tasks.get_mut(&task_id) {
        rec.updated_at_ms = now_ms();
        rec.finished_at_ms = Some(now_ms());
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

#[tauri::command]
pub(crate) fn task_create(
    app: tauri::AppHandle,
    plugin_id: String,
    req: TaskCreateReq,
) -> Result<TaskSummary, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let kind = req.kind.trim().to_string();
    if kind.is_empty() {
        return Err("task kind 不能为空".to_string());
    }

    let manager = app.state::<Arc<TaskManagerState>>().inner().clone();
    let now = now_ms();
    let task_id = make_task_id();
    let meta = normalize_task_meta(req.meta)?;
    let record = TaskRecord {
        id: task_id.clone(),
        plugin_id: plugin_id.clone(),
        kind,
        meta,
        status: TaskStatus::Queued,
        created_at_ms: now,
        updated_at_ms: now,
        started_at_ms: None,
        finished_at_ms: None,
        cancel_requested: false,
        error: None,
        payload: req.payload.unwrap_or(Value::Null),
        result: None,
    };

    {
        let mut tasks = manager
            .tasks
            .lock()
            .map_err(|_| "任务状态锁定失败".to_string())?;
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
        let mut handles = manager
            .handles
            .lock()
            .map_err(|_| "任务状态锁定失败".to_string())?;
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
    let tasks = manager
        .tasks
        .lock()
        .map_err(|_| "任务状态锁定失败".to_string())?;
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
    let tasks = manager
        .tasks
        .lock()
        .map_err(|_| "任务状态锁定失败".to_string())?;

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
    let mut tasks = manager
        .tasks
        .lock()
        .map_err(|_| "任务状态锁定失败".to_string())?;
    let rec = tasks.get_mut(tid).ok_or_else(|| "任务不存在".to_string())?;
    if rec.plugin_id != plugin_id {
        return Err("任务不存在".to_string());
    }
    if is_task_finished(rec.status) {
        return Ok(rec.summary());
    }
    rec.cancel_requested = true;
    rec.updated_at_ms = now_ms();
    if rec.status == TaskStatus::Queued {
        rec.status = TaskStatus::Canceled;
        rec.finished_at_ms = Some(now_ms());
        rec.error = Some("任务已取消".to_string());
        rec.result = None;
        return Ok(rec.summary());
    }
    if rec.status == TaskStatus::Running {
        rec.status = TaskStatus::Canceled;
        rec.finished_at_ms = Some(now_ms());
        rec.error = Some("任务已取消".to_string());
        rec.result = None;

        let handle = {
            let mut handles = manager
                .handles
                .lock()
                .map_err(|_| "任务状态锁定失败".to_string())?;
            handles.remove(tid)
        };
        if let Some(h) = handle {
            h.abort();
        }
    }
    Ok(rec.summary())
}
