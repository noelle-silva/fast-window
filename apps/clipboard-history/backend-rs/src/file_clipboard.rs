use crate::domain::now_ms;
use crate::model::{ClipboardFileEntry, ClipboardHistoryItem};
use std::fs;
use std::path::{Path, PathBuf};

const IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

pub enum ClipboardFilesClassification {
    SingleImage(PathBuf),
    Files(ClipboardHistoryItem),
}

#[derive(Clone, Debug)]
pub struct ClipboardFilesSnapshot {
    pub paths: Vec<PathBuf>,
}

pub fn read_files_clipboard() -> Result<Option<ClipboardFilesSnapshot>, String> {
    platform::read_files_clipboard()
}

pub fn write_files_clipboard(paths: &[PathBuf]) -> Result<(), String> {
    let normalized = normalize_existing_paths(paths)?;
    platform::write_files_clipboard(&normalized)
}

pub fn history_item_from_files(paths: &[PathBuf]) -> Option<ClipboardHistoryItem> {
    let non_empty_paths = paths
        .iter()
        .filter(|path| !path.as_os_str().is_empty())
        .collect::<Vec<_>>();
    if non_empty_paths.is_empty() {
        return None;
    }
    let entries = non_empty_paths
        .iter()
        .map(|path| file_entry(path))
        .collect::<Option<Vec<_>>>()?;
    if entries.len() != non_empty_paths.len() {
        return None;
    }
    let content = entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    Some(ClipboardHistoryItem {
        item_type: "files".to_string(),
        content,
        time: now_ms(),
        path: None,
        files: Some(entries),
    })
}

pub fn classify_files_clipboard(paths: &[PathBuf]) -> Option<ClipboardFilesClassification> {
    if let Some(path) = single_image_file_path(paths) {
        return Some(ClipboardFilesClassification::SingleImage(path));
    }
    history_item_from_files(paths).map(ClipboardFilesClassification::Files)
}

fn single_image_file_path(paths: &[PathBuf]) -> Option<PathBuf> {
    let mut non_empty = paths.iter().filter(|path| !path.as_os_str().is_empty());
    let path = non_empty.next()?;
    if non_empty.next().is_some() || !path.is_file() || !is_image_path(path) {
        return None;
    }
    Some(path.clone())
}

fn normalize_existing_paths(paths: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    let mut missing = Vec::new();
    for path in paths {
        if path.as_os_str().is_empty() {
            continue;
        }
        if path.exists() {
            out.push(path.clone());
        } else {
            missing.push(path.display().to_string());
        }
    }
    if !missing.is_empty() {
        return Err(format!("源文件不可用：{}", missing.join("；")));
    }
    if out.is_empty() {
        return Err("文件剪贴板写入需要至少一个可用路径".to_string());
    }
    Ok(out)
}

fn file_entry(path: &Path) -> Option<ClipboardFileEntry> {
    if !path.exists() {
        return None;
    }
    let metadata = fs::metadata(path).ok();
    let kind = if metadata.as_ref().map(|v| v.is_dir()).unwrap_or(false) {
        "directory"
    } else if metadata.as_ref().map(|v| v.is_file()).unwrap_or(false) {
        "file"
    } else {
        "unknown"
    };
    let modified_at = metadata
        .as_ref()
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64);
    Some(ClipboardFileEntry {
        path: path.display().to_string(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_else(|| path.to_str().unwrap_or("文件"))
            .to_string(),
        kind: kind.to_string(),
        extension: path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!(".{value}")),
        size_bytes: metadata
            .as_ref()
            .filter(|value| value.is_file())
            .map(|value| value.len()),
        modified_at,
    })
}

fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .map(|extension| IMAGE_EXTENSIONS.contains(&extension.as_str()))
        .unwrap_or(false)
}

#[cfg(windows)]
mod platform {
    use super::ClipboardFilesSnapshot;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::path::PathBuf;
    use std::ptr::copy_nonoverlapping;
    use windows::Win32::Foundation::{GlobalFree, BOOL, HANDLE, HWND, POINT};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::UI::Shell::{DragQueryFileW, DROPFILES, HDROP};

    const CF_HDROP_FORMAT: u32 = 15;

    struct ClipboardGuard;

