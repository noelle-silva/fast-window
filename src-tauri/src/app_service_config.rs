use std::path::Path;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::app_lifecycle::{
    ServiceConnection, ServiceConnectionFile, ServiceConnectionFileFormat, ServiceConnectionValue,
};

const CONNECTION_KEY_MAX_BYTES: usize = 4096;
const PORT_DEFAULT_VALUE: &str = "default";
const PORT_MIN_VALUE: u32 = 1;
const PORT_MAX_VALUE: u32 = 65535;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ConnectionField {
    Port,
    Key,
}

impl ConnectionField {
    fn parse(raw: &str) -> Result<Self, String> {
        let field = raw.trim();
        if field.is_empty() {
            return Err("服务信息字段不能为空".to_string());
        }
        match field {
            "port" => Ok(Self::Port),
            "key" => Ok(Self::Key),
            _ => Err(format!("不支持的服务信息字段: {field}（仅支持 port/key）")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Port => "port",
            Self::Key => "key",
        }
    }

    fn from_connection<'a>(
        self,
        connection: Option<&'a ServiceConnection>,
    ) -> Option<&'a ServiceConnectionValue> {
        let connection = connection?;
        match self {
            Self::Port => connection.port.as_ref(),
            Self::Key => connection.key.as_ref(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppServiceConfigSaveResult {
    field: String,
    value: String,
}

/// 把服务应用连接信息（port/key）保存回服务声明指向的数据文件。
#[tauri::command]
pub(crate) fn app_service_config_save(
    exe_path: String,
    field: String,
    value: String,
) -> Result<AppServiceConfigSaveResult, String> {
    let raw_path = exe_path.trim();
    if raw_path.is_empty() {
        return Err("应用文件路径不能为空".to_string());
    }
    let field = ConnectionField::parse(&field)?;
    let value = save_connection_value(Path::new(raw_path), field, &value)?;
    Ok(AppServiceConfigSaveResult {
        field: field.as_str().to_string(),
        value,
    })
}

fn save_connection_value(
    exe_path: &Path,
    field: ConnectionField,
    raw_value: &str,
) -> Result<String, String> {
    let Some(app) = crate::app_installer::resolve_installed_service_app(exe_path)? else {
        return Err("该应用不是服务应用，无法保存服务信息".to_string());
    };
    let Some(entry) = field.from_connection(app.declaration.connection.as_ref()) else {
        return Err("声明中没有配置该项".to_string());
    };
    let ServiceConnectionValue::File(file) = entry else {
        return Err("该项为声明字面值，暂不支持编辑".to_string());
    };

    let value = normalize_connection_value(field, raw_value)?;
    let target = app.manifest_dir.join(&file.path);
    write_connection_file(file, &target, &value)?;
    Ok(value)
}

fn normalize_connection_value(field: ConnectionField, raw: &str) -> Result<String, String> {
    match field {
        ConnectionField::Port => normalize_port(raw),
        ConnectionField::Key => normalize_key(raw),
    }
}

fn normalize_port(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    if text == PORT_DEFAULT_VALUE {
        return Ok(PORT_DEFAULT_VALUE.to_string());
    }
    if text.is_empty() || !text.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!(
            "端口必须是 {PORT_MIN_VALUE}-{PORT_MAX_VALUE} 的数字或 {PORT_DEFAULT_VALUE}"
        ));
    }
    let port: u32 = text
        .parse()
        .ok()
        .filter(|port| (PORT_MIN_VALUE..=PORT_MAX_VALUE).contains(port))
        .ok_or_else(|| format!("端口必须在 {PORT_MIN_VALUE}-{PORT_MAX_VALUE} 之间"))?;
    Ok(port.to_string())
}

fn normalize_key(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err("钥匙不能为空".to_string());
    }
    if text.contains('\r') || text.contains('\n') {
        return Err("钥匙不能包含换行符".to_string());
    }
    if text.len() > CONNECTION_KEY_MAX_BYTES {
        return Err(format!("钥匙长度不能超过 {CONNECTION_KEY_MAX_BYTES} 字节"));
    }
    Ok(text.to_string())
}

