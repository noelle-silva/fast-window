use crate::clipboard_snapshot::read_clipboard_snapshot;
use crate::tasks::state::TaskManagerState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

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

pub(crate) fn validate_payload(payload: &Value) -> Result<(), String> {
    // payload 允许为空对象；但不允许是奇怪的基础类型（避免未来扩展时踩坑）。
    if payload.is_null() {
        return Ok(());
    }
    serde_json::from_value::<ClipboardWatchTaskPayload>(payload.clone())
        .map(|_| ())
        .map_err(|e| format!("任务参数无效: {e}"))
}

pub(crate) async fn run(
    app: &tauri::AppHandle,
    manager: Arc<TaskManagerState>,
    task_id: String,
    plugin_id: String,
    payload: Value,
) -> Result<Value, String> {
    let payload: ClipboardWatchTaskPayload = if payload.is_null() {
        ClipboardWatchTaskPayload {
            interval_ms: None,
            max_history: None,
        }
    } else {
        serde_json::from_value(payload).map_err(|e| format!("任务参数无效: {e}"))?
    };

    let interval_ms = payload.interval_ms.unwrap_or(1000).clamp(200, 15_000);
    let max_history = payload.max_history.unwrap_or(50).clamp(10, 1000);

    let out_dir = crate::resolve_plugin_output_dir(app, &plugin_id);
    crate::ensure_writable_dir(&out_dir)?;

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
        }

        let (text, image) = read_clipboard_snapshot(app).await?;
        let now = crate::now_ms();
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
            rec.updated_at_ms = crate::now_ms();
        }

        tokio::time::sleep(Duration::from_millis(interval_ms)).await;
    }

    serde_json::to_value(ClipboardWatchTaskResult { items })
        .map_err(|e| format!("任务结果序列化失败: {e}"))
}
