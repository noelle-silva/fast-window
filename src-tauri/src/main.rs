#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::sync::{Arc, Mutex};
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;

use base64::{engine::general_purpose, Engine as _};
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, WindowEvent,
    tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent},
    menu::{Menu, MenuItem},
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use serde_json::{Map, Value};
use std::collections::HashMap;

const DEFAULT_WAKE_SHORTCUT: &str = "control+alt+Space";
const APP_CONFIG_FILE: &str = "app.json";
const WAKE_SHORTCUT_KEY: &str = "wakeShortcut";
const AUTO_START_KEY: &str = "autoStart";
const PLUGIN_OUTPUT_DIRS_KEY: &str = "pluginOutputDirs";
const TASKS_RETENTION_LIMIT: usize = 120;
const TASKS_PER_PLUGIN_LIMIT: usize = 40;

// 避免开发版把“开机启动”写到正式版同一个注册表项里（会导致装了 MSI 以后仍然自启 debug exe）。
#[cfg(debug_assertions)]
const AUTO_START_REG_VALUE: &str = "Fast Window (Dev)";
#[cfg(not(debug_assertions))]
const AUTO_START_REG_VALUE: &str = "Fast Window";

const DATA_DIR_ENV: &str = "FAST_WINDOW_DATA_DIR";

