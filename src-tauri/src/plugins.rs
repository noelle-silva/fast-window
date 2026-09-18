use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::install_fs::replace_dir_from_tmp;
use crate::{
    app_data_dir, app_local_base_dir, app_plugins_dir, open_dir_in_file_manager,
};

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

fn is_valid_manifest_capability(cap: &str) -> bool {
    let s = cap.trim();
    if s.is_empty() || s.len() > 256 || s.contains('\n') || s.contains('\r') {
        return false;
    }
    if s.starts_with("tauri:") {
        return true;
    }
    if !s.starts_with("cap:") {
        return false;
    }
    s["cap:".len()..]
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '*' | '|' | '-'))
}

const LEGACY_PLUGIN_API_VERSION: u64 = 2;
const PLUGIN_PACKAGE_MAX_FILES: usize = 512;
const PLUGIN_PACKAGE_MAX_BYTES: usize = 120 * 1024 * 1024;

struct StoreManifestSummary {
    main: String,
    background_main: Option<String>,
    local_icon: Option<PathBuf>,
}

fn manifest_string(manifest: &Value, field: &str) -> String {
    manifest
        .get(field)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn is_supported_icon_file_path(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    lower.ends_with(".svg")
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".webp")
        || lower.ends_with(".gif")
        || lower.ends_with(".ico")
}

fn manifest_local_icon_path(icon: &str) -> Result<Option<PathBuf>, String> {
    let raw = icon.trim();
    if raw.is_empty() || raw.starts_with("data:image/") {
        return Ok(None);
    }

    let rel = if raw.starts_with("svg:") {
        raw["svg:".len()..].trim()
    } else if raw.starts_with("file:") {
        raw["file:".len()..].trim()
    } else if raw.contains(':') {
        return Ok(None);
    } else {
        raw
    };

    if rel.is_empty() || !is_supported_icon_file_path(rel) {
        return Ok(None);
    }

    safe_relative_path_no_curdir(rel).map(Some)
}

fn validate_plugin_package_files(
    root: &Path,
    summary: &StoreManifestSummary,
) -> Result<(), String> {
    let main = safe_relative_path_no_curdir(&summary.main)?;
    if !root.join(&main).is_file() {
        return Err("插件入口文件不存在（manifest.main）".to_string());
    }

    if let Some(bg) = summary.background_main.as_deref() {
        let bg = safe_relative_path_no_curdir(bg)?;
        if !root.join(bg).is_file() {
            return Err("后台入口文件不存在（manifest.background.main）".to_string());
        }
    }

    if let Some(icon) = summary.local_icon.as_ref() {
        if !root.join(icon).is_file() {
            return Err("插件图标文件不存在（manifest.icon）".to_string());
        }
    }

    Ok(())
}

