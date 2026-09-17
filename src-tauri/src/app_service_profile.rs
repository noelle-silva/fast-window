//! 启动配置画像：宿主查看与编辑服务应用连接信息的唯一入口。
//!
//! 画像固定位于应用包目录下的 data/service-profile.json，以固定结构承载
//! 端口与钥匙；读取与写入共用同一套字段校验（端口 1-65535 整数、钥匙非空），
//! 文件缺失按"尚未生成"对待，宿主不代为生成。

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

/// 画像文件相对应用包目录的固定位置。
const PROFILE_RELATIVE_PATH: &str = "data/service-profile.json";
/// 画像读取上限：画像远小于此值，超限文件拒绝读入。
const PROFILE_MAX_BYTES: u64 = 16 * 1024;

const PORT_MIN_VALUE: u64 = 1;
const PORT_MAX_VALUE: u64 = 65535;

/// 画像文件缺失时的展示原因。
pub(crate) const PROFILE_PENDING_REASON: &str = "尚未生成：启动服务后可用";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ServiceProfile {
    pub(crate) port: u32,
    pub(crate) key: String,
}

pub(crate) fn profile_path(app_dir: &Path) -> PathBuf {
    app_dir.join(PROFILE_RELATIVE_PATH)
}

/// 读取并校验画像；文件缺失返回 Ok(None)，坏值快速失败。
pub(crate) fn read_profile(app_dir: &Path) -> Result<Option<ServiceProfile>, String> {
    let path = profile_path(app_dir);
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("读取启动配置画像失败: {e}")),
    };
    if metadata.len() > PROFILE_MAX_BYTES {
        return Err("启动配置画像文件过大，拒绝读取".to_string());
    }
    let payload =
        std::fs::read_to_string(&path).map_err(|e| format!("读取启动配置画像失败: {e}"))?;
    parse_profile(&payload).map(Some)
}

fn parse_profile(payload: &str) -> Result<ServiceProfile, String> {
    let document: Value =
        serde_json::from_str(payload).map_err(|e| format!("启动配置画像无效: {e}"))?;
    let object = document
        .as_object()
        .ok_or_else(|| "启动配置画像必须是 JSON 对象".to_string())?;
    Ok(ServiceProfile {
        port: profile_port(object.get("port"))?,
        key: profile_key(object.get("key"))?,
    })
}

fn profile_port(value: Option<&Value>) -> Result<u32, String> {
    let value = value
        .ok_or_else(|| "启动配置画像缺少 port 字段（必须为 1-65535 的整数）".to_string())?;
    let port = value
        .as_u64()
        .ok_or_else(|| "启动配置画像的 port 必须是 1-65535 的整数".to_string())?;
    validate_port(port)
}

fn profile_key(value: Option<&Value>) -> Result<String, String> {
    let value = value.ok_or_else(|| "启动配置画像缺少 key 字段".to_string())?;
    let text = value
        .as_str()
        .ok_or_else(|| "启动配置画像的 key 必须是字符串".to_string())?;
    validate_key(text)
}

/// 校验端口文本输入（编辑入口）并返回规范化的端口整数。
pub(crate) fn normalize_port(raw: &str) -> Result<u32, String> {
    let text = raw.trim();
    if text.is_empty() || !text.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!(
            "端口必须是 {PORT_MIN_VALUE}-{PORT_MAX_VALUE} 的整数"
        ));
    }
    let port = text
        .parse::<u64>()
        .map_err(|_| format!("端口必须在 {PORT_MIN_VALUE}-{PORT_MAX_VALUE} 之间"))?;
    validate_port(port)
}

fn validate_port(port: u64) -> Result<u32, String> {
    if (PORT_MIN_VALUE..=PORT_MAX_VALUE).contains(&port) {
        return Ok(port as u32);
    }
    Err(format!(
        "端口必须在 {PORT_MIN_VALUE}-{PORT_MAX_VALUE} 之间，实际为 {port}"
    ))
}

