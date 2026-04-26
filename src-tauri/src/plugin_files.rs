use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio::io::AsyncReadExt;

const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;
const FILE_STREAM_CHUNK_BYTES: usize = 64 * 1024;
const FILE_STREAM_MAX_CHUNK_BYTES: usize = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFsEntry {
    name: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
    #[serde(rename = "isFile")]
    is_file: bool,
    size: u64,
    modified_ms: u64,
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

fn plugin_fs_entry_from_path(path: &Path) -> Result<PluginFsEntry, String> {
    let meta = path
        .metadata()
        .map_err(|e| format!("读取路径元信息失败: {e}"))?;
    let modified = meta.modified().unwrap_or(UNIX_EPOCH);
    let modified_ms = modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64;
    Ok(PluginFsEntry {
        name: path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_directory: meta.is_dir(),
        is_file: meta.is_file(),
        size: meta.len(),
        modified_ms,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFilesListDirReq {
    scope: String,
    dir: Option<String>,
}

#[tauri::command]
pub(crate) fn plugin_files_list_dir(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesListDirReq,
) -> Result<Vec<PluginFsEntry>, String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();

    let root = crate::resolve_plugin_files_root(&app, &plugin_id, &scope)?;
    crate::ensure_writable_dir(&root)?;
    let root_c = std::fs::canonicalize(&root).map_err(|e| format!("文件根目录不可用: {e}"))?;

    let dir_rel = req
        .dir
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let dir = if let Some(dr) = dir_rel {
        let rel = crate::safe_relative_path(&dr)?;
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
        out.push(plugin_fs_entry_from_path(&entry.path())?);
    }

    out.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    });
    Ok(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFilesPathReq {
    scope: String,
    path: String,
}

#[tauri::command]
pub(crate) fn plugin_files_stat(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesPathReq,
) -> Result<PluginFsEntry, String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let (_root_c, full_c) =
        crate::resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.path)?;
    plugin_fs_entry_from_path(&full_c)
}

#[tauri::command]
pub(crate) fn plugin_files_mkdir(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesPathReq,
) -> Result<String, String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let (_root_c, full) = crate::resolve_write_path_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if full.exists() && !full.is_dir() {
        return Err("目标已存在且不是目录".to_string());
    }
    std::fs::create_dir_all(&full).map_err(|e| format!("创建目录失败: {e}"))?;
    Ok(full.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn plugin_files_read_text(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesPathReq,
) -> Result<String, String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let (_root_c, full_c) =
        crate::resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if !full_c.is_file() {
        return Err("文件不存在".to_string());
    }

    let bytes = std::fs::read(&full_c).map_err(|e| format!("读取文件失败: {e}"))?;
    if bytes.len() > MAX_TEXT_BYTES {
        return Err("文本文件过大".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "文本不是 UTF-8 编码".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFilesWriteTextReq {
    scope: String,
    path: String,
    text: String,
    overwrite: Option<bool>,
}

#[tauri::command]
pub(crate) fn plugin_files_write_text(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesWriteTextReq,
) -> Result<String, String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let overwrite = req.overwrite.unwrap_or(false);
    let (_root_c, full) = crate::resolve_write_path_in_scope(&app, &plugin_id, &scope, &req.path)?;

    if req.text.as_bytes().len() > MAX_TEXT_BYTES {
        return Err("文本过大".to_string());
    }

    if full.exists() && !overwrite {
        return Err("文件已存在（overwrite=false）".to_string());
    }
    std::fs::write(&full, req.text.as_bytes()).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(full.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn plugin_files_read_base64(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesPathReq,
) -> Result<String, String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let (_root_c, full_c) =
        crate::resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if !full_c.is_file() {
        return Err("文件不存在".to_string());
    }

    let bytes = std::fs::read(&full_c).map_err(|e| format!("读取文件失败: {e}"))?;
    let mime = file_mime_by_ext(&full_c);
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFilesThumbnailReq {
    scope: String,
    path: String,
    width: Option<u32>,
    height: Option<u32>,
}

#[tauri::command]
pub(crate) fn plugin_files_thumbnail(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesThumbnailReq,
) -> Result<String, String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let (_root_c, full_c) =
        crate::resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if !full_c.is_file() {
        return Err("文件不存在".to_string());
    }

    let w = req.width.unwrap_or(320).max(16).min(1024);
    let h = req.height.unwrap_or(180).max(16).min(1024);
    crate::thumbnails::file_thumbnail_png_data_url(&full_c, w, h)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFilesWriteBase64Req {
    scope: String,
    path: String,
    data_url_or_base64: String,
    overwrite: Option<bool>,
}

#[tauri::command]
pub(crate) fn plugin_files_write_base64(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesWriteBase64Req,
) -> Result<String, String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let overwrite = req.overwrite.unwrap_or(false);
    let (_root_c, full) = crate::resolve_write_path_in_scope(&app, &plugin_id, &scope, &req.path)?;

    let bytes = decode_base64_payload(&req.data_url_or_base64, usize::MAX)?;
    if full.exists() && !overwrite {
        return Err("文件已存在（overwrite=false）".to_string());
    }
    std::fs::write(&full, bytes).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(full.to_string_lossy().to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFilesTransferReq {
    scope: String,
    from: String,
    to: String,
    overwrite: Option<bool>,
}

#[tauri::command]
pub(crate) fn plugin_files_rename(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesTransferReq,
) -> Result<(), String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let overwrite = req.overwrite.unwrap_or(false);

    let (_root_c, from_c) =
        crate::resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.from)?;
    if !(from_c.is_file() || from_c.is_dir()) {
        return Err("源文件不存在".to_string());
    }

    let (_root_c2, to) = crate::resolve_write_path_in_scope(&app, &plugin_id, &scope, &req.to)?;
    if to.exists() && !overwrite {
        return Err("目标已存在（overwrite=false）".to_string());
    }
    std::fs::rename(&from_c, &to).map_err(|e| format!("重命名失败: {e}"))?;
    Ok(())
}

fn path_is_within(child: &Path, parent: &Path) -> bool {
    let mut c_it = child.components();
    let mut p_it = parent.components();
    loop {
        match p_it.next() {
            None => return true,
            Some(p) => match c_it.next() {
                None => return false,
                Some(c) => {
                    if c != p {
                        return false;
                    }
                }
            },
        }
    }
}

fn copy_dir_recursive(from: &Path, to: &Path, overwrite: bool) -> Result<(), String> {
    if path_is_within(to, from) {
        return Err("禁止把目录复制到自身内部".to_string());
    }
    if to.exists() && !to.is_dir() {
        return Err("复制目标已存在且不是目录".to_string());
    }
    std::fs::create_dir_all(to).map_err(|e| format!("创建复制目标目录失败: {e}"))?;
    for entry in std::fs::read_dir(from).map_err(|e| format!("读取源目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取源目录项失败: {e}"))?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        let meta = entry
            .metadata()
            .map_err(|e| format!("读取源目录项元信息失败: {e}"))?;
        if meta.is_dir() {
            copy_dir_recursive(&src, &dst, overwrite)?;
        } else if meta.is_file() {
            if dst.exists() && !overwrite {
                return Err("复制目标已存在（overwrite=false）".to_string());
            }
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建复制目标目录失败: {e}"))?;
            }
            std::fs::copy(&src, &dst).map_err(|e| format!("复制文件失败: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn plugin_files_copy(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesTransferReq,
) -> Result<(), String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let overwrite = req.overwrite.unwrap_or(false);

    let (_root_c, from_c) =
        crate::resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.from)?;
    let (_root_c2, to) = crate::resolve_write_path_in_scope(&app, &plugin_id, &scope, &req.to)?;
    if from_c.is_file() {
        if to.exists() && !overwrite {
            return Err("复制目标已存在（overwrite=false）".to_string());
        }
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建复制目标目录失败: {e}"))?;
        }
        std::fs::copy(&from_c, &to).map_err(|e| format!("复制文件失败: {e}"))?;
        return Ok(());
    }
    if from_c.is_dir() {
        if to.exists() && !to.is_dir() {
            return Err("复制目标已存在且不是目录".to_string());
        }
        copy_dir_recursive(&from_c, &to, overwrite)?;
        return Ok(());
    }
    Err("源路径不存在".to_string())
}

#[tauri::command]
pub(crate) fn plugin_files_delete(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesPathReq,
) -> Result<(), String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let (root_c, full_c) =
        crate::resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if !full_c.is_file() {
        return Err("文件不存在".to_string());
    }
    std::fs::remove_file(&full_c).map_err(|e| format!("删除文件失败: {e}"))?;
    cleanup_empty_data_dirs(&scope, &root_c, full_c.parent().map(|p| p.to_path_buf()));
    Ok(())
}

fn cleanup_empty_data_dirs(scope: &str, root_c: &Path, mut cur: Option<PathBuf>) {
    if scope != "data" {
        return;
    }
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

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum PluginFileReadStreamEvent {
    Start { size: u64 },
    Chunk { bytes: Vec<u8> },
    End { canceled: bool },
    Error { message: String },
}

fn read_cancels() -> &'static Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>> {
    static READ_CANCELS: OnceLock<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>> =
        OnceLock::new();
    READ_CANCELS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn write_sessions() -> &'static Mutex<HashMap<String, WriteStreamSession>> {
    static WRITE_SESSIONS: OnceLock<Mutex<HashMap<String, WriteStreamSession>>> = OnceLock::new();
    WRITE_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn make_file_stream_id(plugin_id: &str) -> String {
    let stamp = crate::now_ms();
    format!(
        "filestream-{plugin_id}-{stamp}-{:08x}",
        crate::rand_u32(stamp)
    )
}

#[tauri::command]
pub(crate) fn plugin_files_read_stream(
    app: tauri::AppHandle,
    plugin_id: String,
    stream_id: String,
    req: PluginFilesPathReq,
    channel: Channel<PluginFileReadStreamEvent>,
) -> Result<String, String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let sid = stream_id.trim().to_string();
    if sid.is_empty() {
        return Err("streamId 不能为空".to_string());
    }
    let scope = req.scope.trim().to_string();
    let (_root_c, full_c) =
        crate::resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if !full_c.is_file() {
        return Err("文件不存在".to_string());
    }
    let size = full_c
        .metadata()
        .map_err(|e| format!("读取文件元信息失败: {e}"))?
        .len();
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut map = read_cancels()
            .lock()
            .map_err(|_| "读流状态锁定失败".to_string())?;
        map.insert(sid.clone(), tx);
    }

    let sid_for_task = sid.clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            let mut file = tokio::fs::File::open(&full_c)
                .await
                .map_err(|e| format!("打开文件失败: {e}"))?;
            let _ = channel.send(PluginFileReadStreamEvent::Start { size });
            let mut buf = vec![0u8; FILE_STREAM_CHUNK_BYTES];
            loop {
                tokio::select! {
                    _ = &mut rx => {
                        let _ = channel.send(PluginFileReadStreamEvent::End { canceled: true });
                        return Ok::<(), String>(());
                    }
                    read = file.read(&mut buf) => {
                        let n = read.map_err(|e| format!("读取文件失败: {e}"))?;
                        if n == 0 { break; }
                        if channel.send(PluginFileReadStreamEvent::Chunk { bytes: buf[..n].to_vec() }).is_err() {
                            return Ok(());
                        }
                    }
                }
            }
            let _ = channel.send(PluginFileReadStreamEvent::End { canceled: false });
            Ok(())
        }
        .await;
        if let Err(message) = result {
            let _ = channel.send(PluginFileReadStreamEvent::Error { message });
            let _ = channel.send(PluginFileReadStreamEvent::End { canceled: false });
        }
        if let Ok(mut map) = read_cancels().lock() {
            map.remove(&sid_for_task);
        }
    });

    Ok(sid)
}

