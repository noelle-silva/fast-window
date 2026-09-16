use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use crate::app_lifecycle::{
    read_service_declaration_at, ServiceConnection, ServiceConnectionFile,
    ServiceConnectionFileFormat, ServiceConnectionValue, ServiceDeclaration,
};

const SERVICE_CONNECTION_VALUE_MAX_BYTES: u64 = 16 * 1024;
const CONNECTION_VALUE_PENDING_REASON: &str = "尚未生成：启动服务后可用";

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
    fn window() -> Self {
        Self {
            app_kind: "window",
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

/// 读取已安装应用的服务信息：窗口应用返回 appKind=window 信号，服务应用附带只读声明信息。
#[tauri::command]
pub(crate) fn app_service_info(exe_path: String) -> Result<AppServiceInfo, String> {
    let raw = exe_path.trim();
    if raw.is_empty() {
        return Err("应用文件路径不能为空".to_string());
    }
    build_app_service_info_for_exe(Path::new(raw))
}

fn build_app_service_info_for_exe(exe_path: &Path) -> Result<AppServiceInfo, String> {
    let Some(location) =
        crate::app_installer::resolve_installed_service_declaration_location(exe_path)?
    else {
        return Ok(AppServiceInfo::window());
    };

    let declaration = read_service_declaration_at(&location.declaration_path)?;
    Ok(build_service_info(&location.manifest_dir, &declaration))
}

fn build_service_info(manifest_dir: &Path, declaration: &ServiceDeclaration) -> AppServiceInfo {
    AppServiceInfo {
        app_kind: "service",
        start: Some(AppServiceStartInfo {
            executable: declaration.executable.to_string_lossy().to_string(),
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
        connection: build_connection_info(manifest_dir, declaration.connection.as_ref()),
    }
}

fn build_connection_info(
    manifest_dir: &Path,
    connection: Option<&ServiceConnection>,
) -> Option<AppServiceConnectionInfo> {
    let connection = connection?;
    Some(AppServiceConnectionInfo {
        port: resolve_connection_value(
            connection.port.as_ref(),
            manifest_dir,
            "声明中没有配置端口",
        ),
        key: resolve_connection_value(connection.key.as_ref(), manifest_dir, "声明中没有配置钥匙"),
    })
}

fn resolve_connection_value(
    entry: Option<&ServiceConnectionValue>,
    manifest_dir: &Path,
    missing_reason: &str,
) -> AppServiceConnectionValueInfo {
    let Some(entry) = entry else {
        return AppServiceConnectionValueInfo::unavailable(missing_reason);
    };

    match entry {
        ServiceConnectionValue::Value(value) => AppServiceConnectionValueInfo::available(value),
        ServiceConnectionValue::File(file) => resolve_connection_file(file, manifest_dir),
    }
}

fn resolve_connection_file(
    file: &ServiceConnectionFile,
    manifest_dir: &Path,
) -> AppServiceConnectionValueInfo {
    let path = manifest_dir.join(&file.path);
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return AppServiceConnectionValueInfo::unavailable(CONNECTION_VALUE_PENDING_REASON);
        }
        Err(e) => return AppServiceConnectionValueInfo::unavailable(format!("读取失败: {e}")),
    };
    if metadata.len() > SERVICE_CONNECTION_VALUE_MAX_BYTES {
        return AppServiceConnectionValueInfo::unavailable("文件过大，拒绝读取");
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) => return AppServiceConnectionValueInfo::unavailable(format!("读取失败: {e}")),
    };
    match file.format {
        ServiceConnectionFileFormat::Text => display_text_value(&text),
        ServiceConnectionFileFormat::Json => {
            display_json_field(&text, file.field.as_deref().unwrap_or_default())
        }
    }
}

fn display_text_value(text: &str) -> AppServiceConnectionValueInfo {
    let value = text.trim();
    if value.is_empty() {
        AppServiceConnectionValueInfo::unavailable("文件内容为空")
    } else {
        AppServiceConnectionValueInfo::available(value)
    }
}

fn display_json_field(text: &str, field: &str) -> AppServiceConnectionValueInfo {
    let document: serde_json::Value = match serde_json::from_str(text) {
        Ok(document) => document,
        Err(e) => {
            return AppServiceConnectionValueInfo::unavailable(format!("JSON 解析失败: {e}"));
        }
    };
    let Some(object) = document.as_object() else {
        return AppServiceConnectionValueInfo::unavailable("JSON 内容不是对象");
    };
    let Some(value) = object.get(field) else {
        return AppServiceConnectionValueInfo::unavailable(format!("JSON 中缺少字段: {field}"));
    };
    match value {
        serde_json::Value::String(value) => {
            let value = value.trim();
            if value.is_empty() {
                AppServiceConnectionValueInfo::unavailable(format!("字段 {field} 内容为空"))
            } else {
                AppServiceConnectionValueInfo::available(value)
            }
        }
        serde_json::Value::Number(value) => {
            AppServiceConnectionValueInfo::available(value.to_string())
        }
        _ => AppServiceConnectionValueInfo::unavailable(format!("字段 {field} 类型不可展示")),
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{
        app_service_info, build_app_service_info_for_exe, AppServiceInfo,
        CONNECTION_VALUE_PENDING_REASON,
    };

    const SERVICE_DECLARATION: &str = r#"{
        "schemaVersion": 1,
        "id": "eucli-box",
        "start": {
            "executable": "eucli-box.exe",
            "args": ["--port", "8765"]
        },
        "ready": { "type": "log", "match": "is ready", "timeoutSeconds": 10 },
        "connection": {
            "port": { "type": "file", "path": "data/.meta/port.json", "format": "json", "field": "port" },
            "key": { "type": "file", "path": "data/.meta/box.key", "format": "text" }
        },
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

    fn write_package(root: &Path, manifest: &str) -> PathBuf {
        let package_dir = root.join("eucli-box").join("package");
        std::fs::create_dir_all(&package_dir).expect("创建测试目录失败");
        std::fs::write(package_dir.join("fw-app.json"), manifest).expect("写入清单失败");
        let exe_path = package_dir.join("eucli-box.exe");
        std::fs::write(&exe_path, b"").expect("写入可执行文件失败");
        exe_path
    }

    fn service_manifest() -> &'static str {
        r#"{
            "id": "eucli-box",
            "name": "eucli-box",
            "version": "0.1.2",
            "windowsExecutable": "eucli-box.exe",
            "service": "fw-app.service.json"
        }"#
    }

    fn write_service_package(root: &Path) -> PathBuf {
        let exe_path = write_package(root, service_manifest());
        let package_dir = exe_path.parent().expect("可执行文件没有父目录");
        std::fs::write(package_dir.join("fw-app.service.json"), SERVICE_DECLARATION)
            .expect("写入服务声明失败");
        exe_path
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

    fn write_connection_file(exe_path: &Path, relative: &str, content: &str) {
        let package_dir = exe_path.parent().expect("可执行文件没有父目录");
        let path = package_dir.join(relative);
        std::fs::create_dir_all(path.parent().expect("连接文件没有父目录"))
            .expect("创建连接文件目录失败");
        std::fs::write(path, content).expect("写入连接文件失败");
    }

    #[test]
    fn window_app_reports_window_kind_without_service_sections() {
        let root = test_root("window");
        let exe_path = write_package(
            &root,
            r#"{
                "id": "legacy-app",
                "name": "legacy-app",
                "version": "0.1.0",
                "windowsExecutable": "eucli-box.exe"
            }"#,
        );

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        assert_eq!(info.app_kind, "window");
        assert!(info.start.is_none());
        assert!(info.ready.is_none());
        assert!(info.stop.is_none());
        assert!(info.connection.is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn service_app_reports_declaration_sections() {
        let root = test_root("service");
        let exe_path = write_service_package(&root);

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        assert_eq!(info.app_kind, "service");
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
    fn connection_literal_value_is_returned_verbatim() {
        let root = test_root("literal");
        let exe_path = write_package(&root, service_manifest());
        let package_dir = exe_path.parent().expect("可执行文件没有父目录");
        std::fs::write(
            package_dir.join("fw-app.service.json"),
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "is ready" },
                "connection": {
                    "port": { "type": "value", "value": "http://127.0.0.1:8765" }
                },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("写入服务声明失败");

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        let port = connection_value(&info, "port");
        assert!(port.available);
        assert_eq!(port.value, "http://127.0.0.1:8765");
        assert!(port.reason.is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn connection_text_file_is_read_and_trimmed() {
        let root = test_root("text-file");
        let exe_path = write_service_package(&root);
        write_connection_file(&exe_path, "data/.meta/box.key", "  secret-key\n");

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        let key = connection_value(&info, "key");
        assert!(key.available);
        assert_eq!(key.value, "secret-key");
        assert!(key.reason.is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn connection_json_file_reads_string_field() {
        let root = test_root("json-string");
        let exe_path = write_service_package(&root);
        write_connection_file(&exe_path, "data/.meta/port.json", r#"{ "port": "8765" }"#);

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        let port = connection_value(&info, "port");
        assert!(port.available);
        assert_eq!(port.value, "8765");
        assert!(port.reason.is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn connection_json_file_reads_number_field() {
        let root = test_root("json-number");
        let exe_path = write_service_package(&root);
        write_connection_file(&exe_path, "data/.meta/port.json", r#"{ "port": 9000 }"#);

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        let port = connection_value(&info, "port");
        assert!(port.available);
        assert_eq!(port.value, "9000");
        assert!(port.reason.is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_connection_files_report_pending_reason() {
        let root = test_root("missing-file");
        let exe_path = write_service_package(&root);

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        for field in ["port", "key"] {
            let value = connection_value(&info, field);
            assert!(!value.available);
            assert!(value.value.is_empty());
            assert_eq!(value.reason, CONNECTION_VALUE_PENDING_REASON);
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn broken_connection_json_reports_unavailable_reason() {
        let root = test_root("broken-json");
        let exe_path = write_service_package(&root);
        write_connection_file(&exe_path, "data/.meta/port.json", r#"{ "port": "#);

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        let port = connection_value(&info, "port");
        assert!(!port.available);
        assert!(port.value.is_empty());
        assert!(port.reason.starts_with("JSON 解析失败"), "{}", port.reason);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_connection_json_field_reports_unavailable_reason() {
        let root = test_root("missing-json-field");
        let exe_path = write_service_package(&root);
        write_connection_file(&exe_path, "data/.meta/port.json", r#"{ "other": 9000 }"#);

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        let port = connection_value(&info, "port");
        assert!(!port.available);
        assert_eq!(port.reason, "JSON 中缺少字段: port");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unsupported_connection_json_field_type_reports_unavailable_reason() {
        let root = test_root("json-field-type");
        let exe_path = write_service_package(&root);
        write_connection_file(&exe_path, "data/.meta/port.json", r#"{ "port": true }"#);

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        let port = connection_value(&info, "port");
        assert!(!port.available);
        assert_eq!(port.reason, "字段 port 类型不可展示");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_connection_sections_report_unavailable_reasons() {
        let root = test_root("partial");
        let exe_path = write_package(&root, service_manifest());
        let package_dir = exe_path.parent().expect("可执行文件没有父目录");
        std::fs::write(
            package_dir.join("fw-app.service.json"),
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "is ready" },
                "connection": {
                    "key": { "type": "file", "path": "data/.meta/box.key" }
                },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("写入服务声明失败");

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        let port = connection_value(&info, "port");
        assert!(!port.available);
        assert_eq!(port.reason, "声明中没有配置端口");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_connection_section_leaves_connection_absent() {
        let root = test_root("no-connection");
        let exe_path = write_package(&root, service_manifest());
        let package_dir = exe_path.parent().expect("可执行文件没有父目录");
        std::fs::write(
            package_dir.join("fw-app.service.json"),
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "is ready" },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("写入服务声明失败");

        let info = build_app_service_info_for_exe(&exe_path).expect("读取服务信息失败");

        assert_eq!(info.app_kind, "service");
        assert!(info.connection.is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn broken_declaration_reports_read_error() {
        let root = test_root("broken");
        let exe_path = write_service_package(&root);
        let package_dir = exe_path.parent().expect("可执行文件没有父目录");
        std::fs::write(package_dir.join("fw-app.service.json"), "not-json")
            .expect("写入服务声明失败");

        let error = build_app_service_info_for_exe(&exe_path).unwrap_err();

        assert!(error.starts_with("服务声明文件解析失败"), "{error}");

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