/// 校验钥匙文本输入（编辑入口）并返回规范化的钥匙。
pub(crate) fn normalize_key(raw: &str) -> Result<String, String> {
    validate_key(raw)
}

fn validate_key(raw: &str) -> Result<String, String> {
    let key = raw.trim();
    if key.is_empty() {
        return Err("钥匙不能为空".to_string());
    }
    Ok(key.to_string())
}

/// 把端口写入画像：保留文档其它字段，文件缺失时创建只含该字段的文档。
pub(crate) fn save_port(app_dir: &Path, raw: &str) -> Result<u32, String> {
    let port = normalize_port(raw)?;
    update_document(app_dir, |document| {
        document.insert("port".to_string(), Value::from(port));
    })?;
    Ok(port)
}

/// 把钥匙写入画像：保留文档其它字段，文件缺失时创建只含该字段的文档。
pub(crate) fn save_key(app_dir: &Path, raw: &str) -> Result<String, String> {
    let key = normalize_key(raw)?;
    update_document(app_dir, |document| {
        document.insert("key".to_string(), Value::String(key.clone()));
    })?;
    Ok(key)
}

fn update_document(
    app_dir: &Path,
    update: impl FnOnce(&mut Map<String, Value>),
) -> Result<(), String> {
    let path = profile_path(app_dir);
    crate::json_file::with_exclusive_path(&path, || {
        let mut document = read_document_unlocked(&path);
        update(&mut document);
        crate::json_file::write_pretty_unlocked(&path, &Value::Object(document))
    })
}