#[tauri::command]
pub(crate) fn plugin_files_read_stream_cancel(stream_id: String) -> Result<(), String> {
    let sid = stream_id.trim().to_string();
    if sid.is_empty() {
        return Err("streamId 不能为空".to_string());
    }
    if let Ok(mut map) = read_cancels().lock() {
        if let Some(tx) = map.remove(&sid) {
            let _ = tx.send(());
        }
    }
    Ok(())
}

#[derive(Clone)]
struct WriteStreamSession {
    plugin_id: String,
    target_path: PathBuf,
    temp_path: PathBuf,
    overwrite: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFilesWriteStreamOpenRes {
    write_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFilesWriteStreamOpenReq {
    scope: String,
    path: String,
    overwrite: Option<bool>,
}

#[tauri::command]
pub(crate) fn plugin_files_write_stream_open(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesWriteStreamOpenReq,
) -> Result<PluginFilesWriteStreamOpenRes, String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let scope = req.scope.trim().to_string();
    let overwrite = req.overwrite.unwrap_or(false);
    let (_root_c, target_path) =
        crate::resolve_write_path_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if target_path.exists() && !overwrite {
        return Err("文件已存在（overwrite=false）".to_string());
    }
    let parent = target_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "目标路径无父目录".to_string())?;
    std::fs::create_dir_all(&parent).map_err(|e| format!("创建写入目录失败: {e}"))?;
    let write_id = make_file_stream_id(&plugin_id);
    let temp_path = parent.join(format!(".{}.tmp", write_id));
    std::fs::File::create(&temp_path).map_err(|e| format!("创建临时文件失败: {e}"))?;

