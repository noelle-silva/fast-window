use std::path::Path;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) struct PendingDirReplacement {
    dst: PathBuf,
    bak: PathBuf,
    had_existing: bool,
    committed: bool,
}

impl PendingDirReplacement {
    pub(crate) fn commit(mut self) -> Result<(), String> {
        self.committed = true;
        if self.bak.exists() {
            let _ = std::fs::remove_dir_all(&self.bak);
        }
        Ok(())
    }

    pub(crate) fn rollback(mut self) -> Result<(), String> {
        if self.dst.exists() {
            std::fs::remove_dir_all(&self.dst).map_err(|e| format!("移除新目录失败: {e}"))?;
        }
        if self.had_existing && self.bak.exists() {
            std::fs::rename(&self.bak, &self.dst).map_err(|e| format!("恢复旧目录失败: {e}"))?;
        }
        self.committed = true;
        Ok(())
    }
}

impl Drop for PendingDirReplacement {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        let _ = std::fs::remove_dir_all(&self.dst);
        if self.had_existing && self.bak.exists() {
            let _ = std::fs::rename(&self.bak, &self.dst);
        }
    }
}

pub(crate) fn begin_replace_dir_from_tmp(
    dst: &Path,
    tmp: &Path,
    tag: &str,
) -> Result<PendingDirReplacement, String> {
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
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let bak = parent.join(format!(".bak-{safe_tag}-{stamp}"));

    // Windows 上 remove_dir_all 可能因为文件占用删到一半；rename 交换可以保证失败时旧目录仍在。
    let had_existing = dst.exists();
    if had_existing {
        if let Err(e) = std::fs::rename(dst, &bak) {
            let _ = std::fs::remove_dir_all(tmp);
            return Err(format!("重命名旧目录失败（可能被占用）: {e}"));
        }
    }

    if let Err(e) = std::fs::rename(tmp, dst) {
        if bak.exists() {
            let _ = std::fs::rename(&bak, dst);
        }
        let _ = std::fs::remove_dir_all(tmp);
        return Err(format!("替换目录失败: {e}"));
    }

    Ok(PendingDirReplacement {
        dst: dst.to_path_buf(),
        bak,
        had_existing,
        committed: false,
    })
}

pub(crate) fn replace_dir_from_tmp(dst: &Path, tmp: &Path, tag: &str) -> Result<(), String> {
    begin_replace_dir_from_tmp(dst, tmp, tag)?.commit()
}
