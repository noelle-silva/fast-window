use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::data_dir;

const BROWSER_DIR_NAME: &str = "browser";
/// WebView2 始终在 userDataFolder 内创建该子目录存放实际数据（含系统默认位置）。
const WEBVIEW_DATA_DIR_NAME: &str = "EBWebView";
const MIGRATION_STAGING_SUFFIX: &str = ".migrating";
/// WebView2 在系统用户目录下的历史默认数据目录名。
const LEGACY_DIR_NAME: &str = "EBWebView";

/// 本次会话固定的浏览器数据目录；None 表示降级为系统默认位置。
#[derive(Clone)]
pub(crate) struct BrowserDataDir(pub(crate) Option<PathBuf>);

impl BrowserDataDir {
    pub(crate) fn path(&self) -> Option<&Path> {
        self.0.as_deref()
    }
}

/// 启动早期调用：解析目录、确保可写、修复历史错误布局、按需搬迁旧数据，
/// 返回本次会话的目录事实（传给 WebView2 的 userDataFolder）。
pub(crate) fn prepare(app: &tauri::AppHandle) -> BrowserDataDir {
    let user_data_folder = match resolve(app) {
        Ok(path) => path,
        Err(error) => {
            log(&format!("浏览器数据目录解析失败，改用系统默认位置: {error}"));
            return BrowserDataDir(None);
        }
    };
    if let Err(error) = data_dir::ensure_writable_dir(&user_data_folder) {
        log(&format!(
            "浏览器数据目录不可用，改用系统默认位置: {error}"
        ));
        return BrowserDataDir(None);
    }

    let data_root = data_root(&user_data_folder);
    repair_misplaced_layout(&user_data_folder, &data_root);
    migrate_if_needed(app, &data_root);
    BrowserDataDir(Some(user_data_folder))
}

/// 传给 WebView2 的 userDataFolder = App 数据目录 / browser（唯一派生规则）。
pub(crate) fn resolve(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir::resolve_data_dir(app)?.join(BROWSER_DIR_NAME))
}

/// WebView2 实际数据目录：始终位于 userDataFolder 的 EBWebView 子目录下。
pub(crate) fn data_root(user_data_folder: &Path) -> PathBuf {
    user_data_folder.join(WEBVIEW_DATA_DIR_NAME)
}

fn migrate_if_needed(app: &tauri::AppHandle, target: &Path) {
    // 用户切换数据目录留下的搬迁任务：以当前活跃数据为准，覆盖目标旧副本。
    if let Some(source) = pending_source(app).map(normalize_source) {
        if same_directory(&source, target) || is_nested(&source, target) {
            log(&format!(
                "搬迁来源与目标互相嵌套，跳过搬迁: {}",
                source.display()
            ));
            clear_pending(app);
            return;
        }
        match migrate(&source, target) {
            Ok(()) => {
                log(&format!(
                    "浏览器数据已跟随数据目录搬迁: {} -> {}",
                    source.display(),
                    target.display()
                ));
                clear_pending(app);
            }
            Err(error) => {
                log(&format!("浏览器数据搬迁失败，保留来源下次重试: {error}"));
            }
        }
        return;
    }

    // 升级后的自动搬迁：仅当目标还没有数据时执行。
    if !directory_is_empty(target) {
        return;
    }
    let Some(source) = legacy_browser_data_dir(app).filter(|path| path.is_dir()) else {
        return;
    };
    if same_directory(&source, target) || is_nested(&source, target) {
        log(&format!(
            "迁移来源与目标互相嵌套，跳过搬迁: {}",
            source.display()
        ));
        return;
    }
    match migrate(&source, target) {
        Ok(()) => {
            log(&format!(
                "浏览器数据已搬迁: {} -> {}",
                source.display(),
                target.display()
            ));
        }
        Err(error) => {
            log(&format!("浏览器数据搬迁失败，保留来源下次重试: {error}"));
        }
    }
}