fn write_connection_file(
    file: &ServiceConnectionFile,
    target: &Path,
    value: &str,
) -> Result<(), String> {
    ensure_connection_parent_dir(target)?;
    match file.format {
        ServiceConnectionFileFormat::Text => write_text_value(target, value),
        ServiceConnectionFileFormat::Json => {
            let json_field = file
                .field
                .as_deref()
                .filter(|field| !field.is_empty())
                .ok_or_else(|| "服务声明缺少 JSON 字段名，无法保存".to_string())?;
            write_json_field_value(target, json_field, value)
        }
    }
}

fn ensure_connection_parent_dir(target: &Path) -> Result<(), String> {
    let Some(parent) = target.parent() else {
        return Err("连接信息文件路径没有父目录".to_string());
    };
    if parent.as_os_str().is_empty() || parent.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(parent).map_err(|e| format!("创建连接信息目录失败: {e}"))
}

#[cfg(unix)]
fn write_text_value(target: &Path, value: &str) -> Result<(), String> {
    use std::io::Write as _;
    use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(target)
        .map_err(|e| format!("写入连接信息文件失败: {e}"))?;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("设置连接信息文件权限失败: {e}"))?;
    file.write_all(format!("{value}\n").as_bytes())
        .map_err(|e| format!("写入连接信息文件失败: {e}"))
}

#[cfg(not(unix))]
fn write_text_value(target: &Path, value: &str) -> Result<(), String> {
    std::fs::write(target, format!("{value}\n"))
        .map_err(|e| format!("写入连接信息文件失败: {e}"))
}

fn write_json_field_value(target: &Path, field: &str, value: &str) -> Result<(), String> {
    crate::json_file::with_exclusive_path(target, || {
        let mut document = read_json_document(target);
        document.insert(field.to_string(), Value::String(value.to_string()));
        crate::json_file::write_pretty_unlocked(target, &Value::Object(document))
    })
}

