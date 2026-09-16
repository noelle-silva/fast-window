use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

pub(crate) const DEFAULT_READY_TIMEOUT_SECONDS: u64 = 30;
const SERVICE_DECLARATION_MAX_BYTES: u64 = 256 * 1024;

/// 连接信息文件的读取格式。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ServiceConnectionFileFormat {
    /// 裸文本，整份文件内容即取值。
    Text,
    /// JSON 文档，按 field 取字段值。
    Json,
}

/// file 形态的连接信息取值描述。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ServiceConnectionFile {
    /// 包内相对路径（已通过安全校验）。
    pub(crate) path: PathBuf,
    pub(crate) format: ServiceConnectionFileFormat,
    /// format=json 时指定要读取的字段；text 形态为 None。
    pub(crate) field: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ServiceConnectionValue {
    /// 声明里的字面值。
    Value(String),
    /// 包内相对路径指向的文件。
    File(ServiceConnectionFile),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ServiceConnection {
    pub(crate) port: Option<ServiceConnectionValue>,
    pub(crate) key: Option<ServiceConnectionValue>,
}

#[derive(Clone, Debug)]
pub(crate) struct ServiceDeclaration {
    /// 服务进程的可执行文件：解析阶段为包内相对路径，装载后为包内绝对路径。
    pub(crate) executable: PathBuf,
    pub(crate) args: Vec<String>,
    pub(crate) environment: Vec<(String, String)>,
    pub(crate) ready_match: String,
    pub(crate) ready_timeout: Duration,
    /// 停止类型：解析阶段已校验，仅允许 terminate。
    pub(crate) stop_type: String,
    pub(crate) connection: Option<ServiceConnection>,
}

pub(crate) fn is_ready_line(line: &str, ready_match: &str) -> bool {
    line.contains(ready_match)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawServiceDeclaration {
    #[serde(default)]
    start: Option<RawServiceStart>,
    #[serde(default)]
    ready: Option<RawServiceReady>,
    #[serde(default)]
    stop: Option<RawServiceStop>,
    #[serde(default)]
    connection: Option<RawServiceConnection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawServiceConnection {
    #[serde(default)]
    port: Option<RawServiceConnectionEntry>,
    #[serde(default)]
    key: Option<RawServiceConnectionEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawServiceConnectionEntry {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    field: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawServiceStart {
    #[serde(default)]
    executable: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
    #[serde(default)]
    environment: Option<BTreeMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawServiceReady {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(rename = "match", default)]
    matched: Option<String>,
    #[serde(default)]
    timeout_seconds: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawServiceStop {
    #[serde(rename = "type", default)]
    kind: Option<String>,
}

pub(crate) fn load_service_declaration_for_exe(
    exe_path: &Path,
) -> Result<Option<ServiceDeclaration>, String> {
    let Some(location) =
        crate::app_installer::resolve_installed_service_declaration_location(exe_path)?
    else {
        return Ok(None);
    };

    let mut declaration = read_service_declaration_at(&location.declaration_path)?;
    declaration.executable = location.manifest_dir.join(&declaration.executable);
    if !declaration.executable.is_file() {
        return Err(format!(
            "服务可执行文件不存在: {}",
            declaration.executable.display()
        ));
    }
    Ok(Some(declaration))
}

/// 读取并解析指定路径的服务声明文件，不做可执行文件存在性校验，也不改写其中的相对路径。
pub(crate) fn read_service_declaration_at(
    declaration_path: &Path,
) -> Result<ServiceDeclaration, String> {
    let metadata =
        std::fs::metadata(declaration_path).map_err(|e| format!("读取服务声明文件失败: {e}"))?;
    if metadata.len() > SERVICE_DECLARATION_MAX_BYTES {
        return Err("服务声明文件过大".to_string());
    }
    let text = std::fs::read_to_string(declaration_path)
        .map_err(|e| format!("读取服务声明文件失败: {e}"))?;

    parse_service_declaration(&text)
}

fn parse_service_declaration(text: &str) -> Result<ServiceDeclaration, String> {
    let raw: RawServiceDeclaration =
        serde_json::from_str(text).map_err(|e| format!("服务声明文件解析失败: {e}"))?;

    let start = raw
        .start
        .ok_or_else(|| "服务声明缺少 start 段".to_string())?;
    let ready = raw
        .ready
        .ok_or_else(|| "服务声明缺少 ready 段".to_string())?;
    let stop = raw.stop.ok_or_else(|| "服务声明缺少 stop 段".to_string())?;

    let executable = required_relative_executable(start.executable.as_deref())?;
    let args = start.args.unwrap_or_default();
    let environment = normalized_environment(start.environment.unwrap_or_default())?;

    match ready.kind.as_deref().map(str::trim) {
        Some("log") => {}
        Some(kind) => {
            return Err(format!(
                "fw-app.service.ready.type 不支持: {kind}（本版本仅支持 log）"
            ));
        }
        None => return Err("fw-app.service.ready.type 不能为空".to_string()),
    }
    let ready_match = ready
        .matched
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "fw-app.service.ready.match 不能为空".to_string())?
        .to_string();
    let ready_timeout = match ready.timeout_seconds {
        None => Duration::from_secs(DEFAULT_READY_TIMEOUT_SECONDS),
        Some(seconds) if seconds > 0 => Duration::from_secs(seconds as u64),
        Some(seconds) => {
            return Err(format!(
                "fw-app.service.ready.timeoutSeconds 必须为正整数: {seconds}"
            ));
        }
    };

    match stop.kind.as_deref().map(str::trim) {
        Some("terminate") => {}
        Some(kind) => {
            return Err(format!(
                "fw-app.service.stop.type 不支持: {kind}（本版本仅支持 terminate）"
            ));
        }
        None => return Err("fw-app.service.stop.type 不能为空".to_string()),
    }
    let stop_type = "terminate".to_string();

    let connection = parse_service_connection(raw.connection)?;

    Ok(ServiceDeclaration {
        executable,
        args,
        environment,
        ready_match,
        ready_timeout,
        stop_type,
        connection,
    })
}

fn parse_service_connection(
    raw: Option<RawServiceConnection>,
) -> Result<Option<ServiceConnection>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let port = parse_service_connection_entry(raw.port, "port")?;
    let key = parse_service_connection_entry(raw.key, "key")?;
    if port.is_none() && key.is_none() {
        return Ok(None);
    }
    Ok(Some(ServiceConnection { port, key }))
}

fn parse_service_connection_entry(
    raw: Option<RawServiceConnectionEntry>,
    field: &str,
) -> Result<Option<ServiceConnectionValue>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let kind = raw
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|kind| !kind.is_empty())
        .ok_or_else(|| format!("fw-app.service.connection.{field}.type 不能为空"))?;
    match kind {
        "value" => {
            let value = raw
                .value
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("fw-app.service.connection.{field}.value 不能为空"))?;
            Ok(Some(ServiceConnectionValue::Value(value.to_string())))
        }
        "file" => {
            let relative = raw
                .path
                .as_deref()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .ok_or_else(|| format!("fw-app.service.connection.{field}.path 不能为空"))?;
            let path = crate::plugins::safe_relative_path_no_curdir(relative)
                .map_err(|e| format!("fw-app.service.connection.{field}.path 不合法: {e}"))?;
            let format = match raw
                .format
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                None | Some("text") => ServiceConnectionFileFormat::Text,
                Some("json") => ServiceConnectionFileFormat::Json,
                Some(format) => {
                    return Err(format!(
                        "fw-app.service.connection.{field}.format 不支持: {format}（本版本仅支持 text/json）"
                    ));
                }
            };
            let json_field = match format {
                ServiceConnectionFileFormat::Json => Some(
                    raw.field
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .ok_or_else(|| format!("fw-app.service.connection.{field}.field 不能为空"))?
                        .to_string(),
                ),
                ServiceConnectionFileFormat::Text => None,
            };
            Ok(Some(ServiceConnectionValue::File(ServiceConnectionFile {
                path,
                format,
                field: json_field,
            })))
        }
        kind => Err(format!(
            "fw-app.service.connection.{field}.type 不支持: {kind}（本版本仅支持 value/file）"
        )),
    }
}