#[derive(Deserialize)]
struct HttpRequest {
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    #[serde(rename = "bodyBase64")]
    body_base64: Option<String>,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum TaskStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskSummary {
    id: String,
    plugin_id: String,
    kind: String,
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
struct TaskManagerState {
    tasks: Mutex<HashMap<String, TaskRecord>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskCreateReq {
    kind: String,
    #[serde(default)]
    payload: Option<Value>,
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

fn is_http_url(url: &str) -> bool {
    let u = url.trim();
    let u = u.to_ascii_lowercase();
    u.starts_with("http://") || u.starts_with("https://")
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
    let rnd = format!("{:08x}", rand_u32(stamp));
    format!("task-{stamp}-{rnd}")
}

fn is_task_finished(status: TaskStatus) -> bool {
    matches!(status, TaskStatus::Succeeded | TaskStatus::Failed | TaskStatus::Canceled)
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

async fn read_clipboard_snapshot(app: &AppHandle) -> Result<(String, Option<ClipboardImageSnapshot>), String> {
    let app_text = app.clone();
    let text = tauri::async_runtime::spawn_blocking(move || {
        app_text
            .clipboard()
            .read_text()
            .unwrap_or_default()
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
                let png = encode_rgba_to_png_bytes(rgba, img.width(), img.height()).unwrap_or_default();
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
    app: &AppHandle,
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

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let u = url.trim();
    if !is_http_url(u) {
        return Err("url 必须以 http(s):// 开头".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(u)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(u)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(u)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
        return Ok(());
    }
}

#[tauri::command]
async fn http_request(req: HttpRequest) -> Result<HttpResponse, String> {
    let method = req.method.trim().to_uppercase();
    if method.is_empty() {
        return Err("method 不能为空".to_string());
    }
    if !is_http_url(&req.url) {
        return Err("url 必须以 http(s):// 开头".to_string());
    }

    let timeout = Duration::from_millis(req.timeout_ms.unwrap_or(20_000).min(120_000));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("创建 http client 失败: {e}"))?;

    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "不支持的 method".to_string())?;
    let mut rb = client.request(m, req.url);

    if let Some(h) = req.headers {
        if h.len() > 64 {
            return Err("headers 过多".to_string());
        }
        for (k, v) in h {
            if k.len() > 128 || v.len() > 4096 {
                return Err("header 太长".to_string());
            }
            rb = rb.header(k, v);
        }
    }

    if let Some(body_base64) = req.body_base64 {
        // 允许插件以 base64 发送二进制（用于图片等），避免 body 只能传字符串的限制
        // 控制大小：解码后最多 6MB，防止滥用
        let raw = body_base64.trim();
        if raw.len() > 12 * 1024 * 1024 {
            return Err("bodyBase64 过大".to_string());
        }

        let pure = if raw.starts_with("data:") {
            match raw.find("base64,") {
                Some(i) => &raw[(i + "base64,".len())..],
                None => raw,
            }
        } else {
            raw
        };

        let bytes = general_purpose::STANDARD
            .decode(pure.trim())
            .map_err(|e| format!("bodyBase64 解码失败: {e}"))?;
        if bytes.len() > 6 * 1024 * 1024 {
            return Err("bodyBase64 解码后数据过大".to_string());
        }
        rb = rb.body(bytes);
    } else if let Some(body) = req.body {
        if body.len() > 512 * 1024 {
            return Err("body 过大".to_string());
        }
        rb = rb.body(body);
    }

    let resp = rb.send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status().as_u16();

    let mut headers: HashMap<String, String> = HashMap::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(vs) = v.to_str() {
            headers.insert(k.as_str().to_string(), vs.to_string());
        }
    }

    // 图片相关的 JSON/base64 响应可能很大（尤其是 chat/completions 返回 b64）。
    // 这里做上限保护，避免插件拉取无限大响应导致内存爆炸。
    const MAX_HTTP_RESPONSE_BYTES: usize = 25 * 1024 * 1024; // 25MB

    let bytes = resp.bytes().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if bytes.len() > MAX_HTTP_RESPONSE_BYTES {
        return Err(format!("响应过大（{} > {}）", bytes.len(), MAX_HTTP_RESPONSE_BYTES));
    }
    let body = String::from_utf8(bytes.to_vec()).map_err(|_| "响应不是 UTF-8 文本".to_string())?;

    Ok(HttpResponse { status, headers, body })
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

async fn execute_task(app: AppHandle, manager: Arc<TaskManagerState>, task_id: String) {
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
        (
            rec.plugin_id.clone(),
            rec.kind.clone(),
            rec.payload.clone(),
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
            run_clipboard_watch_task(&app, payload, manager.clone(), task_id.clone(), plugin_id).await
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
fn task_create(app: tauri::AppHandle, plugin_id: String, req: TaskCreateReq) -> Result<TaskSummary, String> {
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
    let record = TaskRecord {
        id: task_id.clone(),
        plugin_id: plugin_id.clone(),
        kind,
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
    tauri::async_runtime::spawn(async move {
        execute_task(app_clone, manager_clone, task_id).await;
    });

    Ok(record.summary())
}

#[tauri::command]
fn task_get(app: tauri::AppHandle, plugin_id: String, task_id: String) -> Result<Option<TaskSummary>, String> {
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
fn task_list(app: tauri::AppHandle, plugin_id: String, limit: Option<usize>) -> Result<Vec<TaskSummary>, String> {
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
fn task_cancel(app: tauri::AppHandle, plugin_id: String, task_id: String) -> Result<TaskSummary, String> {
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
    let rec = tasks
        .get_mut(tid)
        .ok_or_else(|| "任务不存在".to_string())?;
    if rec.plugin_id != plugin_id {
        return Err("任务不存在".to_string());
    }
    rec.cancel_requested = true;
    rec.updated_at_ms = now_ms();
    if rec.status == TaskStatus::Queued {
        rec.status = TaskStatus::Canceled;
        rec.finished_at_ms = Some(now_ms());
        rec.error = Some("任务已取消".to_string());
    }
    Ok(rec.summary())
}

#[derive(Default)]
struct WindowState {
    last_position: Mutex<Option<tauri::PhysicalPosition<i32>>>,
}

struct WakeShortcutState {
    current: Mutex<Shortcut>,
    paused: Mutex<bool>,
}

trait Positionable {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>>;
    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()>;
    fn center(&self) -> tauri::Result<()>;
}

impl Positionable for tauri::Window {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>> {
        tauri::Window::outer_position(self)
    }

    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()> {
        tauri::Window::set_position(self, position)
    }

    fn center(&self) -> tauri::Result<()> {
        tauri::Window::center(self)
    }
}

impl Positionable for tauri::WebviewWindow {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>> {
        tauri::WebviewWindow::outer_position(self)
    }

    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()> {
        tauri::WebviewWindow::set_position(self, position)
    }

    fn center(&self) -> tauri::Result<()> {
        tauri::WebviewWindow::center(self)
    }
}

fn save_position_if_valid(window: &impl Positionable, state: &WindowState) {
    if let Ok(pos) = window.outer_position() {
        // 隐藏时会把窗口移到屏幕外（-10000, -10000），不要把这种位置记成“上次位置”
        if pos.x <= -9000 || pos.y <= -9000 {
            return;
        }
        if let Ok(mut guard) = state.last_position.lock() {
            *guard = Some(pos);
        }
    }
}

fn restore_or_center(window: &impl Positionable, state: &WindowState) {
    let last = state
        .last_position
        .lock()
        .ok()
        .and_then(|g| *g);

    if let Some(pos) = last {
        let _ = window.set_position(pos);
    } else {
        let _ = window.center();
    }
}

fn portable_base_dir_from_env() -> Option<PathBuf> {
    let Ok(raw) = std::env::var(DATA_DIR_ENV) else {
        return None;
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    Some(PathBuf::from(raw))
}

fn is_dir_writable(dir: &Path) -> bool {
    let test = dir.join(".fast-window.write-test");
    match std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .open(&test)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&test);
            true
        }
        Err(_) => false,
    }
}

fn app_local_base_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Some(p) = portable_base_dir_from_env() {
        return p;
    }

    // 便携优先：exe 同目录（比 cwd 稳定）。但 MSI 默认装在 Program Files，不可写时退回到 AppData。
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if is_dir_writable(dir) {
                return dir.to_path_buf();
            }
        }
    }

    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default())
}

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app_local_base_dir(app).join("data")
}

fn app_plugins_dir(app: &tauri::AppHandle) -> PathBuf {
    app_local_base_dir(app).join("plugins")
}

fn app_config_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join(APP_CONFIG_FILE)
}

fn open_dir_in_file_manager(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("当前平台不支持打开文件管理器".to_string())
}

fn plugin_default_output_dir(app: &tauri::AppHandle, plugin_id: &str) -> PathBuf {
    // 默认输出到 data/<pluginId>/output-images
    app_data_dir(app).join(plugin_id).join("output-images")
}

fn read_plugin_output_dir_from_config(app: &tauri::AppHandle, plugin_id: &str) -> Option<PathBuf> {
    let cfg_path = app_config_path(app);
    let map = read_json_map(&cfg_path);
    let Some(Value::Object(obj)) = map.get(PLUGIN_OUTPUT_DIRS_KEY) else {
        return None;
    };
    let Some(Value::String(s)) = obj.get(plugin_id) else {
        return None;
    };
    let raw = s.trim();
    if raw.is_empty() {
        return None;
    }
    Some(PathBuf::from(raw))
}

fn write_plugin_output_dir_to_config(app: &tauri::AppHandle, plugin_id: &str, dir: &Path) -> Result<(), String> {
    let cfg_path = app_config_path(app);
    let mut map = read_json_map(&cfg_path);

    let v = map
        .entry(PLUGIN_OUTPUT_DIRS_KEY.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !v.is_object() {
        *v = Value::Object(Map::new());
    }
    let obj = v.as_object_mut().unwrap();
    obj.insert(plugin_id.to_string(), Value::String(dir.to_string_lossy().to_string()));

    write_json_map(&cfg_path, &map)
}

fn ensure_writable_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;
    if !dir.is_dir() {
        return Err("输出路径不是目录".to_string());
    }
    if !is_dir_writable(dir) {
        return Err("目录不可写（权限不足或被占用）".to_string());
    }
    Ok(())
}

fn resolve_plugin_output_dir(app: &tauri::AppHandle, plugin_id: &str) -> PathBuf {
    // 配置优先；若不可用则回退到默认目录（避免破坏用户空间）
    if let Some(p) = read_plugin_output_dir_from_config(app, plugin_id) {
        if ensure_writable_dir(&p).is_ok() {
            return p;
        }
    }
    plugin_default_output_dir(app, plugin_id)
}

fn read_json_map(path: &Path) -> Map<String, Value> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return Map::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(&content) else {
        return Map::new();
    };
    match v {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

fn write_json_map(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let content = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(path, content).map_err(|e| format!("写入配置失败: {e}"))?;
    Ok(())
}

fn decode_base64_image_payload(raw: &str) -> Result<(Vec<u8>, String), String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("图片数据为空".to_string());
    }

    // data URL: data:image/png;base64,....
    if s.starts_with("data:") {
        let base64_pos = s.find("base64,").ok_or_else(|| "data URL 缺少 base64,".to_string())?;
        let meta = &s["data:".len()..base64_pos];
        let b64 = &s[(base64_pos + "base64,".len())..];

        let ext = if meta.contains("image/png") {
            "png"
        } else if meta.contains("image/jpeg") {
            "jpg"
        } else if meta.contains("image/webp") {
            "webp"
        } else {
            "png"
        };

        if b64.len() > 40 * 1024 * 1024 {
            return Err("图片数据过大".to_string());
        }
        let bytes = general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("base64 解码失败: {e}"))?;
        if bytes.len() > 25 * 1024 * 1024 {
            return Err("图片过大".to_string());
        }
        return Ok((bytes, ext.to_string()));
    }

    if s.len() > 40 * 1024 * 1024 {
        return Err("图片数据过大".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(s)
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("图片过大".to_string());
    }
    Ok((bytes, "png".to_string()))
}

#[tauri::command]
fn plugin_get_output_dir(app: tauri::AppHandle, plugin_id: String) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let dir = resolve_plugin_output_dir(&app, &plugin_id);
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn plugin_pick_output_dir(app: tauri::AppHandle, plugin_id: String) -> Result<Option<String>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let picked = rfd::FileDialog::new()
        .set_title("选择输出目录")
        .pick_folder();

    let Some(dir) = picked else {
        return Ok(None);
    };

    ensure_writable_dir(&dir)?;
    write_plugin_output_dir_to_config(&app, &plugin_id, &dir)?;
    Ok(Some(dir.to_string_lossy().to_string()))
}

#[tauri::command]
fn plugin_open_output_dir(app: tauri::AppHandle, plugin_id: String) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let dir = resolve_plugin_output_dir(&app, &plugin_id);
    open_dir_in_file_manager(&dir)
}

