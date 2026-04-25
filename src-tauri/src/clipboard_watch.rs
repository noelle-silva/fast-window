use crate::clipboard_snapshot::read_clipboard_snapshot;
use crate::plugins::is_safe_id;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;

static WATCH_ID_SEQ: AtomicU32 = AtomicU32::new(0);

fn make_watch_id() -> String {
    let stamp = crate::now_ms();
    let seq = WATCH_ID_SEQ.fetch_add(1, Ordering::Relaxed);
    let rnd = format!("{:08x}", crate::rand_u32(stamp ^ (seq as u64)));
    format!("clipwatch-{stamp}-{seq:08x}-{rnd}")
}

#[derive(Default)]
pub(crate) struct ClipboardWatchManagerState {
    watches: Mutex<HashMap<String, ClipboardWatchRecord>>,
    handles: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Clone)]
struct ClipboardWatchRecord {
    id: String,
    plugin_id: String,
    created_at_ms: u64,
    updated_at_ms: u64,
    cancel_requested: bool,
    latest: Option<ClipboardSnapshotItem>,
    items: Vec<ClipboardSnapshotItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardWatchStartReq {
    interval_ms: Option<u64>,
    max_history: Option<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardSnapshotItem {
    r#type: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    time: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardWatchSummary {
    id: String,
    updated_at_ms: u64,
    created_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest: Option<ClipboardSnapshotItem>,
    items: Vec<ClipboardSnapshotItem>,
}

impl ClipboardWatchRecord {
    fn summary(&self) -> ClipboardWatchSummary {
        ClipboardWatchSummary {
            id: self.id.clone(),
            updated_at_ms: self.updated_at_ms,
            created_at_ms: self.created_at_ms,
            latest: self.latest.clone(),
            items: self.items.clone(),
        }
    }
}

fn normalize_req(req: ClipboardWatchStartReq) -> (u64, usize) {
    let interval_ms = req.interval_ms.unwrap_or(1000).clamp(200, 15_000);
    let max_history = req.max_history.unwrap_or(50).clamp(10, 1000);
    (interval_ms, max_history)
}

fn trim_plugin_watches(map: &mut HashMap<String, ClipboardWatchRecord>, plugin_id: &str) -> Vec<String> {
    // 快速失败：限制每个插件同时最多 8 个 watch，避免“后台无限开监听”拖垮宿主。
    const MAX_WATCHES_PER_PLUGIN: usize = 8;
    let mut list: Vec<(String, u64)> = map
        .iter()
        .filter(|(_, v)| v.plugin_id == plugin_id)
        .map(|(k, v)| (k.clone(), v.updated_at_ms))
        .collect();
    if list.len() <= MAX_WATCHES_PER_PLUGIN {
        return Vec::new();
    }
    list.sort_by(|a, b| b.1.cmp(&a.1)); // newest first
    let mut removed: Vec<String> = Vec::new();
    for (id, _) in list.into_iter().skip(MAX_WATCHES_PER_PLUGIN) {
        map.remove(&id);
        removed.push(id);
    }
    removed
}

async fn run_watch_loop(
    app: tauri::AppHandle,
    state: Arc<ClipboardWatchManagerState>,
    watch_id: String,
    plugin_id: String,
    interval_ms: u64,
    max_history: usize,
) {
    let out_dir = crate::resolve_plugin_output_dir(&app, &plugin_id);
    if crate::ensure_writable_dir(&out_dir).is_err() {
        // 目录不可写时，watch 仍可跑文本；图片落盘会失败，但不应卡死循环。
    }

    let mut items: Vec<ClipboardSnapshotItem> = Vec::new();
    let mut last_text = String::new();
    let mut last_image_hash: u32 = 0;

    loop {
        // cancel?
        {
            let mut g = match state.watches.lock() {
                Ok(v) => v,
                Err(_) => return,
            };
            let Some(rec) = g.get_mut(&watch_id) else {
                return;
            };
            if rec.cancel_requested {
                return;
            }
        }

        let snapshot = read_clipboard_snapshot(&app).await;
        let (text, image) = match snapshot {
            Ok(v) => v,
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(interval_ms)).await;
                continue;
            }
        };

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
            if img.hash != last_image_hash {
                last_image_hash = img.hash;
                let hash_hex = format!("{:08x}", img.hash);
                let filename = format!("clipboard-image-{hash_hex}.png");
                let full = out_dir.join(filename);
                if std::fs::write(&full, img.png).is_ok() {
                    let snapshot = ClipboardSnapshotItem {
                        r#type: "image".to_string(),
                        content: format!("img:{hash_hex}"),
                        path: Some(full.to_string_lossy().to_string()),
                        time: now,
                    };
                    latest_item = Some(snapshot.clone());
                    items.insert(0, snapshot);
                    if items.len() > max_history {
                        items.truncate(max_history);
                    }
                }
            }
        }