fn required_relative_executable(value: Option<&str>) -> Result<PathBuf, String> {
    let raw = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "fw-app.service.start.executable 不能为空".to_string())?;
    let path = crate::plugins::safe_relative_path_no_curdir(raw)
        .map_err(|e| format!("fw-app.service.start.executable 不合法: {e}"))?;
    if !path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
    {
        return Err("fw-app.service.start.executable 必须指向 .exe 文件".to_string());
    }
    Ok(path)
}

fn normalized_environment(raw: BTreeMap<String, String>) -> Result<Vec<(String, String)>, String> {
    let mut environment = Vec::with_capacity(raw.len());
    for (key, value) in raw {
        if key.is_empty() || key.contains('=') || key.contains('\0') {
            return Err(format!(
                "fw-app.service.start.environment 变量名不合法: {key}"
            ));
        }
        if value.contains('\0') {
            return Err(format!(
                "fw-app.service.start.environment 变量值不合法: {key}"
            ));
        }
        environment.push((key, value));
    }
    Ok(environment)
}

#[cfg(test)]
mod tests {
    use super::{
        is_ready_line, parse_service_declaration, ServiceConnection, ServiceConnectionFile,
        ServiceConnectionFileFormat, ServiceConnectionValue, DEFAULT_READY_TIMEOUT_SECONDS,
    };
    use std::path::PathBuf;
    use std::time::Duration;

