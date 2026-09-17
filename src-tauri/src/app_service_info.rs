use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use crate::app_installer::InstalledServiceApp;
use crate::app_service_profile::{self, PROFILE_PENDING_REASON};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppServiceInfo {
    app_kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    start: Option<AppServiceStartInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ready: Option<AppServiceReadyInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<AppServiceStopInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    connection: Option<AppServiceConnectionInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppServiceStartInfo {
    executable: String,
    args: Vec<String>,
    environment: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppServiceReadyInfo {
    #[serde(rename = "match")]
    matched: String,
    timeout_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppServiceStopInfo {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppServiceConnectionInfo {
    port: AppServiceConnectionValueInfo,
    key: AppServiceConnectionValueInfo,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppServiceConnectionValueInfo {
    available: bool,
    value: String,
    reason: String,
}

impl AppServiceInfo {
    fn desktop() -> Self {
        Self {
            app_kind: "desktop-app",
            start: None,
            ready: None,
            stop: None,
            connection: None,
        }
    }
}

impl AppServiceConnectionValueInfo {
    fn available(value: impl Into<String>) -> Self {
        Self {
            available: true,
            value: value.into(),
            reason: String::new(),
        }
    }

    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            available: false,
            value: String::new(),
            reason: reason.into(),
        }
    }
}

/// 读取已安装应用的服务信息：桌面应用返回 appKind=desktop-app 信号，服务应用附带声明信息与固定画像。
#[tauri::command]
pub(crate) fn app_service_info(exe_path: String) -> Result<AppServiceInfo, String> {
    let raw = exe_path.trim();
    if raw.is_empty() {
        return Err("应用文件路径不能为空".to_string());
    }
    build_app_service_info_for_exe(Path::new(raw))
}

fn build_app_service_info_for_exe(exe_path: &Path) -> Result<AppServiceInfo, String> {
    let Some(app) = crate::app_installer::resolve_installed_service_app(exe_path)? else {
        return Ok(AppServiceInfo::desktop());
    };

    build_service_info(&app)
}

fn build_service_info(app: &InstalledServiceApp) -> Result<AppServiceInfo, String> {
    let declaration = &app.declaration;
    Ok(AppServiceInfo {
        app_kind: "service-app",
        start: Some(AppServiceStartInfo {
            executable: app.executable_relative.to_string_lossy().to_string(),
            args: declaration.args.clone(),
            environment: declaration.environment.iter().cloned().collect(),
        }),
        ready: Some(AppServiceReadyInfo {
            matched: declaration.ready_match.clone(),
            timeout_seconds: declaration.ready_timeout.as_secs(),
        }),
        stop: Some(AppServiceStopInfo {
            kind: declaration.stop_type.clone(),
        }),
        connection: Some(build_connection_info(&app.manifest_dir)?),
    })
}

fn build_connection_info(app_dir: &Path) -> Result<AppServiceConnectionInfo, String> {
    match app_service_profile::read_profile(app_dir)? {
        Some(profile) => Ok(AppServiceConnectionInfo {
            port: AppServiceConnectionValueInfo::available(profile.port.to_string()),
            key: AppServiceConnectionValueInfo::available(profile.key),
        }),
        None => Ok(AppServiceConnectionInfo {
            port: AppServiceConnectionValueInfo::unavailable(PROFILE_PENDING_REASON),
            key: AppServiceConnectionValueInfo::unavailable(PROFILE_PENDING_REASON),
        }),
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{app_service_info, build_app_service_info_for_exe, AppServiceInfo};
    use crate::app_service_profile::PROFILE_PENDING_REASON;

    const SERVICE_DECLARATION: &str = r#"{
        "start": {
            "args": ["--port", "8765"]
        },
        "ready": { "type": "log", "match": "is ready", "timeoutSeconds": 10 },
        "stop": { "type": "terminate" }
    }"#;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "fw-app-service-info-test-{name}-{pid}",
            pid = std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    fn service_manifest(declaration: &str) -> String {
        format!(
            r#"{{
  "type": "service-app",
  "id": "eucli-box",
  "name": "eucli-box",
  "version": "0.1.2",
  "package": {{ "windowsExecutable": "eucli-box.exe" }},
  "service": {declaration}
}}"#
        )
    }

    fn write_package(root: &Path, manifest: &str) -> PathBuf {
        let package_dir = root.join("eucli-box").join("package");
        std::fs::create_dir_all(&package_dir).expect("创建测试目录失败");
        std::fs::write(package_dir.join("fw-app.json"), manifest).expect("写入清单失败");
        let exe_path = package_dir.join("eucli-box.exe");
        std::fs::write(&exe_path, b"").expect("写入可执行文件失败");
        exe_path
    }

    fn write_service_package(root: &Path, declaration: &str) -> PathBuf {
        write_package(root, &service_manifest(declaration))
    }

    fn write_profile(exe_path: &Path, content: &str) {
        let profile_path = exe_path
            .parent()
            .expect("可执行文件没有父目录")
            .join("data")
            .join("service-profile.json");
        std::fs::create_dir_all(profile_path.parent().expect("画像文件没有父目录"))
            .expect("创建画像目录失败");
        std::fs::write(profile_path, content).expect("写入画像文件失败");
    }

    fn connection_value<'a>(
        info: &'a AppServiceInfo,
        key: &str,
    ) -> &'a super::AppServiceConnectionValueInfo {
        let connection = info.connection.as_ref().expect("服务应用应有连接信息");
        match key {
            "port" => &connection.port,
            _ => &connection.key,
        }
    }

    #[test]
    fn desktop_app_reports_desktop_kind_without_service_sections() {
        let root = test_root("window");
        let exe_path = write_package(
            &root,
            r#"{
                "type": "desktop-app",
                "id": "demo-app",
                "name": "demo-app",
                "version": "0.1.0",
                "package": { "windowsExecutable": "eucli-box.exe" }
            }"#,
        );

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        assert_eq!(info.app_kind, "desktop-app");
        assert!(info.start.is_none());
        assert!(info.ready.is_none());
        assert!(info.stop.is_none());
        assert!(info.connection.is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn service_app_reports_declaration_sections() {
        let root = test_root("service");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        assert_eq!(info.app_kind, "service-app");
        let start = info.start.as_ref().expect("服务应用应有启动方式");
        assert_eq!(start.executable, "eucli-box.exe");
        assert_eq!(start.args, vec!["--port", "8765"]);
        assert!(start.environment.is_empty());

        let ready = info.ready.as_ref().expect("服务应用应有就绪规则");
        assert_eq!(ready.matched, "is ready");
        assert_eq!(ready.timeout_seconds, 10);

        assert_eq!(
            info.stop.as_ref().map(|stop| stop.kind.as_str()),
            Some("terminate")
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn connection_reads_fixed_profile_values() {
        let root = test_root("profile");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);
        write_profile(&exe_path, r#"{ "port": 9000, "key": "  secret-key  " }"#);

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        let port = connection_value(&info, "port");
        assert!(port.available);
        assert_eq!(port.value, "9000");
        assert!(port.reason.is_empty());

        let key = connection_value(&info, "key");
        assert!(key.available);
        assert_eq!(key.value, "secret-key");
        assert!(key.reason.is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_profile_reports_pending_reason() {
        let root = test_root("missing-profile");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        for field in ["port", "key"] {
            let value = connection_value(&info, field);
            assert!(!value.available);
            assert!(value.value.is_empty());
            assert_eq!(value.reason, PROFILE_PENDING_REASON);
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn broken_profile_fails_fast() {
        let root = test_root("broken-profile");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        for (content, expected) in [
            (r#"{ "port": "#, "启动配置画像无效"),
            (r#"{ "port": 65536, "key": "abc" }"#, "端口"),
            (r#"{ "port": 9000, "key": "  " }"#, "钥匙"),
        ] {
            write_profile(&exe_path, content);
            let error = build_app_service_info_for_exe(&exe_path).unwrap_err();
            assert!(error.contains(expected), "内容 {content}：{error}");
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn broken_inline_service_section_reports_parse_error() {
        let root = test_root("broken");
        let exe_path = write_package(
            &root,
            r#"{
                "type": "service-app",
                "id": "eucli-box",
                "name": "eucli-box",
                "version": "0.1.2",
                "package": { "windowsExecutable": "eucli-box.exe" },
                "service": "not-an-object"
            }"#,
        );

        let error = build_app_service_info_for_exe(&exe_path).unwrap_err();

        assert!(error.starts_with("已安装 fw-app.json 解析失败"), "{error}");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unregistered_or_unknown_exe_is_rejected() {
        let error = app_service_info("  ".to_string()).unwrap_err();
        assert_eq!(error, "应用文件路径不能为空");

        let missing = std::env::temp_dir().join("fw-app-service-info-test-missing.exe");
        let error = app_service_info(missing.to_string_lossy().to_string()).unwrap_err();
        assert!(error.starts_with("应用文件不存在"), "{error}");
    }
}