fn read_package_manifest(root: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(root.join("manifest.json"))
        .map_err(|e| format!("读取 manifest.json 失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("manifest.json 解析失败: {e}"))
}

fn validate_installed_package(
    root: &Path,
    expected_id: &str,
    expected_version: Option<&str>,
    expected_requires: Option<&BTreeSet<String>>,
    label: &str,
) -> Result<StoreManifestSummary, String> {
    if !root.join("manifest.json").is_file() {
        return Err(format!("{label} 缺少 manifest.json"));
    }

    let manifest = read_package_manifest(root)?;
    let version = expected_version
        .map(|s| s.to_string())
        .unwrap_or_else(|| manifest_string(&manifest, "version"));
    let summary =
        validate_store_manifest(&manifest, expected_id, &version, expected_requires, label)?;
    validate_plugin_package_files(root, &summary)?;
    Ok(summary)
}

fn manifest_api_version(manifest: &Value) -> Result<u64, String> {
    let api_version = manifest
        .get("apiVersion")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if api_version == LEGACY_PLUGIN_API_VERSION {
        Ok(api_version)
    } else {
        Err(
            "manifest.apiVersion 必须为 2；v3/v4 是已移除的过渡契约，v5 请使用独立应用包"
                .to_string(),
        )
    }
}

fn validate_manifest_optional_string(
    manifest: &Value,
    field: &str,
    required: bool,
) -> Result<(), String> {
    match manifest.get(field) {
        Some(Value::String(_)) => Ok(()),
        Some(_) => Err(format!("{field} 必须是字符串")),
        None if required => Err(format!("{field} 必须是字符串")),
        None => Ok(()),
    }
}

fn validate_manifest_ui_type(manifest: &Value, required: bool) -> Result<(), String> {
    let ui_type = manifest
        .get("ui")
        .and_then(|v| v.as_object())
        .and_then(|obj| obj.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if ui_type == "iframe" || (!required && ui_type.is_empty()) {
        Ok(())
    } else if required {
        Err("manifest.ui.type 必须为 \"iframe\"".to_string())
    } else {
        Err("manifest.ui.type 如提供则必须为 \"iframe\"".to_string())
    }
}

fn parse_manifest_requires(
    manifest: &Value,
    required: bool,
    label: &str,
) -> Result<BTreeSet<String>, String> {
    let mut out = BTreeSet::<String>::new();
    match manifest.get("requires") {
        Some(Value::Array(requires)) => {
            for item in requires {
                let cap = item.as_str().unwrap_or("").trim();
                if !is_valid_manifest_capability(cap) {
                    return Err(format!("{label}.requires 存在不合法能力声明"));
                }
                out.insert(cap.to_string());
            }
            Ok(out)
        }
        Some(_) => Err(format!("{label}.requires 必须是数组")),
        None if required => Err(format!("{label}.requires 必须是数组（即使为空）")),
        None => Ok(out),
    }
}

fn validate_manifest_requires_match(
    actual: &BTreeSet<String>,
    expected: &BTreeSet<String>,
    label: &str,
) -> Result<(), String> {
    if actual == expected {
        return Ok(());
    }

    let expected_list = expected.iter().cloned().collect::<Vec<_>>();
    let actual_list = actual.iter().cloned().collect::<Vec<_>>();
    Err(format!(
        "{label}.requires 不匹配：expected={:?}, got={:?}",
        expected_list, actual_list
    ))
}

fn validate_store_manifest(
    manifest: &Value,
    expected_id: &str,
    expected_version: &str,
    expected_requires: Option<&BTreeSet<String>>,
    label: &str,
) -> Result<StoreManifestSummary, String> {
    let plugin_id = manifest_string(manifest, "id");
    if !is_safe_id(&plugin_id) {
        return Err(format!("{label}.id 不合法（仅允许字母/数字/_/-）"));
    }
    if plugin_id != expected_id {
        return Err(format!(
            "{label}.id 不匹配：expected={}, got={}",
            expected_id, plugin_id
        ));
    }

    let name = manifest_string(manifest, "name");
    if name.is_empty() {
        return Err(format!("{label}.name 不能为空"));
    }

    let version = manifest_string(manifest, "version");
    if version.is_empty() {
        return Err(format!("{label}.version 不能为空"));
    }
    if version != expected_version {
        return Err(format!(
            "{label}.version 不匹配：expected={}, got={}",
            expected_version, version
        ));
    }

    manifest_api_version(manifest)?;
    validate_manifest_optional_string(manifest, &format!("{label}.description"), true)?;
    validate_manifest_ui_type(manifest, true)?;

    let requires = parse_manifest_requires(manifest, true, label)?;
    if expected_requires.is_some() {
        let expected_requires = expected_requires.expect("checked is_some");
        validate_manifest_requires_match(&requires, expected_requires, label)?;
    }

    let main = manifest_string(manifest, "main");
    if main.is_empty() {
        return Err(format!("{label}.main 不能为空"));
    }

    let bg_main = manifest
        .get("background")
        .and_then(|v| v.as_object())
        .and_then(|obj| obj.get("main"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let background_main = if !bg_main.is_empty() && bg_main != main {
        Some(bg_main)
    } else {
        None
    };

    if let Some(background) = manifest.get("background") {
        let Some(background) = background.as_object() else {
            return Err(format!("{label}.background 必须是对象"));
        };
        if background.contains_key("lifecycle") {
            return Err(format!(
                "{label}.background.lifecycle 属于已移除的 v3/v4 过渡契约"
            ));
        }
        if background.contains_key("runtime") {
            return Err(format!(
                "{label}.background.runtime 属于已移除的 v3/v4 过渡契约"
            ));
        }
        if let Some(auto_start) = background.get("autoStart") {
            if !auto_start.is_boolean() {
                return Err(format!("{label}.background.autoStart 必须是布尔值"));
            }
        }
    }

    let icon = manifest_string(manifest, "icon");
    let local_icon = manifest_local_icon_path(&icon)?;

    Ok(StoreManifestSummary {
        main,
        background_main,
        local_icon,
    })
}

#[cfg(debug_assertions)]
fn is_dir_empty(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => true,
    }
}

// Release/MSI 不再随包预置任何插件（纯净宿主）。插件只通过本地导入安装到 plugins/ 目录。

#[tauri::command]
pub(crate) async fn get_plugins_dir(app: tauri::AppHandle) -> String {
    // 统一使用 App 本地数据目录（避免 cwd 漂移），插件默认放到这里
    let plugins_dir = app_plugins_dir(&app);
    let _ = std::fs::create_dir_all(&plugins_dir);
    plugins_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub(crate) async fn plugin_dev_sync(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        return Ok(false);
    }

    #[cfg(debug_assertions)]
    {
        let skip_dev_sync = std::env::var("FAST_WINDOW_SKIP_PLUGIN_DEV_SYNC")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if skip_dev_sync {
            return Ok(false);
        }

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

            let icon = manifest_string(manifest, "icon");
            if let Some(rel) = manifest_local_icon_path(&icon)? {
                out.push(rel.to_string_lossy().to_string());
            }

            // 去重（保持稳定顺序）
            let mut seen = std::collections::HashSet::<String>::new();
            out.retain(|p| seen.insert(p.clone()));
            Ok(out)
        }

        async fn sync_repo_plugins_into(
            app: &tauri::AppHandle,
            repo_plugins: &Path,
            plugins_dir: &Path,
        ) -> Result<(), String> {
            let uninstalled_ids = crate::plugin_uninstall::dev_sync_uninstalled_plugin_ids(app);
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
                if uninstalled_ids.contains(&plugin_id) {
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

                let dst = plugins_dir.join(&plugin_id);
                let files = match collect_referenced_seed_files(&manifest) {
                    Ok(v) => v,
                    Err(_) => vec!["manifest.json".to_string()],
                };

                let _ = std::fs::create_dir_all(&dst);
                for rel in files {
                    let from = src.join(&rel);
                    let to = dst.join(&rel);
                    if let Some(parent) = to.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    // dev 同步：仅同步 v2 插件运行所需文件；失败不阻断其它插件（不破坏用户空间）。
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
        let plugins_dir = app_plugins_dir(&app);
        std::fs::create_dir_all(&plugins_dir).map_err(|e| format!("创建插件目录失败: {e}"))?;
        if repo_plugins.is_dir() && !crate::same_path(&repo_plugins, &plugins_dir) {
            // 开发同步：v2 legacy 插件只同步运行所需文件，避免 node_modules 等开发目录拖慢/失败。
            sync_repo_plugins_into(&app, &repo_plugins, &plugins_dir).await?;
            return Ok(true);
        }
        Ok(false)
    }
}

#[tauri::command]
pub(crate) fn get_data_dir(app: tauri::AppHandle) -> String {
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
            if repo_data.is_dir() && !crate::same_path(&repo_data, &data_dir) {
                let _ = copy_dir_all(&repo_data, &data_dir);
            }
        }
    }

    data_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub(crate) fn open_data_root_dir(app: tauri::AppHandle) -> Result<(), String> {
    let root = app_local_base_dir(&app);
    open_dir_in_file_manager(&root)
}

#[tauri::command]
pub(crate) fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app_data_dir(&app);
    open_dir_in_file_manager(&dir)
}

#[tauri::command]
pub(crate) fn open_plugins_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app_plugins_dir(&app);
    open_dir_in_file_manager(&dir)
}

pub(crate) fn is_safe_id(id: &str) -> bool {
    if id.is_empty() {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn safe_relative_path(rel: &str) -> Result<PathBuf, String> {
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

pub(crate) fn safe_relative_path_no_curdir(rel: &str) -> Result<PathBuf, String> {
    let p = safe_relative_path(rel)?;
    for c in Path::new(rel).components() {
        if matches!(c, Component::CurDir) {
            return Err("路径不合法（不允许包含 .）".to_string());
        }
    }
    Ok(p)
}

pub(crate) fn hex_val(c: u8) -> Option<u8> {
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

pub(crate) fn query_get_param(uri: &tauri::http::Uri, key: &str) -> Option<String> {
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
pub(crate) struct FsDirEntry {
    name: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
}

#[tauri::command]
pub(crate) fn list_plugins(app: tauri::AppHandle) -> Vec<String> {
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
pub(crate) fn read_plugin_file(
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
pub(crate) fn read_plugin_file_base64(
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
pub(crate) fn read_plugins_dir(
    app: tauri::AppHandle,
    rel_dir: String,
) -> Result<Vec<FsDirEntry>, String> {
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
pub(crate) struct PluginWriteFile {
    path: String,
    bytes: Vec<u8>,
}

#[tauri::command]
pub(crate) async fn install_plugin_files(
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
    if files.len() > PLUGIN_PACKAGE_MAX_FILES {
        return Err("文件数量过多".to_string());
    }

    let total: usize = files.iter().map(|f| f.bytes.len()).sum();
    if total > PLUGIN_PACKAGE_MAX_BYTES {
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
        let rel = match safe_relative_path_no_curdir(&f.path) {
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

    if let Err(e) = validate_installed_package(&tmp_dir, &plugin_id, None, None, "导入插件") {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(e);
    }

    if let Err(e) = replace_dir_from_tmp(&plugin_dir, &tmp_dir, &format!("install-{plugin_id}")) {
        return Err(format!("安装插件失败: {e}"));
    }
    crate::plugin_uninstall::forget_dev_sync_uninstalled_plugin(&app, &plugin_id);
    Ok(())
}
