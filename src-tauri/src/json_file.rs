use serde_json::Value;
#[cfg(target_os = "windows")]
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

pub(crate) fn with_exclusive_path<T>(
    path: &Path,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = platform::PathLock::acquire(path)?;
    action()
}

pub(crate) fn read_value(path: &Path) -> Result<Value, String> {
    with_exclusive_path(path, || read_value_unlocked(path))
}

pub(crate) fn read_value_unlocked(path: &Path) -> Result<Value, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("读取配置失败: {e}"))?;
    serde_json::from_str::<Value>(&content).map_err(|e| format!("解析 JSON 失败: {e}"))
}

pub(crate) fn write_pretty(path: &Path, value: &Value) -> Result<(), String> {
    with_exclusive_path(path, || write_pretty_unlocked(path, value))
}

pub(crate) fn write_pretty_unlocked(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }

    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化配置失败: {e}"))?;
    let tmp = temp_path_for(path);

    std::fs::write(&tmp, content).map_err(|e| format!("写入临时配置失败: {e}"))?;
    if let Err(e) = replace_file(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

fn temp_path_for(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    parent.join(format!(
        ".tmp-{name}-{}-{stamp}-{seq}.json",
        std::process::id()
    ))
}

#[cfg(target_os = "windows")]
fn replace_file(tmp: &Path, target: &Path) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let tmp_wide = wide_path(tmp);
    let target_wide = wide_path(target);
    unsafe {
        MoveFileExW(
            PCWSTR(tmp_wide.as_ptr()),
            PCWSTR(target_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|e| format!("替换配置文件失败: {e}"))
}

#[cfg(not(target_os = "windows"))]
fn replace_file(tmp: &Path, target: &Path) -> Result<(), String> {
    std::fs::rename(tmp, target).map_err(|e| format!("替换配置文件失败: {e}"))
}

#[cfg(target_os = "windows")]
fn wide_path(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(target_os = "windows")]
fn mutex_name_for(path: &Path) -> String {
    let normalized = path.to_string_lossy().to_ascii_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    format!("Local\\FastWindow.JsonFile.{hex}")
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{mutex_name_for, wide_path};
    use std::path::Path;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        CreateMutexW, ReleaseMutex, WaitForSingleObject, INFINITE,
    };

    pub(crate) struct PathLock {
        handle: HANDLE,
    }

    impl PathLock {
        pub(crate) fn acquire(path: &Path) -> Result<Self, String> {
            let name = mutex_name_for(path);
            let name_wide = wide_path(Path::new(&name));
            let handle = unsafe { CreateMutexW(None, false, PCWSTR(name_wide.as_ptr())) }
                .map_err(|e| format!("创建配置文件锁失败: {e}"))?;

            let wait = unsafe { WaitForSingleObject(handle, INFINITE) };
            if wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED {
                return Ok(Self { handle });
            }

            unsafe {
                let _ = CloseHandle(handle);
            }
            Err(format!("等待配置文件锁失败: {wait:?}"))
        }
    }

    impl Drop for PathLock {
        fn drop(&mut self) {
            unsafe {
                let _ = ReleaseMutex(self.handle);
                let _ = CloseHandle(self.handle);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use std::path::Path;

    pub(crate) struct PathLock;

    impl PathLock {
        pub(crate) fn acquire(_path: &Path) -> Result<Self, String> {
            Ok(Self)
        }
    }
}