/// 修复 0.1.10 的错误布局：实际数据曾被搬到 userDataFolder 根下，
/// 而 WebView2 只认其 EBWebView 子目录；把根下数据移入子目录（覆盖其中新建的空数据）。
/// 移动逐项原子进行且幂等：中断后下次启动继续。
fn repair_misplaced_layout(user_data_folder: &Path, data_root: &Path) {
    if !has_misplaced_data(user_data_folder) {
        return;
    }
    match move_entries_into_data_root(user_data_folder, data_root) {
        Ok(()) => log("浏览器数据目录布局已修复（根下数据移入 EBWebView 子目录）"),
        Err(error) => log(&format!(
            "浏览器数据目录布局修复未完成，下次启动继续: {error}"
        )),
    }
}

fn has_misplaced_data(user_data_folder: &Path) -> bool {
    user_data_folder.join("Default").is_dir() || user_data_folder.join("Local State").is_file()
}

fn move_entries_into_data_root(user_data_folder: &Path, data_root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(data_root)
        .map_err(|e| format!("创建目录失败 {}: {e}", data_root.display()))?;
    let entries = std::fs::read_dir(user_data_folder)
        .map_err(|e| format!("读取目录失败 {}: {e}", user_data_folder.display()))?;
    for entry in entries {
        let entry =
            entry.map_err(|e| format!("读取目录项失败 {}: {e}", user_data_folder.display()))?;
        let name = entry.file_name();
        // EBWebView 本身与可能残留的搬迁暂存目录留在原位（暂存由搬迁流程自行清理）。
        if name.to_string_lossy().starts_with(WEBVIEW_DATA_DIR_NAME) {
            continue;
        }
        let source = entry.path();
        let destination = data_root.join(&name);
        if destination.exists() {
            remove_path(&destination)?;
        }
        std::fs::rename(&source, &destination)
            .map_err(|e| format!("移动 {} 失败: {e}", source.display()))?;
    }
    Ok(())
}

fn remove_path(path: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("读取文件类型失败 {}: {e}", path.display()))?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| format!("删除目录失败 {}: {e}", path.display()))
    } else {
        std::fs::remove_file(path).map_err(|e| format!("删除文件失败 {}: {e}", path.display()))
    }
}

/// 待迁移来源：用户切换数据目录时记录的当前活跃数据位置（目录不存在则视为无任务）。
fn pending_source(app: &tauri::AppHandle) -> Option<PathBuf> {
    let pending = data_dir::pending_browser_data_dir(app).ok().flatten()?;
    pending.is_dir().then_some(pending)
}

/// 历史版本可能把待迁移记录写成 userDataFolder（数据在其 EBWebView 子目录里）；
/// 归一化为实际数据根，并顺带修复来源自身的错位布局。
fn normalize_source(pending: PathBuf) -> PathBuf {
    let nested_root = data_root(&pending);
    if nested_root.is_dir() {
        repair_misplaced_layout(&pending, &nested_root);
        nested_root
    } else {
        pending
    }
}

fn legacy_browser_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let local_data_dir = app.path().local_data_dir().ok()?;
    Some(
        local_data_dir
            .join(app.config().identifier.clone())
            .join(LEGACY_DIR_NAME),
    )
}

fn migrate(source: &Path, target: &Path) -> Result<(), String> {
    let staging = staging_dir(target);
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|e| format!("清理暂存目录失败: {e}"))?;
    }
    copy_dir_recursive(source, &staging).map_err(|error| {
        let _ = std::fs::remove_dir_all(&staging);
        error
    })?;

    if target.exists() {
        std::fs::remove_dir_all(target).map_err(|e| format!("清理目标目录失败: {e}"))?;
    }
    if let Err(error) = std::fs::rename(&staging, target) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("就位搬迁数据失败: {error}"));
    }

    // 数据已就位；来源删除失败不影响本次结果，下次启动按来源与目标状态重新判定。
    let _ = std::fs::remove_dir_all(source);
    Ok(())
}

