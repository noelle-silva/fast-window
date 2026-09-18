//! 旧形态已安装清单兼容：一次性迁移通道（未来可删）。
//!
//! 早期安装包内的 fw-app.json 是扁平形态：顶层 `windowsExecutable` / `icon` /
//! `service` / `displayMode` / `commands`，没有 `type` 与 `package` 段。当前宿主只认
//! 新形态，导致这些历史安装包在商店里被误判为未安装。本模块只服务于「已安装历史包」
//! 的读取路径：把旧形态归一化为当前 `AppPackageManifest` 视图；新包的安装校验完全
//! 不经过这里。
//!
//! 迁移通道边界：
//! - 基础身份（id、version、入口 exe 路径与文件）必须成立；
//! - 展示字段（icon / commands / displayMode）与独立服务声明尽力归一化，坏值降级不阻断；
//! - 历史安装全部升级为新形态后，整个模块可直接删除。

use std::path::Path;

use serde::Deserialize;

use crate::app_lifecycle::ServiceDeclaration;

use super::{
    is_short_icon_text, safe_relative_path_no_curdir, AppPackageCommand, AppPackageManifest,
    AppPackageSection, AppType, APP_ICON_DATA_URL_MAX_LEN,
};

const LEGACY_SERVICE_DECLARATION_MAX_BYTES: u64 = 256 * 1024;