#[tauri::command]
fn plugin_save_image_base64(app: tauri::AppHandle, plugin_id: String, data: String) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let out_dir = resolve_plugin_output_dir(&app, &plugin_id);
    ensure_writable_dir(&out_dir)?;

    let (bytes, ext) = decode_base64_image_payload(&data)?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let filename = format!("ai-image-{stamp}.{ext}");
    let full = out_dir.join(filename);

    std::fs::write(&full, bytes).map_err(|e| format!("写入图片失败: {e}"))?;
    Ok(full.to_string_lossy().to_string())
}

fn path_has_image_ext(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp")
}

fn image_mime_by_ext(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

#[tauri::command]
fn plugin_list_output_images(app: tauri::AppHandle, plugin_id: String) -> Result<Vec<String>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let out_dir = resolve_plugin_output_dir(&app, &plugin_id);
    ensure_writable_dir(&out_dir)?;

    let mut items: Vec<(SystemTime, PathBuf)> = Vec::new();
    let rd = std::fs::read_dir(&out_dir).map_err(|e| format!("读取输出目录失败: {e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let path = entry.path();
        if !path.is_file() || !path_has_image_ext(&path) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(UNIX_EPOCH);
        items.push((modified, path));
    }

    items.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(items
        .into_iter()
        .map(|(_, p)| p.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
fn plugin_read_output_image(app: tauri::AppHandle, plugin_id: String, path: String) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let input = PathBuf::from(path.trim());
    if input.as_os_str().is_empty() {
        return Err("图片路径不能为空".to_string());
    }

    let out_dir = resolve_plugin_output_dir(&app, &plugin_id);
    ensure_writable_dir(&out_dir)?;

    let root = std::fs::canonicalize(&out_dir).map_err(|e| format!("输出目录不可用: {e}"))?;
    let full = std::fs::canonicalize(&input).map_err(|e| format!("图片路径无效: {e}"))?;
    if !full.starts_with(&root) {
        return Err("图片路径越界".to_string());
    }
    if !full.is_file() {
        return Err("图片不存在".to_string());
    }
    if !path_has_image_ext(&full) {
        return Err("不支持的图片类型".to_string());
    }

    let bytes = std::fs::read(&full).map_err(|e| format!("读取图片失败: {e}"))?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("图片过大".to_string());
    }
    let mime = image_mime_by_ext(&full);
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[tauri::command]
fn plugin_delete_output_image(app: tauri::AppHandle, plugin_id: String, path: String) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let input = PathBuf::from(path.trim());
    if input.as_os_str().is_empty() {
        return Err("图片路径不能为空".to_string());
    }

    let out_dir = resolve_plugin_output_dir(&app, &plugin_id);
    ensure_writable_dir(&out_dir)?;

    let root = std::fs::canonicalize(&out_dir).map_err(|e| format!("输出目录不可用: {e}"))?;
    let full = std::fs::canonicalize(&input).map_err(|e| format!("图片路径无效: {e}"))?;
    if !full.starts_with(&root) {
        return Err("图片路径越界".to_string());
    }
    if !full.is_file() {
        return Err("图片不存在".to_string());
    }
    if !path_has_image_ext(&full) {
        return Err("不支持的图片类型".to_string());
    }

    std::fs::remove_file(&full).map_err(|e| format!("删除图片失败: {e}"))?;
    Ok(())
}

#[cfg(debug_assertions)]
fn same_path(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

#[derive(Clone, Serialize)]
struct AutoStartStatus {
    supported: bool,
    enabled: bool,
    scope: &'static str,
}

fn load_auto_start_pref(app: &tauri::AppHandle) -> Option<bool> {
    let cfg_path = app_config_path(app);
    let map = read_json_map(&cfg_path);

    if map.contains_key(AUTO_START_KEY) {
        return map.get(AUTO_START_KEY).and_then(|v| v.as_bool());
    }
    if map.contains_key("auto_start") {
        return map.get("auto_start").and_then(|v| v.as_bool());
    }
    None
}

#[cfg(target_os = "windows")]
mod auto_start {
    use std::io;
    use std::path::Path;

    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

    fn open_run_key(read_only: bool) -> Result<RegKey, String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let flags = if read_only { KEY_READ } else { KEY_READ | KEY_WRITE };
        hkcu.open_subkey_with_flags(RUN_KEY, flags)
            .map_err(|e| format!("打开注册表失败: {e}"))
    }

    fn current_exe_command() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {e}"))?;
        Ok(format!("\"{}\"", exe.to_string_lossy()))
    }

    fn split_command(cmd: &str) -> (String, String) {
        let s = cmd.trim();
        if s.starts_with('"') {
            let rest = &s[1..];
            if let Some(end) = rest.find('"') {
                let exe = rest[..end].to_string();
                let args = rest[end + 1..].trim().to_string();
                return (exe, args);
            }
        }

        if let Some(idx) = s.find(char::is_whitespace) {
            let exe = s[..idx].to_string();
            let args = s[idx..].trim().to_string();
            return (exe, args);
        }

        (s.to_string(), String::new())
    }

    fn should_rewrite_to_current_exe(existing_exe: &str) -> bool {
        if existing_exe.trim().is_empty() {
            return false;
        }
        if !Path::new(existing_exe).exists() {
            return true;
        }
        let lower = existing_exe.to_ascii_lowercase();
        lower.contains("\\target\\debug\\")
            || lower.contains("/target/debug/")
            || lower.contains("\\target\\release\\")
            || lower.contains("/target/release/")
    }

    pub fn ensure_enabled_points_to_current_exe(value_name: &str) -> Result<(), String> {
        let key = open_run_key(false)?;
        let Ok(existing) = key.get_value::<String, _>(value_name) else {
            return Ok(());
        };

        let (existing_exe, existing_args) = split_command(&existing);
        if !should_rewrite_to_current_exe(&existing_exe) {
            return Ok(());
        }

        let current_exe = std::env::current_exe()
            .map_err(|e| format!("获取程序路径失败: {e}"))?
            .to_string_lossy()
            .to_string();
        if existing_exe.eq_ignore_ascii_case(&current_exe) {
            return Ok(());
        }

        let next = if existing_args.is_empty() {
            format!("\"{}\"", current_exe)
        } else {
            format!("\"{}\" {}", current_exe, existing_args)
        };
        key.set_value(value_name, &next)
            .map_err(|e| format!("写入自启注册表项失败: {e}"))?;

        Ok(())
    }

    pub fn is_enabled(value_name: &str) -> bool {
        let Ok(key) = open_run_key(true) else {
            return false;
        };
        key.get_raw_value(value_name).is_ok()
    }

    pub fn set_enabled(value_name: &str, enabled: bool) -> Result<bool, String> {
        let key = open_run_key(false)?;

        if enabled {
            let cmd = current_exe_command()?;
            key.set_value(value_name, &cmd)
                .map_err(|e| format!("写入自启注册表项失败: {e}"))?;
        } else {
            match key.delete_value(value_name) {
                Ok(_) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("删除自启注册表项失败: {e}")),
            }
        }

        Ok(is_enabled(value_name))
    }
}