fn staging_dir(target: &Path) -> PathBuf {
    let file_name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    target.with_file_name(format!("{file_name}{MIGRATION_STAGING_SUFFIX}"))
}

fn directory_is_empty(path: &Path) -> bool {
    std::fs::read_dir(path)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(true)
}

/// 来源与目标互为祖先时复制会自我嵌套，视为病态配置。
fn is_nested(source: &Path, target: &Path) -> bool {
    target.starts_with(source) || source.starts_with(target)
}

/// 同一目录的不同写法（大小写、`.` 等）不应触发自我搬迁。
fn same_directory(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn copy_dir_recursive(source: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("创建目录失败 {}: {e}", dest.display()))?;
    let entries = std::fs::read_dir(source)
        .map_err(|e| format!("读取目录失败 {}: {e}", source.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败 {}: {e}", source.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败 {}: {e}", entry.path().display()))?;
        let dest_path = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &dest_path)
                .map_err(|e| format!("复制文件失败 {}: {e}", entry.path().display()))?;
        }
        // 其它类型（符号链接等）不属于 WebView2 数据目录结构，跳过。
    }
    Ok(())
}

fn clear_pending(app: &tauri::AppHandle) {
    if let Err(error) = data_dir::clear_pending_browser_data_dir(app) {
        log(&format!("清除待搬迁记录失败: {error}"));
    }
}