    let session = WriteStreamSession {
        plugin_id: plugin_id.clone(),
        target_path,
        temp_path,
        overwrite,
    };
    let mut map = write_sessions()
        .lock()
        .map_err(|_| "写流状态锁定失败".to_string())?;
    map.insert(write_id.clone(), session);
    Ok(PluginFilesWriteStreamOpenRes { write_id })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFilesWriteStreamChunkReq {
    write_id: String,
    bytes: Vec<u8>,
}

#[tauri::command]
pub(crate) fn plugin_files_write_stream_chunk(
    plugin_id: String,
    req: PluginFilesWriteStreamChunkReq,
) -> Result<(), String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    if req.bytes.len() > FILE_STREAM_MAX_CHUNK_BYTES {
        return Err("写入分片过大".to_string());
    }
    let session = {
        let map = write_sessions()
            .lock()
            .map_err(|_| "写流状态锁定失败".to_string())?;
        map.get(req.write_id.trim())
            .cloned()
            .ok_or_else(|| "写流不存在".to_string())?
    };
    if session.plugin_id != plugin_id {
        return Err("写流不存在".to_string());
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&session.temp_path)
        .map_err(|e| format!("打开临时文件失败: {e}"))?;
    file.write_all(&req.bytes)
        .map_err(|e| format!("写入分片失败: {e}"))
}