fn load_wake_shortcut(app: &tauri::AppHandle) -> (Shortcut, String) {
    let cfg_path = app_config_path(app);
    let map = read_json_map(&cfg_path);

    let raw = map
        .get(WAKE_SHORTCUT_KEY)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            map.get("wake_shortcut")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| DEFAULT_WAKE_SHORTCUT.to_string());

    match Shortcut::from_str(raw.trim()) {
        Ok(s) => (s, s.to_string()),
        Err(e) => {
            eprintln!(
                "[config] invalid wakeShortcut \"{}\" in {:?}: {}",
                raw,
                cfg_path,
                e
            );
            let fallback = Shortcut::from_str(DEFAULT_WAKE_SHORTCUT)
                .expect("DEFAULT_WAKE_SHORTCUT must be parseable");
            (fallback, fallback.to_string())
        }
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<WindowState>();
        restore_or_center(&window, &state);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let state = app.state::<WindowState>();
            save_position_if_valid(&window, &state);
            let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
    }
}

#[cfg(debug_assertions)]
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else if ty.is_file() {
            if let Some(parent) = to.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn is_dir_empty(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => true,
    }
}

#[tauri::command]
fn get_plugins_dir(app: tauri::AppHandle) -> String {
    // 统一使用 App 本地数据目录（避免 cwd 漂移），插件默认放到这里
    let plugins_dir = app_plugins_dir(&app);
    let _ = std::fs::create_dir_all(&plugins_dir);

    // 开发模式：把仓库里的 plugins 同步到本地数据目录（方便开发，且配合 fs scope 收紧）
    #[cfg(debug_assertions)]
    {
        let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
        let repo_plugins = workspace_root.join("plugins");
        if repo_plugins.is_dir() && !same_path(&repo_plugins, &plugins_dir) {
            // 每次都覆盖同步：以仓库为真源
            let _ = copy_dir_all(&repo_plugins, &plugins_dir);
        }
    }

    plugins_dir.to_string_lossy().to_string()
}

