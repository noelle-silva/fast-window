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

fn backup_stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis()
}

fn safe_backup_tag(tag: &str) -> String {
    tag.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
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

    let safe_tag = safe_backup_tag(tag);
    let bak = parent.join(format!(".bak-{safe_tag}-{}", backup_stamp()));

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

enum OverlayStep {
    CreatedDir(PathBuf),
    BackedUpFile(PathBuf),
    PlacedFile(PathBuf),
}

/// 覆盖式目录合并：把 tmp 中的文件逐个覆盖进 dst，dst 中不在 tmp 的内容保持不动。
/// 被覆盖的旧文件先移入备份区，任一步失败时按逆序恢复，成功提交后清理备份区。
pub(crate) struct PendingDirOverlay {
    dst: PathBuf,
    bak: PathBuf,
    created_dst: bool,
    steps: Vec<OverlayStep>,
    finished: bool,
}

impl PendingDirOverlay {
    pub(crate) fn commit(mut self) -> Result<(), String> {
        self.finished = true;
        if self.bak.exists() {
            let _ = std::fs::remove_dir_all(&self.bak);
        }
        Ok(())
    }

    pub(crate) fn rollback(mut self) -> Result<(), String> {
        let result = self.rollback_steps();
        self.finished = true;
        result
    }

    fn merge_from(&mut self, tmp: &Path) -> Result<(), String> {
        match std::fs::metadata(&self.dst) {
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => return Err("目标路径已存在但不是目录，拒绝覆盖".to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir_all(&self.dst).map_err(|e| format!("创建目标目录失败: {e}"))?;
                self.created_dst = true;
            }
            Err(error) => return Err(format!("读取目标目录失败: {error}")),
        }
        self.merge_dir(tmp, Path::new(""))
    }

    fn merge_dir(&mut self, src: &Path, rel: &Path) -> Result<(), String> {
        let entries = std::fs::read_dir(src).map_err(|e| format!("读取包目录失败: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取包目录条目失败: {e}"))?;
            let rel_child = rel.join(entry.file_name());
            let file_type = entry
                .file_type()
                .map_err(|e| format!("读取包条目类型失败 {}: {e}", rel_child.display()))?;
            if file_type.is_dir() {
                self.merge_subdir(&entry.path(), &rel_child)?;
            } else if file_type.is_file() {
                self.merge_file(&entry.path(), &rel_child)?;
            }
        }
        Ok(())
    }

    fn merge_subdir(&mut self, src: &Path, rel: &Path) -> Result<(), String> {
        let target = self.dst.join(rel);
        match std::fs::metadata(&target) {
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => {
                return Err(format!(
                    "目标路径已存在同名文件，拒绝覆盖目录: {}",
                    rel.display()
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir(&target)
                    .map_err(|e| format!("创建目标目录失败 {}: {e}", rel.display()))?;
                self.steps.push(OverlayStep::CreatedDir(rel.to_path_buf()));
            }
            Err(error) => return Err(format!("读取目标路径失败 {}: {error}", rel.display())),
        }
        self.merge_dir(src, rel)
    }

    fn merge_file(&mut self, src: &Path, rel: &Path) -> Result<(), String> {
        let target = self.dst.join(rel);
        match std::fs::symlink_metadata(&target) {
            Ok(meta) if meta.is_dir() => {
                return Err(format!(
                    "目标路径已存在同名目录，拒绝覆盖文件: {}",
                    rel.display()
                ));
            }
            Ok(_) => {
                let bak = self.bak.join(rel);
                if let Some(parent) = bak.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("创建备份目录失败 {}: {e}", rel.display()))?;
                }
                std::fs::rename(&target, &bak)
                    .map_err(|e| format!("备份旧文件失败 {}: {e}", rel.display()))?;
                self.steps
                    .push(OverlayStep::BackedUpFile(rel.to_path_buf()));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("读取目标文件失败 {}: {error}", rel.display())),
        }
        std::fs::rename(src, &target)
            .map_err(|e| format!("覆盖文件失败 {}: {e}", rel.display()))?;
        self.steps.push(OverlayStep::PlacedFile(rel.to_path_buf()));
        Ok(())
    }

    fn rollback_steps(&mut self) -> Result<(), String> {
        let mut failures = Vec::new();
        while let Some(step) = self.steps.pop() {
            match step {
                OverlayStep::PlacedFile(rel) => {
                    let target = self.dst.join(&rel);
                    match std::fs::remove_file(&target) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => {
                            failures.push(format!("移除新文件失败 {}: {error}", rel.display()))
                        }
                    }
                }
                OverlayStep::BackedUpFile(rel) => {
                    let bak = self.bak.join(&rel);
                    if !bak.exists() {
                        continue;
                    }
                    let target = self.dst.join(&rel);
                    if let Err(error) = std::fs::rename(&bak, &target) {
                        failures.push(format!("恢复旧文件失败 {}: {error}", rel.display()));
                    }
                }
                // 目录里若仍有其他内容，remove_dir 会失败：那些内容不属于本次覆盖，保持不动。
                OverlayStep::CreatedDir(rel) => {
                    let _ = std::fs::remove_dir(self.dst.join(&rel));
                }
            }
        }
        if self.created_dst {
            let _ = std::fs::remove_dir(&self.dst);
        }
        if failures.is_empty() {
            if self.bak.exists() {
                let _ = std::fs::remove_dir_all(&self.bak);
            }
            Ok(())
        } else {
            Err(format!(
                "{}（旧文件备份保留在 {}）",
                failures.join("; "),
                self.bak.display()
            ))
        }
    }

    fn fail(&mut self, error: String) -> String {
        let result = self.rollback_steps();
        self.finished = true;
        match result {
            Ok(()) => error,
            Err(rollback_error) => format!("{error}; 回滚失败: {rollback_error}"),
        }
    }
}