        if let Some(latest) = latest_item {
            let mut g = match state.watches.lock() {
                Ok(v) => v,
                Err(_) => return,
            };
            let Some(rec) = g.get_mut(&watch_id) else {
                return;
            };
            if rec.cancel_requested {
                return;
            }
            rec.latest = Some(latest);
            rec.items = items.clone();
            rec.updated_at_ms = crate::now_ms();
        }

        tokio::time::sleep(Duration::from_millis(interval_ms)).await;
    }
}

#[tauri::command]
pub(crate) fn clipboard_watch_start(
    app: tauri::AppHandle,
    plugin_id: String,
    req: Value,
) -> Result<ClipboardWatchSummary, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let req: ClipboardWatchStartReq =
        serde_json::from_value(req).map_err(|e| format!("参数无效: {e}"))?;
    let (interval_ms, max_history) = normalize_req(req);

    let state = app
        .state::<Arc<ClipboardWatchManagerState>>()
        .inner()
        .clone();

    let now = crate::now_ms();
    let watch_id = make_watch_id();

    let record = ClipboardWatchRecord {
        id: watch_id.clone(),
        plugin_id: plugin_id.clone(),
        created_at_ms: now,
        updated_at_ms: now,
        cancel_requested: false,
        latest: None,
        items: Vec::new(),
    };

    {
        let mut g = state
            .watches
            .lock()
            .map_err(|_| "watch 状态锁定失败".to_string())?;
        g.insert(watch_id.clone(), record.clone());
        let removed = trim_plugin_watches(&mut g, &plugin_id);
        if !removed.is_empty() {
            // 对齐 handles：移除并中止已被 trim 的旧 watch。
            if let Ok(mut h) = state.handles.lock() {
                for id in removed {
                    if let Some(handle) = h.remove(&id) {
                        handle.abort();
                    }
                }
            }
        }
    }

    let app_clone = app.clone();
    let state_clone = state.clone();
    let id_clone = watch_id.clone();
    let plugin_clone = plugin_id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        run_watch_loop(
            app_clone,
            state_clone,
            id_clone,
            plugin_clone,
            interval_ms,
            max_history,
        )
        .await;
    });

    {
        let mut h = state
            .handles
            .lock()
            .map_err(|_| "watch 句柄锁定失败".to_string())?;
        h.insert(watch_id.clone(), handle);
    }

    Ok(record.summary())
}

#[tauri::command]
pub(crate) fn clipboard_watch_get(
    app: tauri::AppHandle,
    plugin_id: String,
    watch_id: String,
) -> Result<Option<ClipboardWatchSummary>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let id = watch_id.trim();
    if id.is_empty() {
        return Ok(None);
    }

    let state = app
        .state::<Arc<ClipboardWatchManagerState>>()
        .inner()
        .clone();
    let g = state
        .watches
        .lock()
        .map_err(|_| "watch 状态锁定失败".to_string())?;
    let item = g.get(id).filter(|r| r.plugin_id == plugin_id);
    Ok(item.map(|r| r.summary()))
}

#[tauri::command]
pub(crate) fn clipboard_watch_stop(
    app: tauri::AppHandle,
    plugin_id: String,
    watch_id: String,
) -> Result<Option<ClipboardWatchSummary>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let id = watch_id.trim();
    if id.is_empty() {
        return Ok(None);
    }

    let state = app
        .state::<Arc<ClipboardWatchManagerState>>()
        .inner()
        .clone();

    let summary = {
        let mut g = state
            .watches
            .lock()
            .map_err(|_| "watch 状态锁定失败".to_string())?;
        let Some(rec) = g.get_mut(id) else {
            return Ok(None);
        };
        if rec.plugin_id != plugin_id {
            return Ok(None);
        }
        rec.cancel_requested = true;
        rec.updated_at_ms = crate::now_ms();
        rec.summary()
    };

    let handle = {
        let mut h = state
            .handles
            .lock()
            .map_err(|_| "watch 句柄锁定失败".to_string())?;
        h.remove(id)
    };
    if let Some(h) = handle {
        h.abort();
    }

    Ok(Some(summary))
}