/// 读取目标 JSON 文档用于保留其它字段；不存在或不可解析为对象时返回空文档（重建）。
fn read_json_document(target: &Path) -> Map<String, Value> {
    let Ok(text) = std::fs::read_to_string(target) else {
        return Map::new();
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(document)) => document,
        _ => Map::new(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use serde_json::Value;

    use super::{app_service_config_save, save_connection_value, ConnectionField};

    const SERVICE_DECLARATION: &str = r#"{
        "ready": { "type": "log", "match": "is ready" },
        "connection": {
            "port": { "type": "file", "path": "data/.meta/port.json", "format": "json", "field": "port" },
            "key": { "type": "file", "path": "data/.meta/box.key", "format": "text" }
        },
        "stop": { "type": "terminate" }
    }"#;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "fw-app-service-config-test-{name}-{pid}",
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

    fn connection_file_path(exe_path: &Path, relative: &str) -> PathBuf {
        exe_path
            .parent()
            .expect("可执行文件没有父目录")
            .join(relative)
    }

    fn write_connection_file(exe_path: &Path, relative: &str, content: &str) {
        let path = connection_file_path(exe_path, relative);
        std::fs::create_dir_all(path.parent().expect("连接文件没有父目录"))
            .expect("创建连接文件目录失败");
        std::fs::write(path, content).expect("写入连接文件失败");
    }

    fn read_document(exe_path: &Path, relative: &str) -> Value {
        let text = std::fs::read_to_string(connection_file_path(exe_path, relative))
            .expect("读取连接信息文件失败");
        serde_json::from_str(&text).expect("连接信息文件应可解析")
    }

    #[test]
    fn saves_port_into_new_json_document() {
        let root = test_root("port-new");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        save_connection_value(&exe_path, ConnectionField::Port, "9000").expect("保存端口失败");

        assert_eq!(
            read_document(&exe_path, "data/.meta/port.json")["port"],
            Value::String("9000".to_string())
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn saves_port_preserving_other_json_fields() {
        let root = test_root("port-preserve");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);
        write_connection_file(
            &exe_path,
            "data/.meta/port.json",
            r#"{ "port": "default", "other": 7 }"#,
        );

        save_connection_value(&exe_path, ConnectionField::Port, "18999").expect("保存端口失败");

        let document = read_document(&exe_path, "data/.meta/port.json");
        assert_eq!(document["port"], Value::String("18999".to_string()));
        assert_eq!(document["other"], Value::from(7));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn normalizes_port_default_and_numeric_text() {
        let root = test_root("port-normalize");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        for (input, expected) in [
            ("default", "default"),
            (" 08 ", "8"),
            ("1", "1"),
            ("65535", "65535"),
        ] {
            save_connection_value(&exe_path, ConnectionField::Port, input).expect("保存端口失败");
            assert_eq!(
                read_document(&exe_path, "data/.meta/port.json")["port"],
                Value::String(expected.to_string()),
                "输入 {input}"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_invalid_port_values() {
        let root = test_root("port-invalid");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        for input in ["", "  ", "abc", "1.5", "12a", "Default", "-1", "+1"] {
            let error = save_connection_value(&exe_path, ConnectionField::Port, input).unwrap_err();
            assert_eq!(error, "端口必须是 1-65535 的数字或 default", "输入 {input}");
        }
        for input in ["0", "65536", "99999999999999999999"] {
            let error = save_connection_value(&exe_path, ConnectionField::Port, input).unwrap_err();
            assert_eq!(error, "端口必须在 1-65535 之间", "输入 {input}");
        }
        assert!(!connection_file_path(&exe_path, "data/.meta/port.json").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn saves_key_as_text_with_trailing_newline() {
        let root = test_root("key-write");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);
        write_connection_file(&exe_path, "data/.meta/box.key", "old-key\n");

        save_connection_value(&exe_path, ConnectionField::Key, "  secret-key \n").expect("保存钥匙失败");

        let content =
            std::fs::read_to_string(connection_file_path(&exe_path, "data/.meta/box.key"))
                .expect("读取钥匙文件失败");
        assert_eq!(content, "secret-key\n");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_blank_and_multiline_key_values() {
        let root = test_root("key-invalid");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        for input in ["", "   "] {
            let error = save_connection_value(&exe_path, ConnectionField::Key, input).unwrap_err();
            assert_eq!(error, "钥匙不能为空", "输入 {input:?}");
        }
        for input in ["line1\nline2", "line1\r\nline2", "line1\rline2"] {
            let error = save_connection_value(&exe_path, ConnectionField::Key, input).unwrap_err();
            assert_eq!(error, "钥匙不能包含换行符", "输入 {input:?}");
        }
        let too_long = "a".repeat(4097);
        let error = save_connection_value(&exe_path, ConnectionField::Key, &too_long).unwrap_err();
        assert_eq!(error, "钥匙长度不能超过 4096 字节");
        assert!(!connection_file_path(&exe_path, "data/.meta/box.key").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_literal_value_connection_entry() {
        let root = test_root("literal");
        let exe_path = write_service_package(
            &root,
            r#"{
                "ready": { "type": "log", "match": "is ready" },
                "connection": {
                    "port": { "type": "value", "value": "9000" }
                },
                "stop": { "type": "terminate" }
            }"#,
        );

        let error = save_connection_value(&exe_path, ConnectionField::Port, "9001").unwrap_err();

        assert_eq!(error, "该项为声明字面值，暂不支持编辑");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_missing_connection_field() {
        let root = test_root("missing-field");
        let exe_path = write_service_package(
            &root,
            r#"{
                "ready": { "type": "log", "match": "is ready" },
                "connection": {
                    "key": { "type": "file", "path": "data/.meta/box.key" }
                },
                "stop": { "type": "terminate" }
            }"#,
        );

        let error = save_connection_value(&exe_path, ConnectionField::Port, "9000").unwrap_err();

        assert_eq!(error, "声明中没有配置该项");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_desktop_app_save() {
        let root = test_root("window-app");
        write_package(
            &root,
            r#"{
                "type": "desktop-app",
                "id": "demo",
                "name": "demo",
                "version": "0.1.0",
                "package": { "windowsExecutable": "demo.exe" }
            }"#,
        );
        let exe_path = root.join("eucli-box").join("package").join("demo.exe");
        std::fs::write(&exe_path, b"").expect("写入可执行文件失败");

        let error = save_connection_value(&exe_path, ConnectionField::Port, "9000").unwrap_err();

        assert_eq!(error, "该应用不是服务应用，无法保存服务信息");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_unsafe_declaration_paths_without_writing() {
        let root = test_root("unsafe-path");
        let exe_path = write_service_package(
            &root,
            r#"{
                "ready": { "type": "log", "match": "is ready" },
                "connection": {
                    "key": { "type": "file", "path": "../box.key" }
                },
                "stop": { "type": "terminate" }
            }"#,
        );

        let error = save_connection_value(&exe_path, ConnectionField::Key, "secret").unwrap_err();

        assert!(
            error.contains("fw-app.service.connection.key.path 不合法"),
            "{error}"
        );
        assert!(!root.join("eucli-box").join("box.key").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rebuilds_unparsable_json_documents() {
        let root = test_root("json-rebuild");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        for content in [r#"{ "port": "#, "[]", "\"text\"", "null"] {
            write_connection_file(&exe_path, "data/.meta/port.json", content);
            save_connection_value(&exe_path, ConnectionField::Port, "9000").expect("保存端口失败");
            assert_eq!(
                read_document(&exe_path, "data/.meta/port.json")["port"],
                Value::String("9000".to_string()),
                "原内容 {content}"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn saves_json_key_field_when_declared_as_json() {
        let root = test_root("key-json");
        let exe_path = write_service_package(
            &root,
            r#"{
                "ready": { "type": "log", "match": "is ready" },
                "connection": {
                    "key": { "type": "file", "path": "data/.meta/box.key.json", "format": "json", "field": "key" }
                },
                "stop": { "type": "terminate" }
            }"#,
        );

        save_connection_value(&exe_path, ConnectionField::Key, "secret").expect("保存钥匙失败");

        assert_eq!(
            read_document(&exe_path, "data/.meta/box.key.json")["key"],
            Value::String("secret".to_string())
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_unknown_or_blank_field_name() {
        let root = test_root("field-name");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);
        let exe = exe_path.to_string_lossy().to_string();

        let error = app_service_config_save(exe.clone(), "address".to_string(), "9000".to_string())
            .unwrap_err();
        assert_eq!(error, "不支持的服务信息字段: address（仅支持 port/key）");

        let error =
            app_service_config_save(exe, "  ".to_string(), "9000".to_string()).unwrap_err();
        assert_eq!(error, "服务信息字段不能为空");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_blank_exe_path_in_save_command() {
        let error = app_service_config_save(
            "  ".to_string(),
            "port".to_string(),
            "9000".to_string(),
        )
        .unwrap_err();

        assert_eq!(error, "应用文件路径不能为空");
    }

    #[test]
    fn save_command_returns_normalized_field_and_value() {
        let root = test_root("command-result");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        let result = app_service_config_save(
            exe_path.to_string_lossy().to_string(),
            "port".to_string(),
            " 08 ".to_string(),
        )
        .expect("保存端口失败");

        assert_eq!(result.field, "port");
        assert_eq!(result.value, "8");
        let _ = std::fs::remove_dir_all(&root);
    }
}