#[tauri::command]
pub(crate) fn plugin_files_write_stream_close(
    plugin_id: String,
    write_id: String,
) -> Result<(), String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let session = {
        let mut map = write_sessions()
            .lock()
            .map_err(|_| "写流状态锁定失败".to_string())?;
        map.remove(write_id.trim())
            .ok_or_else(|| "写流不存在".to_string())?
    };
    if session.plugin_id != plugin_id {
        let _ = std::fs::remove_file(&session.temp_path);
        return Err("写流不存在".to_string());
    }
    if session.target_path.exists() {
        if !session.overwrite {
            let _ = std::fs::remove_file(&session.temp_path);
            return Err("文件已存在（overwrite=false）".to_string());
        }
        if session.target_path.is_file() {
            std::fs::remove_file(&session.target_path)
                .map_err(|e| format!("覆盖旧文件失败: {e}"))?;
        } else {
            let _ = std::fs::remove_file(&session.temp_path);
            return Err("目标已存在且不是文件".to_string());
        }
    }
    std::fs::rename(&session.temp_path, &session.target_path)
        .map_err(|e| format!("提交写入失败: {e}"))
}

#[tauri::command]
pub(crate) fn plugin_files_write_stream_cancel(
    plugin_id: String,
    write_id: String,
) -> Result<(), String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let session = {
        let mut map = write_sessions()
            .lock()
            .map_err(|_| "写流状态锁定失败".to_string())?;
        map.remove(write_id.trim())
    };
    if let Some(session) = session {
        if session.plugin_id != plugin_id {
            return Err("写流不存在".to_string());
        }
        let _ = std::fs::remove_file(&session.temp_path);
    }
    Ok(())
}