/// 读取目标 JSON 文档用于保留其它字段；不存在或不可解析为对象时返回空文档（重建）。
fn read_document_unlocked(path: &Path) -> Map<String, Value> {
    let Ok(text) = std::fs::read_to_string(path) else {
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

    use super::{
        normalize_key, normalize_port, profile_path, read_profile, save_key, save_port,
        ServiceProfile,
    };

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "fw-app-service-profile-test-{name}-{pid}",
            pid = std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("创建测试目录失败");
        root
    }

    fn write_profile(app_dir: &Path, content: &str) {
        let path = profile_path(app_dir);
        std::fs::create_dir_all(path.parent().expect("画像文件没有父目录"))
            .expect("创建画像目录失败");
        std::fs::write(path, content).expect("写入画像文件失败");
    }

    fn read_document(app_dir: &Path) -> Value {
        let text = std::fs::read_to_string(profile_path(app_dir)).expect("读取画像文件失败");
        serde_json::from_str(&text).expect("画像文件应可解析")
    }

    #[test]
    fn missing_profile_reports_pending() {
        let root = test_root("missing");

        assert_eq!(read_profile(&root).expect("读取画像失败"), None);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_port_and_key_from_fixed_path() {
        let root = test_root("read");
        write_profile(&root, r#"{ "port": 9000, "key": "secret" }"#);

        assert_eq!(
            read_profile(&root).expect("读取画像失败"),
            Some(ServiceProfile {
                port: 9000,
                key: "secret".to_string(),
            })
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_key_with_surrounding_whitespace_trimmed() {
        let root = test_root("read-trim");
        write_profile(&root, r#"{ "port": 1, "key": "  secret  " }"#);

        assert_eq!(
            read_profile(&root).expect("读取画像失败"),
            Some(ServiceProfile {
                port: 1,
                key: "secret".to_string(),
            })
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_broken_documents_without_pending_fallback() {
        let root = test_root("broken");

        for content in [
            "",
            r#"{ "port": "#,
            "[]",
            "\"text\"",
            "null",
            r#"{ "port": "9000", "key": "abc" }"#,
            r#"{ "port": 9000.5, "key": "abc" }"#,
            r#"{ "port": true, "key": "abc" }"#,
            r#"{ "port": 0, "key": "abc" }"#,
            r#"{ "port": 65536, "key": "abc" }"#,
            r#"{ "key": "abc" }"#,
            r#"{ "port": 9000 }"#,
            r#"{ "port": 9000, "key": "" }"#,
            r#"{ "port": 9000, "key": "   " }"#,
            r#"{ "port": 9000, "key": 123 }"#,
        ] {
            write_profile(&root, content);
            let error = read_profile(&root).unwrap_err();
            assert!(!error.is_empty(), "内容 {content} 应快速失败");
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn accepts_boundary_ports_and_ignores_extra_fields() {
        let root = test_root("boundary");

        for port in [1, 65535] {
            write_profile(
                &root,
                &format!(r#"{{ "extra": true, "port": {port}, "key": "abc" }}"#),
            );
            assert_eq!(
                read_profile(&root).expect("读取画像失败"),
                Some(ServiceProfile {
                    port,
                    key: "abc".to_string(),
                })
            );
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn saves_port_creating_document() {
        let root = test_root("save-port-new");

        assert_eq!(save_port(&root, " 9000 ").expect("保存端口失败"), 9000);

        assert_eq!(read_document(&root)["port"], Value::from(9000));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn saves_port_preserving_other_fields() {
        let root = test_root("save-port-preserve");
        write_profile(&root, r#"{ "port": 8765, "key": "keep", "other": 7 }"#);

        save_port(&root, "18999").expect("保存端口失败");

        let document = read_document(&root);
        assert_eq!(document["port"], Value::from(18999));
        assert_eq!(document["key"], Value::from("keep"));
        assert_eq!(document["other"], Value::from(7));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn saves_key_trimmed_and_preserving_port() {
        let root = test_root("save-key");
        write_profile(&root, r#"{ "port": 8765, "key": "old" }"#);

        assert_eq!(
            save_key(&root, "  secret-key  ").expect("保存钥匙失败"),
            "secret-key"
        );

        let document = read_document(&root);
        assert_eq!(document["key"], Value::from("secret-key"));
        assert_eq!(document["port"], Value::from(8765));
        assert_eq!(
            read_profile(&root).expect("读取画像失败"),
            Some(ServiceProfile {
                port: 8765,
                key: "secret-key".to_string(),
            })
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_invalid_values_before_writing() {
        let root = test_root("save-invalid");

        for input in ["", "0", "65536", "abc"] {
            assert!(save_port(&root, input).is_err(), "端口输入 {input} 应被拒绝");
        }
        for input in ["", "   "] {
            assert!(save_key(&root, input).is_err(), "钥匙输入 {input:?} 应被拒绝");
        }
        assert!(!profile_path(&root).exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rebuilds_unparsable_documents_on_save() {
        let root = test_root("save-rebuild");

        for content in [r#"{ "port": "#, "[]", "\"text\"", "null"] {
            write_profile(&root, content);
            save_port(&root, "9000").expect("保存端口失败");
            assert_eq!(
                read_document(&root)["port"],
                Value::from(9000),
                "原内容 {content}"
            );
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn normalizes_port_text_input() {
        for (input, expected) in [
            ("1", 1),
            ("65535", 65535),
            (" 08 ", 8),
            ("8765", 8765),
        ] {
            assert_eq!(normalize_port(input).expect("端口应有效"), expected, "输入 {input}");
        }
    }

    #[test]
    fn rejects_invalid_port_text_input() {
        for input in [
            "",
            "  ",
            "abc",
            "1.5",
            "12a",
            "Default",
            "-1",
            "+1",
            "0",
            "65536",
            "99999999999999999999",
        ] {
            assert!(normalize_port(input).is_err(), "输入 {input} 应被拒绝");
        }
    }

    #[test]
    fn normalizes_and_validates_key_text_input() {
        assert_eq!(normalize_key("  secret  ").expect("钥匙应有效"), "secret");
        for input in ["", "   "] {
            assert!(normalize_key(input).is_err(), "输入 {input:?} 应被拒绝");
        }
    }
}