    fn sample_declaration() -> &'static str {
        r#"{
            "schemaVersion": 1,
            "id": "eucli-box",
            "start": {
                "executable": "eucli-box.exe",
                "args": []
            },
            "ready": {
                "type": "log",
                "match": "is ready"
            },
            "connection": {
                "port": {
                    "type": "file",
                    "path": "data/.meta/port.json",
                    "format": "json",
                    "field": "port"
                },
                "key": {
                    "type": "file",
                    "path": "data/.meta/box.key",
                    "format": "text"
                }
            },
            "stop": {
                "type": "terminate"
            }
        }"#
    }

    fn declaration_with_ready(ready: &str) -> String {
        format!(
            r#"{{
                "start": {{ "executable": "eucli-box.exe" }},
                "ready": {ready},
                "stop": {{ "type": "terminate" }}
            }}"#
        )
    }

    #[test]
    fn parses_sample_service_declaration_with_default_timeout() {
        let declaration = parse_service_declaration(sample_declaration()).expect("声明应可解析");

        assert_eq!(declaration.executable, PathBuf::from("eucli-box.exe"));
        assert!(declaration.args.is_empty());
        assert!(declaration.environment.is_empty());
        assert_eq!(declaration.ready_match, "is ready");
        assert_eq!(
            declaration.ready_timeout,
            Duration::from_secs(DEFAULT_READY_TIMEOUT_SECONDS)
        );
        assert_eq!(declaration.stop_type, "terminate");
        assert_eq!(
            declaration.connection,
            Some(ServiceConnection {
                port: Some(ServiceConnectionValue::File(ServiceConnectionFile {
                    path: PathBuf::from("data/.meta/port.json"),
                    format: ServiceConnectionFileFormat::Json,
                    field: Some("port".to_string()),
                })),
                key: Some(ServiceConnectionValue::File(ServiceConnectionFile {
                    path: PathBuf::from("data/.meta/box.key"),
                    format: ServiceConnectionFileFormat::Text,
                    field: None,
                })),
            })
        );
    }

    #[test]
    fn parses_connection_file_value() {
        let declaration = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": {
                    "port": { "type": "file", "path": "data/.meta/port.json", "format": "json", "field": "port" },
                    "key": { "type": "file", "path": "data/.meta/box.key" }
                },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("声明应可解析");

        assert_eq!(
            declaration.connection,
            Some(ServiceConnection {
                port: Some(ServiceConnectionValue::File(ServiceConnectionFile {
                    path: PathBuf::from("data/.meta/port.json"),
                    format: ServiceConnectionFileFormat::Json,
                    field: Some("port".to_string()),
                })),
                key: Some(ServiceConnectionValue::File(ServiceConnectionFile {
                    path: PathBuf::from("data/.meta/box.key"),
                    format: ServiceConnectionFileFormat::Text,
                    field: None,
                })),
            })
        );
    }

    #[test]
    fn parses_legacy_literal_connection_value() {
        let declaration = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": {
                    "port": { "type": "value", "value": "http://127.0.0.1:8765" }
                },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("声明应可解析");

        assert_eq!(
            declaration.connection,
            Some(ServiceConnection {
                port: Some(ServiceConnectionValue::Value(
                    "http://127.0.0.1:8765".to_string()
                )),
                key: None,
            })
        );
    }

    #[test]
    fn legacy_address_connection_entry_is_ignored() {
        let declaration = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": {
                    "address": { "type": "value", "value": "http://127.0.0.1:8765" }
                },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("声明应可解析");

        assert!(declaration.connection.is_none());
    }

    #[test]
    fn missing_connection_section_is_allowed() {
        let declaration = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("声明应可解析");

        assert!(declaration.connection.is_none());
    }

    #[test]
    fn blank_connection_section_is_treated_as_missing() {
        let declaration = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": {},
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("声明应可解析");

        assert!(declaration.connection.is_none());
    }

    #[test]
    fn parses_partial_connection_section() {
        let declaration = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": {
                    "key": { "type": "file", "path": "data/.meta/box.key" }
                },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("声明应可解析");

        assert_eq!(
            declaration.connection,
            Some(ServiceConnection {
                port: None,
                key: Some(ServiceConnectionValue::File(ServiceConnectionFile {
                    path: PathBuf::from("data/.meta/box.key"),
                    format: ServiceConnectionFileFormat::Text,
                    field: None,
                })),
            })
        );
    }

    #[test]
    fn rejects_unsupported_connection_type() {
        let error = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": { "port": { "type": "env", "value": "ADDR" } },
                "stop": { "type": "terminate" }
            }"#,
        )
        .unwrap_err();

        assert_eq!(
            error,
            "fw-app.service.connection.port.type 不支持: env（本版本仅支持 value/file）"
        );
    }

    #[test]
    fn rejects_json_connection_file_without_field() {
        let error = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": {
                    "port": { "type": "file", "path": "data/.meta/port.json", "format": "json" }
                },
                "stop": { "type": "terminate" }
            }"#,
        )
        .unwrap_err();
        assert_eq!(error, "fw-app.service.connection.port.field 不能为空");

        let error = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": {
                    "port": { "type": "file", "path": "data/.meta/port.json", "format": "json", "field": "  " }
                },
                "stop": { "type": "terminate" }
            }"#,
        )
        .unwrap_err();
        assert_eq!(error, "fw-app.service.connection.port.field 不能为空");
    }

    #[test]
    fn rejects_unknown_connection_file_format() {
        let error = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": {
                    "port": { "type": "file", "path": "data/.meta/port.json", "format": "xml" }
                },
                "stop": { "type": "terminate" }
            }"#,
        )
        .unwrap_err();

        assert_eq!(
            error,
            "fw-app.service.connection.port.format 不支持: xml（本版本仅支持 text/json）"
        );
    }

    #[test]
    fn rejects_blank_connection_value_and_path() {
        let error = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": { "key": { "type": "value", "value": "  " } },
                "stop": { "type": "terminate" }
            }"#,
        )
        .unwrap_err();
        assert_eq!(error, "fw-app.service.connection.key.value 不能为空");

        let error = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "connection": { "key": { "type": "file", "path": " " } },
                "stop": { "type": "terminate" }
            }"#,
        )
        .unwrap_err();
        assert_eq!(error, "fw-app.service.connection.key.path 不能为空");
    }

    #[test]
    fn rejects_unsafe_connection_file_paths() {
        for path in ["../box.key", "./box.key", "C:/box.key"] {
            let error = parse_service_declaration(&format!(
                r#"{{
                    "start": {{ "executable": "eucli-box.exe" }},
                    "ready": {{ "type": "log", "match": "ready" }},
                    "connection": {{ "key": {{ "type": "file", "path": "{path}" }} }},
                    "stop": {{ "type": "terminate" }}
                }}"#
            ))
            .unwrap_err();
            assert!(
                error.starts_with("fw-app.service.connection.key.path 不合法"),
                "{error}"
            );
        }
    }

    #[test]
    fn parses_service_start_args() {
        let declaration = parse_service_declaration(
            r#"{
                "start": {
                    "executable": "bin/eucli-box.exe",
                    "args": ["--port", "8765"]
                },
                "ready": { "type": "log", "match": "is ready" },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("声明应可解析");

        assert_eq!(declaration.executable, PathBuf::from("bin/eucli-box.exe"));
        assert_eq!(declaration.args, vec!["--port", "8765"]);
    }

    #[test]
    fn parses_custom_ready_timeout_seconds() {
        let declaration = parse_service_declaration(&declaration_with_ready(
            r#"{ "type": "log", "match": "ready", "timeoutSeconds": 5 }"#,
        ))
        .expect("声明应可解析");

        assert_eq!(declaration.ready_timeout, Duration::from_secs(5));
    }

    #[test]
    fn rejects_non_positive_ready_timeout_seconds() {
        for seconds in ["0", "-1"] {
            let error = parse_service_declaration(&declaration_with_ready(&format!(
                r#"{{ "type": "log", "match": "ready", "timeoutSeconds": {seconds} }}"#
            )))
            .unwrap_err();
            assert!(error.contains("timeoutSeconds 必须为正整数"), "{error}");
        }
    }

    #[test]
    fn rejects_missing_declaration_sections() {
        assert_eq!(
            parse_service_declaration(
                r#"{ "ready": { "type": "log", "match": "ready" }, "stop": { "type": "terminate" } }"#
            )
            .unwrap_err(),
            "服务声明缺少 start 段"
        );
        assert_eq!(
            parse_service_declaration(
                r#"{ "start": { "executable": "eucli-box.exe" }, "stop": { "type": "terminate" } }"#
            )
            .unwrap_err(),
            "服务声明缺少 ready 段"
        );
        assert_eq!(
            parse_service_declaration(
                r#"{ "start": { "executable": "eucli-box.exe" }, "ready": { "type": "log", "match": "ready" } }"#
            )
            .unwrap_err(),
            "服务声明缺少 stop 段"
        );
    }

    #[test]
    fn rejects_unsupported_ready_type() {
        let error = parse_service_declaration(&declaration_with_ready(
            r#"{ "type": "port", "match": "8765" }"#,
        ))
        .unwrap_err();

        assert_eq!(
            error,
            "fw-app.service.ready.type 不支持: port（本版本仅支持 log）"
        );
    }

    #[test]
    fn rejects_blank_ready_match() {
        let error = parse_service_declaration(&declaration_with_ready(
            r#"{ "type": "log", "match": "  " }"#,
        ))
        .unwrap_err();

        assert_eq!(error, "fw-app.service.ready.match 不能为空");
    }

    #[test]
    fn rejects_unsupported_stop_type() {
        let error = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.exe" },
                "ready": { "type": "log", "match": "ready" },
                "stop": { "type": "kill" }
            }"#,
        )
        .unwrap_err();

        assert_eq!(
            error,
            "fw-app.service.stop.type 不支持: kill（本版本仅支持 terminate）"
        );
    }

    #[test]
    fn rejects_unsafe_executable_paths() {
        for executable in ["../eucli-box.exe", "./eucli-box.exe", "C:/eucli-box.exe"] {
            let error = parse_service_declaration(&format!(
                r#"{{
                    "start": {{ "executable": "{executable}" }},
                    "ready": {{ "type": "log", "match": "ready" }},
                    "stop": {{ "type": "terminate" }}
                }}"#
            ))
            .unwrap_err();
            assert!(
                error.starts_with("fw-app.service.start.executable 不合法"),
                "{error}"
            );
        }
    }

    #[test]
    fn rejects_non_exe_executable() {
        let error = parse_service_declaration(
            r#"{
                "start": { "executable": "eucli-box.bat" },
                "ready": { "type": "log", "match": "ready" },
                "stop": { "type": "terminate" }
            }"#,
        )
        .unwrap_err();

        assert_eq!(error, "fw-app.service.start.executable 必须指向 .exe 文件");
    }

    #[test]
    fn rejects_invalid_environment_variable_names() {
        let error = parse_service_declaration(
            r#"{
                "start": {
                    "executable": "eucli-box.exe",
                    "environment": { "EUCLI=BOX": "1" }
                },
                "ready": { "type": "log", "match": "ready" },
                "stop": { "type": "terminate" }
            }"#,
        )
        .unwrap_err();

        assert_eq!(
            error,
            "fw-app.service.start.environment 变量名不合法: EUCLI=BOX"
        );
    }

    #[test]
    fn matches_ready_log_line() {
        let declaration = parse_service_declaration(sample_declaration()).expect("声明应可解析");

        assert!(is_ready_line(
            "eucli-box v0.1.2 is ready — listening on http://127.0.0.1:8765",
            &declaration.ready_match
        ));
        assert!(!is_ready_line(
            "eucli-box v0.1.2 starting",
            &declaration.ready_match
        ));
    }

    #[test]
    fn rejects_invalid_declaration_json() {
        let error = parse_service_declaration("not-json").unwrap_err();

        assert!(error.starts_with("服务声明文件解析失败"), "{error}");
    }
}
