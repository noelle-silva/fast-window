#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Component, Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use tauri::ipc::Channel;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, EventTarget, Manager, WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

mod migrations;

const DEFAULT_WAKE_SHORTCUT: &str = "control+alt+Space";
const APP_STORAGE_ID: &str = "__app";
const APP_CONFIG_FILE: &str = "app.json";
const PLUGIN_OVERWRITE_PREFS_FILE: &str = "plugins-overwrite.json";
const WAKE_SHORTCUT_KEY: &str = "wakeShortcut";
const AUTO_START_KEY: &str = "autoStart";
const MAIN_WINDOW_BOUNDS_KEY: &str = "mainWindowBounds";
const PLUGIN_OUTPUT_DIRS_KEY: &str = "pluginOutputDirs";
const WEBVIEW_SETTINGS_KEY: &str = "webview";
const TASKS_RETENTION_LIMIT: usize = 120;
const TASKS_PER_PLUGIN_LIMIT: usize = 40;
static TASK_ID_SEQ: AtomicU32 = AtomicU32::new(0);
static HTTP_STREAM_ID_SEQ: AtomicU32 = AtomicU32::new(0);

// 避免开发版把“开机启动”写到正式版同一个注册表项里（会导致装了 MSI 以后仍然自启 debug exe）。
#[cfg(debug_assertions)]
const AUTO_START_REG_VALUE: &str = "Fast Window (Dev)";
#[cfg(not(debug_assertions))]
const AUTO_START_REG_VALUE: &str = "Fast Window";

const DATA_DIR_ENV: &str = "FAST_WINDOW_DATA_DIR";
const BROWSER_WINDOW_LABEL: &str = "browser";
const BROWSER_BAR_WINDOW_LABEL: &str = "browser_bar";
const ACTIVATE_PLUGIN_EVENT: &str = "fast-window:activate-plugin";
const WEBVIEW_SETTINGS_UPDATED_EVENT: &str = "fast-window:webview-settings-updated";
const BROWSER_BAR_HEIGHT: f64 = 40.0;
const BROWSER_STACK_TOTAL_HEIGHT: f64 = 605.0;
const WALLPAPER_SETTINGS_KEY: &str = "wallpaper";

#[cfg(windows)]
fn apply_bottom_rounded_corners(window: &tauri::WebviewWindow, radius_dip: f64) {
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, GDI_REGION_TYPE,
        RGN_OR,
    };

    let hwnd = match window.hwnd() {
        Ok(v) => v,
        Err(_) => return,
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = match window.outer_size() {
        Ok(v) => v,
        Err(_) => return,
    };

    let w = size.width as i32;
    let h = size.height as i32;
    if w <= 0 || h <= 0 {
        return;
    }

    let mut r = (radius_dip * scale).round() as i32;
    r = r.max(0).min(w / 2).min(h / 2);

    unsafe {
        // r=0：移除 region（恢复矩形窗口）
        if r == 0 {
            let _ = SetWindowRgn(hwnd, None, true);
            return;
        }

        // 先做“全圆角”的 round rect，再把顶部条形区域并回去 => 只保留底部两角圆角
        let round = CreateRoundRectRgn(0, 0, w + 1, h + 1, r * 2, r * 2);
        if round.0 == std::ptr::null_mut() {
            return;
        }
        let top = CreateRectRgn(0, 0, w + 1, r + 1);
        if top.0 == std::ptr::null_mut() {
            let _ = DeleteObject(round.into());
            return;
        }
        let combined = CreateRectRgn(0, 0, 0, 0);
        if combined.0 == std::ptr::null_mut() {
            let _ = DeleteObject(round.into());
            let _ = DeleteObject(top.into());
            return;
        }

        // combined = round OR top
        let ok = CombineRgn(Some(combined), Some(round), Some(top), RGN_OR);
        let _ = DeleteObject(round.into());
        let _ = DeleteObject(top.into());
        if ok == GDI_REGION_TYPE(0) {
            let _ = DeleteObject(combined.into());
            return;
        }

        // 成功后 combined 归系统所有，不能 DeleteObject
        if SetWindowRgn(hwnd, Some(combined), true) == 0 {
            let _ = DeleteObject(combined.into());
        }
    }
}

#[cfg(not(windows))]
fn apply_bottom_rounded_corners(_window: &tauri::WebviewWindow, _radius_dip: f64) {}

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponseBase64 {
    status: u16,
    headers: HashMap<String, String>,
    body_base64: String,
}

#[derive(Default)]
struct HttpStreamManagerState {
    cancels: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum HttpStreamEvent {
    Start {
        status: u16,
        headers: HashMap<String, String>,
    },
    Chunk {
        text: String,
    },
    End {
        canceled: bool,
    },
    Error {
        message: String,
    },
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
    handles: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
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
    let seq = TASK_ID_SEQ.fetch_add(1, Ordering::Relaxed);
    let rnd = format!("{:08x}", rand_u32(stamp ^ (seq as u64)));
    format!("task-{stamp}-{seq:08x}-{rnd}")
}

fn make_http_stream_id() -> String {
    let stamp = now_ms();
    let seq = HTTP_STREAM_ID_SEQ.fetch_add(1, Ordering::Relaxed);
    let rnd = format!("{:08x}", rand_u32(stamp ^ (seq as u64)));
    format!("httpstream-{stamp}-{seq:08x}-{rnd}")
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
    app: &AppHandle,
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

#[tauri::command]
async fn clipboard_write_image_data_url(app: tauri::AppHandle, data_url: String) -> Result<(), String> {
    let raw = data_url;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, _) = decode_base64_image_payload(&raw)?;
        let img = image::load_from_memory(&bytes).map_err(|e| format!("解码图片失败: {e}"))?;
        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();
        let image = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
        app2.clipboard()
            .write_image(&image)
            .map_err(|e| format!("写入图片剪贴板失败: {e}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("写入图片剪贴板失败: {e}"))?
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
    let mut u = url.trim().to_string();
    if u.chars().any(|c| c.is_whitespace()) {
        return Err("url 不允许包含空白字符，请先进行 URL 编码（例如空格用 %20）".to_string());
    }
    if u.contains('\\') {
        // 避免 Windows 上被当成路径导致 explorer 打开资源管理器。
        u = u.replace('\\', "/");
    }

    if !is_http_url(&u) {
        return Err("url 必须以 http(s):// 开头".to_string());
    }

    open::that(&u).map_err(|e| format!("打开链接失败: {e}"))?;
    Ok(())
}

#[tauri::command]
fn open_external_uri(uri: String) -> Result<(), String> {
    let mut u = uri.trim().to_string();
    if u.is_empty() {
        return Ok(());
    }
    if u.chars().any(|c| c.is_whitespace()) {
        return Err("uri 不允许包含空白字符，请先进行 URL 编码（例如空格用 %20）".to_string());
    }
    if u.contains('\\') {
        u = u.replace('\\', "/");
    }

    let parsed = tauri::Url::parse(&u).map_err(|e| format!("uri 解析失败: {e}"))?;
    let scheme = parsed.scheme().to_ascii_lowercase();
    // 避免把 Windows 路径（如 C:/xxx）误判成 scheme。
    if scheme.len() < 2 {
        return Err("uri scheme 不合法（太短）".to_string());
    }
    if scheme == "file" {
        return Err("不允许打开 file:// uri".to_string());
    }
    if scheme == "javascript" {
        return Err("不允许打开 javascript: uri".to_string());
    }

    open::that(parsed.as_str()).map_err(|e| format!("打开失败: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn open_browser_window(
    app: tauri::AppHandle,
    url: String,
    plugin_id: String,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let mut u = url.trim().to_string();
    if u.chars().any(|c| c.is_whitespace()) {
        return Err("url 不允许包含空白字符，请先进行 URL 编码（例如空格用 %20）".to_string());
    }
    if u.contains('\\') {
        u = u.replace('\\', "/");
    }
    if !is_http_url(&u) {
        return Err("url 必须以 http(s):// 开头".to_string());
    }

    let parsed = tauri::Url::parse(&u).map_err(|e| format!("url 解析失败: {e}"))?;

    {
        let state = app.state::<BrowserWindowState>();
        if let Ok(mut g) = state.return_to_plugin_id.lock() {
            *g = Some(plugin_id);
        }
        if let Ok(mut g) = state.active.lock() {
            *g = true;
        };
        if let Ok(mut g) = state.closing.lock() {
            *g = false;
        };
    }
    // 首次打开会经历“创建两个窗口 + 定位 + 聚焦”的抖动期，先加门闩避免误隐藏。
    browser_stack_set_suppress_hide(&app, 1500);

    // 进入“浏览栈模式”时隐藏主窗口：快捷键将优先唤醒这个浏览栈。
    // 首次打开时把主窗口位置当作浏览栈初始位置，避免“只顶部栏居中”造成的错位感。
    if !browser_stack_exists(&app) {
        if let Some(main) = app.get_webview_window("main") {
            if let Ok(pos) = main.outer_position() {
                if pos.x > -9000 && pos.y > -9000 {
                    let state = app.state::<BrowserWindowState>();
                    if let Ok(mut g) = state.last_position.lock() {
                        *g = Some(pos);
                    };
                }
            }
        }
    }
    hide_main_window(&app);

    if browser_stack_exists(&app) {
        if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
            let _ = w.navigate(parsed);
        }
        browser_stack_show(&app);
        return Ok(());
    }

    let title = "Web";
    let webview_settings = load_webview_settings(&app);
    let video_script = browser_video_injection_script(&webview_settings.video)?;

    let bar = tauri::WebviewWindowBuilder::new(
        &app,
        BROWSER_BAR_WINDOW_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title(title)
    .inner_size(1020.0, BROWSER_BAR_HEIGHT)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|e| format!("创建顶部栏窗口失败: {e}"))?;

    let app_ = app.clone();
    let content = tauri::WebviewWindowBuilder::new(
        &app,
        BROWSER_WINDOW_LABEL,
        tauri::WebviewUrl::External(parsed),
    )
    .title(title)
    .initialization_script(video_script)
    .on_new_window(move |url, _features| {
        // 很多网站会用 window.open / target=_blank 打开“新标签页”。
        // 我们没有标签页：把它折叠成“当前窗口跳转”。
        if is_http_url(url.as_str()) {
            if let Some(w) = app_.get_webview_window(BROWSER_WINDOW_LABEL) {
                let _ = w.navigate(url);
            }
        } else {
            let _ = open::that(url.as_str());
        }
        tauri::webview::NewWindowResponse::Deny
    })
    .inner_size(
        1020.0,
        (BROWSER_STACK_TOTAL_HEIGHT - BROWSER_BAR_HEIGHT).max(200.0),
    )
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(false)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|e| format!("创建浏览窗口失败: {e}"))?;

    // 让“网页主体窗口”只有底部两个角是圆角（顶部两个角会和顶部栏拼接，不要圆角）。
    apply_bottom_rounded_corners(&content, 16.0);

    // 初次创建时不要跟随 main（因为 main 已被移到屏幕外隐藏了），用浏览栈的恢复/居中逻辑。
    browser_stack_restore_or_center(&app);

    let _ = bar.show();
    let _ = content.show();
    let _ = content.set_focus();
    Ok(())
}

#[tauri::command]
async fn close_browser_window(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack_close(&app);
    Ok(())
}

#[tauri::command]
async fn hide_browser_stack(app: tauri::AppHandle) -> Result<(), String> {
    browser_stack_hide(&app);
    Ok(())
}

#[tauri::command]
async fn browser_go_back(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.eval("history.back()");
    }
    Ok(())
}

#[tauri::command]
async fn browser_go_forward(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.eval("history.forward()");
    }
    Ok(())
}

#[tauri::command]
async fn browser_reload(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.eval("location.reload()");
    }
    Ok(())
}

#[tauri::command]
fn get_webview_settings(app: tauri::AppHandle) -> WebviewSettings {
    load_webview_settings(&app)
}

#[tauri::command]
fn set_webview_settings(
    app: tauri::AppHandle,
    settings: WebviewSettings,
) -> Result<WebviewSettings, String> {
    let next = write_webview_settings(&app, settings)?;

    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        if let Ok(script) = browser_video_injection_script(&next.video) {
            let _ = w.eval(&script);
        }
    }

    let _ = app.emit_to(
        EventTarget::webview_window(BROWSER_BAR_WINDOW_LABEL),
        WEBVIEW_SETTINGS_UPDATED_EVENT,
        next.clone(),
    );
    let _ = app.emit_to(
        EventTarget::webview_window("main"),
        WEBVIEW_SETTINGS_UPDATED_EVENT,
        next.clone(),
    );

    Ok(next)
}

#[tauri::command]
fn browser_video_set_rate(app: tauri::AppHandle, rate: f64) -> Result<(), String> {
    let settings = load_webview_settings(&app);
    let r = clamp_video_rate(rate, settings.video.max_rate);

    let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) else {
        return Ok(());
    };

    let js = format!(
        r#"(function () {{
  try {{
    if (window.__fastwindowVideoSpeedToggleState) {{
      window.__fastwindowVideoSpeedToggleState.activeKey = null;
      window.__fastwindowVideoSpeedToggleState.prevRate = null;
    }}
    if (typeof window.__fastwindowVideoSpeedApplyRate === 'function') {{
      window.__fastwindowVideoSpeedApplyRate({r});
      return;
    }}
    const list = document.querySelectorAll('video');
    for (const v of list) {{
      try {{
        v.playbackRate = {r};
        v.defaultPlaybackRate = {r};
      }} catch (_) {{}}
    }}
    window.__fastwindowVideoSpeedCurrentRate = {r};
  }} catch (_) {{}}
}})();"#
    );
    let _ = w.eval(&js);
    Ok(())
}

#[tauri::command]
fn browser_video_toggle_preset(
    app: tauri::AppHandle,
    shortcut: String,
    rate: f64,
) -> Result<(), String> {
    let key = shortcut.trim();
    if key.is_empty() {
        return Err("shortcut 不能为空".to_string());
    }
    let settings = load_webview_settings(&app);
    let r = clamp_video_rate(rate, settings.video.max_rate);

    let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) else {
        return Ok(());
    };

    let key_js = serde_json::to_string(&key).map_err(|e| format!("序列化快捷键失败: {e}"))?;
    let js = format!(
        r#"(function () {{
  try {{
    if (typeof window.__fastwindowVideoSpeedTogglePreset === 'function') {{
      window.__fastwindowVideoSpeedTogglePreset({key_js}, {r});
      return;
    }}
    if (typeof window.__fastwindowVideoSpeedApplyRate === 'function') {{
      window.__fastwindowVideoSpeedApplyRate({r});
      return;
    }}
    const list = document.querySelectorAll('video');
    for (const v of list) {{
      try {{
        v.playbackRate = {r};
        v.defaultPlaybackRate = {r};
      }} catch (_) {{}}
    }}
    window.__fastwindowVideoSpeedCurrentRate = {r};
  }} catch (_) {{}}
}})();"#,
    );
    let _ = w.eval(&js);
    Ok(())
}

#[tauri::command]
async fn browser_stack_toggle_fullscreen(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<BrowserWindowState>();
    let next = state.fullscreen.lock().ok().map(|g| !*g).unwrap_or(true);
    browser_stack_apply_fullscreen(&app, next)?;
    Ok(())
}

fn browser_stack_set_always_on_top(app: &tauri::AppHandle, enable: bool) {
    if let Some(w) = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        let _ = w.set_always_on_top(enable);
    }
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.set_always_on_top(enable);
    }
}

fn browser_stack_is_pinned(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    state.pinned.lock().ok().map(|g| *g).unwrap_or(false)
}

#[tauri::command]
async fn browser_stack_get_pinned(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(browser_stack_is_pinned(&app))
}

#[tauri::command]
async fn browser_stack_toggle_pinned(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<BrowserWindowState>();
    let next = {
        let mut g = state
            .pinned
            .lock()
            .map_err(|_| "浏览窗口状态锁定失败".to_string())?;
        *g = !*g;
        *g
    };
    if next {
        // 保险：确保窗口处于置顶态
        browser_stack_set_always_on_top(&app, true);
    }
    Ok(next)
}

