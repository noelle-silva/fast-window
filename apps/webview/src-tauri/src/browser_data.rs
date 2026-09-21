use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::data_dir;

const BROWSER_DIR_NAME: &str = "browser";
/// 多账号身份空间集合目录（位于数据目录下，与默认空间目录同级）。
const IDENTITY_DIR_NAME: &str = "browser-profiles";
/// 身份空间元数据文件名（记录来源条目名与网址，供展示与继承匹配）。
const IDENTITY_META_FILE: &str = "identity.json";
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

    repair_misplaced_layout(&user_data_folder, &data_root(&user_data_folder));
    migrate_if_needed(app, &user_data_folder);
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

/// 身份空间标识：小写字母、数字、`-`、`_`，长度受限（兼作目录名，防路径穿越）。
pub(crate) fn is_safe_space_id(space_id: &str) -> bool {
    !space_id.is_empty()
        && space_id.len() <= 40
        && space_id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// 身份空间 userDataFolder = `<数据目录>/browser-profiles/<空间标识>`。
pub(crate) fn identity_dir(data_dir: &Path, space_id: &str) -> Result<PathBuf, String> {
    if !is_safe_space_id(space_id) {
        return Err(format!("非法浏览器空间标识: {space_id}"));
    }
    Ok(data_dir.join(IDENTITY_DIR_NAME).join(space_id))
}

/// 确保身份空间目录可用，返回其 userDataFolder。
pub(crate) fn ensure_identity_dir(
    app: &tauri::AppHandle,
    space_id: &str,
) -> Result<PathBuf, String> {
    let dir = identity_dir(&data_dir::resolve_data_dir(app)?, space_id)?;
    data_dir::ensure_writable_dir(&dir)?;
    Ok(dir)
}

/// 身份空间元数据：来源展示信息。
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdentityMeta {
    pub name: String,
    pub url: String,
}

/// 写入身份空间元数据（尽力而为，失败仅记录；路径非法返回错误）。
pub(crate) fn write_identity_meta(
    data_dir: &Path,
    space_id: &str,
    name: &str,
    url: &str,
) -> Result<(), String> {
    let dir = identity_dir(data_dir, space_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建身份空间目录失败: {e}"))?;
    let meta = IdentityMeta {
        name: name.trim().to_string(),
        url: url.trim().to_string(),
    };
    let payload =
        serde_json::to_string_pretty(&meta).map_err(|e| format!("序列化身份元数据失败: {e}"))?;
    std::fs::write(dir.join(IDENTITY_META_FILE), format!("{payload}\n"))
        .map_err(|e| format!("写入身份元数据失败: {e}"))
}

/// 读取身份空间元数据；文件缺失或损坏时返回 None。
pub(crate) fn read_identity_meta(data_dir: &Path, space_id: &str) -> Option<IdentityMeta> {
    let dir = identity_dir(data_dir, space_id).ok()?;
    let text = std::fs::read_to_string(dir.join(IDENTITY_META_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

/// 列举身份空间目录名（仅安全标识）。
pub(crate) fn list_identity_spaces(data_dir: &Path) -> Vec<String> {
    let root = data_dir.join(IDENTITY_DIR_NAME);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut spaces = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if is_safe_space_id(&name) {
            spaces.push(name);
        }
    }
    spaces.sort();
    spaces
}

/// 身份空间目录占用字节数（递归；读取失败按 0 计）。
pub(crate) fn identity_space_size(data_dir: &Path, space_id: &str) -> u64 {
    let Ok(dir) = identity_dir(data_dir, space_id) else {
        return 0;
    };
    dir_size_bytes(&dir)
}

fn dir_size_bytes(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut total = 0_u64;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            total = total.saturating_add(dir_size_bytes(&entry.path()));
        } else {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

/// 删除条目的身份空间（尽力而为：失败仅记录，不影响条目删除结果）。
pub(crate) fn remove_identity_dir(data_dir: &Path, space_id: &str) {
    let dir = match identity_dir(data_dir, space_id) {
        Ok(dir) => dir,
        Err(error) => {
            log(&format!("跳过身份空间清理: {error}"));
            return;
        }
    };
    if !dir.exists() {
        return;
    }
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => log(&format!("身份数据空间已清理: {}", dir.display())),
        Err(error) => log(&format!(
            "身份数据空间清理失败（残留不影响功能）: {} ({error})",
            dir.display()
        )),
    }
}

fn migrate_if_needed(app: &tauri::AppHandle, user_data_folder: &Path) {
    // 用户切换数据目录留下的搬迁任务：默认空间与身份空间整包跟随。
    if let Some(pending) = pending_source(app) {
        migrate_pending(app, &pending, user_data_folder);
        return;
    }

    // 升级后的自动搬迁：仅当默认空间还没有数据时执行。
    let data_root = data_root(user_data_folder);
    if !directory_is_empty(&data_root) {
        return;
    }
    let Some(source) = legacy_browser_data_dir(app).filter(|path| path.is_dir()) else {
        return;
    };
    if same_directory(&source, &data_root) || is_nested(&source, &data_root) {
        log(&format!(
            "迁移来源与目标互相嵌套，跳过搬迁: {}",
            source.display()
        ));
        return;
    }
    match migrate(&source, &data_root) {
        Ok(()) => {
            log(&format!(
                "浏览器数据已搬迁: {} -> {}",
                source.display(),
                data_root.display()
            ));
        }
        Err(error) => {
            log(&format!("浏览器数据搬迁失败，保留来源下次重试: {error}"));
        }
    }
}

/// 用户切换数据目录的整包搬迁：默认空间目录与身份空间集分别覆盖到新数据目录。
fn migrate_pending(app: &tauri::AppHandle, pending: &Path, target_user_data_folder: &Path) {
    let Some(source_data_dir) = pending_data_dir(pending) else {
        clear_pending(app);
        return;
    };
    let Some(target_data_dir) = target_user_data_folder.parent().map(Path::to_path_buf) else {
        clear_pending(app);
        return;
    };
    let mut failed = false;

    let source_user_data_folder = source_data_dir.join(BROWSER_DIR_NAME);
    if source_user_data_folder.is_dir() {
        repair_misplaced_layout(
            &source_user_data_folder,
            &data_root(&source_user_data_folder),
        );
        if same_directory(&source_user_data_folder, target_user_data_folder)
            || is_nested(&source_user_data_folder, target_user_data_folder)
        {
            log(&format!(
                "默认浏览器空间与目标互相嵌套，跳过搬迁: {}",
                source_user_data_folder.display()
            ));
        } else {
            match migrate(&source_user_data_folder, target_user_data_folder) {
                Ok(()) => log(&format!(
                    "默认浏览器空间已跟随搬迁: {} -> {}",
                    source_user_data_folder.display(),
                    target_user_data_folder.display()
                )),
                Err(error) => {
                    log(&format!("默认浏览器空间搬迁失败: {error}"));
                    failed = true;
                }
            }
        }
    }

    let source_identities = source_data_dir.join(IDENTITY_DIR_NAME);
    let target_identities = target_data_dir.join(IDENTITY_DIR_NAME);
    if source_identities.is_dir() {
        if same_directory(&source_identities, &target_identities)
            || is_nested(&source_identities, &target_identities)
        {
            log(&format!(
                "身份空间与目标互相嵌套，跳过搬迁: {}",
                source_identities.display()
            ));
        } else {
            match migrate(&source_identities, &target_identities) {
                Ok(()) => log(&format!(
                    "身份空间已跟随搬迁: {} -> {}",
                    source_identities.display(),
                    target_identities.display()
                )),
                Err(error) => {
                    log(&format!("身份空间搬迁失败: {error}"));
                    failed = true;
                }
            }
        }
    }

    if failed {
        log("浏览器数据搬迁未完成，保留来源下次启动重试");
    } else {
        clear_pending(app);
    }
}

/// 待迁移记录 → 旧数据目录（兼容历史三种记录形态：数据目录 / userDataFolder / 数据根）。
fn pending_data_dir(pending: &Path) -> Option<PathBuf> {
    let name = pending.file_name()?.to_string_lossy();
    if name == WEBVIEW_DATA_DIR_NAME {
        return pending.parent()?.parent().map(Path::to_path_buf);
    }
    if name == BROWSER_DIR_NAME {
        return pending.parent().map(Path::to_path_buf);
    }
    Some(pending.to_path_buf())
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
    fn pending_data_dir_accepts_all_recorded_forms() {
        let root = temp_dir("pending-data-dir");
        let data_dir = root.join("data");
        std::fs::create_dir_all(data_dir.join("browser").join("EBWebView")).unwrap();

        assert_eq!(pending_data_dir(&data_dir).unwrap(), data_dir);
        assert_eq!(pending_data_dir(&data_dir.join("browser")).unwrap(), data_dir);
        assert_eq!(
            pending_data_dir(&data_dir.join("browser").join("EBWebView")).unwrap(),
            data_dir
        );
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