/// 旧形态清单的解析结果。
pub(super) enum LegacyParseOutcome {
    /// 确认是旧形态，已归一化为当前清单视图。
    Manifest(Box<AppPackageManifest>),
    /// 文本不是旧形态，交给当前形态的错误语义处理。
    NotLegacy,
    /// 文本是旧形态但已损坏。
    Broken(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAppPackageManifest {
    id: String,
    name: String,
    version: String,
    windows_executable: String,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    service: Option<String>,
    #[serde(default)]
    display_mode: Option<String>,
    #[serde(default)]
    commands: Vec<LegacyAppPackageCommand>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAppPackageCommand {
    id: String,
    title: String,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    hotkey: Option<String>,
}

/// 解析旧形态已安装清单并归一化为当前视图。
pub(super) fn parse_legacy_installed_manifest(
    text: &str,
    manifest_dir: &Path,
) -> LegacyParseOutcome {
    let legacy: LegacyAppPackageManifest = match serde_json::from_str(text) {
        Ok(legacy) => legacy,
        Err(error) => {
            return if declares_legacy_executable(text) {
                LegacyParseOutcome::Broken(error.to_string())
            } else {
                LegacyParseOutcome::NotLegacy
            };
        }
    };

    let service_path = legacy
        .service
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());
    let service =
        service_path.and_then(|path| load_legacy_service_declaration(path, manifest_dir));
    let app_type = if service_path.is_some() {
        AppType::ServiceApp
    } else {
        AppType::DesktopApp
    };

    LegacyParseOutcome::Manifest(Box::new(AppPackageManifest {
        app_type,
        id: legacy.id,
        name: legacy.name,
        version: legacy.version,
        package: AppPackageSection {
            windows_executable: legacy.windows_executable,
            icon: sanitize_icon(legacy.icon.as_deref(), manifest_dir),
        },
        service,
        display_mode: sanitize_display_mode(legacy.display_mode.as_deref()),
        commands: sanitize_commands(legacy.commands, manifest_dir),
    }))
}

/// 旧形态基础身份校验：id、version、入口 exe 路径合法且指向 .exe。
pub(super) fn validate_legacy_manifest_identity(
    manifest: &AppPackageManifest,
) -> Result<(String, String), String> {
    let identity = super::manifest_identity(manifest)?;
    let exe = safe_relative_path_no_curdir(&manifest.package.windows_executable)?;
    if !exe
        .extension()
        .and_then(|s| s.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
    {
        return Err("fw-app.windowsExecutable 必须指向 .exe 文件".to_string());
    }
    Ok(identity)
}

/// 旧形态入口文件校验：声明的可执行文件必须真实存在。
pub(super) fn validate_legacy_entry_file(
    manifest_dir: &Path,
    manifest: &AppPackageManifest,
) -> Result<(), String> {
    let exe = safe_relative_path_no_curdir(&manifest.package.windows_executable)?;
    if !manifest_dir.join(exe).is_file() {
        return Err("应用入口文件不存在（fw-app.windowsExecutable）".to_string());
    }
    Ok(())
}

fn declares_legacy_executable(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| {
            value
                .as_object()
                .map(|object| object.contains_key("windowsExecutable"))
        })
        .unwrap_or(false)
}

fn load_legacy_service_declaration(
    path: &str,
    manifest_dir: &Path,
) -> Option<ServiceDeclaration> {
    let rel = safe_relative_path_no_curdir(path).ok()?;
    let full = manifest_dir.join(rel);
    let metadata = std::fs::metadata(&full).ok()?;
    if metadata.len() > LEGACY_SERVICE_DECLARATION_MAX_BYTES {
        return None;
    }
    let text = std::fs::read_to_string(&full).ok()?;
    serde_json::from_str(&text).ok()
}

fn sanitize_icon(icon: Option<&str>, manifest_dir: &Path) -> Option<String> {
    let icon = icon.map(str::trim).filter(|icon| !icon.is_empty())?;
    if icon.starts_with("data:image/") {
        return (icon.len() <= APP_ICON_DATA_URL_MAX_LEN).then(|| icon.to_string());
    }
    if is_short_icon_text(icon) {
        return Some(icon.to_string());
    }
    let rel = safe_relative_path_no_curdir(icon).ok()?;
    manifest_dir.join(rel).is_file().then(|| icon.to_string())
}

fn sanitize_display_mode(mode: Option<&str>) -> Option<String> {
    let mode = mode.map(str::trim).filter(|mode| !mode.is_empty())?;
    matches!(mode, "default" | "window" | "top").then(|| mode.to_string())
}

fn sanitize_commands(
    commands: Vec<LegacyAppPackageCommand>,
    manifest_dir: &Path,
) -> Vec<AppPackageCommand> {
    commands
        .into_iter()
        .map(|command| AppPackageCommand {
            id: command.id,
            title: command.title,
            icon: sanitize_icon(command.icon.as_deref(), manifest_dir),
            hotkey: command.hotkey,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEGACY_DESKTOP_MANIFEST: &str = r#"{
        "schemaVersion": 2,
        "id": "demo-app",
        "name": "Demo App",
        "version": "0.1.0",
        "windowsExecutable": "demo-app.exe",
        "icon": "assets/icon.svg",
        "displayMode": "window",
        "commands": [{ "id": "open", "title": "Open", "icon": "assets/open.svg", "hotkey": "Alt+O" }]
    }"#;

    const LEGACY_SERVICE_MANIFEST: &str = r#"{
        "id": "eucli-box",
        "name": "eucli-box",
        "version": "0.1.2",
        "windowsExecutable": "eucli-box.exe",
        "service": "fw-app.service.json"
    }"#;

    fn test_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "fw-app-legacy-manifest-test-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("创建测试目录失败");
        root
    }

    fn parse_manifest(root: &Path, text: &str) -> AppPackageManifest {
        match parse_legacy_installed_manifest(text, root) {
            LegacyParseOutcome::Manifest(manifest) => *manifest,
            LegacyParseOutcome::NotLegacy => panic!("文本应识别为旧形态"),
            LegacyParseOutcome::Broken(error) => panic!("旧形态不应损坏: {error}"),
        }
    }

    #[test]
    fn normalizes_legacy_desktop_manifest() {
        let root = test_root("desktop");
        std::fs::create_dir_all(root.join("assets")).expect("创建资源目录失败");
        std::fs::write(root.join("assets/icon.svg"), b"<svg/>").expect("写入图标失败");
        std::fs::write(root.join("assets/open.svg"), b"<svg/>").expect("写入命令图标失败");

        let manifest = parse_manifest(&root, LEGACY_DESKTOP_MANIFEST);

        assert_eq!(manifest.app_type.as_str(), "desktop-app");
        assert_eq!(manifest.id, "demo-app");
        assert_eq!(manifest.version, "0.1.0");
        assert_eq!(manifest.package.windows_executable, "demo-app.exe");
        assert_eq!(manifest.package.icon.as_deref(), Some("assets/icon.svg"));
        assert_eq!(manifest.display_mode.as_deref(), Some("window"));
        assert_eq!(manifest.commands.len(), 1);
        assert_eq!(manifest.commands[0].icon.as_deref(), Some("assets/open.svg"));
        assert_eq!(manifest.commands[0].hotkey.as_deref(), Some("Alt+O"));
        assert!(manifest.service.is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn drops_icon_when_file_is_missing() {
        let root = test_root("missing-icon");

        let manifest = parse_manifest(&root, LEGACY_DESKTOP_MANIFEST);

        assert!(manifest.package.icon.is_none());
        assert!(manifest.commands[0].icon.is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn drops_invalid_display_mode() {
        let root = test_root("bad-mode");
        let text = LEGACY_DESKTOP_MANIFEST.replace("\"window\"", "\"fullscreen\"");

        let manifest = parse_manifest(&root, &text);

        assert!(manifest.display_mode.is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn loads_legacy_service_declaration_file() {
        let root = test_root("service");
        std::fs::write(
            root.join("fw-app.service.json"),
            r#"{
                "start": { "executable": "eucli-box.exe", "args": ["--port", "8765"] },
                "ready": { "type": "log", "match": "is ready" },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("写入服务声明失败");

        let manifest = parse_manifest(&root, LEGACY_SERVICE_MANIFEST);

        assert_eq!(manifest.app_type.as_str(), "service-app");
        let declaration = manifest.service.expect("旧服务声明应被内联");
        assert_eq!(declaration.args, vec!["--port", "8765"]);
        assert_eq!(declaration.ready_match, "is ready");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_service_declaration_degrades_without_failure() {
        let root = test_root("service-missing");

        let manifest = parse_manifest(&root, LEGACY_SERVICE_MANIFEST);

        assert_eq!(manifest.app_type.as_str(), "service-app");
        assert!(manifest.service.is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn broken_legacy_manifest_reports_broken() {
        let root = test_root("broken");
        let broken = r#"{ "windowsExecutable": "demo-app.exe", "id": "demo-app" }"#;

        match parse_legacy_installed_manifest(broken, &root) {
            LegacyParseOutcome::Broken(error) => {
                assert!(error.contains("name"), "{error}");
            }
            _ => panic!("缺字段的旧形态应报 Broken"),
        }

        let incomplete = r#"{ "id": "demo-app", "name": "Demo", "version": "0.1.0" }"#;
        match parse_legacy_installed_manifest(incomplete, &root) {
            LegacyParseOutcome::NotLegacy => {}
            _ => panic!("无旧形态标记的残缺文本应报 NotLegacy"),
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn current_manifest_text_is_not_legacy() {
        let root = test_root("current");
        let text = r#"{
            "type": "desktop-app",
            "id": "demo-app",
            "name": "Demo",
            "version": "0.1.0",
            "package": { "windowsExecutable": "demo-app.exe" }
        }"#;

        match parse_legacy_installed_manifest(text, &root) {
            LegacyParseOutcome::NotLegacy => {}
            _ => panic!("新形态文本不应识别为旧形态"),
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn identity_rejects_unsafe_or_non_exe_executable() {
        let root = test_root("identity");
        let mut manifest = parse_manifest(&root, LEGACY_DESKTOP_MANIFEST);

        manifest.package.windows_executable = "../demo-app.exe".to_string();
        assert!(validate_legacy_manifest_identity(&manifest).is_err());

        manifest.package.windows_executable = "demo-app.bat".to_string();
        let error = validate_legacy_manifest_identity(&manifest).unwrap_err();
        assert!(error.contains("必须指向 .exe"), "{error}");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn entry_file_must_exist() {
        let root = test_root("entry");
        let manifest = parse_manifest(&root, LEGACY_DESKTOP_MANIFEST);

        assert!(validate_legacy_entry_file(&root, &manifest).is_err());

        std::fs::write(root.join("demo-app.exe"), b"").expect("写入 exe 失败");
        assert!(validate_legacy_entry_file(&root, &manifest).is_ok());

        let _ = std::fs::remove_dir_all(&root);
    }
}