fn log(message: &str) {
    eprintln!("[webview][browser-data] {message}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fw-webview-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn derives_data_root_under_user_data_folder() {
        assert_eq!(
            data_root(Path::new("data/browser")),
            PathBuf::from("data/browser/EBWebView")
        );
    }

    #[test]
    fn derives_staging_dir_beside_target() {
        assert_eq!(
            staging_dir(Path::new("data/browser/EBWebView")),
            PathBuf::from("data/browser/EBWebView.migrating")
        );
    }

    #[test]
    fn detects_nested_paths() {
        assert!(is_nested(
            Path::new("C:/data/browser"),
            Path::new("C:/data/browser/nested")
        ));
        assert!(is_nested(
            Path::new("C:/data"),
            Path::new("C:/data/browser")
        ));
        assert!(!is_nested(
            Path::new("C:/data/browser"),
            Path::new("C:/other/browser")
        ));
        assert!(!is_nested(
            Path::new("C:/data/browser-old"),
            Path::new("C:/data/browser")
        ));
    }

    #[test]
    fn migrates_source_into_empty_target_and_removes_source() {
        let root = temp_dir("migrate");
        let source = root.join("legacy");
        std::fs::create_dir_all(source.join("Default")).unwrap();
        std::fs::write(source.join("Default").join("Cookies"), b"cookie-data").unwrap();
        std::fs::write(source.join("Local State"), b"state").unwrap();
        let target = root.join("data").join("browser");
        std::fs::create_dir_all(&target).unwrap();

        migrate(&source, &target).unwrap();

        assert!(!source.exists());
        assert_eq!(
            std::fs::read(target.join("Default").join("Cookies")).unwrap(),
            b"cookie-data"
        );
        assert_eq!(std::fs::read(target.join("Local State")).unwrap(), b"state");
        assert!(!staging_dir(&target).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn repairs_misplaced_root_data_into_data_root() {
        let root = temp_dir("repair-misplaced");
        let user_data_folder = root.join("data").join("browser");
        std::fs::create_dir_all(user_data_folder.join("Default")).unwrap();
        std::fs::write(user_data_folder.join("Default").join("Cookies"), b"old").unwrap();
        std::fs::write(user_data_folder.join("Local State"), b"old-state").unwrap();
        let data_root = data_root(&user_data_folder);
        std::fs::create_dir_all(data_root.join("Default")).unwrap();
        std::fs::write(data_root.join("Default").join("Cookies"), b"new").unwrap();

        repair_misplaced_layout(&user_data_folder, &data_root);

        assert_eq!(std::fs::read(data_root.join("Default").join("Cookies")).unwrap(), b"old");
        assert_eq!(std::fs::read(data_root.join("Local State")).unwrap(), b"old-state");
        assert!(!user_data_folder.join("Default").exists());
        assert!(!user_data_folder.join("Local State").exists());
        assert!(!has_misplaced_data(&user_data_folder));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn normalizes_legacy_pending_user_data_folder() {
        let root = temp_dir("normalize-legacy");
        let user_data_folder = root.join("old").join("browser");
        std::fs::create_dir_all(user_data_folder.join("Default")).unwrap();
        std::fs::write(user_data_folder.join("Default").join("Cookies"), b"old").unwrap();
        std::fs::write(user_data_folder.join("Local State"), b"state").unwrap();
        let nested = data_root(&user_data_folder);
        std::fs::create_dir_all(nested.join("Default")).unwrap();
        std::fs::write(nested.join("Default").join("Cookies"), b"new").unwrap();

        let source = normalize_source(user_data_folder.clone());

        assert_eq!(source, nested);
        assert_eq!(std::fs::read(source.join("Default").join("Cookies")).unwrap(), b"old");
        assert!(!user_data_folder.join("Default").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn normalizes_data_root_source_unchanged() {
        let root = temp_dir("normalize-root");
        let data_root_dir = root.join("old").join("browser").join("EBWebView");
        std::fs::create_dir_all(&data_root_dir).unwrap();
        std::fs::write(data_root_dir.join("Local State"), b"state").unwrap();

        let source = normalize_source(data_root_dir.clone());

        assert_eq!(source, data_root_dir);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn keeps_normal_layout_untouched() {
        let root = temp_dir("repair-normal");
        let user_data_folder = root.join("data").join("browser");
        let data_root = data_root(&user_data_folder);
        std::fs::create_dir_all(&data_root).unwrap();
        std::fs::write(data_root.join("Local State"), b"state").unwrap();

        repair_misplaced_layout(&user_data_folder, &data_root);

        assert_eq!(std::fs::read(data_root.join("Local State")).unwrap(), b"state");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_replaces_existing_target() {
        let root = temp_dir("migrate-replace");
        let source = root.join("active");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("Cookies"), b"fresh").unwrap();
        let target = root.join("chosen").join("browser");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("Cookies"), b"stale").unwrap();
        std::fs::write(target.join("stale-only"), b"stale").unwrap();

        migrate(&source, &target).unwrap();

        assert_eq!(std::fs::read(target.join("Cookies")).unwrap(), b"fresh");
        assert!(!target.join("stale-only").exists());
        assert!(!source.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn same_directory_matches_equivalent_paths() {
        let root = temp_dir("same-directory");
        let nested = root.join("child");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(same_directory(&root, &root));
        assert!(same_directory(&root, &nested.join("..")));
        assert!(!same_directory(&root, &nested));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_cleans_stale_staging_before_copy() {
        let root = temp_dir("migrate-stale-staging");
        let source = root.join("legacy");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("file"), b"data").unwrap();
        let target = root.join("data").join("browser");
        std::fs::create_dir_all(staging_dir(&target)).unwrap();
        std::fs::write(staging_dir(&target).join("stale"), b"stale").unwrap();

        migrate(&source, &target).unwrap();

        assert!(!source.exists());
        assert!(target.join("file").is_file());
        assert!(!target.join("stale").exists());
        assert!(!staging_dir(&target).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migration_failure_keeps_source_and_cleans_staging() {
        let root = temp_dir("migrate-failure");
        let source = root.join("legacy-file");
        std::fs::write(&source, b"not-a-directory").unwrap();
        let target = root.join("data").join("browser");

        let result = migrate(&source, &target);

        assert!(result.is_err());
        assert!(source.is_file());
        assert!(!target.exists());
        assert!(!staging_dir(&target).exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