#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> String {
    // 统一使用 App 本地数据目录（避免 cwd 漂移）
    let data_dir = app_data_dir(&app);
    let _ = std::fs::create_dir_all(&data_dir);

    // 开发模式：仅在目标目录为空时，把仓库里的 data 迁移一份过来（不覆盖用户数据）
    #[cfg(debug_assertions)]
    {
        if is_dir_empty(&data_dir) {
            let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
            let repo_data = workspace_root.join("data");
            if repo_data.is_dir() && !same_path(&repo_data, &data_dir) {
                let _ = copy_dir_all(&repo_data, &data_dir);
            }
        }
    }

    data_dir.to_string_lossy().to_string()
}

#[tauri::command]
fn open_data_root_dir(app: tauri::AppHandle) -> Result<(), String> {
    let root = app_local_base_dir(&app);
    open_dir_in_file_manager(&root)
}

#[tauri::command]
fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app_data_dir(&app);
    open_dir_in_file_manager(&dir)
}

#[tauri::command]
fn open_plugins_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app_plugins_dir(&app);
    open_dir_in_file_manager(&dir)
}

fn is_safe_id(id: &str) -> bool {
    if id.is_empty() {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn safe_relative_path(rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.is_absolute() {
        return Err("路径不允许为绝对路径".to_string());
    }
    for c in p.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err("路径不合法（不允许包含 .. 等）".to_string()),
        }
    }
    Ok(p.to_path_buf())
}

