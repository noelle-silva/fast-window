use std::collections::BTreeMap;
use std::time::Duration;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer};

pub(crate) const DEFAULT_READY_TIMEOUT_SECONDS: u64 = 30;

/// 应用清单内联的 service 段。可执行文件不在这里声明，统一使用 package.windowsExecutable。
#[derive(Clone, Debug)]
pub(crate) struct ServiceDeclaration {
    pub(crate) args: Vec<String>,
    pub(crate) environment: Vec<(String, String)>,
    pub(crate) ready_match: String,
    pub(crate) ready_timeout: Duration,
    /// 停止类型：解析阶段已校验，仅允许 terminate。
    pub(crate) stop_type: String,
}

impl<'de> Deserialize<'de> for ServiceDeclaration {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawServiceDeclaration::deserialize(deserializer)?;
        parse_service_declaration(raw).map_err(D::Error::custom)
    }
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
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawServiceStart {
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

fn parse_service_declaration(raw: RawServiceDeclaration) -> Result<ServiceDeclaration, String> {
    let start = raw.start.unwrap_or_default();
    let ready = raw
        .ready
        .ok_or_else(|| "服务声明缺少 ready 段".to_string())?;
    let stop = raw.stop.ok_or_else(|| "服务声明缺少 stop 段".to_string())?;

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

    Ok(ServiceDeclaration {
        args,
        environment,
        ready_match,
        ready_timeout,
        stop_type,
    })
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
    use super::{is_ready_line, ServiceDeclaration, DEFAULT_READY_TIMEOUT_SECONDS};
    use std::time::Duration;

    fn parse_declaration(text: &str) -> Result<ServiceDeclaration, String> {
        serde_json::from_str(text).map_err(|error| error.to_string())
    }

    fn sample_declaration() -> &'static str {
        r#"{
            "start": {
                "args": []
            },
            "ready": {
                "type": "log",
                "match": "is ready"
            },
            "stop": {
                "type": "terminate"
            }
        }"#
    }

    fn declaration_with_ready(ready: &str) -> String {
        format!(
            r#"{{
                "ready": {ready},
                "stop": {{ "type": "terminate" }}
            }}"#
        )
    }

    #[test]
    fn parses_sample_service_declaration_with_default_timeout() {
        let declaration = parse_declaration(sample_declaration()).expect("声明应可解析");

        assert!(declaration.args.is_empty());
        assert!(declaration.environment.is_empty());
        assert_eq!(declaration.ready_match, "is ready");
        assert_eq!(
            declaration.ready_timeout,
            Duration::from_secs(DEFAULT_READY_TIMEOUT_SECONDS)
        );
        assert_eq!(declaration.stop_type, "terminate");
    }

    #[test]
    fn legacy_connection_section_is_ignored() {
        let declaration = parse_declaration(
            r#"{
                "ready": { "type": "log", "match": "ready" },
                "connection": {
                    "port": { "type": "file", "path": "data/.meta/port.json" }
                },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("声明应可解析");

        assert_eq!(declaration.ready_match, "ready");
    }

    #[test]
    fn missing_start_section_is_allowed() {
        let declaration = parse_declaration(
            r#"{
                "ready": { "type": "log", "match": "is ready" },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("声明应可解析");

        assert!(declaration.args.is_empty());
        assert!(declaration.environment.is_empty());
    }

    #[test]
    fn parses_service_start_args() {
        let declaration = parse_declaration(
            r#"{
                "start": {
                    "args": ["--port", "8765"]
                },
                "ready": { "type": "log", "match": "is ready" },
                "stop": { "type": "terminate" }
            }"#,
        )
        .expect("声明应可解析");

        assert_eq!(declaration.args, vec!["--port", "8765"]);
    }

    #[test]
    fn parses_custom_ready_timeout_seconds() {
        let declaration = parse_declaration(&declaration_with_ready(
            r#"{ "type": "log", "match": "ready", "timeoutSeconds": 5 }"#,
        ))
        .expect("声明应可解析");

        assert_eq!(declaration.ready_timeout, Duration::from_secs(5));
    }

    #[test]
    fn rejects_non_positive_ready_timeout_seconds() {
        for seconds in ["0", "-1"] {
            let error = parse_declaration(&declaration_with_ready(&format!(
                r#"{{ "type": "log", "match": "ready", "timeoutSeconds": {seconds} }}"#
            )))
            .unwrap_err();
            assert!(error.contains("timeoutSeconds 必须为正整数"), "{error}");
        }
    }

    #[test]
    fn rejects_missing_declaration_sections() {
        assert!(
            parse_declaration(r#"{ "stop": { "type": "terminate" } }"#)
                .unwrap_err()
                .starts_with("服务声明缺少 ready 段")
        );
        assert!(
            parse_declaration(r#"{ "ready": { "type": "log", "match": "ready" } }"#)
                .unwrap_err()
                .starts_with("服务声明缺少 stop 段")
        );
    }

    #[test]
    fn rejects_unsupported_ready_type() {
        let error = parse_declaration(&declaration_with_ready(
            r#"{ "type": "port", "match": "8765" }"#,
        ))
        .unwrap_err();

        assert!(
            error.starts_with("fw-app.service.ready.type 不支持: port（本版本仅支持 log）"),
            "{error}"
        );
    }

    #[test]
    fn rejects_blank_ready_match() {
        let error = parse_declaration(&declaration_with_ready(r#"{ "type": "log", "match": "  " }"#))
            .unwrap_err();

        assert!(
            error.starts_with("fw-app.service.ready.match 不能为空"),
            "{error}"
        );
    }

    #[test]
    fn rejects_unsupported_stop_type() {
        let error = parse_declaration(
            r#"{
                "ready": { "type": "log", "match": "ready" },
                "stop": { "type": "kill" }
            }"#,
        )
        .unwrap_err();

        assert!(
            error.starts_with("fw-app.service.stop.type 不支持: kill（本版本仅支持 terminate）"),
            "{error}"
        );
    }

    #[test]
    fn rejects_invalid_environment_variable_names() {
        let error = parse_declaration(
            r#"{
                "start": {
                    "environment": { "EUCLI=BOX": "1" }
                },
                "ready": { "type": "log", "match": "ready" },
                "stop": { "type": "terminate" }
            }"#,
        )
        .unwrap_err();

        assert!(
            error.starts_with("fw-app.service.start.environment 变量名不合法: EUCLI=BOX"),
            "{error}"
        );
    }

    #[test]
    fn matches_ready_log_line() {
        let declaration = parse_declaration(sample_declaration()).expect("声明应可解析");

        assert!(is_ready_line(
            "eucli-box v0.1.2 is ready — listening on http://127.0.0.1:8765",
            &declaration.ready_match
        ));
        assert!(!is_ready_line(
            "eucli-box v0.1.2 starting",
            &declaration.ready_match
        ));
    }
}