#[tauri::command]
async fn http_request(req: HttpRequest) -> Result<HttpResponse, String> {
    let (status, headers, bytes) = http_request_raw(req).await?;
    let body = String::from_utf8(bytes).map_err(|_| "响应不是 UTF-8 文本".to_string())?;
    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

#[tauri::command]
async fn http_request_base64(req: HttpRequest) -> Result<HttpResponseBase64, String> {
    let (status, headers, bytes) = http_request_raw(req).await?;
    let body_base64 = general_purpose::STANDARD.encode(bytes);
    Ok(HttpResponseBase64 {
        status,
        headers,
        body_base64,
    })
}

#[tauri::command]
async fn http_request_stream(
    app: tauri::AppHandle,
    req: HttpRequest,
    channel: Channel<HttpStreamEvent>,
) -> Result<String, String> {
    let stream_id = make_http_stream_id();
    let manager = app
        .state::<Arc<HttpStreamManagerState>>()
        .inner()
        .clone();

    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut cancels = manager
            .cancels
            .lock()
            .map_err(|_| "流式请求状态锁定失败".to_string())?;
        cancels.insert(stream_id.clone(), tx);
    }

    struct Cleanup {
        manager: Arc<HttpStreamManagerState>,
        stream_id: String,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if let Ok(mut cancels) = self.manager.cancels.lock() {
                cancels.remove(&self.stream_id);
            }
        }
    }

    let manager_clone = manager.clone();
    let stream_id_clone = stream_id.clone();
    tauri::async_runtime::spawn(async move {
        let _cleanup = Cleanup {
            manager: manager_clone,
            stream_id: stream_id_clone,
        };

        const MAX_TIMEOUT_MS: u64 = 15 * 60 * 1000;
        let (status, headers, mut resp) = match http_request_send(req, MAX_TIMEOUT_MS).await {
            Ok(v) => v,
            Err(e) => {
                let _ = channel.send(HttpStreamEvent::Error { message: e });
                let _ = channel.send(HttpStreamEvent::End { canceled: false });
                return;
            }
        };

        if channel
            .send(HttpStreamEvent::Start { status, headers })
            .is_err()
        {
            return;
        }

        const MAX_HTTP_STREAM_BYTES: usize = 50 * 1024 * 1024; // 50MB
        let mut total: usize = 0;
        let mut pending: Vec<u8> = Vec::new();

        let mut canceled = false;
        loop {
            tokio::select! {
                _ = &mut rx => {
                    canceled = true;
                    break;
                }
                chunk = resp.chunk() => {
                    match chunk {
                        Ok(Some(bytes)) => {
                            total = total.saturating_add(bytes.len());
                            if total > MAX_HTTP_STREAM_BYTES {
                                let _ = channel.send(HttpStreamEvent::Error { message: "响应过大（超过 50MB）".to_string() });
                                break;
                            }
                            pending.extend_from_slice(&bytes);

                            loop {
                                if pending.is_empty() { break; }
                                match std::str::from_utf8(&pending) {
                                    Ok(s) => {
                                        let text = s.to_string();
                                        pending.clear();
                                        if !text.is_empty()
                                            && channel.send(HttpStreamEvent::Chunk { text }).is_err()
                                        {
                                            return;
                                        }
                                    }
                                    Err(e) => {
                                        let n = e.valid_up_to();
                                        if n == 0 {
                                            // 无效 UTF-8：丢掉 1 字节避免卡死
                                            pending.remove(0);
                                            break;
                                        }
                                        let text = String::from_utf8_lossy(&pending[..n]).to_string();
                                        pending.drain(..n);
                                        if !text.is_empty() && channel.send(HttpStreamEvent::Chunk { text }).is_err() {
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                        Ok(None) => break,
                        Err(e) => {
                            let _ = channel.send(HttpStreamEvent::Error { message: format!("读取响应失败: {e}") });
                            break;
                        }
                    }
                }
            }
        }

        // flush pending utf8
        if !pending.is_empty() {
            if let Ok(s) = std::str::from_utf8(&pending) {
                let _ = channel.send(HttpStreamEvent::Chunk { text: s.to_string() });
            }
        }

        let _ = channel.send(HttpStreamEvent::End { canceled });
    });

    Ok(stream_id)
}

#[tauri::command]
fn http_request_stream_cancel(app: tauri::AppHandle, stream_id: String) -> Result<(), String> {
    if stream_id.trim().is_empty() {
        return Err("streamId 不能为空".to_string());
    }
    let manager = app
        .state::<Arc<HttpStreamManagerState>>()
        .inner()
        .clone();
    let tx = {
        let mut cancels = manager
            .cancels
            .lock()
            .map_err(|_| "流式请求状态锁定失败".to_string())?;
        cancels.remove(stream_id.trim())
    };
    if let Some(tx) = tx {
        let _ = tx.send(());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayTestChannelRequest {
    total: u32,
    delay_ms: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayTestChannelEvent {
    seq: u32,
    total: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayTestChannelResult {
    total: u32,
}

#[tauri::command]
async fn gateway_test_channel(
    req: GatewayTestChannelRequest,
    channel: Channel<GatewayTestChannelEvent>,
) -> Result<GatewayTestChannelResult, String> {
    let total = req.total.max(1).min(200);
    let delay_ms = req.delay_ms.unwrap_or(50).min(2_000);

    for seq in 1..=total {
        let _ = channel.send(GatewayTestChannelEvent { seq, total });
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }

    Ok(GatewayTestChannelResult { total })
}

async fn http_request_send(
    req: HttpRequest,
    timeout_cap_ms: u64,
) -> Result<(u16, HashMap<String, String>, reqwest::Response), String> {
    let method = req.method.trim().to_uppercase();
    if method.is_empty() {
        return Err("method 不能为空".to_string());
    }
    if !is_http_url(&req.url) {
        return Err("url 必须以 http(s):// 开头".to_string());
    }

    let timeout = Duration::from_millis(
        req.timeout_ms
            .unwrap_or(20_000)
            .min(timeout_cap_ms.max(10_000)),
    );
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("创建 http client 失败: {e}"))?;

    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| "不支持的 method".to_string())?;
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

    // JSON 里内嵌 data:image/... base64（例如多模态 chat）会非常大。
    // 这里给 body 做一个更现实的上限；否则参考图一上来就会“秒失败”。
    const MAX_HTTP_REQUEST_BODY_BYTES: usize = 12 * 1024 * 1024; // 12MB

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
        if body.len() > MAX_HTTP_REQUEST_BODY_BYTES {
            return Err(format!(
                "body 过大（{} > {}）",
                body.len(),
                MAX_HTTP_REQUEST_BODY_BYTES
            ));
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

    Ok((status, headers, resp))
}

async fn http_request_raw(
    req: HttpRequest,
) -> Result<(u16, HashMap<String, String>, Vec<u8>), String> {
    let (status, headers, resp) = http_request_send(req, 120_000).await?;

    // 图片相关的 JSON/base64 响应可能很大（尤其是 chat/completions 返回 b64）。
    // 这里做上限保护，避免插件拉取无限大响应导致内存爆炸。
    const MAX_HTTP_RESPONSE_BYTES: usize = 25 * 1024 * 1024; // 25MB

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    if bytes.len() > MAX_HTTP_RESPONSE_BYTES {
        return Err(format!(
            "响应过大（{} > {}）",
            bytes.len(),
            MAX_HTTP_RESPONSE_BYTES
        ));
    }
    Ok((status, headers, bytes.to_vec()))
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
fn task_create(
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
fn task_get(
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
fn task_list(
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
fn task_cancel(
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

#[derive(Default)]
struct WindowState {
    last_bounds: Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>,
    save_seq: AtomicU64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedWindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

struct BrowserWindowState {
    return_to_plugin_id: Mutex<Option<String>>,
    active: Mutex<bool>,
    last_position: Mutex<Option<tauri::PhysicalPosition<i32>>>,
    suppress_hide_until_ms: Mutex<u64>,
    fullscreen: Mutex<bool>,
    restore_bounds: Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>,
    pinned: Mutex<bool>,
    closing: Mutex<bool>,
}

impl Default for BrowserWindowState {
    fn default() -> Self {
        Self {
            return_to_plugin_id: Mutex::new(None),
            active: Mutex::new(false),
            last_position: Mutex::new(None),
            suppress_hide_until_ms: Mutex::new(0),
            fullscreen: Mutex::new(false),
            restore_bounds: Mutex::new(None),
            // 图钉：默认不启用（维持“失焦自动隐藏”的原交互）。
            pinned: Mutex::new(false),
            // 关闭防抖：我们有两个窗口（顶部栏 + 内容），关闭时需要避免 CloseRequested 互相触发导致循环。
            closing: Mutex::new(false),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivatePluginPayload {
    plugin_id: String,
}

struct WakeShortcutState {
    current: Mutex<Shortcut>,
    paused: Mutex<bool>,
}

trait Boundsable {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>>;
    fn inner_size(&self) -> tauri::Result<tauri::PhysicalSize<u32>>;
    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()>;
    fn set_size(&self, size: tauri::PhysicalSize<u32>) -> tauri::Result<()>;
    fn center(&self) -> tauri::Result<()>;
    fn available_monitors(&self) -> tauri::Result<Vec<tauri::Monitor>>;
}

impl Boundsable for tauri::Window {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>> {
        tauri::Window::outer_position(self)
    }

    fn inner_size(&self) -> tauri::Result<tauri::PhysicalSize<u32>> {
        tauri::Window::inner_size(self)
    }

    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()> {
        tauri::Window::set_position(self, position)
    }

    fn set_size(&self, size: tauri::PhysicalSize<u32>) -> tauri::Result<()> {
        tauri::Window::set_size(self, size)
    }

    fn center(&self) -> tauri::Result<()> {
        tauri::Window::center(self)
    }

    fn available_monitors(&self) -> tauri::Result<Vec<tauri::Monitor>> {
        tauri::Window::available_monitors(self)
    }
}

impl Boundsable for tauri::WebviewWindow {
    fn outer_position(&self) -> tauri::Result<tauri::PhysicalPosition<i32>> {
        tauri::WebviewWindow::outer_position(self)
    }

    fn inner_size(&self) -> tauri::Result<tauri::PhysicalSize<u32>> {
        tauri::WebviewWindow::inner_size(self)
    }

    fn set_position(&self, position: tauri::PhysicalPosition<i32>) -> tauri::Result<()> {
        tauri::WebviewWindow::set_position(self, position)
    }

    fn set_size(&self, size: tauri::PhysicalSize<u32>) -> tauri::Result<()> {
        tauri::WebviewWindow::set_size(self, size)
    }

    fn center(&self) -> tauri::Result<()> {
        tauri::WebviewWindow::center(self)
    }

    fn available_monitors(&self) -> tauri::Result<Vec<tauri::Monitor>> {
        tauri::WebviewWindow::available_monitors(self)
    }
}

fn save_bounds_if_valid(window: &impl Boundsable, state: &WindowState) {
    let Ok(pos) = window.outer_position() else {
        return;
    };
    // 隐藏时会把窗口移到屏幕外（-10000, -10000），不要把这种位置记成“上次位置”
    if pos.x <= -9000 || pos.y <= -9000 {
        return;
    }
    // 这里必须用 inner_size：Tauri 的 set_size 更接近“内容区大小”，
    // 如果用 outer_size 保存再用 set_size 恢复，会把边框/阴影重复叠加，导致每次唤醒都变大。
    let Ok(size) = window.inner_size() else {
        return;
    };
    // 极端情况下可能拿到 0；不要写入无效尺寸
    if size.width < 200 || size.height < 150 {
        return;
    }
    if let Ok(mut guard) = state.last_bounds.lock() {
        *guard = Some((pos, size));
    }
}

fn rect_intersects(
    a_pos: tauri::PhysicalPosition<i32>,
    a_size: tauri::PhysicalSize<u32>,
    b_pos: tauri::PhysicalPosition<i32>,
    b_size: tauri::PhysicalSize<u32>,
) -> bool {
    let ax1 = a_pos.x as i64;
    let ay1 = a_pos.y as i64;
    let ax2 = ax1 + a_size.width as i64;
    let ay2 = ay1 + a_size.height as i64;

    let bx1 = b_pos.x as i64;
    let by1 = b_pos.y as i64;
    let bx2 = bx1 + b_size.width as i64;
    let by2 = by1 + b_size.height as i64;

    ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1
}

fn clamp_i32(v: i32, min: i32, max: i32) -> i32 {
    if v < min {
        return min;
    }
    if v > max {
        return max;
    }
    v
}

fn restore_bounds_or_center(window: &impl Boundsable, state: &WindowState) {
    let last = state.last_bounds.lock().ok().and_then(|g| g.clone());

    if let Some((pos, size)) = last {
        let monitors = window.available_monitors().unwrap_or_default();
        if monitors.is_empty() {
            let _ = window.set_size(size);
            let _ = window.set_position(pos);
            return;
        }

        // 防御：之前版本如果把 outer_size 当成 set_size 的参数，会导致配置里记录的尺寸越存越大。
        // 这里按显示器 work area 把恢复尺寸/位置夹回合理范围，避免升级后第一次唤醒还炸屏。
        let mut picked: Option<tauri::PhysicalRect<i32, u32>> = None;
        for m in &monitors {
            let wa = *m.work_area();
            if rect_intersects(
                pos,
                size,
                wa.position,
                tauri::PhysicalSize::new(wa.size.width, wa.size.height),
            ) {
                picked = Some(wa);
                break;
            }
        }

        if let Some(wa) = picked {
            let max_w = wa.size.width.max(1);
            let max_h = wa.size.height.max(1);
            let next_size = tauri::PhysicalSize::new(size.width.min(max_w), size.height.min(max_h));

            let min_x = wa.position.x;
            let min_y = wa.position.y;
            let max_x = wa.position.x + wa.size.width as i32 - next_size.width as i32;
            let max_y = wa.position.y + wa.size.height as i32 - next_size.height as i32;
            let next_pos = tauri::PhysicalPosition::new(
                clamp_i32(pos.x, min_x, max_x),
                clamp_i32(pos.y, min_y, max_y),
            );

            let _ = window.set_size(next_size);
            let _ = window.set_position(next_pos);
            return;
        }
    }

    let _ = window.center();
}

fn load_main_window_bounds_from_config(
    app: &tauri::AppHandle,
) -> Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)> {
    let map = read_app_config_map(app);
    let raw = map.get(MAIN_WINDOW_BOUNDS_KEY)?.clone();
    let parsed = serde_json::from_value::<PersistedWindowBounds>(raw).ok()?;

    if parsed.x <= -9000 || parsed.y <= -9000 {
        return None;
    }
    if parsed.width < 200 || parsed.height < 150 {
        return None;
    }
    if parsed.width > 20000 || parsed.height > 20000 {
        return None;
    }

    Some((
        tauri::PhysicalPosition::new(parsed.x, parsed.y),
        tauri::PhysicalSize::new(parsed.width, parsed.height),
    ))
}

fn persist_main_window_bounds(app: &tauri::AppHandle, state: &WindowState) {
    let saved = state.last_bounds.lock().ok().and_then(|g| g.clone());
    let Some((pos, size)) = saved else {
        return;
    };

    let bounds = PersistedWindowBounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    };

    let mut map = read_app_config_map(app);
    let Ok(v) = serde_json::to_value(bounds) else {
        return;
    };
    map.insert(MAIN_WINDOW_BOUNDS_KEY.to_string(), v);
    if let Err(e) = write_app_config_map(app, &map) {
        eprintln!("[config] failed to persist main window bounds: {e}");
    }
}

fn schedule_persist_main_window_bounds(app: &tauri::AppHandle) {
    let state = app.state::<WindowState>();
    let next = state.save_seq.fetch_add(1, Ordering::Relaxed).saturating_add(1);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(350)).await;
        let state = app.state::<WindowState>();
        if state.save_seq.load(Ordering::Relaxed) != next {
            return;
        }
        persist_main_window_bounds(&app, &state);
    });
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
    app_data_dir(app).join(APP_STORAGE_ID).join(APP_CONFIG_FILE)
}

fn app_config_legacy_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join(APP_CONFIG_FILE)
}

fn app_plugin_overwrite_prefs_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app)
        .join(APP_STORAGE_ID)
        .join(PLUGIN_OVERWRITE_PREFS_FILE)
}

fn read_json_map_opt(path: &Path) -> Option<Map<String, Value>> {
    if !path.is_file() {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let v = serde_json::from_str::<Value>(&content).ok()?;
    match v {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

fn read_app_config_map(app: &tauri::AppHandle) -> Map<String, Value> {
    let p = app_config_path(app);
    if let Some(map) = read_json_map_opt(&p) {
        return map;
    }
    let legacy = app_config_legacy_path(app);
    read_json_map_opt(&legacy).unwrap_or_else(Map::new)
}

fn write_app_config_map(app: &tauri::AppHandle, map: &Map<String, Value>) -> Result<(), String> {
    let p = app_config_path(app);
    write_json_map(&p, map)
}

fn read_plugin_overwrite_prefs(app: &tauri::AppHandle) -> BTreeMap<String, bool> {
    let p = app_plugin_overwrite_prefs_path(app);
    let Some(map) = read_json_map_opt(&p) else {
        return BTreeMap::new();
    };

    let mut out: BTreeMap<String, bool> = BTreeMap::new();
    for (k, v) in map {
        if !is_safe_id(&k) {
            continue;
        }
        if let Some(b) = v.as_bool() {
            out.insert(k, b);
        }
    }
    out
}

fn write_plugin_overwrite_prefs(
    app: &tauri::AppHandle,
    prefs: &BTreeMap<String, bool>,
) -> Result<(), String> {
    let p = app_plugin_overwrite_prefs_path(app);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }

    let mut obj = Map::<String, Value>::new();
    for (k, v) in prefs {
        obj.insert(k.clone(), Value::Bool(*v));
    }
    let out = serde_json::to_string_pretty(&Value::Object(obj))
        .map_err(|e| format!("序列化覆盖更新配置失败: {e}"))?;
    std::fs::write(&p, format!("{out}\n")).map_err(|e| format!("写入覆盖更新配置失败: {e}"))?;
    Ok(())
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

fn plugin_default_ref_images_dir(app: &tauri::AppHandle, plugin_id: &str) -> PathBuf {
    // 插件私有图片存放在 data/<pluginId>/ref-images（不走可配置输出目录，避免混入用户空间）
    app_data_dir(app).join(plugin_id).join("ref-images")
}

fn read_plugin_output_dir_from_config(app: &tauri::AppHandle, plugin_id: &str) -> Option<PathBuf> {
    let map = read_app_config_map(app);
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

fn write_plugin_output_dir_to_config(
    app: &tauri::AppHandle,
    plugin_id: &str,
    dir: &Path,
) -> Result<(), String> {
    let mut map = read_app_config_map(app);

    let v = map
        .entry(PLUGIN_OUTPUT_DIRS_KEY.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !v.is_object() {
        *v = Value::Object(Map::new());
    }
    let obj = v.as_object_mut().unwrap();
    obj.insert(
        plugin_id.to_string(),
        Value::String(dir.to_string_lossy().to_string()),
    );

    write_app_config_map(app, &map)
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

fn write_json_map(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let content = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|e| format!("序列化配置失败: {e}"))?;

    let parent = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let tmp = parent.join(format!(".tmp-{name}-{stamp}.json"));

    std::fs::write(&tmp, &content).map_err(|e| format!("写入临时配置失败: {e}"))?;

    // 尽量原子替换，避免写入过程中进程退出导致配置文件半写/空文件。
    match std::fs::rename(&tmp, path) {
        Ok(_) => {}
        Err(_) => {
            // Windows 上 rename 不能覆盖已有文件：先删再试；仍失败则退回 copy。
            if path.exists() {
                let _ = std::fs::remove_file(path);
                if std::fs::rename(&tmp, path).is_ok() {
                    return Ok(());
                }
            }
            std::fs::copy(&tmp, path).map_err(|e| format!("写入配置失败: {e}"))?;
            let _ = std::fs::remove_file(&tmp);
        }
    }
    Ok(())
}

fn read_json_value(path: &Path) -> Result<Value, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("读取配置失败: {e}"))?;
    serde_json::from_str::<Value>(&content).map_err(|e| format!("解析 JSON 失败: {e}"))
}

fn write_json_value(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|e| format!("序列化配置失败: {e}"))?;

    let parent = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "value".to_string());
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let tmp = parent.join(format!(".tmp-{name}-{stamp}.json"));

    std::fs::write(&tmp, &content).map_err(|e| format!("写入临时配置失败: {e}"))?;

    match std::fs::rename(&tmp, path) {
        Ok(_) => {}
        Err(_) => {
            if path.exists() {
                let _ = std::fs::remove_file(path);
                if std::fs::rename(&tmp, path).is_ok() {
                    return Ok(());
                }
            }
            std::fs::copy(&tmp, path).map_err(|e| format!("写入配置失败: {e}"))?;
            let _ = std::fs::remove_file(&tmp);
        }
    }
    Ok(())
}

static STORAGE_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

fn storage_lock_for(plugin_id: &str) -> Arc<Mutex<()>> {
    let locks = STORAGE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = locks.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(v) = guard.get(plugin_id) {
        return v.clone();
    }
    let v = Arc::new(Mutex::new(()));
    guard.insert(plugin_id.to_string(), v.clone());
    v
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebviewVideoSpeedPreset {
    label: String,
    rate: f64,
    #[serde(default)]
    shortcut: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebviewVideoSettings {
    default_rate: f64,
    max_rate: f64,
    #[serde(default)]
    presets: Vec<WebviewVideoSpeedPreset>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebviewSettings {
    video: WebviewVideoSettings,
}

impl Default for WebviewVideoSettings {
    fn default() -> Self {
        Self {
            default_rate: 1.0,
            max_rate: 16.0,
            presets: vec![
                WebviewVideoSpeedPreset {
                    label: "1x".to_string(),
                    rate: 1.0,
                    shortcut: None,
                },
                WebviewVideoSpeedPreset {
                    label: "1.5x".to_string(),
                    rate: 1.5,
                    shortcut: None,
                },
                WebviewVideoSpeedPreset {
                    label: "2x".to_string(),
                    rate: 2.0,
                    shortcut: None,
                },
            ],
        }
    }
}

impl Default for WebviewSettings {
    fn default() -> Self {
        Self {
            video: WebviewVideoSettings::default(),
        }
    }
}

fn clamp_video_rate(rate: f64, max_rate: f64) -> f64 {
    let max_rate = if max_rate.is_finite() { max_rate } else { 16.0 };
    let max_rate = max_rate.max(0.25).min(16.0);
    let mut r = if rate.is_finite() { rate } else { 1.0 };
    r = r.max(0.25).min(max_rate);
    (r * 100.0).round() / 100.0
}

fn normalize_shortcut(raw: &str) -> Option<(String, bool)> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }

    let mut has_modifier = false;
    let mut control = false;
    let mut alt = false;
    let mut shift = false;
    let mut super_key = false;

    let parts: Vec<&str> = s
        .split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }

    let code = parts[parts.len() - 1];
    if code.eq_ignore_ascii_case("control")
        || code.eq_ignore_ascii_case("ctrl")
        || code.eq_ignore_ascii_case("alt")
        || code.eq_ignore_ascii_case("shift")
        || code.eq_ignore_ascii_case("super")
        || code.eq_ignore_ascii_case("meta")
        || code.eq_ignore_ascii_case("cmd")
    {
        return None;
    }

    for p in &parts[..parts.len() - 1] {
        if p.eq_ignore_ascii_case("control") || p.eq_ignore_ascii_case("ctrl") {
            control = true;
            has_modifier = true;
        } else if p.eq_ignore_ascii_case("alt") {
            alt = true;
            has_modifier = true;
        } else if p.eq_ignore_ascii_case("shift") {
            shift = true;
            has_modifier = true;
        } else if p.eq_ignore_ascii_case("super")
            || p.eq_ignore_ascii_case("meta")
            || p.eq_ignore_ascii_case("cmd")
        {
            super_key = true;
            has_modifier = true;
        } else {
            return None;
        }
    }

    let mut out: Vec<String> = Vec::new();
    if control {
        out.push("control".to_string());
    }
    if alt {
        out.push("alt".to_string());
    }
    if shift {
        out.push("shift".to_string());
    }
    if super_key {
        out.push("super".to_string());
    }
    out.push(code.to_string());
    Some((out.join("+"), has_modifier))
}

fn sanitize_webview_settings_for_load(mut settings: WebviewSettings) -> WebviewSettings {
    settings.video.max_rate = clamp_video_rate(settings.video.max_rate, 16.0);
    settings.video.default_rate =
        clamp_video_rate(settings.video.default_rate, settings.video.max_rate);

    let mut seen_shortcuts: HashMap<String, ()> = HashMap::new();
    let mut presets: Vec<WebviewVideoSpeedPreset> = Vec::new();
    for mut p in settings.video.presets.into_iter().take(64) {
        p.rate = clamp_video_rate(p.rate, settings.video.max_rate);
        p.label = p.label.trim().to_string();
        if p.label.is_empty() {
            p.label = format!("{}x", p.rate);
        }

        p.shortcut = match p.shortcut.take().and_then(|s| normalize_shortcut(&s)) {
            Some((normalized, _has_modifier)) => {
                if seen_shortcuts.contains_key(&normalized) {
                    None
                } else {
                    seen_shortcuts.insert(normalized.clone(), ());
                    Some(normalized)
                }
            }
            _ => None,
        };

        presets.push(p);
    }

    settings.video.presets = presets;
    settings
}

fn validate_webview_settings_for_save(
    mut settings: WebviewSettings,
) -> Result<WebviewSettings, String> {
    settings.video.max_rate = clamp_video_rate(settings.video.max_rate, 16.0);
    settings.video.default_rate =
        clamp_video_rate(settings.video.default_rate, settings.video.max_rate);

    let mut seen_shortcuts: HashMap<String, ()> = HashMap::new();
    let mut presets: Vec<WebviewVideoSpeedPreset> = Vec::new();
    for (idx, mut p) in settings.video.presets.into_iter().take(64).enumerate() {
        p.rate = clamp_video_rate(p.rate, settings.video.max_rate);
        p.label = p.label.trim().to_string();
        if p.label.is_empty() {
            p.label = format!("{}x", p.rate);
        }

        if let Some(raw) = p.shortcut.take() {
            let raw = raw.trim().to_string();
            if raw.is_empty() {
                p.shortcut = None;
            } else {
                let Some((normalized, has_modifier)) = normalize_shortcut(&raw) else {
                    return Err(format!("预设快捷键格式不合法（第 {} 条）", idx + 1));
                };
                let _ = has_modifier;
                if seen_shortcuts.contains_key(&normalized) {
                    return Err(format!("快捷键重复: {normalized}"));
                }
                seen_shortcuts.insert(normalized.clone(), ());
                p.shortcut = Some(normalized);
            }
        }

        presets.push(p);
    }

    settings.video.presets = presets;
    Ok(settings)
}

fn load_webview_settings(app: &tauri::AppHandle) -> WebviewSettings {
    let map = read_app_config_map(app);
    let v = map
        .get(WEBVIEW_SETTINGS_KEY)
        .cloned()
        .unwrap_or(Value::Null);
    let parsed = serde_json::from_value::<WebviewSettings>(v).unwrap_or_default();
    sanitize_webview_settings_for_load(parsed)
}

fn write_webview_settings(
    app: &tauri::AppHandle,
    settings: WebviewSettings,
) -> Result<WebviewSettings, String> {
    let mut map = read_app_config_map(app);
    let normalized = validate_webview_settings_for_save(settings)?;
    map.insert(
        WEBVIEW_SETTINGS_KEY.to_string(),
        serde_json::to_value(normalized.clone()).map_err(|e| format!("序列化配置失败: {e}"))?,
    );
    write_app_config_map(app, &map)?;
    Ok(normalized)
}

fn browser_video_injection_script(video: &WebviewVideoSettings) -> Result<String, String> {
    let json = serde_json::to_string(video).map_err(|e| format!("序列化配置失败: {e}"))?;
    let quoted = serde_json::to_string(&json).map_err(|e| format!("序列化配置失败: {e}"))?;

    Ok(format!(
        r#"(function () {{
  const cfg = JSON.parse({quoted});
  const clamp = (r) => {{
    const max = (Number.isFinite(cfg.maxRate) ? cfg.maxRate : 16);
    const max2 = Math.min(16, Math.max(0.25, max));
    const v = (Number.isFinite(r) ? r : 1);
    return Math.min(max2, Math.max(0.25, v));
  }};

  const normalizeEvent = (e) => {{
    const parts = [];
    if (e.ctrlKey) parts.push('control');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('super');
    const code = typeof e.code === 'string' ? e.code : '';
    if (!code || code === 'Unidentified') return null;
    parts.push(code);
    return parts.join('+');
  }};

  const isEditable = (t) => {{
    try {{
      const el = t && t.nodeType === 1 ? t : null;
      if (!el) return false;
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      if (typeof el.closest === 'function' && el.closest('[contenteditable=\"true\"],[role=\"textbox\"]')) return true;
      return false;
    }} catch (_) {{
      return false;
    }}
  }};

  const applyRate = (rate) => {{
    const r = clamp(rate);
    const list = document.querySelectorAll('video');
    for (const v of list) {{
      try {{
        v.playbackRate = r;
        v.defaultPlaybackRate = r;
      }} catch (_) {{}}
    }}
    return r;
  }};

  const ensure = () => {{
    const r = applyRate(cfg.defaultRate);
    window.__fastwindowVideoSpeedCurrentRate = r;
    window.__fastwindowVideoSpeedToggleState = {{ activeKey: null, prevRate: null }};
  }};

  if (!window.__fastwindowVideoSpeedInstalled) {{
    window.__fastwindowVideoSpeedInstalled = true;

    window.__fastwindowVideoSpeedApplyRate = (rate) => {{
      const r = applyRate(rate);
      window.__fastwindowVideoSpeedCurrentRate = r;
      return r;
    }};

    window.__fastwindowVideoSpeedTogglePreset = (key, rate) => {{
      try {{
        const st = window.__fastwindowVideoSpeedToggleState || {{ activeKey: null, prevRate: null }};
        if (st.activeKey === key) {{
          const back = (typeof st.prevRate === 'number') ? st.prevRate : cfg.defaultRate;
          st.activeKey = null;
          st.prevRate = null;
          window.__fastwindowVideoSpeedToggleState = st;
          return window.__fastwindowVideoSpeedApplyRate(back);
        }}
        const cur = (typeof window.__fastwindowVideoSpeedCurrentRate === 'number')
          ? window.__fastwindowVideoSpeedCurrentRate
          : cfg.defaultRate;
        st.activeKey = key;
        st.prevRate = cur;
        window.__fastwindowVideoSpeedToggleState = st;
        return window.__fastwindowVideoSpeedApplyRate(rate);
      }} catch (_) {{
        return window.__fastwindowVideoSpeedApplyRate(rate);
      }}
    }};

    window.addEventListener('keydown', (e) => {{
      try {{
        if (e.repeat) return;
        if (isEditable(e.target)) return;
        const key = normalizeEvent(e);
        if (!key) return;
        const presets = Array.isArray(window.__fastwindowVideoSpeedConfig?.presets)
          ? window.__fastwindowVideoSpeedConfig.presets
          : [];
        for (const p of presets) {{
          if (!p || typeof p.shortcut !== 'string') continue;
          if (p.shortcut === key && typeof p.rate === 'number') {{
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            window.__fastwindowVideoSpeedTogglePreset(key, p.rate);
            return;
          }}
        }}
      }} catch (_) {{}}
    }}, true);

    let scheduled = false;
    const scheduleApply = () => {{
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {{
        scheduled = false;
        try {{
          if (typeof window.__fastwindowVideoSpeedCurrentRate !== 'number') return;
          applyRate(window.__fastwindowVideoSpeedCurrentRate);
        }} catch (_) {{}}
      }}, 200);
    }};
    const obs = new MutationObserver(scheduleApply);
    obs.observe(document.documentElement || document, {{ childList: true, subtree: true }});
  }}

  window.__fastwindowVideoSpeedConfig = cfg;
  ensure();
}})();"#,
    ))
}

fn decode_base64_image_payload(raw: &str) -> Result<(Vec<u8>, String), String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("图片数据为空".to_string());
    }

    // data URL: data:image/png;base64,....
    if s.starts_with("data:") {
        let base64_pos = s
            .find("base64,")
            .ok_or_else(|| "data URL 缺少 base64,".to_string())?;
        let meta = &s["data:".len()..base64_pos];
        let b64 = &s[(base64_pos + "base64,".len())..];

        let ext = if meta.contains("image/png") {
            "png"
        } else if meta.contains("image/gif") {
            "gif"
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
fn plugin_pick_output_dir(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Option<String>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    struct AlwaysOnTopGuard {
        window: Option<tauri::WebviewWindow>,
    }
    impl Drop for AlwaysOnTopGuard {
        fn drop(&mut self) {
            if let Some(w) = self.window.take() {
                let _ = w.set_always_on_top(true);
            }
        }
    }
    let mut guard = AlwaysOnTopGuard { window: None };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(false);
        guard.window = Some(w);
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
fn plugin_pick_dir(app: tauri::AppHandle, plugin_id: String) -> Result<Option<String>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    struct AlwaysOnTopGuard {
        window: Option<tauri::WebviewWindow>,
    }
    impl Drop for AlwaysOnTopGuard {
        fn drop(&mut self) {
            if let Some(w) = self.window.take() {
                let _ = w.set_always_on_top(true);
            }
        }
    }
    let mut guard = AlwaysOnTopGuard { window: None };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(false);
        guard.window = Some(w);
    }

    let picked = rfd::FileDialog::new().set_title("选择文件夹").pick_folder();
    let Some(dir) = picked else {
        return Ok(None);
    };
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
fn plugin_open_dir(_app: tauri::AppHandle, plugin_id: String, dir: String) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let s = dir.trim();
    if s.is_empty() {
        return Err("dir 不能为空".to_string());
    }

    let p = PathBuf::from(s);
    if !p.is_absolute() {
        return Err("dir 必须是绝对路径".to_string());
    }
    if !p.exists() {
        return Err("目录不存在".to_string());
    }
    if !p.is_dir() {
        return Err("路径不是目录".to_string());
    }

    open_dir_in_file_manager(&p)
}

fn resolve_plugin_files_root(
    app: &tauri::AppHandle,
    plugin_id: &str,
    scope: &str,
) -> Result<PathBuf, String> {
    match scope {
        // 插件私有数据：data/<pluginId>/files
        "data" => Ok(app_data_dir(app).join(plugin_id).join("files")),
        // 用户输出目录：可配置（默认 data/<pluginId>/output-images，历史命名，避免破坏用户空间）
        "output" => Ok(resolve_plugin_output_dir(app, plugin_id)),
        _ => Err("scope 不支持（仅支持 data/output）".to_string()),
    }
}

fn resolve_existing_file_in_scope(
    app: &tauri::AppHandle,
    plugin_id: &str,
    scope: &str,
    path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let root = resolve_plugin_files_root(app, plugin_id, scope)?;
    ensure_writable_dir(&root)?;
    let root_c = std::fs::canonicalize(&root).map_err(|e| format!("文件根目录不可用: {e}"))?;

    let raw = path.trim();
    if raw.is_empty() {
        return Err("path 不能为空".to_string());
    }

    let input = PathBuf::from(raw);
    let full = if input.is_absolute() {
        input
    } else {
        let rel = safe_relative_path(raw)?;
        root.join(rel)
    };
    if !full.exists() {
        return Err("文件不存在".to_string());
    }
    let full_c = std::fs::canonicalize(&full).map_err(|e| format!("文件路径无效: {e}"))?;
    if !full_c.starts_with(&root_c) {
        return Err("文件路径越界".to_string());
    }
    Ok((root_c, full_c))
}

fn resolve_write_path_in_scope(
    app: &tauri::AppHandle,
    plugin_id: &str,
    scope: &str,
    rel_path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let root = resolve_plugin_files_root(app, plugin_id, scope)?;
    ensure_writable_dir(&root)?;
    let root_c = std::fs::canonicalize(&root).map_err(|e| format!("文件根目录不可用: {e}"))?;

    let rp = rel_path.trim();
    if rp.is_empty() {
        return Err("path 不能为空".to_string());
    }
    let rel = safe_relative_path(rp)?;
    let full = root.join(rel);

    let parent = full
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| root.clone());
    std::fs::create_dir_all(&parent).map_err(|e| format!("创建目录失败: {e}"))?;
    let parent_c = std::fs::canonicalize(&parent).map_err(|e| format!("目录路径无效: {e}"))?;
    if !parent_c.starts_with(&root_c) {
        return Err("文件路径越界".to_string());
    }
    Ok((root_c, full))
}

fn file_mime_by_ext(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html",
        "txt" => "text/plain",
        "json" => "application/json",
        "css" => "text/css",
        "js" => "text/javascript",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    }
}

fn decode_base64_payload(data: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
    let s = data.trim();
    if s.is_empty() {
        return Err("数据为空".to_string());
    }

    let b64 = if s.starts_with("data:") {
        // data:<mime>;base64,<payload>
        let Some((_meta, payload)) = s.split_once(',') else {
            return Err("data URL 格式不合法".to_string());
        };
        if !s.contains(";base64,") {
            return Err("仅支持 base64 data URL".to_string());
        }
        payload.trim()
    } else {
        s
    };

    if b64.len() > 120 * 1024 * 1024 {
        return Err("base64 数据过大".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    if bytes.len() > max_bytes {
        return Err("文件过大".to_string());
    }
    Ok(bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginFsEntry {
    name: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
    #[serde(rename = "isFile")]
    is_file: bool,
    size: u64,
    modified_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginFilesListDirReq {
    scope: String,
    dir: Option<String>,
}

#[tauri::command]
fn plugin_files_list_dir(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesListDirReq,
) -> Result<Vec<PluginFsEntry>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();

    let root = resolve_plugin_files_root(&app, &plugin_id, &scope)?;
    ensure_writable_dir(&root)?;
    let root_c = std::fs::canonicalize(&root).map_err(|e| format!("文件根目录不可用: {e}"))?;

    let dir_rel = req.dir.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let dir = if let Some(dr) = dir_rel {
        let rel = safe_relative_path(&dr)?;
        let full = root.join(rel);
        std::fs::create_dir_all(&full).map_err(|e| format!("创建目录失败: {e}"))?;
        let full_c = std::fs::canonicalize(&full).map_err(|e| format!("目录路径无效: {e}"))?;
        if !full_c.starts_with(&root_c) {
            return Err("目录路径越界".to_string());
        }
        full_c
    } else {
        root_c.clone()
    };

    let mut out: Vec<PluginFsEntry> = Vec::new();
    let rd = std::fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata().map_err(|e| format!("读取目录项元信息失败: {e}"))?;
        let modified = meta.modified().unwrap_or(UNIX_EPOCH);
        let modified_ms = modified
            .duration_since(UNIX_EPOCH)
            .unwrap_or_else(|_| Duration::from_millis(0))
            .as_millis() as u64;
        out.push(PluginFsEntry {
            name,
            is_directory: meta.is_dir(),
            is_file: meta.is_file(),
            size: meta.len(),
            modified_ms,
        });
    }

    out.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    Ok(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginFilesReadTextReq {
    scope: String,
    path: String,
}

#[tauri::command]
fn plugin_files_read_text(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesReadTextReq,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let (_root_c, full_c) = resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if !full_c.is_file() {
        return Err("文件不存在".to_string());
    }

    const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;
    let bytes = std::fs::read(&full_c).map_err(|e| format!("读取文件失败: {e}"))?;
    if bytes.len() > MAX_TEXT_BYTES {
        return Err("文本文件过大".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "文本不是 UTF-8 编码".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginFilesWriteTextReq {
    scope: String,
    path: String,
    text: String,
    overwrite: Option<bool>,
}

#[tauri::command]
fn plugin_files_write_text(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesWriteTextReq,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let overwrite = req.overwrite.unwrap_or(false);
    let (_root_c, full) = resolve_write_path_in_scope(&app, &plugin_id, &scope, &req.path)?;

    const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;
    if req.text.as_bytes().len() > MAX_TEXT_BYTES {
        return Err("文本过大".to_string());
    }

    if full.exists() && !overwrite {
        return Err("文件已存在（overwrite=false）".to_string());
    }
    std::fs::write(&full, req.text.as_bytes()).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(full.to_string_lossy().to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginFilesReadBase64Req {
    scope: String,
    path: String,
}

#[tauri::command]
fn plugin_files_read_base64(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesReadBase64Req,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let (_root_c, full_c) = resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if !full_c.is_file() {
        return Err("文件不存在".to_string());
    }

    const MAX_BYTES: usize = 50 * 1024 * 1024;
    let bytes = std::fs::read(&full_c).map_err(|e| format!("读取文件失败: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err("文件过大".to_string());
    }
    let mime = file_mime_by_ext(&full_c);
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginFilesWriteBase64Req {
    scope: String,
    path: String,
    data_url_or_base64: String,
    overwrite: Option<bool>,
}

#[tauri::command]
fn plugin_files_write_base64(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesWriteBase64Req,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let overwrite = req.overwrite.unwrap_or(false);
    let (_root_c, full) = resolve_write_path_in_scope(&app, &plugin_id, &scope, &req.path)?;

    const MAX_BYTES: usize = 50 * 1024 * 1024;
    let bytes = decode_base64_payload(&req.data_url_or_base64, MAX_BYTES)?;
    if full.exists() && !overwrite {
        return Err("文件已存在（overwrite=false）".to_string());
    }
    std::fs::write(&full, bytes).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(full.to_string_lossy().to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginFilesRenameReq {
    scope: String,
    from: String,
    to: String,
    overwrite: Option<bool>,
}

#[tauri::command]
fn plugin_files_rename(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesRenameReq,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let overwrite = req.overwrite.unwrap_or(false);

    let (_root_c, from_c) = resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.from)?;
    if !from_c.is_file() {
        return Err("源文件不存在".to_string());
    }

    let (_root_c2, to) = resolve_write_path_in_scope(&app, &plugin_id, &scope, &req.to)?;
    if to.exists() && !overwrite {
        return Err("目标已存在（overwrite=false）".to_string());
    }
    std::fs::rename(&from_c, &to).map_err(|e| format!("重命名失败: {e}"))?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginFilesDeleteReq {
    scope: String,
    path: String,
}

#[tauri::command]
fn plugin_files_delete(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesDeleteReq,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let (root_c, full_c) = resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if !full_c.is_file() {
        return Err("文件不存在".to_string());
    }
    std::fs::remove_file(&full_c).map_err(|e| format!("删除文件失败: {e}"))?;

    // 仅清理 plugin 私有 data scope 产生的空目录；output scope 不做清理（避免误删用户目录结构）。
    if scope == "data" {
        let mut cur = full_c.parent().map(|p| p.to_path_buf());
        while let Some(dir) = cur {
            if dir == root_c {
                break;
            }
            let Ok(mut rd) = std::fs::read_dir(&dir) else {
                break;
            };
            if rd.next().is_some() {
                break;
            }
            let _ = std::fs::remove_dir(&dir);
            cur = dir.parent().map(|p| p.to_path_buf());
        }
    }

    Ok(())
}

#[tauri::command]
fn path_has_image_ext(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif")
}

fn normalize_image_ext(ext: &str) -> String {
    let e = ext.trim().to_ascii_lowercase();
    if e == "jpeg" {
        "jpg".to_string()
    } else {
        e
    }
}

fn image_ext_from_path(path: &Path) -> Option<String> {
    let ext = path.extension().and_then(|s| s.to_str())?;
    Some(normalize_image_ext(ext))
}

fn resolve_plugin_images_root(
    app: &tauri::AppHandle,
    plugin_id: &str,
    scope: &str,
) -> Result<PathBuf, String> {
    match scope {
        // 插件私有数据：固定在 data/<pluginId>/ref-images（历史目录，保留以避免破坏旧数据）
        "data" => Ok(plugin_default_ref_images_dir(app, plugin_id)),
        // 用户输出目录：可配置（默认 data/<pluginId>/output-images）
        "output" => Ok(resolve_plugin_output_dir(app, plugin_id)),
        _ => Err("scope 不支持（仅支持 data/output）".to_string()),
    }
}

fn resolve_image_path_in_scope(
    app: &tauri::AppHandle,
    plugin_id: &str,
    scope: &str,
    path: &str,
    must_exist: bool,
) -> Result<(PathBuf, PathBuf), String> {
    let root = resolve_plugin_images_root(app, plugin_id, scope)?;
    ensure_writable_dir(&root)?;
    let root_c = std::fs::canonicalize(&root).map_err(|e| format!("图片目录不可用: {e}"))?;

    let raw = path.trim();
    if raw.is_empty() {
        return Err("图片路径不能为空".to_string());
    }

    let input = PathBuf::from(raw);
    let full = if input.is_absolute() {
        input
    } else {
        let rel = safe_relative_path(raw)?;
        root.join(rel)
    };

    if must_exist {
        if !full.exists() {
            return Err("图片不存在".to_string());
        }
        let full_c = std::fs::canonicalize(&full).map_err(|e| format!("图片路径无效: {e}"))?;
        if !full_c.starts_with(&root_c) {
            return Err("图片路径越界".to_string());
        }
        return Ok((root_c, full_c));
    }

    // must_exist=false：用于写入，full 可能尚不存在；改为校验 parent 目录是否仍在 root 内。
    let parent = full.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| root.clone());
    std::fs::create_dir_all(&parent).map_err(|e| format!("创建目录失败: {e}"))?;
    let parent_c = std::fs::canonicalize(&parent).map_err(|e| format!("目录路径无效: {e}"))?;
    if !parent_c.starts_with(&root_c) {
        return Err("图片路径越界".to_string());
    }
    Ok((root_c, full))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginImagesWriteBase64Req {
    scope: String,
    data_url_or_base64: String,
    rel_path: Option<String>,
    overwrite: Option<bool>,
}

#[tauri::command]
fn plugin_images_write_base64(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginImagesWriteBase64Req,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let scope = req.scope.trim().to_string();
    let data = req.data_url_or_base64;
    let rel_path = req
        .rel_path
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let overwrite = req.overwrite.unwrap_or(false);

    let (bytes, payload_ext) = decode_base64_image_payload(&data)?;
    let payload_ext = normalize_image_ext(&payload_ext);

    if let Some(rp) = rel_path {
        let rel = safe_relative_path(&rp)?;
        if !path_has_image_ext(&rel) {
            return Err("不支持的图片类型（仅支持 png/jpg/jpeg/webp/gif）".to_string());
        }
        let Some(rel_ext) = image_ext_from_path(&rel) else {
            return Err("图片路径缺少后缀".to_string());
        };
        if rel_ext != payload_ext {
            return Err("图片类型与目标后缀不一致".to_string());
        }

        let (_root_c, full) = resolve_image_path_in_scope(&app, &plugin_id, &scope, &rp, false)?;
        if full.exists() && !overwrite {
            return Err("图片已存在（overwrite=false）".to_string());
        }
        std::fs::write(&full, bytes).map_err(|e| format!("写入图片失败: {e}"))?;
        return Ok(full.to_string_lossy().to_string());
    }

    let root = resolve_plugin_images_root(&app, &plugin_id, &scope)?;
    ensure_writable_dir(&root)?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let filename = format!("image-{stamp}.{payload_ext}");
    let full = root.join(filename);

    std::fs::write(&full, bytes).map_err(|e| format!("写入图片失败: {e}"))?;
    Ok(full.to_string_lossy().to_string())
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
        "gif" => "image/gif",
        _ => "image/png",
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginImagesListReq {
    scope: String,
    dir: Option<String>,
}

#[tauri::command]
fn plugin_images_list(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginImagesListReq,
) -> Result<Vec<String>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let scope = req.scope.trim().to_string();
    let root = resolve_plugin_images_root(&app, &plugin_id, &scope)?;
    ensure_writable_dir(&root)?;
    let root_c = std::fs::canonicalize(&root).map_err(|e| format!("图片目录不可用: {e}"))?;

    let dir_rel = req.dir.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let dir = if let Some(dr) = dir_rel {
        let rel = safe_relative_path(&dr)?;
        let full = root.join(rel);
        std::fs::create_dir_all(&full).map_err(|e| format!("创建目录失败: {e}"))?;
        let full_c = std::fs::canonicalize(&full).map_err(|e| format!("目录路径无效: {e}"))?;
        if !full_c.starts_with(&root_c) {
            return Err("目录路径越界".to_string());
        }
        full_c
    } else {
        root_c.clone()
    };

    let mut items: Vec<(SystemTime, PathBuf)> = Vec::new();
    let rd = std::fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {e}"))?;
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginImagesReadReq {
    scope: String,
    path: String,
}

#[tauri::command]
fn plugin_images_read(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginImagesReadReq,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let scope = req.scope.trim().to_string();
    let (_root_c, full_c) = resolve_image_path_in_scope(&app, &plugin_id, &scope, &req.path, true)?;

    if !full_c.is_file() {
        return Err("图片不存在".to_string());
    }
    if !path_has_image_ext(&full_c) {
        return Err("不支持的图片类型".to_string());
    }

    let bytes = std::fs::read(&full_c).map_err(|e| format!("读取图片失败: {e}"))?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("图片过大".to_string());
    }
    let mime = image_mime_by_ext(&full_c);
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginImagesDeleteReq {
    scope: String,
    path: String,
}

#[tauri::command]
fn plugin_images_delete(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginImagesDeleteReq,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let scope = req.scope.trim().to_string();
    let (root_c, full_c) = resolve_image_path_in_scope(&app, &plugin_id, &scope, &req.path, true)?;

    if !full_c.is_file() {
        return Err("图片不存在".to_string());
    }
    if !path_has_image_ext(&full_c) {
        return Err("不支持的图片类型".to_string());
    }

    std::fs::remove_file(&full_c).map_err(|e| format!("删除图片失败: {e}"))?;

    // 仅清理 plugin 私有 data scope 产生的空目录；output scope 不做清理（避免误删用户目录结构）。
    if scope == "data" {
        let mut cur = full_c.parent().map(|p| p.to_path_buf());
        while let Some(dir) = cur {
            if dir == root_c {
                break;
            }
            let Ok(mut rd) = std::fs::read_dir(&dir) else {
                break;
            };
            if rd.next().is_some() {
                break;
            }
            let _ = std::fs::remove_dir(&dir);
            cur = dir.parent().map(|p| p.to_path_buf());
        }
    }

    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginPickedImage {
    name: String,
    data_url: String,
}

#[tauri::command]
fn plugin_pick_images(
    app: tauri::AppHandle,
    plugin_id: String,
    max_count: Option<usize>,
) -> Result<Vec<PluginPickedImage>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let max = max_count.unwrap_or(8).clamp(1, 20);
    struct AlwaysOnTopGuard {
        window: Option<tauri::WebviewWindow>,
    }
    impl Drop for AlwaysOnTopGuard {
        fn drop(&mut self) {
            if let Some(w) = self.window.take() {
                let _ = w.set_always_on_top(true);
            }
        }
    }
    let mut guard = AlwaysOnTopGuard { window: None };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(false);
        guard.window = Some(w);
    }
    let picked = rfd::FileDialog::new()
        .set_title("选择图片")
        .add_filter("Image", &["png", "jpg", "jpeg", "webp", "gif"])
        .pick_files();

    let Some(files) = picked else {
        return Ok(vec![]);
    };

    const MAX_BYTES: usize = 10 * 1024 * 1024; // 10MB
    let mut out: Vec<PluginPickedImage> = Vec::new();
    for path in files.into_iter().take(max) {
        if !path.is_file() || !path_has_image_ext(&path) {
            continue;
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("读取图片失败: {e}"))?;
        if bytes.len() > MAX_BYTES {
            return Err("图片过大（> 10MB）".to_string());
        }
        let mime = image_mime_by_ext(&path);
        let b64 = general_purpose::STANDARD.encode(bytes);
        let data_url = format!("data:{mime};base64,{b64}");
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("image")
            .to_string();
        out.push(PluginPickedImage { name, data_url });
    }
    Ok(out)
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
    let map = read_app_config_map(app);

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
        let flags = if read_only {
            KEY_READ
        } else {
            KEY_READ | KEY_WRITE
        };
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
    let map = read_app_config_map(app);

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
                raw, cfg_path, e
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
        restore_bounds_or_center(&window, &state);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<WindowState>();
        save_bounds_if_valid(&window, &state);
        persist_main_window_bounds(app, &state);
        let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
        let _ = window.hide();
    }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            hide_main_window(app);
        } else {
            show_main_window(app);
        }
    }
}

fn emit_activate_plugin_if_any(app: &tauri::AppHandle) {
    let state = app.state::<BrowserWindowState>();
    let pid = state
        .return_to_plugin_id
        .lock()
        .ok()
        .and_then(|g| g.clone());
    if let Some(plugin_id) = pid {
        let _ = app.emit_to(
            EventTarget::webview_window("main"),
            ACTIVATE_PLUGIN_EVENT,
            ActivatePluginPayload { plugin_id },
        );
    }
}

fn browser_stack_exists(app: &tauri::AppHandle) -> bool {
    app.get_webview_window(BROWSER_BAR_WINDOW_LABEL).is_some()
        && app.get_webview_window(BROWSER_WINDOW_LABEL).is_some()
}

fn browser_stack_is_visible(app: &tauri::AppHandle) -> bool {
    let bar = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL);
    let content = app.get_webview_window(BROWSER_WINDOW_LABEL);
    bar.as_ref()
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
        && content
            .as_ref()
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
}

fn browser_stack_is_focused(app: &tauri::AppHandle) -> bool {
    let bar = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL);
    let content = app.get_webview_window(BROWSER_WINDOW_LABEL);
    bar.as_ref()
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
        || content
            .as_ref()
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false)
}

fn browser_stack_set_suppress_hide(app: &tauri::AppHandle, duration_ms: u64) {
    let state = app.state::<BrowserWindowState>();
    let until = now_ms().saturating_add(duration_ms);
    if let Ok(mut g) = state.suppress_hide_until_ms.lock() {
        *g = (*g).max(until);
    };
}

fn browser_stack_should_suppress_hide(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    let until = state
        .suppress_hide_until_ms
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(0);
    now_ms() < until
}

fn browser_stack_restore_or_center(app: &tauri::AppHandle) {
    let bar = match app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        Some(w) => w,
        None => return,
    };
    let content = match app.get_webview_window(BROWSER_WINDOW_LABEL) {
        Some(w) => w,
        None => return,
    };

    let state = app.state::<BrowserWindowState>();
    let saved = state.last_position.lock().ok().and_then(|g| g.clone());

    if let Some(pos) = saved {
        let _ = bar.set_position(pos);
    } else {
        // 让“整个浏览栈（顶部栏+网页）”居中，而不是只让顶部栏居中。
        let bar_size = bar.outer_size().ok();
        let content_size = content.outer_size().ok();
        let total_w = bar_size
            .map(|s| s.width)
            .or_else(|| content_size.map(|s| s.width))
            .unwrap_or(1020);
        let total_h = bar_size
            .map(|s| s.height)
            .unwrap_or(BROWSER_BAR_HEIGHT.round().max(1.0) as u32)
            .saturating_add(content_size.map(|s| s.height).unwrap_or(565));

        let monitor = bar
            .primary_monitor()
            .ok()
            .flatten()
            .or_else(|| bar.current_monitor().ok().flatten());
        if let Some(m) = monitor {
            let wa = *m.work_area();
            let x = wa.position.x + ((wa.size.width as i32 - total_w as i32) / 2);
            let y = wa.position.y + ((wa.size.height as i32 - total_h as i32) / 2);
            let _ = bar.set_position(tauri::PhysicalPosition::new(x, y));
        } else {
            let _ = bar.center();
        }
    }

    let bar_pos = bar.outer_position().ok();
    let bar_h = bar
        .inner_size()
        .ok()
        .map(|s| s.height)
        .unwrap_or(BROWSER_BAR_HEIGHT.round().max(1.0) as u32);
    if let Some(p) = bar_pos {
        let _ = content.set_position(tauri::PhysicalPosition::new(p.x, p.y + bar_h as i32));
    }
}

fn browser_stack_show(app: &tauri::AppHandle) {
    if !browser_stack_exists(app) {
        return;
    }
    // 显示/聚焦时会有短暂的焦点抖动，避免误触发“失焦隐藏”。
    browser_stack_set_suppress_hide(app, 800);
    browser_stack_restore_or_center(app);
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        apply_bottom_rounded_corners(&w, 16.0);
    }

    if let Some(w) = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        let _ = w.show();
    }
    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn browser_stack_hide(app: &tauri::AppHandle) {
    let bar = match app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        Some(w) => w,
        None => return,
    };
    let content = match app.get_webview_window(BROWSER_WINDOW_LABEL) {
        Some(w) => w,
        None => return,
    };

    let state = app.state::<BrowserWindowState>();
    if let Ok(pos) = bar.outer_position() {
        // 隐藏时会把窗口移到屏幕外（-10000, -10000），不要把这种位置记成“上次位置”
        if pos.x > -9000 && pos.y > -9000 {
            if let Ok(mut g) = state.last_position.lock() {
                *g = Some(pos);
            }
        }
    }

    let _ = bar.set_position(tauri::PhysicalPosition::new(-10000, -10000));
    let _ = content.set_position(tauri::PhysicalPosition::new(-10000, -10000));
    let _ = bar.hide();
    let _ = content.hide();
}

fn browser_stack_end_session(app: &tauri::AppHandle) {
    browser_stack_hide(app);
    let state = app.state::<BrowserWindowState>();
    if let Ok(mut g) = state.active.lock() {
        *g = false;
    }
    if let Ok(mut g) = state.fullscreen.lock() {
        *g = false;
    }
    if let Ok(mut g) = state.restore_bounds.lock() {
        *g = None;
    }
    emit_activate_plugin_if_any(app);
    show_main_window(app);
}

fn browser_stack_is_closing(app: &tauri::AppHandle) -> bool {
    let state = app.state::<BrowserWindowState>();
    state.closing.lock().ok().map(|g| *g).unwrap_or(false)
}

fn browser_stack_set_closing(app: &tauri::AppHandle, closing: bool) {
    let state = app.state::<BrowserWindowState>();
    if let Ok(mut g) = state.closing.lock() {
        *g = closing;
    };
}

fn browser_stack_close(app: &tauri::AppHandle) {
    // “关闭浏览”应当真正销毁 WebView：否则只是 hide，会导致网页音频继续播放。
    browser_stack_set_closing(app, true);
    browser_stack_end_session(app);

    if let Some(w) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window(BROWSER_BAR_WINDOW_LABEL) {
        let _ = w.close();
    }
}

fn browser_stack_apply_fullscreen(app: &tauri::AppHandle, enable: bool) -> Result<(), String> {
    let bar = app
        .get_webview_window(BROWSER_BAR_WINDOW_LABEL)
        .ok_or_else(|| "顶部栏窗口不存在".to_string())?;
    let content = app
        .get_webview_window(BROWSER_WINDOW_LABEL)
        .ok_or_else(|| "浏览窗口不存在".to_string())?;

    let state = app.state::<BrowserWindowState>();

    // 如果窗口处于“最大化”状态，set_size/set_position 可能会被系统忽略。
    let _ = bar.unmaximize();
    let _ = content.unmaximize();

    if enable {
        // 记录“还原边界”（只记录一次，避免全屏状态下覆盖）
        if let Ok(mut g) = state.restore_bounds.lock() {
            if g.is_none() {
                let pos = bar
                    .outer_position()
                    .unwrap_or(tauri::PhysicalPosition::new(0, 0));
                let bar_size = bar
                    .outer_size()
                    .unwrap_or(tauri::PhysicalSize::new(1020, BROWSER_BAR_HEIGHT as u32));
                let content_size = content.outer_size().unwrap_or(tauri::PhysicalSize::new(
                    1020,
                    (BROWSER_STACK_TOTAL_HEIGHT - BROWSER_BAR_HEIGHT) as u32,
                ));
                let total = tauri::PhysicalSize::new(
                    bar_size.width,
                    bar_size.height.saturating_add(content_size.height),
                );
                *g = Some((pos, total));
            }
        }

        let monitor = bar
            .current_monitor()
            .map_err(|e| format!("读取显示器信息失败: {e}"))?
            .or_else(|| bar.primary_monitor().ok().flatten())
            .ok_or_else(|| "无法获取显示器信息".to_string())?;

        let wa = *monitor.work_area();
        let pos = wa.position;
        let size = wa.size;

        let scale = monitor.scale_factor();
        let bar_h = (BROWSER_BAR_HEIGHT * scale).round().max(1.0) as u32;
        let content_h = size.height.saturating_sub(bar_h).max(1);

        let _ = bar.set_position(pos);
        let _ = bar.set_size(tauri::PhysicalSize::new(size.width, bar_h));

        let _ = content.set_position(tauri::PhysicalPosition::new(pos.x, pos.y + bar_h as i32));
        let _ = content.set_size(tauri::PhysicalSize::new(size.width, content_h));
        apply_bottom_rounded_corners(&content, 16.0);

        if let Ok(mut g) = state.fullscreen.lock() {
            *g = true;
        }
        // 布局调整期间焦点会抖动，避免误隐藏
        browser_stack_set_suppress_hide(app, 1200);
        let _ = bar.show();
        let _ = content.show();
        let _ = content.set_focus();
        return Ok(());
    }

    // disable
    let restore = state.restore_bounds.lock().ok().and_then(|g| g.clone());
    let (pos, total) = if let Some(v) = restore {
        v
    } else {
        let pos = state
            .last_position
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .unwrap_or(tauri::PhysicalPosition::new(0, 0));
        (
            pos,
            tauri::PhysicalSize::new(1020, BROWSER_STACK_TOTAL_HEIGHT.round().max(200.0) as u32),
        )
    };

    let scale = bar.scale_factor().unwrap_or(1.0);
    let bar_h = (BROWSER_BAR_HEIGHT * scale).round().max(1.0) as u32;
    let content_h = total.height.saturating_sub(bar_h).max(1);

    let _ = bar.set_position(pos);
    let _ = bar.set_size(tauri::PhysicalSize::new(total.width, bar_h));

    let _ = content.set_position(tauri::PhysicalPosition::new(pos.x, pos.y + bar_h as i32));
    let _ = content.set_size(tauri::PhysicalSize::new(total.width, content_h));
    apply_bottom_rounded_corners(&content, 16.0);

    if let Ok(mut g) = state.fullscreen.lock() {
        *g = false;
    }
    if let Ok(mut g) = state.restore_bounds.lock() {
        *g = None;
    }
    browser_stack_set_suppress_hide(app, 800);
    let _ = bar.show();
    let _ = content.show();
    let _ = content.set_focus();
    Ok(())
}

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

fn replace_dir_from_tmp(dst: &Path, tmp: &Path, tag: &str) -> Result<(), String> {
    let Some(parent) = dst.parent() else {
        let _ = std::fs::remove_dir_all(tmp);
        return Err("目标目录没有父目录".to_string());
    };

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();

    let safe_tag: String = tag
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let bak = parent.join(format!(".bak-{safe_tag}-{stamp}"));

    // Windows 上 remove_dir_all 可能“删到一半失败”（文件被占用），会留下空壳目录。
    // 这里用 rename 交换：要么完整替换成功，要么原目录保持不动。
    if dst.exists() {
        if let Err(e) = std::fs::rename(dst, &bak) {
            let _ = std::fs::remove_dir_all(tmp);
            return Err(format!("重命名旧目录失败（可能被占用）: {e}"));
        }
    }

    if let Err(e) = std::fs::rename(tmp, dst) {
        // 回滚：尽力把旧目录改回去
        if bak.exists() {
            let _ = std::fs::rename(&bak, dst);
        }
        let _ = std::fs::remove_dir_all(tmp);
        return Err(format!("替换目录失败: {e}"));
    }

    if bak.exists() {
        let _ = std::fs::remove_dir_all(&bak);
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

#[cfg(not(debug_assertions))]
fn seed_plugins_from_resources(app: &tauri::AppHandle) {
    let plugins_dir = app_plugins_dir(app);
    let _ = std::fs::create_dir_all(&plugins_dir);

    let Ok(resource_dir) = app.path().resource_dir() else {
        return;
    };
    // tauri 的 resources 支持 glob，且当资源路径在 src-tauri 目录之外时，
    // bundler 会把它们放到 resource_dir/_up_/... 下。
    // 优先使用种子目录 plugin-seeds，避免与运行时 plugins/ 目录重名导致便携模式冲突。
    // 兼容布局：
    // - resource_dir/plugin-seeds
    // - resource_dir/_up_/plugin-seeds
    // - legacy: resource_dir/plugins
    // - legacy: resource_dir/_up_/plugins
    let bundled_plugins = {
        let direct = resource_dir.join("plugin-seeds");
        if direct.is_dir() {
            direct
        } else {
            let up = resource_dir.join("_up_").join("plugin-seeds");
            if up.is_dir() {
                up
            } else {
                let legacy = resource_dir.join("plugins");
                if legacy.is_dir() {
                    legacy
                } else {
                    let legacy_up = resource_dir.join("_up_").join("plugins");
                    if legacy_up.is_dir() {
                        legacy_up
                    } else {
                        return;
                    }
                }
            }
        }
    };

    let Ok(entries) = std::fs::read_dir(&bundled_plugins) else {
        return;
    };

    let overwrite_prefs = read_plugin_overwrite_prefs(app);

    for e in entries.flatten() {
        let Ok(ty) = e.file_type() else {
            continue;
        };
        if !ty.is_dir() {
            continue;
        }
        let plugin_id = e.file_name().to_string_lossy().to_string();
        if !is_safe_id(&plugin_id) {
            continue;
        }

        let dst = plugins_dir.join(&plugin_id);
        let src_dir = e.path();

        if !dst.exists() {
            let _ = copy_dir_all(&src_dir, &dst);
            continue;
        }

        // 用户空间优先：目标不是目录则不动。
        if !dst.is_dir() {
            continue;
        }

        // 默认：允许覆盖更新；仅当用户显式设置为 false 时才禁止。
        if overwrite_prefs.get(&plugin_id).copied().unwrap_or(true) == false {
            continue;
        }

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_else(|_| Duration::from_millis(0))
            .as_millis();
        let tmp_dir = plugins_dir.join(format!(".tmp-seed-{plugin_id}-{stamp}"));
        if tmp_dir.exists() {
            let _ = std::fs::remove_dir_all(&tmp_dir);
        }
        if copy_dir_all(&src_dir, &tmp_dir).is_err() {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            continue;
        }

        // 覆盖更新：只要用户允许，就直接用随包版本替换（不做任何版本/manifest 跳过判断）。
        if replace_dir_from_tmp(&dst, &tmp_dir, &format!("seed-{plugin_id}")).is_err() {
            // 失败就跳过：不能破坏用户空间（尤其是 Windows 上文件占用时）。
            continue;
        }
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
        fn collect_referenced_seed_files(manifest: &Value) -> Result<Vec<String>, String> {
            let mut out: Vec<String> = Vec::new();
            out.push("manifest.json".to_string());

            let main = manifest
                .get("main")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if main.is_empty() {
                return Err("manifest.main is required".to_string());
            }
            let _ = safe_relative_path(&main)?;
            out.push(main.clone());

            let bg_main = manifest
                .get("background")
                .and_then(|v| v.as_object())
                .and_then(|obj| obj.get("main"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if !bg_main.is_empty() && bg_main != main {
                let _ = safe_relative_path(&bg_main)?;
                out.push(bg_main);
            }

            let icon = manifest
                .get("icon")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if icon.starts_with("svg:") {
                let rel = icon["svg:".len()..].trim().to_string();
                if !rel.is_empty() && rel.to_ascii_lowercase().ends_with(".svg") {
                    let _ = safe_relative_path(&rel)?;
                    out.push(rel);
                }
            }

            // 去重（保持稳定顺序）
            let mut seen = std::collections::HashSet::<String>::new();
            out.retain(|p| seen.insert(p.clone()));
            Ok(out)
        }

        fn sync_repo_plugins_into(
            repo_plugins: &Path,
            plugins_dir: &Path,
        ) -> Result<(), String> {
            let Ok(entries) = std::fs::read_dir(repo_plugins) else {
                return Ok(());
            };

            for e in entries.flatten() {
                let Ok(ty) = e.file_type() else { continue };
                if !ty.is_dir() {
                    continue;
                }
                let plugin_id = e.file_name().to_string_lossy().to_string();
                if plugin_id.starts_with('.') || !is_safe_id(&plugin_id) {
                    continue;
                }

                let src = e.path();
                let manifest_path = src.join("manifest.json");
                if !manifest_path.is_file() {
                    continue;
                }

                let manifest_raw = match std::fs::read_to_string(&manifest_path) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let manifest: Value = match serde_json::from_str(&manifest_raw) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let files = match collect_referenced_seed_files(&manifest) {
                    Ok(v) => v,
                    Err(_) => vec!["manifest.json".to_string()],
                };

                let dst = plugins_dir.join(&plugin_id);
                let _ = std::fs::create_dir_all(&dst);
                for rel in files {
                    let from = src.join(&rel);
                    let to = dst.join(&rel);
                    if let Some(parent) = to.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    // dev 同步：尽力覆盖写入；失败不阻断其它插件（不破坏用户空间）
                    let _ = std::fs::copy(&from, &to);
                }
            }

            Ok(())
        }

        let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
        let repo_plugins = workspace_root.join("plugins");
        if repo_plugins.is_dir() && !same_path(&repo_plugins, &plugins_dir) {
            // 每次都覆盖同步：以仓库为真源。
            // 只同步运行时需要的最小集合（manifest/main/bg/icon），避免 node_modules 等大目录拖慢/失败。
            let _ = sync_repo_plugins_into(&repo_plugins, &plugins_dir);
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

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn percent_decode_query_component(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' => {
                if i + 2 >= bytes.len() {
                    return None;
                }
                let hi = hex_val(bytes[i + 1])?;
                let lo = hex_val(bytes[i + 2])?;
                out.push((hi << 4) | lo);
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

fn query_get_param(uri: &tauri::http::Uri, key: &str) -> Option<String> {
    let q = uri.query()?;
    for part in q.split('&') {
        if part.is_empty() {
            continue;
        }
        let (k_raw, v_raw) = part.split_once('=').unwrap_or((part, ""));
        let k = percent_decode_query_component(k_raw).unwrap_or_else(|| k_raw.to_string());
        if k != key {
            continue;
        }
        let v = percent_decode_query_component(v_raw).unwrap_or_else(|| v_raw.to_string());
        return Some(v);
    }
    None
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
        // 目录里没有 manifest.json 就不认为是插件，避免空目录/残留目录造成噪音。
        if !e.path().join("manifest.json").is_file() {
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
fn read_plugin_file(
    app: tauri::AppHandle,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let rel = safe_relative_path(&path)?;

    let plugin_dir = app_plugins_dir(&app).join(&plugin_id);
    let full = plugin_dir.join(rel);
    std::fs::read_to_string(&full).map_err(|e| format!("读取插件文件失败: {e}"))
}

#[tauri::command]
fn read_plugin_file_base64(
    app: tauri::AppHandle,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let rel = safe_relative_path(&path)?;

    let plugin_dir = app_plugins_dir(&app).join(&plugin_id);
    let full = plugin_dir.join(rel);
    let bytes = std::fs::read(&full).map_err(|e| format!("读取插件文件失败: {e}"))?;
    if bytes.len() > 512 * 1024 {
        return Err("图标文件过大（>512KB）".to_string());
    }
    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn set_plugin_allow_overwrite_on_update(
    app: tauri::AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let plugin_dir = app_plugins_dir(&app).join(&plugin_id);
    if !plugin_dir.is_dir() || !plugin_dir.join("manifest.json").is_file() {
        return Err("插件不存在或缺少 manifest.json".to_string());
    }

    let mut prefs = read_plugin_overwrite_prefs(&app);
    // 默认：true。只持久化 false（禁用）即可，避免文件变大。
    if enabled {
        prefs.remove(&plugin_id);
    } else {
        prefs.insert(plugin_id, false);
    }
    write_plugin_overwrite_prefs(&app, &prefs)?;
    Ok(())
}

#[tauri::command]
fn get_plugins_allow_overwrite_on_update(app: tauri::AppHandle) -> Vec<String> {
    let prefs = read_plugin_overwrite_prefs(&app);
    let ids = list_plugins(app.clone());
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        // 默认：true。仅当 prefs 显式为 false 时才禁用。
        if prefs.get(&id).copied().unwrap_or(true) == false {
            continue;
        }
        out.push(id);
    }
    out.sort();
    out
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
        let ty = e
            .file_type()
            .map_err(|e| format!("读取目录项类型失败: {e}"))?;
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

    if let Err(e) = replace_dir_from_tmp(&plugin_dir, &tmp_dir, &format!("install-{plugin_id}")) {
        return Err(format!("安装插件失败: {e}"));
    }
    Ok(())
}

fn storage_file_path(app: &tauri::AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    // 统一：每个插件的数据都放在 data/<pluginId>/ 目录内，避免 data 根目录杂乱。
    // legacy：历史遗留存储文件（对象 map）。新版存储使用 storage/<key>.json。
    Ok(app_data_dir(app).join(plugin_id).join("storage.json"))
}

fn storage_flat_legacy_file_path(app: &tauri::AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    Ok(app_data_dir(app).join(format!("{plugin_id}.json")))
}

fn storage_kv_dir_path(app: &tauri::AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    Ok(app_data_dir(app).join(plugin_id).join("storage"))
}

fn storage_value_path(app: &tauri::AppHandle, plugin_id: &str, key: &str) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let k = key.replace('\\', "/");
    if k.trim().is_empty() {
        return Err("key 不能为空".to_string());
    }
    if k.ends_with('/') {
        return Err("key 不允许以 / 结尾".to_string());
    }
    let rel = safe_relative_path(&k)?;
    let dir = storage_kv_dir_path(app, plugin_id)?;
    let mut full = dir.join(rel);

    let name = full
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "value".to_string());
    full.set_file_name(format!("{name}.json"));
    Ok(full)
}

fn read_json_object_map(path: &Path) -> Option<Map<String, Value>> {
    let v = read_json_value(path).ok()?;
    match v {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

fn read_legacy_storage_value(app: &tauri::AppHandle, plugin_id: &str, key: &str) -> Option<Value> {
    let legacy_storage_json = storage_file_path(app, plugin_id).ok();
    if let Some(p) = legacy_storage_json.as_ref().filter(|p| p.is_file()) {
        if let Some(map) = read_json_object_map(p) {
            if let Some(v) = map.get(key) {
                return Some(v.clone());
            }
        }
    }

    let legacy_flat = storage_flat_legacy_file_path(app, plugin_id).ok();
    if let Some(p) = legacy_flat.as_ref().filter(|p| p.is_file()) {
        if let Some(map) = read_json_object_map(p) {
            if let Some(v) = map.get(key) {
                return Some(v.clone());
            }
        }
    }

    None
}

fn read_legacy_storage_all(app: &tauri::AppHandle, plugin_id: &str) -> Vec<Map<String, Value>> {
    let mut out: Vec<Map<String, Value>> = Vec::new();

    if let Ok(p) = storage_file_path(app, plugin_id) {
        if p.is_file() {
            if let Some(map) = read_json_object_map(&p) {
                out.push(map);
            }
        }
    }

    if let Ok(p) = storage_flat_legacy_file_path(app, plugin_id) {
        if p.is_file() {
            if let Some(map) = read_json_object_map(&p) {
                out.push(map);
            }
        }
    }

    out
}

fn remove_key_from_legacy_storage(app: &tauri::AppHandle, plugin_id: &str, key: &str) {
    let paths = [
        storage_file_path(app, plugin_id).ok(),
        storage_flat_legacy_file_path(app, plugin_id).ok(),
    ];

    for p in paths.into_iter().flatten() {
        if !p.is_file() {
            continue;
        }
        let Some(mut map) = read_json_object_map(&p) else {
            continue;
        };
        if map.remove(key).is_none() {
            continue;
        }
        if map.is_empty() {
            let _ = std::fs::remove_file(&p);
            continue;
        }
        let _ = write_json_value(&p, &Value::Object(map));
    }
}

fn storage_walk_json_files(root: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if !root.is_dir() {
        return out;
    }
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(cur) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&cur) else {
            continue;
        };
        for ent in entries.flatten() {
            let p = ent.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            if !p.is_file() {
                continue;
            }
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            out.push(p);
        }
    }
    out
}

fn storage_file_key_from_value_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut s = rel.to_string_lossy().replace('\\', "/");
    if !s.ends_with(".json") {
        return None;
    }
    s.truncate(s.len().saturating_sub(5));
    Some(s)
}

fn storage_cleanup_empty_dirs(storage_root: &Path, from_file: &Path) {
    let mut cur = from_file.parent().map(|p| p.to_path_buf());
    while let Some(dir) = cur {
        if dir == storage_root {
            break;
        }
        let Ok(mut rd) = std::fs::read_dir(&dir) else {
            break;
        };
        if rd.next().is_some() {
            break;
        }
        let _ = std::fs::remove_dir(&dir);
        cur = dir.parent().map(|p| p.to_path_buf());
    }
}

#[tauri::command]
fn storage_get(
    app: tauri::AppHandle,
    plugin_id: String,
    key: String,
) -> Result<Option<Value>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let lock = storage_lock_for(&plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());

    let vp = storage_value_path(&app, &plugin_id, &key)?;
    if !vp.is_file() {
        return Ok(read_legacy_storage_value(&app, &plugin_id, &key));
    }
    read_json_value(&vp).map(Some)
}

#[tauri::command]
fn storage_set(
    app: tauri::AppHandle,
    plugin_id: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let lock = storage_lock_for(&plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());

    let vp = storage_value_path(&app, &plugin_id, &key)?;
    write_json_value(&vp, &value)
}

#[tauri::command]
fn storage_remove(app: tauri::AppHandle, plugin_id: String, key: String) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let lock = storage_lock_for(&plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());

    let storage_root = storage_kv_dir_path(&app, &plugin_id)?;
    let vp = storage_value_path(&app, &plugin_id, &key)?;
    if vp.exists() {
        let _ = std::fs::remove_file(&vp);
        storage_cleanup_empty_dirs(&storage_root, &vp);
    }

    // 兼容 legacy：允许移除旧 map 中的 key，避免“删不掉”。
    remove_key_from_legacy_storage(&app, &plugin_id, &key);
    Ok(())
}

#[tauri::command]
fn storage_get_all(app: tauri::AppHandle, plugin_id: String) -> Result<Map<String, Value>, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let lock = storage_lock_for(&plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());

    let mut out: Map<String, Value> = Map::new();
    let storage_root = storage_kv_dir_path(&app, &plugin_id)?;
    for p in storage_walk_json_files(&storage_root) {
        let Some(key) = storage_file_key_from_value_path(&storage_root, &p) else {
            continue;
        };
        let v = read_json_value(&p)?;
        out.insert(key, v);
    }

    // 兼容 legacy：只补齐“新存储中不存在的 key”。
    for legacy in read_legacy_storage_all(&app, &plugin_id) {
        for (k, v) in legacy {
            if out.contains_key(&k) {
                continue;
            }
            out.insert(k, v);
        }
    }

    Ok(out)
}

#[tauri::command]
fn storage_set_all(
    app: tauri::AppHandle,
    plugin_id: String,
    data: Map<String, Value>,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let lock = storage_lock_for(&plugin_id);
    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());
    let storage_root = storage_kv_dir_path(&app, &plugin_id)?;
    if storage_root.exists() {
        std::fs::remove_dir_all(&storage_root).map_err(|e| format!("清空插件存储失败: {e}"))?;
    }
    std::fs::create_dir_all(&storage_root).map_err(|e| format!("创建插件存储目录失败: {e}"))?;

    // 新逻辑：全部按 key->文件存储
    for (k, v) in data {
        let vp = storage_value_path(&app, &plugin_id, &k)?;
        write_json_value(&vp, &v)?;
    }

    // setAll 是“权威覆盖”：写入成功后清理 legacy 文件，避免后续 getAll 混入旧数据。
    if let Ok(p) = storage_file_path(&app, &plugin_id) {
        let _ = std::fs::remove_file(&p);
    }
    if let Ok(p) = storage_flat_legacy_file_path(&app, &plugin_id) {
        let _ = std::fs::remove_file(&p);
    }

    Ok(())
}

#[tauri::command]
fn storage_migrate(app: tauri::AppHandle, plugin_id: String) -> Result<bool, String> {
    migrations::migrate_plugin_storage(&app, &plugin_id)
}

const APP_ICON_OVERRIDES_KEY: &str = "pluginIconOverrides";

#[derive(Clone)]
struct WallpaperView {
    x: f32,
    y: f32,
    scale: f32,
}

fn parse_wallpaper_view(v: &Value) -> Option<WallpaperView> {
    let Value::Object(obj) = v else {
        return None;
    };
    let x = obj.get("x").and_then(|v| v.as_f64()).map(|v| v as f32)?;
    let y = obj.get("y").and_then(|v| v.as_f64()).map(|v| v as f32)?;
    let scale = obj.get("scale").and_then(|v| v.as_f64()).map(|v| v as f32)?;
    Some(WallpaperView {
        x: clamp_f32(x, 0.0, 100.0),
        y: clamp_f32(y, 0.0, 100.0),
        scale: clamp_f32(scale, 1.0, 4.0),
    })
}

fn wallpaper_view_to_value(view: &WallpaperView) -> Value {
    let mut obj = Map::new();
    obj.insert(
        "x".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(view.x, 0.0, 100.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(50.0).unwrap()),
        ),
    );
    obj.insert(
        "y".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(view.y, 0.0, 100.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(50.0).unwrap()),
        ),
    );
    obj.insert(
        "scale".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(view.scale, 1.0, 4.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(1.0).unwrap()),
        ),
    );
    Value::Object(obj)
}

#[derive(Clone, Serialize)]
struct WallpaperViewOut {
    x: f32,
    y: f32,
    scale: f32,
}

fn wallpaper_view_out(v: Option<&WallpaperView>) -> WallpaperViewOut {
    let Some(v) = v else {
        return WallpaperViewOut {
            x: 50.0,
            y: 50.0,
            scale: 1.0,
        };
    };
    WallpaperViewOut {
        x: clamp_f32(v.x, 0.0, 100.0),
        y: clamp_f32(v.y, 0.0, 100.0),
        scale: clamp_f32(v.scale, 1.0, 4.0),
    }
}

#[derive(Clone)]
struct WallpaperItem {
    id: String,
    rel_path: String,
    view: Option<WallpaperView>,
}

#[derive(Clone)]
struct WallpaperConfig {
    enabled: bool,
    opacity: f32,
    blur: f32,
    titlebar_opacity: f32,
    titlebar_blur: f32,
    items: Vec<WallpaperItem>,
    active_id: Option<String>,
}

#[derive(Clone, Serialize)]
struct WallpaperItemOut {
    id: String,
    rev: u64,
}

#[derive(Clone, Serialize)]
struct WallpaperSettingsOut {
    enabled: bool,
    opacity: f32,
    blur: f32,
    #[serde(rename = "titlebarOpacity")]
    titlebar_opacity: f32,
    #[serde(rename = "titlebarBlur")]
    titlebar_blur: f32,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
    rev: u64,
    items: Vec<WallpaperItemOut>,
    #[serde(rename = "activeId")]
    active_id: Option<String>,
    view: Option<WallpaperViewOut>,
}

fn clamp_f32(v: f32, min: f32, max: f32) -> f32 {
    if v.is_nan() {
        return min;
    }
    v.max(min).min(max)
}

fn read_wallpaper_config(app: &tauri::AppHandle) -> Result<WallpaperConfig, String> {
    let vp = storage_value_path(app, "__app", WALLPAPER_SETTINGS_KEY)?;
    let obj = if vp.is_file() {
        match read_json_value(&vp)? {
            Value::Object(obj) => Some(obj),
            _ => None,
        }
    } else {
        None
    };
    let Some(obj) = obj else {
        return Ok(WallpaperConfig {
            enabled: false,
            opacity: 0.65,
            blur: 0.0,
            titlebar_opacity: 0.62,
            titlebar_blur: 12.0,
            items: Vec::new(),
            active_id: None,
        });
    };

    let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
    let opacity = obj
        .get("opacity")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(0.65);
    let blur = obj
        .get("blur")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(0.0);
    let titlebar_opacity = obj
        .get("titlebarOpacity")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(0.62);
    let titlebar_blur = obj
        .get("titlebarBlur")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(12.0);
    let active_id = obj
        .get("activeId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && is_safe_id(s))
        .map(|s| s.to_string());

    let mut items: Vec<WallpaperItem> = Vec::new();
    if let Some(Value::Array(arr)) = obj.get("items") {
        for v in arr {
            let Value::Object(it) = v else { continue };
            let Some(id) = it.get("id").and_then(|v| v.as_str()).map(|s| s.trim()).filter(|s| !s.is_empty()) else {
                continue;
            };
            if !is_safe_id(id) {
                continue;
            }
            let Some(rel_raw) = it.get("path").and_then(|v| v.as_str()).map(|s| s.trim()).filter(|s| !s.is_empty()) else {
                continue;
            };
            let rel = rel_raw.to_string();
            if safe_relative_path(&rel).is_err() {
                continue;
            }
            if items.iter().any(|x| x.id == id) {
                continue;
            }
            let view = it.get("view").and_then(parse_wallpaper_view);
            items.push(WallpaperItem {
                id: id.to_string(),
                rel_path: rel,
                view,
            });
        }
    }

    // 兼容旧格式：path 单值
    let mut legacy_added = false;
    if items.is_empty() {
        let legacy_rel = obj
            .get("path")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .and_then(|s| safe_relative_path(&s).ok().map(|_| s));
        if let Some(rel) = legacy_rel {
            items.push(WallpaperItem {
                id: "legacy".to_string(),
                rel_path: rel,
                view: None,
            });
            legacy_added = true;
        }
    }

    let mut active_id = active_id;
    if active_id.is_none() && legacy_added {
        active_id = Some("legacy".to_string());
    }
    if active_id.is_none() && items.len() == 1 {
        active_id = Some(items[0].id.clone());
    }

    Ok(WallpaperConfig {
        enabled,
        opacity: clamp_f32(opacity, 0.0, 1.0),
        blur: clamp_f32(blur, 0.0, 40.0),
        titlebar_opacity: clamp_f32(titlebar_opacity, 0.0, 1.0),
        titlebar_blur: clamp_f32(titlebar_blur, 0.0, 40.0),
        items,
        active_id,
    })
}

fn wallpaper_item_rev(app: &tauri::AppHandle, rel_path: &str) -> u64 {
    safe_relative_path(rel_path)
        .ok()
        .map(|rel_ok| app_data_dir(app).join(rel_ok))
        .and_then(|full| std::fs::metadata(full).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn resolve_wallpaper_item<'a>(app: &tauri::AppHandle, cfg: &'a WallpaperConfig, want_id: Option<&str>) -> Option<&'a WallpaperItem> {
    let data_root = app_data_dir(app);
    let is_ok = |it: &'a WallpaperItem| {
        safe_relative_path(&it.rel_path)
            .ok()
            .map(|rel_ok| data_root.join(rel_ok))
            .filter(|full| full.is_file())
            .is_some()
    };

    if let Some(id) = want_id.filter(|id| is_safe_id(id)) {
        if let Some(it) = cfg.items.iter().find(|x| x.id == id) {
            if is_ok(it) {
                return Some(it);
            }
        }
    }
    if let Some(id) = cfg.active_id.as_deref() {
        if let Some(it) = cfg.items.iter().find(|x| x.id == id) {
            if is_ok(it) {
                return Some(it);
            }
        }
    }
    cfg.items.iter().find(|it| is_ok(it))
}

fn write_wallpaper_config(app: &tauri::AppHandle, cfg: &WallpaperConfig) -> Result<(), String> {
    let mut obj = Map::new();
    obj.insert("enabled".to_string(), Value::Bool(cfg.enabled));
    obj.insert(
        "opacity".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(cfg.opacity, 0.0, 1.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(0.65).unwrap()),
        ),
    );
    obj.insert(
        "blur".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(cfg.blur, 0.0, 40.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(0.0).unwrap()),
        ),
    );
    obj.insert(
        "titlebarOpacity".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(cfg.titlebar_opacity, 0.0, 1.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(0.62).unwrap()),
        ),
    );
    obj.insert(
        "titlebarBlur".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(cfg.titlebar_blur, 0.0, 40.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(12.0).unwrap()),
        ),
    );

    let mut arr: Vec<Value> = Vec::new();
    for it in &cfg.items {
        if !is_safe_id(&it.id) {
            continue;
        }
        if safe_relative_path(&it.rel_path).is_err() {
            continue;
        }
        let mut it_obj = Map::new();
        it_obj.insert("id".to_string(), Value::String(it.id.clone()));
        it_obj.insert("path".to_string(), Value::String(it.rel_path.clone()));
        if let Some(view) = it.view.as_ref() {
            it_obj.insert("view".to_string(), wallpaper_view_to_value(view));
        }
        arr.push(Value::Object(it_obj));
    }
    obj.insert("items".to_string(), Value::Array(arr));

    if let Some(id) = cfg.active_id.as_ref().filter(|s| is_safe_id(s)) {
        obj.insert("activeId".to_string(), Value::String(id.clone()));
    }

    // 兼容旧版本读取：保留 path 单值（当前激活项）
    if let Some(it) = resolve_wallpaper_item(app, cfg, None) {
        obj.insert("path".to_string(), Value::String(it.rel_path.clone()));
    }

    let vp = storage_value_path(app, "__app", WALLPAPER_SETTINGS_KEY)?;
    write_json_value(&vp, &Value::Object(obj))
}

fn wallpaper_settings_out(app: &tauri::AppHandle, cfg: &WallpaperConfig) -> WallpaperSettingsOut {
    let resolved = resolve_wallpaper_item(app, cfg, None);
    let file_path = resolved
        .and_then(|it| safe_relative_path(&it.rel_path).ok().map(|rel_ok| app_data_dir(app).join(rel_ok)))
        .filter(|full| full.is_file())
        .map(|full| full.to_string_lossy().to_string());
    let rev = resolved.map(|it| wallpaper_item_rev(app, &it.rel_path)).unwrap_or(0);
    let view = file_path
        .as_ref()
        .and_then(|_| resolved.map(|it| wallpaper_view_out(it.view.as_ref())));

    let mut items: Vec<WallpaperItemOut> = Vec::new();
    for it in &cfg.items {
        let full = safe_relative_path(&it.rel_path).ok().map(|rel_ok| app_data_dir(app).join(rel_ok));
        let Some(full) = full else { continue };
        if !full.is_file() {
            continue;
        }
        items.push(WallpaperItemOut {
            id: it.id.clone(),
            rev: wallpaper_item_rev(app, &it.rel_path),
        });
    }

    let enabled = cfg.enabled && file_path.is_some();
    WallpaperSettingsOut {
        enabled,
        opacity: clamp_f32(cfg.opacity, 0.0, 1.0),
        blur: clamp_f32(cfg.blur, 0.0, 40.0),
        titlebar_opacity: clamp_f32(cfg.titlebar_opacity, 0.0, 1.0),
        titlebar_blur: clamp_f32(cfg.titlebar_blur, 0.0, 40.0),
        file_path,
        rev,
        items,
        active_id: resolved.map(|it| it.id.clone()),
        view,
    }
}

#[tauri::command]
fn get_wallpaper_settings(app: tauri::AppHandle) -> Result<WallpaperSettingsOut, String> {
    let cfg = read_wallpaper_config(&app)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
fn set_wallpaper_settings(
    app: tauri::AppHandle,
    enabled: bool,
    opacity: f32,
    blur: f32,
    titlebar_opacity: Option<f32>,
    titlebar_blur: Option<f32>,
) -> Result<WallpaperSettingsOut, String> {
    let mut cfg = read_wallpaper_config(&app)?;
    cfg.opacity = clamp_f32(opacity, 0.0, 1.0);
    cfg.blur = clamp_f32(blur, 0.0, 40.0);
    if let Some(v) = titlebar_opacity {
        cfg.titlebar_opacity = clamp_f32(v, 0.0, 1.0);
    }
    if let Some(v) = titlebar_blur {
        cfg.titlebar_blur = clamp_f32(v, 0.0, 40.0);
    }
    let has_file = resolve_wallpaper_item(&app, &cfg, None).is_some();
    cfg.enabled = enabled && has_file;
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
fn set_wallpaper_view(
    app: tauri::AppHandle,
    id: Option<String>,
    x: f32,
    y: f32,
    scale: f32,
) -> Result<WallpaperSettingsOut, String> {
    let want_id = id
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    if let Some(id) = want_id.as_ref() {
        if !is_safe_id(id) {
            return Err("壁纸 id 不合法".to_string());
        }
    }

    let mut cfg = read_wallpaper_config(&app)?;
    let resolved_id = resolve_wallpaper_item(&app, &cfg, want_id.as_deref()).map(|it| it.id.clone());
    let Some(resolved_id) = resolved_id else {
        return Err("壁纸不存在".to_string());
    };
    let Some(target) = cfg.items.iter_mut().find(|it| it.id == resolved_id) else {
        return Err("壁纸不存在".to_string());
    };

    target.view = Some(WallpaperView {
        x: clamp_f32(x, 0.0, 100.0),
        y: clamp_f32(y, 0.0, 100.0),
        scale: clamp_f32(scale, 1.0, 4.0),
    });
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
fn set_wallpaper_image(app: tauri::AppHandle, data_url: String) -> Result<WallpaperSettingsOut, String> {
    let (bytes, ext) = decode_base64_image_payload(&data_url)?;
    if bytes.is_empty() {
        return Err("图片数据为空".to_string());
    }
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("图片过大（>12MB）".to_string());
    }

    let rel_dir = "__app/wallpaper";
    let mut cfg = read_wallpaper_config(&app)?;
    let dir = app_data_dir(&app).join(rel_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut id = format!("{now_ms}");
    if !is_safe_id(&id) {
        id = "wallpaper".to_string();
    }
    let mut filename = format!("{id}.{ext}");
    let mut attempt = 0u32;
    loop {
        let full = dir.join(&filename);
        if !full.exists() {
            std::fs::write(&full, &bytes).map_err(|e| format!("写入壁纸失败: {e}"))?;
            break;
        }
        attempt += 1;
        id = format!("{now_ms}-{attempt}");
        filename = format!("{id}.{ext}");
        if attempt > 128 {
            return Err("生成壁纸文件名失败".to_string());
        }
    }

    let new_rel = format!("{rel_dir}/{filename}");
    cfg.items.retain(|x| x.id != id);
    cfg.items.push(WallpaperItem {
        id: id.clone(),
        rel_path: new_rel,
        view: Some(WallpaperView {
            x: 50.0,
            y: 50.0,
            scale: 1.0,
        }),
    });
    cfg.active_id = Some(id);
    cfg.enabled = true;
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
fn remove_wallpaper(app: tauri::AppHandle) -> Result<WallpaperSettingsOut, String> {
    let mut cfg = read_wallpaper_config(&app)?;
    for it in &cfg.items {
        if let Ok(old_rel) = safe_relative_path(&it.rel_path) {
            let old_full = app_data_dir(&app).join(old_rel);
            let _ = std::fs::remove_file(old_full);
        }
    }
    cfg.items.clear();
    cfg.active_id = None;
    cfg.enabled = false;
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
fn set_active_wallpaper(app: tauri::AppHandle, id: String) -> Result<WallpaperSettingsOut, String> {
    let id = id.trim().to_string();
    if !is_safe_id(&id) {
        return Err("壁纸 id 不合法".to_string());
    }
    let mut cfg = read_wallpaper_config(&app)?;
    let Some(it) = cfg.items.iter().find(|x| x.id == id) else {
        return Err("壁纸不存在".to_string());
    };
    let full = safe_relative_path(&it.rel_path)
        .ok()
        .map(|rel_ok| app_data_dir(&app).join(rel_ok))
        .filter(|full| full.is_file());
    if full.is_none() {
        return Err("壁纸文件不存在".to_string());
    }
    cfg.active_id = Some(id);
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
fn remove_wallpaper_item(app: tauri::AppHandle, id: String) -> Result<WallpaperSettingsOut, String> {
    let id = id.trim().to_string();
    if !is_safe_id(&id) {
        return Err("壁纸 id 不合法".to_string());
    }
    let mut cfg = read_wallpaper_config(&app)?;
    let idx = cfg.items.iter().position(|x| x.id == id);
    let Some(idx) = idx else {
        return Err("壁纸不存在".to_string());
    };
    if let Ok(rel) = safe_relative_path(&cfg.items[idx].rel_path) {
        let full = app_data_dir(&app).join(rel);
        let _ = std::fs::remove_file(full);
    }
    cfg.items.remove(idx);

    if cfg.active_id.as_deref() == Some(&id) {
        cfg.active_id = None;
        if let Some(next) = resolve_wallpaper_item(&app, &cfg, None) {
            cfg.active_id = Some(next.id.clone());
        }
    }
    if resolve_wallpaper_item(&app, &cfg, None).is_none() {
        cfg.enabled = false;
    }
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
fn cycle_wallpaper(app: tauri::AppHandle, delta: i32) -> Result<WallpaperSettingsOut, String> {
    let mut cfg = read_wallpaper_config(&app)?;
    if cfg.items.len() < 2 {
        return Ok(wallpaper_settings_out(&app, &cfg));
    }
    let mut existing: Vec<&WallpaperItem> = Vec::new();
    for it in &cfg.items {
        let full = safe_relative_path(&it.rel_path).ok().map(|rel_ok| app_data_dir(&app).join(rel_ok));
        match full {
            Some(f) if f.is_file() => existing.push(it),
            _ => {}
        }
    }
    if existing.len() < 2 {
        return Ok(wallpaper_settings_out(&app, &cfg));
    }

    let current = resolve_wallpaper_item(&app, &cfg, None);
    let cur_idx = current
        .and_then(|it| existing.iter().position(|x| x.id == it.id))
        .unwrap_or(0);
    let len = existing.len() as i32;
    let next_idx = (cur_idx as i32 + delta).rem_euclid(len) as usize;
    cfg.active_id = Some(existing[next_idx].id.clone());
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
fn get_plugin_icon_overrides(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let vp = storage_value_path(&app, "__app", APP_ICON_OVERRIDES_KEY)?;
    let overrides = if vp.is_file() {
        match read_json_value(&vp)? {
            Value::Object(obj) => Some(obj),
            _ => None,
        }
    } else {
        None
    };
    let Some(overrides) = overrides else {
        return Ok(HashMap::new());
    };

    let data_root = app_data_dir(&app);
    let mut out: HashMap<String, String> = HashMap::new();
    for (plugin_id, v) in overrides {
        let Value::String(rel_path) = v else {
            continue;
        };
        if !is_safe_id(&plugin_id) {
            continue;
        }
        let Ok(rel) = safe_relative_path(&rel_path) else {
            continue;
        };
        let full = data_root.join(rel);
        let Ok(bytes) = std::fs::read(&full) else {
            continue;
        };
        if bytes.is_empty() || bytes.len() > 512 * 1024 {
            continue;
        }
        let mime = image_mime_by_ext(&full);
        let b64 = general_purpose::STANDARD.encode(bytes);
        out.insert(plugin_id.to_string(), format!("data:{mime};base64,{b64}"));
    }

    Ok(out)
}

#[tauri::command]
fn set_plugin_icon_override(
    app: tauri::AppHandle,
    plugin_id: String,
    data_url: String,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let (bytes, ext) = decode_base64_image_payload(&data_url)?;
    if bytes.is_empty() {
        return Err("图片数据为空".to_string());
    }
    if bytes.len() > 512 * 1024 {
        return Err("缩略图过大（>512KB）".to_string());
    }

    let vp = storage_value_path(&app, "__app", APP_ICON_OVERRIDES_KEY)?;
    let mut overrides = if vp.is_file() {
        match read_json_value(&vp)? {
            Value::Object(obj) => obj,
            _ => Map::new(),
        }
    } else {
        Map::new()
    };

    let icons_dir_rel = "plugin-icons";
    let filename = format!("{plugin_id}.{ext}");
    let new_rel = format!("{icons_dir_rel}/{filename}");

    if let Some(Value::String(old_rel_raw)) = overrides.get(&plugin_id) {
        if old_rel_raw != &new_rel {
            if let Ok(old_rel) = safe_relative_path(old_rel_raw) {
                let old_full = app_data_dir(&app).join(old_rel);
                let _ = std::fs::remove_file(old_full);
            }
        }
    }

    let icons_dir = app_data_dir(&app).join(icons_dir_rel);
    std::fs::create_dir_all(&icons_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    let full = icons_dir.join(&filename);
    std::fs::write(&full, bytes).map_err(|e| format!("写入图标失败: {e}"))?;

    overrides.insert(plugin_id.clone(), Value::String(new_rel));
    write_json_value(&vp, &Value::Object(overrides))
}

#[tauri::command]
fn remove_plugin_icon_override(app: tauri::AppHandle, plugin_id: String) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let vp = storage_value_path(&app, "__app", APP_ICON_OVERRIDES_KEY)?;
    let overrides = if vp.is_file() {
        match read_json_value(&vp)? {
            Value::Object(obj) => Some(obj),
            _ => None,
        }
    } else {
        None
    };
    let Some(mut overrides) = overrides else {
        return Ok(());
    };

    if let Some(Value::String(old_rel)) = overrides.remove(&plugin_id) {
        if let Ok(old_rel) = safe_relative_path(&old_rel) {
            let old_full = app_data_dir(&app).join(old_rel);
            let _ = std::fs::remove_file(old_full);
        }
    }

    write_json_value(&vp, &Value::Object(overrides))
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
    let mut guard = state
        .current
        .lock()
        .map_err(|_| "内部状态锁失败".to_string())?;
    let prev = *guard;
    let was_paused = state.paused.lock().map(|g| *g).unwrap_or(false);

    if prev.id() == next.id() {
        let mut map = read_app_config_map(&app);
        map.insert(
            WAKE_SHORTCUT_KEY.to_string(),
            Value::String(normalized.clone()),
        );
        write_app_config_map(&app, &map)?;
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

    let mut map = read_app_config_map(&app);
    map.insert(
        WAKE_SHORTCUT_KEY.to_string(),
        Value::String(normalized.clone()),
    );
    if let Err(e) = write_app_config_map(&app, &map) {
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
    let current = state
        .current
        .lock()
        .map_err(|_| "内部状态锁失败".to_string())?;

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
    let current = state
        .current
        .lock()
        .map_err(|_| "内部状态锁失败".to_string())?;

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
        let mut map = read_app_config_map(&app);

        let prev_registry = auto_start::is_enabled(AUTO_START_REG_VALUE);
        let next_registry = auto_start::set_enabled(AUTO_START_REG_VALUE, enabled)?;

        map.insert(AUTO_START_KEY.to_string(), Value::Bool(enabled));
        if let Err(e) = write_app_config_map(&app, &map) {
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
        .register_uri_scheme_protocol("wallpaper", |ctx, request| {
            let app = ctx.app_handle();
            let cfg = match read_wallpaper_config(app) {
                Ok(v) => v,
                Err(e) => {
                    return tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                        .header(tauri::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                        .body(format!("failed to load wallpaper config: {e}").as_bytes().to_vec())
                    .unwrap();
                }
            };

            let want_id = query_get_param(request.uri(), "id")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let Some(it) = resolve_wallpaper_item(app, &cfg, want_id.as_deref()) else {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(tauri::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                    .body(b"wallpaper not set".to_vec())
                    .unwrap();
            };
            let Some(rel) = safe_relative_path(&it.rel_path).ok() else {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(tauri::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                    .body(b"wallpaper not set".to_vec())
                    .unwrap();
            };
            let full = app_data_dir(app).join(rel);
            if !full.is_file() {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(tauri::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                    .body(b"wallpaper file not found".to_vec())
                    .unwrap();
            }
            let Ok(bytes) = std::fs::read(&full) else {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                    .header(tauri::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                    .body(b"failed to read wallpaper".to_vec())
                    .unwrap();
            };

            let mime = image_mime_by_ext(&full);
            tauri::http::Response::builder()
                .status(tauri::http::StatusCode::OK)
                .header(tauri::http::header::CONTENT_TYPE, mime)
                .header(tauri::http::header::CACHE_CONTROL, "no-store")
                .body(bytes)
                .unwrap()
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_plugins_dir,
            get_data_dir,
            get_wallpaper_settings,
            set_wallpaper_settings,
            set_wallpaper_view,
            set_wallpaper_image,
            remove_wallpaper,
            set_active_wallpaper,
            remove_wallpaper_item,
            cycle_wallpaper,
            open_data_root_dir,
            open_data_dir,
            open_plugins_dir,
            list_plugins,
            read_plugin_file,
            read_plugin_file_base64,
            set_plugin_allow_overwrite_on_update,
            get_plugins_allow_overwrite_on_update,
            read_plugins_dir,
            install_plugin_files,
            open_external_url,
            open_external_uri,
            open_browser_window,
            close_browser_window,
            hide_browser_stack,
            browser_go_back,
            browser_go_forward,
            browser_reload,
            get_webview_settings,
            set_webview_settings,
            browser_video_set_rate,
            browser_video_toggle_preset,
            browser_stack_toggle_fullscreen,
            browser_stack_get_pinned,
            browser_stack_toggle_pinned,
            http_request,
            http_request_base64,
            http_request_stream,
            http_request_stream_cancel,
            gateway_test_channel,
            clipboard_write_image_data_url,
            storage_get,
            storage_set,
            storage_remove,
            storage_get_all,
            storage_set_all,
            storage_migrate,
            get_plugin_icon_overrides,
            set_plugin_icon_override,
            remove_plugin_icon_override,
            plugin_get_output_dir,
            plugin_pick_output_dir,
            plugin_pick_dir,
            plugin_open_output_dir,
            plugin_open_dir,
            plugin_files_list_dir,
            plugin_files_read_text,
            plugin_files_write_text,
            plugin_files_read_base64,
            plugin_files_write_base64,
            plugin_files_rename,
            plugin_files_delete,
            plugin_images_write_base64,
            plugin_images_list,
            plugin_images_read,
            plugin_images_delete,
            plugin_pick_images,
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
            app.manage(Arc::new(HttpStreamManagerState::default()));
            app.manage(BrowserWindowState::default());

            // 主窗口尺寸/位置：从配置恢复（跨重启记住）
            if let Some(saved) = load_main_window_bounds_from_config(app.handle()) {
                let state = app.state::<WindowState>();
                if let Ok(mut g) = state.last_bounds.lock() {
                    *g = Some(saved);
                }
                if let Some(w) = app.get_webview_window("main") {
                    restore_bounds_or_center(&w, &state);
                }
            }

            // 宿主数据迁移：仅迁移宿主私有存储（__app）。插件数据由插件自行调用 storage.migrate 处理。
            let _ = migrations::migrate_plugin_storage(app.handle(), APP_STORAGE_ID);
            let _ = migrations::migrate_host_files_into_app_dir(app.handle());

            // Release：把 MSI 随包的内置插件“种子”拷到可写的插件目录（仅拷缺失项，不覆盖用户已有插件）。
            #[cfg(not(debug_assertions))]
            {
                let handle = app.handle();
                seed_plugins_from_resources(&handle);
            }

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
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let state = app.state::<WindowState>();
                            save_bounds_if_valid(&w, &state);
                            persist_main_window_bounds(app, &state);
                        }
                        app.exit(0);
                    }
                    "show" => {
                        show_main_window(&app);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        show_main_window(app);
                    }
                })
                .build(app)?;

            // 注册全局快捷键（默认：Ctrl+Alt+Space，可在 data/app.json 的 wakeShortcut 配置）
            if let Err(e) =
                app.global_shortcut()
                    .on_shortcut(wake_shortcut, move |app, _shortcut, event| {
                        if event.state != ShortcutState::Pressed {
                            return;
                        }
                        let state = app.state::<BrowserWindowState>();
                        let active = state.active.lock().ok().map(|g| *g).unwrap_or(false);
                        if active && browser_stack_exists(app) {
                            if browser_stack_is_visible(app) {
                                browser_stack_hide(app);
                            } else {
                                browser_stack_show(app);
                            }
                            return;
                        }
                        toggle_main_window(app);
                    })
            {
                eprintln!(
                    "Failed to register wake shortcut {}: {}",
                    wake_shortcut_text, e
                );
            }

            Ok(())
        })
        // 监听窗口事件：失焦时隐藏
        .on_window_event(|window, event| {
            // 仅 main 窗口需要“失焦自动隐藏/拦截关闭”；其它窗口按普通窗口行为处理。
            if window.label() == BROWSER_BAR_WINDOW_LABEL {
                let app = window.app_handle();
                if let WindowEvent::Moved(_) = event {
                    if let (Some(bar), Some(content)) = (
                        app.get_webview_window(BROWSER_BAR_WINDOW_LABEL),
                        app.get_webview_window(BROWSER_WINDOW_LABEL),
                    ) {
                        let bar_pos = bar.outer_position().ok();
                        let bar_h = bar
                            .inner_size()
                            .ok()
                            .map(|s| s.height)
                            .unwrap_or(BROWSER_BAR_HEIGHT.round().max(1.0) as u32);
                        if let Some(p) = bar_pos {
                            let _ = content.set_position(tauri::PhysicalPosition::new(
                                p.x,
                                p.y + bar_h as i32,
                            ));
                        }
                    }
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if browser_stack_is_closing(app) {
                        return;
                    }
                    api.prevent_close();
                    browser_stack_close(app);
                }
                if let WindowEvent::Focused(focused) = event {
                    if !focused {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(120)).await;
                            if browser_stack_is_pinned(&app) {
                                return;
                            }
                            if browser_stack_is_focused(&app) {
                                return;
                            }
                            if browser_stack_should_suppress_hide(&app) {
                                return;
                            }
                            browser_stack_hide(&app);
                        });
                    }
                }
                return;
            }
            if window.label() == BROWSER_WINDOW_LABEL {
                let app = window.app_handle();
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if browser_stack_is_closing(app) {
                        return;
                    }
                    api.prevent_close();
                    browser_stack_close(app);
                }
                if let WindowEvent::Focused(focused) = event {
                    if !focused {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(120)).await;
                            if browser_stack_is_pinned(&app) {
                                return;
                            }
                            if browser_stack_is_focused(&app) {
                                return;
                            }
                            if browser_stack_should_suppress_hide(&app) {
                                return;
                            }
                            browser_stack_hide(&app);
                        });
                    }
                }
                return;
            }
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle();
                let state = app.state::<WindowState>();
                save_bounds_if_valid(window, &state);
                persist_main_window_bounds(&app, &state);
                let _ = window.set_position(tauri::PhysicalPosition::new(-10000, -10000));
                let _ = window.hide();
                return;
            }
            if let WindowEvent::Moved(_) = event {
                let app = window.app_handle();
                let state = app.state::<WindowState>();
                save_bounds_if_valid(window, &state);
                schedule_persist_main_window_bounds(app);
            }
            if let WindowEvent::Resized(_) = event {
                let app = window.app_handle();
                let state = app.state::<WindowState>();
                save_bounds_if_valid(window, &state);
                schedule_persist_main_window_bounds(app);
            }
            if let WindowEvent::Focused(focused) = event {
                if !focused {
                    // 失焦后延迟一点再隐藏：避免拖拽/系统瞬时失焦导致窗口“闪退”式消失
                    let window = window.clone();
                    let app = window.app_handle();
                    let state = app.state::<WindowState>();
                    save_bounds_if_valid(&window, &state);
                    persist_main_window_bounds(&app, &state);
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