#[derive(Clone, Serialize)]
struct FsDirEntry {
    name: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
}

#[tauri::command]
fn list_plugins(app: tauri::AppHandle) -> Vec<String> {
    let dir = app_plugins_dir(&app);
    let mut out: Vec<String> = Vec::new();

    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };

    for e in entries.flatten() {
        let Ok(ty) = e.file_type() else {
            continue;
        };
        if !ty.is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if is_safe_id(&name) {
            out.push(name);
        }
    }

    out.sort();
    out
}

#[tauri::command]
fn read_plugin_file(app: tauri::AppHandle, plugin_id: String, path: String) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let rel = safe_relative_path(&path)?;

    let plugin_dir = app_plugins_dir(&app).join(&plugin_id);
    let full = plugin_dir.join(rel);
    std::fs::read_to_string(&full).map_err(|e| format!("读取插件文件失败: {e}"))
}

#[tauri::command]
fn read_plugins_dir(app: tauri::AppHandle, rel_dir: String) -> Result<Vec<FsDirEntry>, String> {
    let rel = safe_relative_path(&rel_dir)?;
    let base = app_plugins_dir(&app);
    let dir = base.join(rel);

    let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {e}"))?;
    let mut out: Vec<FsDirEntry> = Vec::new();

    for e in entries {
        let e = e.map_err(|e| format!("读取目录项失败: {e}"))?;
        let ty = e.file_type().map_err(|e| format!("读取目录项类型失败: {e}"))?;
        out.push(FsDirEntry {
            name: e.file_name().to_string_lossy().to_string(),
            is_directory: ty.is_dir(),
        });
    }

    Ok(out)
}

#[derive(Deserialize)]
struct PluginWriteFile {
    path: String,
    bytes: Vec<u8>,
}

#[tauri::command]
fn install_plugin_files(
    app: tauri::AppHandle,
    plugin_id: String,
    overwrite: bool,
    files: Vec<PluginWriteFile>,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    if files.is_empty() {
        return Err("没有可安装的文件".to_string());
    }
    if files.len() > 256 {
        return Err("文件数量过多".to_string());
    }

    let total: usize = files.iter().map(|f| f.bytes.len()).sum();
    if total > 10 * 1024 * 1024 {
        return Err("插件体积过大".to_string());
    }

    let base = app_plugins_dir(&app);
    std::fs::create_dir_all(&base).map_err(|e| format!("创建插件目录失败: {e}"))?;

    let plugin_dir = base.join(&plugin_id);
    if plugin_dir.exists() && !overwrite {
        return Err("同 ID 插件已存在（未勾选覆盖）".to_string());
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let tmp_dir = base.join(format!(".tmp-install-{plugin_id}-{stamp}"));
    if tmp_dir.exists() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
    if let Err(e) = std::fs::create_dir_all(&tmp_dir) {
        return Err(format!("创建临时目录失败: {e}"));
    }

    for f in &files {
        let rel = match safe_relative_path(&f.path) {
            Ok(p) => p,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return Err(e);
            }
        };
        let full = tmp_dir.join(rel);
        if let Some(parent) = full.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return Err(format!("创建目录失败: {e}"));
            }
        }
        if let Err(e) = std::fs::write(&full, &f.bytes) {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(format!("写入插件文件失败: {e}"));
        }
    }

    if plugin_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&plugin_dir) {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(format!("移除旧插件失败: {e}"));
        }
    }

    if let Err(e) = std::fs::rename(&tmp_dir, &plugin_dir) {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(format!("安装插件失败: {e}"));
    }
    Ok(())
}