impl Drop for PendingDirOverlay {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        let _ = self.rollback_steps();
    }
}

pub(crate) fn begin_overlay_dir_from_tmp(
    dst: &Path,
    tmp: &Path,
    tag: &str,
) -> Result<PendingDirOverlay, String> {
    let Some(parent) = dst.parent() else {
        return Err("目标目录没有父目录".to_string());
    };

    let mut overlay = PendingDirOverlay {
        dst: dst.to_path_buf(),
        bak: parent.join(format!(".bak-{}-{}", safe_backup_tag(tag), backup_stamp())),
        created_dst: false,
        steps: Vec::new(),
        finished: false,
    };

    if let Err(error) = overlay.merge_from(tmp) {
        return Err(overlay.fail(error));
    }
    Ok(overlay)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("fw-install-fs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("创建测试目录失败");
        root
    }

    fn write(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("创建测试父目录失败");
        }
        std::fs::write(path, text).expect("写入测试文件失败");
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).expect("读取测试文件失败")
    }

    fn overlay_dirs(root: &Path) -> (PathBuf, PathBuf) {
        (root.join("package"), root.join("tmp"))
    }

    fn backup_leftovers(root: &Path) -> Vec<String> {
        std::fs::read_dir(root)
            .expect("读取测试根目录失败")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.starts_with(".bak-"))
            .collect()
    }

    fn expect_overlay_error(result: Result<PendingDirOverlay, String>) -> String {
        match result {
            Ok(_) => panic!("应覆盖失败"),
            Err(error) => error,
        }
    }

    #[test]
    fn overlays_files_and_keeps_untouched_content() {
        let root = test_root("overlay-keeps");
        let (dst, tmp) = overlay_dirs(&root);
        write(&dst.join("a.txt"), "old-a");
        write(&dst.join("keep.txt"), "keep");
        write(&dst.join("sub/keep.txt"), "keep-sub");
        write(&tmp.join("a.txt"), "new-a");
        write(&tmp.join("sub/new.txt"), "new-sub");
        std::fs::create_dir_all(tmp.join("empty")).expect("创建空目录失败");

        let overlay = begin_overlay_dir_from_tmp(&dst, &tmp, "test").expect("覆盖失败");
        overlay.commit().expect("提交失败");

        assert_eq!(read(&dst.join("a.txt")), "new-a");
        assert_eq!(read(&dst.join("keep.txt")), "keep");
        assert_eq!(read(&dst.join("sub/keep.txt")), "keep-sub");
        assert_eq!(read(&dst.join("sub/new.txt")), "new-sub");
        assert!(dst.join("empty").is_dir(), "包内空目录应被创建");
        assert!(backup_leftovers(&root).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn overlays_into_missing_target_dir() {
        let root = test_root("overlay-fresh");
        let (dst, tmp) = overlay_dirs(&root);
        write(&tmp.join("nested/app.exe"), "app");

        let overlay = begin_overlay_dir_from_tmp(&dst, &tmp, "test").expect("覆盖失败");
        overlay.commit().expect("提交失败");

        assert_eq!(read(&dst.join("nested/app.exe")), "app");
        assert!(backup_leftovers(&root).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rollback_restores_overwritten_files_and_removes_added_files() {
        let root = test_root("overlay-rollback");
        let (dst, tmp) = overlay_dirs(&root);
        write(&dst.join("a.txt"), "old-a");
        write(&dst.join("keep.txt"), "keep");
        write(&tmp.join("a.txt"), "new-a");
        write(&tmp.join("added/new.txt"), "added");

        let overlay = begin_overlay_dir_from_tmp(&dst, &tmp, "test").expect("覆盖失败");
        assert_eq!(read(&dst.join("a.txt")), "new-a");
        overlay.rollback().expect("回滚失败");

        assert_eq!(read(&dst.join("a.txt")), "old-a");
        assert_eq!(read(&dst.join("keep.txt")), "keep");
        assert!(!dst.join("added").exists());
        assert!(backup_leftovers(&root).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rollback_removes_target_dir_created_by_overlay() {
        let root = test_root("overlay-fresh-rollback");
        let (dst, tmp) = overlay_dirs(&root);
        write(&tmp.join("app.exe"), "app");

        let overlay = begin_overlay_dir_from_tmp(&dst, &tmp, "test").expect("覆盖失败");
        overlay.rollback().expect("回滚失败");

        assert!(!dst.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn failed_overlay_rolls_back_completed_steps() {
        let root = test_root("overlay-merge-failure");
        let (dst, tmp) = overlay_dirs(&root);
        write(&dst.join("a.txt"), "old-a");
        write(&dst.join("blocked"), "i-am-a-file");
        write(&tmp.join("a.txt"), "new-a");
        write(&tmp.join("blocked/child.txt"), "child");

        let error = expect_overlay_error(begin_overlay_dir_from_tmp(&dst, &tmp, "test"));

        assert!(error.contains("同名文件"), "{error}");
        assert_eq!(read(&dst.join("a.txt")), "old-a");
        assert_eq!(read(&dst.join("blocked")), "i-am-a-file");
        assert!(!dst.join("blocked/child.txt").exists());
        assert!(backup_leftovers(&root).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_file_over_existing_directory() {
        let root = test_root("overlay-dir-conflict");
        let (dst, tmp) = overlay_dirs(&root);
        std::fs::create_dir_all(dst.join("assets")).expect("创建测试目录失败");
        write(&tmp.join("assets"), "i-am-a-file");

        let error = expect_overlay_error(begin_overlay_dir_from_tmp(&dst, &tmp, "test"));

        assert!(error.contains("同名目录"), "{error}");
        assert!(dst.join("assets").is_dir());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn locked_target_file_fails_and_restores_previous_state() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = test_root("overlay-locked");
        let (dst, tmp) = overlay_dirs(&root);
        write(&dst.join("a.txt"), "old-a");
        write(&tmp.join("a.txt"), "new-a");
        write(&tmp.join("b.txt"), "new-b");

        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(dst.join("a.txt"))
            .expect("独占打开测试文件失败");

        let error = expect_overlay_error(begin_overlay_dir_from_tmp(&dst, &tmp, "test"));

        assert!(error.contains("a.txt"), "{error}");
        drop(lock);
        assert_eq!(read(&dst.join("a.txt")), "old-a");
        assert!(!dst.join("b.txt").exists());

        let _ = std::fs::remove_dir_all(&root);
    }
}
