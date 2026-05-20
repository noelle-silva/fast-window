use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::Shortcut;
use tokio::io::AsyncWriteExt;

use crate::app_lifecycle::{stop_registered_app_for_update, AppLifecycleManager};
use crate::install_fs::begin_replace_dir_from_tmp;
use crate::{
    app_apps_dir, ensure_writable_dir, is_https_url, normalize_zip_name, now_ms,
    open_dir_in_file_manager, parse_sha256_hex_32, rand_u32, safe_relative_path, to_hex_lower,
};

const FW_APP_MANIFEST: &str = "fw-app.json";
const APP_PACKAGE_MAX_ZIP_BYTES: usize = 200 * 1024 * 1024;
const APP_PACKAGE_MAX_EXTRACT_BYTES: usize = 500 * 1024 * 1024;
const APP_PACKAGE_MAX_FILES: usize = 4096;
const APP_MANIFEST_MAX_BYTES: u64 = 256 * 1024;
const APP_ICON_DATA_URL_MAX_LEN: usize = 700 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppPackageManifest {
    id: String,
    name: String,
    version: String,
    windows_executable: String,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    display_mode: Option<String>,
    #[serde(default)]
    commands: Vec<AppPackageCommand>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppPackageCommand {
    id: String,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hotkey: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppStoreInstallRequest {
    url: String,
    expected_sha256: String,
    expected_id: String,
    expected_version: String,
    install_dir: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppStoreUpdateRequest {
    url: String,
    expected_sha256: String,
    expected_id: String,
    expected_version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppStoreInstallResult {
    app_id: String,
    version: String,
    path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledAppInfo {
    id: String,
    name: String,
    version: String,
    path: String,
    icon: String,
    display_mode: String,
    commands: Vec<AppPackageCommand>,
}

struct ExtractedAppPackage {
    tmp_dir: PathBuf,
    manifest: AppPackageManifest,
}

struct ResolvedInstalledApp {
    app_container: PathBuf,
    manifest_dir: PathBuf,
    exe_path: PathBuf,
    manifest: AppPackageManifest,
}

struct RegisteredInstalledApp {
    registry_id: String,
    record: Value,
    installed: ResolvedInstalledApp,
}

impl Drop for ExtractedAppPackage {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.tmp_dir);
    }
}

#[tauri::command]
pub(crate) fn get_apps_dir(app: AppHandle) -> Result<String, String> {
    let dir = app_apps_dir(&app);
    ensure_writable_dir(&dir)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn open_apps_dir(app: AppHandle) -> Result<(), String> {
    let dir = app_apps_dir(&app);
    ensure_writable_dir(&dir)?;
    open_dir_in_file_manager(&dir)
}

#[tauri::command]
pub(crate) fn pick_app_install_dir(app: AppHandle) -> Result<Option<String>, String> {
    let default_dir = app_apps_dir(&app);
    ensure_writable_dir(&default_dir)?;
    let Some(dir) =
        crate::host_dialog::pick_folder_with_default(&app, "选择 v5 应用安装目录", &default_dir)
    else {
        return Ok(None);
    };
    ensure_writable_dir(&dir)?;
    Ok(Some(dir.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn inspect_installed_app(exe_path: String) -> Result<InstalledAppInfo, String> {
    let exe_path = PathBuf::from(exe_path.trim());
    let installed = resolve_installed_app_from_exe(&exe_path)?
        .ok_or_else(|| "无法定位已安装应用的 fw-app.json，拒绝注册".to_string())?;
    installed_app_info(&installed)
}

#[tauri::command]
pub(crate) fn inspect_local_store_app(
    exe_path: String,
) -> Result<Option<InstalledAppInfo>, String> {
    let exe_path = PathBuf::from(exe_path.trim());
    let Some(installed) = resolve_installed_app_from_exe(&exe_path)? else {
        return Ok(None);
    };
    installed_app_info(&installed).map(Some)
}

#[tauri::command]
pub(crate) async fn app_store_install(
    app: AppHandle,
    req: AppStoreInstallRequest,
) -> Result<AppStoreInstallResult, String> {
    let req = normalize_install_request(req)?;
    if find_registered_app_by_store_id(&app, &req.expected_id)?.is_some() {
        return Err("应用已注册，请使用更新操作".to_string());
    }
    let install_root = PathBuf::from(req.install_dir.trim());
    ensure_writable_dir(&install_root)?;

    let app_container = crate::app_layout::app_container_dir(&install_root, &req.expected_id);
    validate_install_target_available(&app_container)?;

    let package = download_and_extract_app_package(&req).await?;
    install_extracted_app_package(&app, package, app_container, None).await
}

#[tauri::command]
pub(crate) async fn app_store_update(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppLifecycleManager>>,
    req: AppStoreUpdateRequest,
) -> Result<AppStoreInstallResult, String> {
    let req = normalize_update_request(req)?;
    let existing = find_registered_app_by_store_id(&app, &req.expected_id)?
        .ok_or_else(|| format!("注册应用不存在: {}", req.expected_id))?;
    let app_container = existing.installed.app_container.clone();
    if !app_container.is_dir() {
        return Err("已注册应用安装目录不存在，拒绝更新".to_string());
    }

    let install_req = AppStoreInstallRequest {
        url: req.url,
        expected_sha256: req.expected_sha256,
        expected_id: req.expected_id,
        expected_version: req.expected_version,
        install_dir: app_container
            .parent()
            .ok_or_else(|| "已注册应用安装目录没有父目录".to_string())?
            .to_string_lossy()
            .to_string(),
    };
    let package = download_and_extract_app_package(&install_req).await?;
    let _ = stop_registered_app_for_update(state.inner(), &existing.registry_id).await?;
    install_extracted_app_package(&app, package, app_container, Some(existing.record)).await
}

fn normalize_install_request(
    req: AppStoreInstallRequest,
) -> Result<AppStoreInstallRequest, String> {
    let url = normalize_https_url(&req.url)?;
    let expected_sha256 = req.expected_sha256.trim().to_string();
    let _ = parse_sha256_hex_32(&expected_sha256)?;
    let expected_id = normalize_app_id(&req.expected_id, "expectedId")?;
    let expected_version = normalize_version(&req.expected_version, "expectedVersion")?;
    let install_dir = req.install_dir.trim().to_string();
    if install_dir.is_empty() {
        return Err("installDir 不能为空".to_string());
    }
    Ok(AppStoreInstallRequest {
        url,
        expected_sha256,
        expected_id,
        expected_version,
        install_dir,
    })
}

fn normalize_update_request(req: AppStoreUpdateRequest) -> Result<AppStoreUpdateRequest, String> {
    let url = normalize_https_url(&req.url)?;
    let expected_sha256 = req.expected_sha256.trim().to_string();
    let _ = parse_sha256_hex_32(&expected_sha256)?;
    let expected_id = normalize_app_id(&req.expected_id, "expectedId")?;
    let expected_version = normalize_version(&req.expected_version, "expectedVersion")?;
    Ok(AppStoreUpdateRequest {
        url,
        expected_sha256,
        expected_id,
        expected_version,
    })
}

fn normalize_https_url(raw: &str) -> Result<String, String> {
    let url = raw.trim().to_string();
    if url.is_empty() {
        return Err("url 不能为空".to_string());
    }
    if !is_https_url(&url) {
        return Err("url 必须以 https:// 开头".to_string());
    }
    Ok(url)
}

fn normalize_app_id(raw: &str, field: &str) -> Result<String, String> {
    let id = raw.trim().to_string();
    if !crate::is_safe_id(&id) {
        return Err(format!("{field} 不合法（仅允许字母/数字/_/-）"));
    }
    Ok(id)
}

fn normalize_version(raw: &str, field: &str) -> Result<String, String> {
    let version = raw.trim().to_string();
    if !is_strict_semver(&version) {
        return Err(format!("{field} 必须是 x.y.z 格式"));
    }
    Ok(version)
}

fn is_strict_semver(version: &str) -> bool {
    let mut parts = version.split('.');
    let Some(major) = parts.next() else {
        return false;
    };
    let Some(minor) = parts.next() else {
        return false;
    };
    let Some(patch) = parts.next() else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }
    [major, minor, patch]
        .iter()
        .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

fn validate_install_target_available(dst_dir: &Path) -> Result<(), String> {
    if !dst_dir.exists() {
        return Ok(());
    }
    if !dst_dir.is_dir() {
        return Err("目标应用路径已存在但不是目录，拒绝覆盖".to_string());
    }
    if dst_dir.join(FW_APP_MANIFEST).is_file()
        || crate::app_layout::app_package_dir(dst_dir)
            .join(FW_APP_MANIFEST)
            .is_file()
    {
        return Err("目标应用已存在，请使用更新操作".to_string());
    }
    Err("目标应用目录已存在但不是 Fast Window v5 应用，拒绝覆盖".to_string())
}

fn registered_app_path(value: &Value) -> Result<PathBuf, String> {
    let path = value
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "已注册应用缺少 path".to_string())?;
    let p = PathBuf::from(path);
    if !p.is_file() {
        return Err("已注册应用可执行文件不存在，拒绝更新".to_string());
    }
    Ok(p)
}

fn registered_app_id(value: &Value) -> Result<String, String> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "已注册应用缺少 id".to_string())?;
    normalize_app_id(id, "appId")
}

fn manifest_identity(manifest: &AppPackageManifest) -> Result<(String, String), String> {
    let id = normalize_app_id(&manifest.id, "fw-app.id")?;
    let version = normalize_version(&manifest.version, "fw-app.version")?;
    Ok((id, version))
}

fn validate_manifest_against_self(
    manifest: &AppPackageManifest,
) -> Result<(String, String), String> {
    let (id, version) = manifest_identity(manifest)?;
    validate_package_manifest(manifest, &id, &version)?;
    Ok((id, version))
}

fn resolve_installed_app_from_exe(exe_path: &Path) -> Result<Option<ResolvedInstalledApp>, String> {
    if !exe_path.is_file() {
        return Err(format!("应用文件不存在: {}", exe_path.display()));
    }

    let mut dir = exe_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "应用路径没有父目录".to_string())?;

    loop {
        let manifest_path = dir.join(FW_APP_MANIFEST);
        if manifest_path.is_file() {
            let manifest = read_installed_manifest(&manifest_path)?;
            validate_manifest_against_self(&manifest)?;
            let declared_exe =
                dir.join(safe_relative_path_no_curdir(&manifest.windows_executable)?);
            if !same_path(&declared_exe, exe_path) {
                return Err(
                    "所选应用文件不是 fw-app.json 声明的 windowsExecutable，拒绝注册".to_string(),
                );
            }
            validate_extracted_app(&dir, &manifest)?;
            let app_container = crate::app_layout::app_container_dir_from_manifest_dir(&dir)?;
            return Ok(Some(ResolvedInstalledApp {
                app_container,
                manifest_dir: dir,
                exe_path: declared_exe,
                manifest,
            }));
        }
        if !dir.pop() {
            return Ok(None);
        }
    }
}

fn installed_app_info(installed: &ResolvedInstalledApp) -> Result<InstalledAppInfo, String> {
    let (id, version) = validate_manifest_against_self(&installed.manifest)?;
    Ok(InstalledAppInfo {
        id,
        name: installed.manifest.name.trim().to_string(),
        version,
        path: installed.exe_path.to_string_lossy().to_string(),
        icon: resolve_app_icon(
            &installed.manifest,
            &installed.manifest_dir,
            &installed.exe_path,
        )?,
        display_mode: installed
            .manifest
            .display_mode
            .as_deref()
            .map(str::trim)
            .filter(|mode| !mode.is_empty())
            .unwrap_or("default")
            .to_string(),
        commands: installed.manifest.commands.clone(),
    })
}

fn registered_record_as_installed_app(value: Value) -> Result<RegisteredInstalledApp, String> {
    let registry_id = registered_app_id(&value)?;
    let exe_path = registered_app_path(&value)?;
    let installed = resolve_installed_app_from_exe(&exe_path)?
        .ok_or_else(|| "无法定位已安装应用的 fw-app.json，拒绝商店更新".to_string())?;
    Ok(RegisteredInstalledApp {
        registry_id,
        record: value,
        installed,
    })
}

fn find_registered_app_by_store_id(
    app: &AppHandle,
    expected_id: &str,
) -> Result<Option<RegisteredInstalledApp>, String> {
    let mut matches = Vec::new();
    for record in crate::app_registry::load_registered_app_records(app)? {
        let registry_id = registered_app_id(&record)?;
        let exact_registry_id = registry_id == expected_id;
        let installed = match registered_record_as_installed_app(record) {
            Ok(installed) => installed,
            Err(error) if exact_registry_id => return Err(error),
            Err(_) => continue,
        };

        let (app_id, _) = manifest_identity(&installed.installed.manifest)?;
        if app_id == expected_id {
            matches.push(installed);
        } else if exact_registry_id {
            return Err(format!(
                "注册应用 id 与 fw-app.id 不一致：registered={}, manifest={}",
                expected_id, app_id
            ));
        }
    }

    if matches.len() > 1 {
        return Err(format!("多个注册应用指向同一个商店应用: {expected_id}"));
    }
    Ok(matches.pop())
}

fn read_installed_manifest(path: &Path) -> Result<AppPackageManifest, String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("读取已安装 fw-app.json 失败: {e}"))?;
    if metadata.len() > APP_MANIFEST_MAX_BYTES {
        return Err("已安装 fw-app.json 过大".to_string());
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("读取已安装 fw-app.json 失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("已安装 fw-app.json 解析失败: {e}"))
}

async fn download_and_extract_app_package(
    req: &AppStoreInstallRequest,
) -> Result<ExtractedAppPackage, String> {
    let apps_dir = PathBuf::from(req.install_dir.trim());
    ensure_writable_dir(&apps_dir)?;
    let tmp_zip = download_zip_to_temp(&apps_dir, req).await?;

    let apps_dir2 = apps_dir.clone();
    let tmp_zip2 = tmp_zip.clone();
    let expected_id = req.expected_id.clone();
    let expected_version = req.expected_version.clone();
    let extracted = tokio::task::spawn_blocking(move || {
        extract_and_validate_zip(&apps_dir2, &tmp_zip2, &expected_id, &expected_version)
    })
    .await
    .map_err(|_| "安装应用失败: 后台任务异常退出".to_string())?;

    let _ = tokio::fs::remove_file(&tmp_zip).await;
    extracted
}

async fn download_zip_to_temp(
    apps_dir: &Path,
    req: &AppStoreInstallRequest,
) -> Result<PathBuf, String> {
    let expected = parse_sha256_hex_32(&req.expected_sha256)?;
    let stamp = now_ms();
    let rnd = rand_u32(stamp);
    let tmp_zip = apps_dir.join(format!(".tmp-app-download-{stamp}-{rnd:08x}.zip"));
    if tmp_zip.exists() {
        let _ = tokio::fs::remove_file(&tmp_zip).await;
    }

    let client = reqwest::Client::builder()
        .user_agent(format!("fast-window/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|e| format!("创建 http client 失败: {e}"))?;

    let resp = client
        .get(&req.url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status().as_u16()));
    }

    let mut total = 0usize;
    let mut hasher = Sha256::new();
    let mut f = tokio::fs::File::create(&tmp_zip)
        .await
        .map_err(|e| format!("创建临时文件失败: {e}"))?;
    let mut r = resp;
    let download_result: Result<(), String> = async {
        while let Some(chunk) = r
            .chunk()
            .await
            .map_err(|e| format!("读取下载流失败: {e}"))?
        {
            total = total.saturating_add(chunk.len());
            if total > APP_PACKAGE_MAX_ZIP_BYTES {
                return Err("应用压缩包过大（>200MB）".to_string());
            }
            hasher.update(&chunk);
            f.write_all(&chunk)
                .await
                .map_err(|e| format!("写入临时文件失败: {e}"))?;
        }
        f.flush()
            .await
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        Ok(())
    }
    .await;

    if let Err(e) = download_result {
        let _ = tokio::fs::remove_file(&tmp_zip).await;
        return Err(e);
    }

    let actual = hasher.finalize();
    if actual.as_slice() != expected.as_slice() {
        let _ = tokio::fs::remove_file(&tmp_zip).await;
        return Err(format!(
            "sha256 校验失败：expected={}, got={}",
            to_hex_lower(&expected),
            to_hex_lower(actual.as_slice())
        ));
    }

    Ok(tmp_zip)
}

fn extract_and_validate_zip(
    apps_dir: &Path,
    zip_path: &Path,
    expected_id: &str,
    expected_version: &str,
) -> Result<ExtractedAppPackage, String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("打开压缩包失败: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("解析压缩包失败: {e}"))?;

    let (manifest_idx, manifest_name) = find_fw_app_manifest(&mut zip)?;
    let prefix = manifest_name
        .strip_suffix(FW_APP_MANIFEST)
        .unwrap_or("")
        .to_string();

    let manifest = read_manifest_at(&mut zip, manifest_idx)?;
    validate_package_manifest(&manifest, expected_id, expected_version)?;

    let stamp = now_ms();
    let tmp_dir = apps_dir.join(format!(".tmp-app-install-{expected_id}-{stamp}"));
    if tmp_dir.exists() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

    if let Err(e) = extract_zip_tree(&mut zip, &prefix, &tmp_dir) {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(e);
    }

    validate_extracted_app(&tmp_dir, &manifest)?;
    Ok(ExtractedAppPackage { tmp_dir, manifest })
}

fn find_fw_app_manifest(
    zip: &mut zip::ZipArchive<std::fs::File>,
) -> Result<(usize, String), String> {
    let mut manifest_idx = None;
    let mut manifest_name = String::new();
    for i in 0..zip.len() {
        let zf = zip
            .by_index(i)
            .map_err(|e| format!("读取压缩包条目失败: {e}"))?;
        if zf.is_dir() {
            continue;
        }
        let name = normalize_zip_name(zf.name());
        if name.ends_with(FW_APP_MANIFEST) {
            if manifest_idx.is_some() {
                return Err("压缩包内存在多个 fw-app.json，拒绝安装".to_string());
            }
            manifest_idx = Some(i);
            manifest_name = name;
        }
    }
    let idx = manifest_idx.ok_or_else(|| "压缩包缺少 fw-app.json".to_string())?;
    Ok((idx, manifest_name))
}

fn read_manifest_at(
    zip: &mut zip::ZipArchive<std::fs::File>,
    manifest_idx: usize,
) -> Result<AppPackageManifest, String> {
    let mut mf = zip
        .by_index(manifest_idx)
        .map_err(|e| format!("读取 fw-app.json 失败: {e}"))?;
    let mut manifest_text = String::new();
    mf.read_to_string(&mut manifest_text)
        .map_err(|e| format!("读取 fw-app.json 失败: {e}"))?;
    serde_json::from_str(&manifest_text).map_err(|e| format!("fw-app.json 解析失败: {e}"))
}

fn validate_package_manifest(
    manifest: &AppPackageManifest,
    expected_id: &str,
    expected_version: &str,
) -> Result<(), String> {
    let id = normalize_app_id(&manifest.id, "fw-app.id")?;
    if id != expected_id {
        return Err(format!(
            "fw-app.id 不匹配：expected={}, got={}",
            expected_id, id
        ));
    }
    if manifest.name.trim().is_empty() {
        return Err("fw-app.name 不能为空".to_string());
    }
    let version = normalize_version(&manifest.version, "fw-app.version")?;
    if version != expected_version {
        return Err(format!(
            "fw-app.version 不匹配：expected={}, got={}",
            expected_version, version
        ));
    }
    let exe = safe_relative_path_no_curdir(&manifest.windows_executable)?;
    if !exe
        .extension()
        .and_then(|s| s.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
    {
        return Err("fw-app.windowsExecutable 必须指向 .exe 文件".to_string());
    }
    validate_display_mode(manifest.display_mode.as_deref())?;
    validate_icon(manifest.icon.as_deref())?;
    validate_commands(&manifest.commands)?;
    Ok(())
}

fn validate_display_mode(value: Option<&str>) -> Result<(), String> {
    let Some(mode) = value.map(str::trim).filter(|mode| !mode.is_empty()) else {
        return Ok(());
    };
    if matches!(mode, "default" | "window" | "top") {
        Ok(())
    } else {
        Err("fw-app.displayMode 必须为 default/window/top".to_string())
    }
}

fn validate_icon(icon: Option<&str>) -> Result<(), String> {
    let Some(icon) = icon.map(str::trim).filter(|icon| !icon.is_empty()) else {
        return Ok(());
    };
    if icon.starts_with("data:image/") && icon.len() > APP_ICON_DATA_URL_MAX_LEN {
        return Err("fw-app.icon data URL 过大".to_string());
    }
    if icon.starts_with("data:image/") || is_short_icon_text(icon) {
        return Ok(());
    }
    let _ = safe_relative_path_no_curdir(icon)?;
    Ok(())
}

fn validate_commands(commands: &[AppPackageCommand]) -> Result<(), String> {
    if commands.len() > 128 {
        return Err("fw-app.commands 数量过多".to_string());
    }
    let mut seen = BTreeMap::<String, ()>::new();
    for command in commands {
        let id = normalize_app_id(&command.id, "fw-app.commands.id")?;
        if seen.insert(id.clone(), ()).is_some() {
            return Err(format!("fw-app.commands.id 重复: {id}"));
        }
        let title = command.title.trim();
        if title.is_empty() || title.len() > 80 {
            return Err(format!("fw-app.commands.title 不合法: {id}"));
        }
        if let Some(hotkey) = command
            .hotkey
            .as_deref()
            .map(str::trim)
            .filter(|hotkey| !hotkey.is_empty())
        {
            hotkey
                .parse::<Shortcut>()
                .map_err(|e| format!("fw-app.commands.hotkey 不合法: {id}, {e}"))?;
        }
    }
    Ok(())
}

fn safe_relative_path_no_curdir(rel: &str) -> Result<PathBuf, String> {
    let p = safe_relative_path(rel)?;
    for c in Path::new(rel).components() {
        if matches!(c, std::path::Component::CurDir) {
            return Err("路径不合法（不允许包含 .）".to_string());
        }
    }
    Ok(p)
}

fn extract_zip_tree(
    zip: &mut zip::ZipArchive<std::fs::File>,
    prefix: &str,
    tmp_dir: &Path,
) -> Result<(), String> {
    let mut extracted_bytes = 0usize;
    let mut extracted_files = 0usize;
    for i in 0..zip.len() {
        let mut zf = zip
            .by_index(i)
            .map_err(|e| format!("读取压缩包条目失败: {e}"))?;
        let raw_name = normalize_zip_name(zf.name());
        if !raw_name.starts_with(prefix) {
            continue;
        }
        let rel_raw = raw_name[prefix.len()..].to_string();
        if rel_raw.is_empty() {
            continue;
        }

        if zf.is_dir() {
            let rel = safe_relative_path_no_curdir(&rel_raw)?;
            let full = tmp_dir.join(rel);
            std::fs::create_dir_all(&full).map_err(|e| format!("创建目录失败: {e}"))?;
            continue;
        }

        extracted_files += 1;
        if extracted_files > APP_PACKAGE_MAX_FILES {
            return Err("文件数量过多（>4096）".to_string());
        }
        let rel = safe_relative_path_no_curdir(&rel_raw)?;
        let full = tmp_dir.join(rel);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        let mut out = std::fs::File::create(&full).map_err(|e| format!("写入文件失败: {e}"))?;
        let copied =
            std::io::copy(&mut zf, &mut out).map_err(|e| format!("解压失败: {e}"))? as usize;
        extracted_bytes = extracted_bytes.saturating_add(copied);
        if extracted_bytes > APP_PACKAGE_MAX_EXTRACT_BYTES {
            return Err("解压后体积过大（>500MB）".to_string());
        }
    }
    Ok(())
}

fn validate_extracted_app(root: &Path, manifest: &AppPackageManifest) -> Result<(), String> {
    if !root.join(FW_APP_MANIFEST).is_file() {
        return Err("解压后的应用缺少 fw-app.json".to_string());
    }
    let exe = safe_relative_path_no_curdir(&manifest.windows_executable)?;
    if !root.join(exe).is_file() {
        return Err("应用入口文件不存在（fw-app.windowsExecutable）".to_string());
    }
    if let Some(icon) = manifest.icon.as_deref().map(str::trim).filter(|icon| {
        !icon.is_empty() && !icon.starts_with("data:image/") && !is_short_icon_text(icon)
    }) {
        let rel = safe_relative_path_no_curdir(icon)?;
        if !root.join(rel).is_file() {
            return Err("应用图标文件不存在（fw-app.icon）".to_string());
        }
    }
    Ok(())
}

async fn install_extracted_app_package(
    app: &AppHandle,
    package: ExtractedAppPackage,
    app_container: PathBuf,
    existing: Option<Value>,
) -> Result<AppStoreInstallResult, String> {
    let app_id = package.manifest.id.trim().to_string();
    let package_dir = crate::app_layout::app_package_dir(&app_container);
    let exe_rel = safe_relative_path_no_curdir(&package.manifest.windows_executable)?;
    let exe_path = package_dir.join(exe_rel);
    let icon_exe_path = package.tmp_dir.join(safe_relative_path_no_curdir(
        &package.manifest.windows_executable,
    )?);
    let record = build_registered_app_record(
        &package.manifest,
        &package.tmp_dir,
        &exe_path,
        &icon_exe_path,
        existing.as_ref(),
    )?;

    let created_container = prepare_app_container(&app_container)?;
    let tag = format!("app-package-{app_id}");
    let replacement = match begin_replace_dir_from_tmp(&package_dir, &package.tmp_dir, &tag) {
        Ok(replacement) => replacement,
        Err(error) => {
            cleanup_created_app_container(&app_container, created_container)?;
            return Err(format!("安装应用失败: {error}"));
        }
    };

    let registry_result = match existing.as_ref() {
        Some(existing) => {
            let previous_id = registered_app_id(existing)?;
            crate::app_registry::replace_registered_app_record(app, &previous_id, record)
        }
        None => crate::app_registry::upsert_registered_app_record(app, record),
    };

    if let Err(error) = registry_result {
        let rollback = replacement.rollback().err();
        let cleanup = cleanup_created_app_container(&app_container, created_container).err();
        return Err(match rollback {
            Some(rollback_error) => format_with_cleanup_error(
                format!("注册应用失败: {error}; 回滚失败: {rollback_error}"),
                cleanup,
            ),
            None => format_with_cleanup_error(format!("注册应用失败: {error}"), cleanup),
        });
    }
    replacement.commit()?;

    Ok(AppStoreInstallResult {
        app_id,
        version: package.manifest.version.trim().to_string(),
        path: exe_path.to_string_lossy().to_string(),
    })
}

fn prepare_app_container(app_container: &Path) -> Result<bool, String> {
    if app_container.exists() {
        if app_container.is_dir() {
            return Ok(false);
        }
        return Err("应用安装路径已存在但不是目录，拒绝安装".to_string());
    }
    std::fs::create_dir_all(app_container).map_err(|e| format!("创建应用容器目录失败: {e}"))?;
    Ok(true)
}

fn cleanup_created_app_container(app_container: &Path, created: bool) -> Result<(), String> {
    if !created {
        return Ok(());
    }
    match std::fs::remove_dir(app_container) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("清理应用容器目录失败: {e}")),
    }
}

fn format_with_cleanup_error(message: String, cleanup: Option<String>) -> String {
    match cleanup {
        Some(cleanup_error) => format!("{message}; {cleanup_error}"),
        None => message,
    }
}

fn build_registered_app_record(
    manifest: &AppPackageManifest,
    manifest_dir: &Path,
    registry_exe_path: &Path,
    icon_exe_path: &Path,
    existing: Option<&Value>,
) -> Result<Value, String> {
    let mut record = existing
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    record.insert(
        "id".to_string(),
        Value::String(manifest.id.trim().to_string()),
    );
    if !record.contains_key("name") {
        record.insert(
            "name".to_string(),
            Value::String(manifest.name.trim().to_string()),
        );
    }
    record.insert(
        "path".to_string(),
        Value::String(registry_exe_path.to_string_lossy().to_string()),
    );
    record.insert(
        "version".to_string(),
        Value::String(manifest.version.trim().to_string()),
    );
    if !record.contains_key("icon") {
        record.insert(
            "icon".to_string(),
            Value::String(resolve_app_icon(manifest, manifest_dir, icon_exe_path)?),
        );
    }
    if !record.contains_key("displayMode") {
        record.insert(
            "displayMode".to_string(),
            Value::String(
                manifest
                    .display_mode
                    .as_deref()
                    .map(str::trim)
                    .filter(|mode| !mode.is_empty())
                    .unwrap_or("default")
                    .to_string(),
            ),
        );
    }
    if !record.contains_key("commands") {
        record.insert(
            "commands".to_string(),
            serde_json::to_value(&manifest.commands)
                .map_err(|e| format!("序列化应用命令失败: {e}"))?,
        );
    }
    record.insert(
        "availableCommands".to_string(),
        serde_json::to_value(&manifest.commands).map_err(|e| format!("序列化应用命令失败: {e}"))?,
    );
    if !record.contains_key("autoStart") {
        record.insert("autoStart".to_string(), Value::Bool(false));
    }
    Ok(Value::Object(record))
}

fn resolve_app_icon(
    manifest: &AppPackageManifest,
    app_root: &Path,
    exe_path: &Path,
) -> Result<String, String> {
    if let Some(icon) = manifest
        .icon
        .as_deref()
        .map(str::trim)
        .filter(|icon| !icon.is_empty())
    {
        if icon.starts_with("data:image/") || is_short_icon_text(icon) {
            return Ok(icon.to_string());
        }
        let rel = safe_relative_path_no_curdir(icon)?;
        let full = app_root.join(rel);
        let bytes = std::fs::read(&full).map_err(|e| format!("读取应用图标失败: {e}"))?;
        if bytes.len() > 512 * 1024 {
            return Err("应用图标过大（>512KB）".to_string());
        }
        let mime = image_mime_by_ext(&full);
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        return Ok(format!("data:{mime};base64,{b64}"));
    }
    crate::thumbnails::file_thumbnail_png_data_url(exe_path, 64, 64)
        .map_err(|e| format!("提取应用图标失败: {e}"))
}

fn is_short_icon_text(icon: &str) -> bool {
    icon.len() <= 8
        && !icon.contains('/')
        && !icon.contains('\\')
        && !icon.contains('.')
        && !icon.contains(':')
}

fn image_mime_by_ext(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        _ => "image/png",
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}