    impl ClipboardGuard {
        fn open() -> Result<Self, String> {
            unsafe { OpenClipboard(HWND(std::ptr::null_mut())) }
                .map(|_| Self)
                .map_err(|e| format!("打开剪贴板失败: {e}"))
        }
    }

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            let _ = unsafe { CloseClipboard() };
        }
    }

    pub fn read_files_clipboard() -> Result<Option<ClipboardFilesSnapshot>, String> {
        let _guard = ClipboardGuard::open()?;
        if unsafe { IsClipboardFormatAvailable(CF_HDROP_FORMAT) }.is_err() {
            return Ok(None);
        }
        let handle = unsafe { GetClipboardData(CF_HDROP_FORMAT) }
            .map_err(|e| format!("读取文件剪贴板失败: {e}"))?;
        if handle.0.is_null() {
            return Ok(None);
        }
        let drop = HDROP(handle.0);
        let count = unsafe { DragQueryFileW(drop, u32::MAX, None) };
        if count == 0 {
            return Ok(None);
        }
        let mut paths = Vec::new();
        for index in 0..count {
            let len = unsafe { DragQueryFileW(drop, index, None) };
            if len == 0 {
                continue;
            }
            let mut buffer = vec![0u16; len as usize + 1];
            let written = unsafe { DragQueryFileW(drop, index, Some(&mut buffer)) };
            if written == 0 {
                continue;
            }
            let text = String::from_utf16_lossy(&buffer[..written as usize]);
            if !text.trim().is_empty() {
                paths.push(PathBuf::from(text));
            }
        }
        if paths.is_empty() {
            return Ok(None);
        }
        Ok(Some(ClipboardFilesSnapshot { paths }))
    }

    pub fn write_files_clipboard(paths: &[PathBuf]) -> Result<(), String> {
        let encoded_paths = encode_paths(paths)?;
        let dropfiles_size = size_of::<DROPFILES>();
        let payload_bytes = encoded_paths.len() * size_of::<u16>();
        let total_size = dropfiles_size + payload_bytes;
        let _guard = ClipboardGuard::open()?;
        unsafe { EmptyClipboard() }.map_err(|e| format!("清空剪贴板失败: {e}"))?;
        let memory = unsafe { GlobalAlloc(GMEM_MOVEABLE, total_size) }
            .map_err(|e| format!("分配文件剪贴板内存失败: {e}"))?;
        let ptr = unsafe { GlobalLock(memory) } as *mut u8;
        if ptr.is_null() {
            let _ = unsafe { GlobalFree(memory) };
            return Err("锁定文件剪贴板内存失败".to_string());
        }
        let header = DROPFILES {
            pFiles: dropfiles_size as u32,
            pt: POINT { x: 0, y: 0 },
            fNC: BOOL(0),
            fWide: BOOL(1),
        };
        unsafe {
            copy_nonoverlapping(
                (&header as *const DROPFILES).cast::<u8>(),
                ptr,
                dropfiles_size,
            );
            copy_nonoverlapping(
                encoded_paths.as_ptr().cast::<u8>(),
                ptr.add(dropfiles_size),
                payload_bytes,
            );
            let _ = GlobalUnlock(memory);
        }
        unsafe { SetClipboardData(CF_HDROP_FORMAT, HANDLE(memory.0)) }
            .map(|_| ())
            .map_err(|error| {
                let _ = unsafe { GlobalFree(memory) };
                format!("写入文件剪贴板失败: {error}")
            })
    }

    fn encode_paths(paths: &[PathBuf]) -> Result<Vec<u16>, String> {
        let mut out = Vec::new();
        for path in paths {
            if path.as_os_str().is_empty() {
                continue;
            }
            out.extend(path.as_os_str().encode_wide());
            out.push(0);
        }
        out.push(0);
        Ok(out)
    }
}

#[cfg(not(windows))]
mod platform {
    use super::ClipboardFilesSnapshot;
    use std::path::PathBuf;

    pub fn read_files_clipboard() -> Result<Option<ClipboardFilesSnapshot>, String> {
        Ok(None)
    }

    pub fn write_files_clipboard(_paths: &[PathBuf]) -> Result<(), String> {
        Err("当前平台不支持文件剪贴板".to_string())
    }
}