fn storage_file_path(app: &tauri::AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    Ok(app_data_dir(app).join(format!("{plugin_id}.json")))
}

#[tauri::command]
fn storage_get(app: tauri::AppHandle, plugin_id: String, key: String) -> Result<Option<Value>, String> {
    let path = storage_file_path(&app, &plugin_id)?;
    let map = read_json_map(&path);
    Ok(map.get(&key).cloned())
}

#[tauri::command]
fn storage_set(app: tauri::AppHandle, plugin_id: String, key: String, value: Value) -> Result<(), String> {
    let path = storage_file_path(&app, &plugin_id)?;
    let mut map = read_json_map(&path);
    map.insert(key, value);
    write_json_map(&path, &map)
}

#[tauri::command]
fn storage_remove(app: tauri::AppHandle, plugin_id: String, key: String) -> Result<(), String> {
    let path = storage_file_path(&app, &plugin_id)?;
    let mut map = read_json_map(&path);
    map.remove(&key);
    write_json_map(&path, &map)
}

#[tauri::command]
fn storage_get_all(app: tauri::AppHandle, plugin_id: String) -> Result<Map<String, Value>, String> {
    let path = storage_file_path(&app, &plugin_id)?;
    Ok(read_json_map(&path))
}

#[tauri::command]
fn storage_set_all(app: tauri::AppHandle, plugin_id: String, data: Map<String, Value>) -> Result<(), String> {
    let path = storage_file_path(&app, &plugin_id)?;
    write_json_map(&path, &data)
}

#[tauri::command]
fn get_wake_shortcut(app: tauri::AppHandle) -> String {
    let state = app.state::<WakeShortcutState>();
    state
        .current
        .lock()
        .map(|s| s.to_string())
        .unwrap_or_else(|_| DEFAULT_WAKE_SHORTCUT.to_string())
}

#[tauri::command]
fn set_wake_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    let raw = shortcut.trim();
    if raw.is_empty() {
        return Err("快捷键不能为空".to_string());
    }

    let next = Shortcut::from_str(raw).map_err(|e| format!("快捷键格式不合法: {e}"))?;
    let normalized = next.to_string();

    let state = app.state::<WakeShortcutState>();
    let mut guard = state.current.lock().map_err(|_| "内部状态锁失败".to_string())?;
    let prev = *guard;
    let was_paused = state.paused.lock().map(|g| *g).unwrap_or(false);

    if prev.id() == next.id() {
        let cfg_path = app_config_path(&app);
        let mut map = read_json_map(&cfg_path);
        map.insert(WAKE_SHORTCUT_KEY.to_string(), Value::String(normalized.clone()));
        write_json_map(&cfg_path, &map)?;
        *guard = next;

        if was_paused {
            app.global_shortcut()
                .on_shortcut(prev, move |app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    toggle_main_window(app);
                })
                .map_err(|e| format!("注册全局快捷键失败: {e}"))?;

            if let Ok(mut p) = state.paused.lock() {
                *p = false;
            }
        }
        return Ok(normalized);
    }

    // 先尝试注册新快捷键：避免先删后加导致用户短暂失去可用热键。
    app.global_shortcut()
        .on_shortcut(next, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            toggle_main_window(app);
        })
        .map_err(|e| format!("注册全局快捷键失败: {e}"))?;

    let cfg_path = app_config_path(&app);
    let mut map = read_json_map(&cfg_path);
    map.insert(WAKE_SHORTCUT_KEY.to_string(), Value::String(normalized.clone()));
    if let Err(e) = write_json_map(&cfg_path, &map) {
        let _ = app.global_shortcut().unregister(next);
        return Err(e);
    }

    let _ = app.global_shortcut().unregister(prev);
    *guard = next;
    if let Ok(mut p) = state.paused.lock() {
        *p = false;
    }
    Ok(normalized)
}

#[tauri::command]
fn pause_wake_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<WakeShortcutState>();
    let current = state.current.lock().map_err(|_| "内部状态锁失败".to_string())?;

    if let Ok(mut p) = state.paused.lock() {
        if *p {
            return Ok(());
        }
        let _ = app.global_shortcut().unregister(*current);
        *p = true;
    }

    Ok(())
}

#[tauri::command]
fn resume_wake_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<WakeShortcutState>();
    let current = state.current.lock().map_err(|_| "内部状态锁失败".to_string())?;

    let mut should_resume = false;
    if let Ok(p) = state.paused.lock() {
        should_resume = *p;
    }
    if !should_resume {
        return Ok(());
    }

    app.global_shortcut()
        .on_shortcut(*current, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            toggle_main_window(app);
        })
        .map_err(|e| format!("注册全局快捷键失败: {e}"))?;

    if let Ok(mut p) = state.paused.lock() {
        *p = false;
    }
    Ok(())
}

