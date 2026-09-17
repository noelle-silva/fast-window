use std::path::Path;

use serde::Serialize;

use crate::app_service_profile;

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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppServiceConfigSaveResult {
    field: String,
    value: String,
}

/// 把服务应用的端口/钥匙保存进固定画像（应用包目录下的 data/service-profile.json）。
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
    match field {
        ConnectionField::Port => {
            let port = app_service_profile::save_port(&app.manifest_dir, raw_value)?;
            Ok(port.to_string())
        }
        ConnectionField::Key => app_service_profile::save_key(&app.manifest_dir, raw_value),
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use serde_json::Value;

    use super::{app_service_config_save, save_connection_value, ConnectionField};

    const SERVICE_DECLARATION: &str = r#"{
        "ready": { "type": "log", "match": "is ready" },
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

    fn profile_file_path(exe_path: &Path) -> PathBuf {
        exe_path
            .parent()
            .expect("可执行文件没有父目录")
            .join("data")
            .join("service-profile.json")
    }

    fn write_profile(exe_path: &Path, content: &str) {
        let path = profile_file_path(exe_path);
        std::fs::create_dir_all(path.parent().expect("画像文件没有父目录"))
            .expect("创建画像目录失败");
        std::fs::write(path, content).expect("写入画像文件失败");
    }

    fn read_document(exe_path: &Path) -> Value {
        let text = std::fs::read_to_string(profile_file_path(exe_path))
            .expect("读取画像文件失败");
        serde_json::from_str(&text).expect("画像文件应可解析")
    }

    #[test]
    fn saves_port_into_new_profile_document() {
        let root = test_root("port-new");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        save_connection_value(&exe_path, ConnectionField::Port, "9000").expect("保存端口失败");

        assert_eq!(read_document(&exe_path)["port"], Value::from(9000));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn saves_port_preserving_other_fields() {
        let root = test_root("port-preserve");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);
        write_profile(&exe_path, r#"{ "port": 8765, "key": "keep", "other": 7 }"#);

        save_connection_value(&exe_path, ConnectionField::Port, "18999").expect("保存端口失败");

        let document = read_document(&exe_path);
        assert_eq!(document["port"], Value::from(18999));
        assert_eq!(document["key"], Value::from("keep"));
        assert_eq!(document["other"], Value::from(7));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn normalizes_port_numeric_text() {
        let root = test_root("port-normalize");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        for (input, expected) in [("8", 8), (" 08 ", 8), ("1", 1), ("65535", 65535)] {
            save_connection_value(&exe_path, ConnectionField::Port, input).expect("保存端口失败");
            assert_eq!(
                read_document(&exe_path)["port"],
                Value::from(expected),
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
            assert_eq!(error, "端口必须是 1-65535 的整数", "输入 {input}");
        }
        for input in ["0", "65536", "99999999999999999999"] {
            let error = save_connection_value(&exe_path, ConnectionField::Port, input).unwrap_err();
            assert!(
                error.starts_with("端口必须在 1-65535 之间"),
                "输入 {input}：{error}"
            );
        }
        assert!(!profile_file_path(&exe_path).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn saves_key_trimmed_into_profile() {
        let root = test_root("key-write");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);
        write_profile(&exe_path, r#"{ "port": 8765, "key": "old" }"#);

        save_connection_value(&exe_path, ConnectionField::Key, "  secret-key \n").expect("保存钥匙失败");

        let document = read_document(&exe_path);
        assert_eq!(document["key"], Value::from("secret-key"));
        assert_eq!(document["port"], Value::from(8765));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_blank_key_values() {
        let root = test_root("key-invalid");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        for input in ["", "   "] {
            let error = save_connection_value(&exe_path, ConnectionField::Key, input).unwrap_err();
            assert_eq!(error, "钥匙不能为空", "输入 {input:?}");
        }
        assert!(!profile_file_path(&exe_path).exists());
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
    fn rebuilds_unparsable_profile_documents() {
        let root = test_root("profile-rebuild");
        let exe_path = write_service_package(&root, SERVICE_DECLARATION);

        for content in [r#"{ "port": "#, "[]", "\"text\"", "null"] {
            write_profile(&exe_path, content);
            save_connection_value(&exe_path, ConnectionField::Port, "9000").expect("保存端口失败");
            assert_eq!(
                read_document(&exe_path)["port"],
                Value::from(9000),
                "原内容 {content}"
            );
        }
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