#[tauri::command]
fn get_auto_start(_app: tauri::AppHandle) -> AutoStartStatus {
    #[cfg(target_os = "windows")]
    {
        return AutoStartStatus {
            supported: true,
            enabled: auto_start::is_enabled(AUTO_START_REG_VALUE),
            scope: "currentUser",
        };
    }

    #[cfg(not(target_os = "windows"))]
    AutoStartStatus {
        supported: false,
        enabled: false,
        scope: "unsupported",
    }
}

#[tauri::command]
fn set_auto_start(app: tauri::AppHandle, enabled: bool) -> Result<AutoStartStatus, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = enabled;
        return Err("当前平台不支持开机自启设置".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let cfg_path = app_config_path(&app);
        let mut map = read_json_map(&cfg_path);

        let prev_registry = auto_start::is_enabled(AUTO_START_REG_VALUE);
        let next_registry = auto_start::set_enabled(AUTO_START_REG_VALUE, enabled)?;

        map.insert(AUTO_START_KEY.to_string(), Value::Bool(enabled));
        if let Err(e) = write_json_map(&cfg_path, &map) {
            let _ = auto_start::set_enabled(AUTO_START_REG_VALUE, prev_registry);
            return Err(e);
        }

        Ok(AutoStartStatus {
            supported: true,
            enabled: next_registry,
            scope: "currentUser",
        })
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_plugins_dir,
            get_data_dir,
            open_data_root_dir,
            open_data_dir,
            open_plugins_dir,
            list_plugins,
            read_plugin_file,
            read_plugins_dir,
            install_plugin_files,
            open_external_url,
            http_request,
            storage_get,
            storage_set,
            storage_remove,
            storage_get_all,
            storage_set_all,
            plugin_get_output_dir,
            plugin_pick_output_dir,
            plugin_open_output_dir,
            plugin_save_image_base64,
            plugin_list_output_images,
            plugin_read_output_image,
            plugin_delete_output_image,
            task_create,
            task_get,
            task_list,
            task_cancel,
            get_wake_shortcut,
            set_wake_shortcut,
            pause_wake_shortcut,
            resume_wake_shortcut,
            get_auto_start,
            set_auto_start
        ])
        .setup(|app| {
            app.manage(WindowState::default());
            app.manage(Arc::new(TaskManagerState::default()));

            let (wake_shortcut, wake_shortcut_text) = load_wake_shortcut(app.handle());
            app.manage(WakeShortcutState {
                current: Mutex::new(wake_shortcut),
                paused: Mutex::new(false),
            });

            // 仅当配置文件显式设置过 autoStart 时，才同步到系统自启（避免默认行为影响用户空间）。
            #[cfg(target_os = "windows")]
            {
                if let Some(pref) = load_auto_start_pref(app.handle()) {
                    let _ = auto_start::set_enabled(AUTO_START_REG_VALUE, pref);
                } else {
                    // 兼容历史遗留：用户可能在开发版开过自启（Run 项指向 target\\debug）。
                    // 这里不“开启”自启，只在它已存在时把路径修正到当前 exe。
                    let _ = auto_start::ensure_enabled_points_to_current_exe(AUTO_START_REG_VALUE);
                }
            }

            // 创建托盘菜单
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // 创建系统托盘
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            show_main_window(&app);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        show_main_window(app);
                    }
                })
                .build(app)?;

            // 注册全局快捷键（默认：Ctrl+Alt+Space，可在 data/app.json 的 wakeShortcut 配置）
            if let Err(e) = app.global_shortcut().on_shortcut(wake_shortcut, move |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                toggle_main_window(app);
            }) {
                eprintln!("Failed to register wake shortcut {}: {}", wake_shortcut_text, e);
            }

            Ok(())
        })
        // 监听窗口事件：失焦时隐藏
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle();
                let state = app.state::<WindowState>();
                save_position_if_valid(window, &state);
                let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
                let _ = window.hide();
                return;
            }
            if let WindowEvent::Moved(_) = event {
                let app = window.app_handle();
                let state = app.state::<WindowState>();
                save_position_if_valid(window, &state);
            }
            if let WindowEvent::Focused(focused) = event {
                if !focused {
                    // 失焦后延迟一点再隐藏：避免拖拽/系统瞬时失焦导致窗口“闪退”式消失
                    let window = window.clone();
                    let app = window.app_handle();
                    let state = app.state::<WindowState>();
                    save_position_if_valid(&window, &state);
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(120)).await;
                        if window.is_focused().unwrap_or(false) {
                            return;
                        }
                        // 先移到屏幕外再隐藏，避免系统动画
                        let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
                        let _ = window.hide();
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
