use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::app_lifecycle::manager::{
    app_stop_with_mode, AppLifecycleManager, AppStopMethod, AppStopMode,
};

pub(crate) mod command;
pub(crate) mod target;

use target::{AppCandidate, AppCatalogEntry, TargetResolution};

/// 宿主可对外调度的应用动作。
///
/// 新增动作只在这里加一个变体，入口层无需改动：
/// 动作语义集中在一处，窗口、HTTP、后续的其它入口共用同一份定义。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HostAppAction {
    Stop,
    ForceStop,
}

impl HostAppAction {
    fn stop_mode(self) -> AppStopMode {
        match self {
            Self::Stop => AppStopMode::Graceful,
            Self::ForceStop => AppStopMode::Force,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum HostActionTarget {
    App(String),
    AllRunning,
}

/// `--all` 是保留目标：只有它表示批量，其余一律按应用名解析。
impl HostActionTarget {
    pub(crate) fn from_raw(raw: &str) -> Self {
        if raw.trim() == "--all" {
            Self::AllRunning
        } else {
            Self::App(raw.trim().to_string())
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostActionRequest {
    pub(crate) action: HostAppAction,
    pub(crate) target: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub(crate) enum HostAppOutcome {
    Stopped { method: AppStopMethod },
    Failed { message: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostActionResult {
    pub(crate) app_id: String,
    pub(crate) name: String,
    pub(crate) duration_ms: u64,
    #[serde(flatten)]
    pub(crate) outcome: HostAppOutcome,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostActionResponse {
    /// 固定为 true，与错误响应的 `ok: false` 构成同一套成败判定。
    pub(crate) ok: bool,
    pub(crate) action: HostAppAction,
    pub(crate) results: Vec<HostActionResult>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum HostActionErrorCode {
    EmptyCommand,
    UnknownAction,
    MissingTarget,
    TargetNotFound,
    TargetAmbiguous,
    CatalogUnavailable,
    DevProfileRequired,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostActionError {
    /// 固定为 false，让窗口与脚本用同一个字段判定成败。
    pub(crate) ok: bool,
    pub(crate) code: HostActionErrorCode,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) candidates: Vec<AppCandidate>,
}

impl HostActionError {
    pub(crate) fn new(code: HostActionErrorCode, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            code,
            message: message.into(),
            candidates: Vec::new(),
        }
    }
}

/// 读取已注册应用，转成调度视角的精简条目。
pub(crate) fn list_catalog(app: &AppHandle) -> Result<Vec<AppCatalogEntry>, HostActionError> {
    let records = crate::app_registry::load_registered_app_records(app).map_err(|error| {
        HostActionError::new(
            HostActionErrorCode::CatalogUnavailable,
            format!("读取应用注册表失败: {error}"),
        )
    })?;

    Ok(records.iter().filter_map(catalog_entry).collect())
}

fn catalog_entry(record: &Value) -> Option<AppCatalogEntry> {
    let id = record.get("id")?.as_str()?.trim();
    if id.is_empty() {
        return None;
    }
    let name = record
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(id);

    Some(AppCatalogEntry {
        id: id.to_string(),
        name: name.to_string(),
    })
}

/// 唯一调度入口：解析目标、逐个执行、如实回传每个目标的结局。
///
/// 单个目标解析失败属于请求级错误，直接拒绝；
/// 目标确定之后，执行过程中单个应用出错只记在那一条结果里，
/// 批量操作不会因为一个应用失败就掩盖其它应用的结局。
pub(crate) async fn dispatch(
    app: &AppHandle,
    manager: &Arc<AppLifecycleManager>,
    action: HostAppAction,
    target: HostActionTarget,
) -> Result<HostActionResponse, HostActionError> {
    let catalog = list_catalog(app)?;
    let targets = resolve_targets(manager, &catalog, target)?;

    let mode = action.stop_mode();
    let mut results = Vec::with_capacity(targets.len());
    for entry in targets {
        let started = Instant::now();
        let outcome = match app_stop_with_mode(manager, entry.id.clone(), mode).await {
            Ok(result) => HostAppOutcome::Stopped {
                method: result.method,
            },
            Err(message) => HostAppOutcome::Failed { message },
        };
        results.push(HostActionResult {
            app_id: entry.id,
            name: entry.name,
            duration_ms: started.elapsed().as_millis() as u64,
            outcome,
        });
    }

    Ok(HostActionResponse {
        ok: true,
        action,
        results,
    })
}

fn resolve_targets(
    manager: &Arc<AppLifecycleManager>,
    catalog: &[AppCatalogEntry],
    target: HostActionTarget,
) -> Result<Vec<AppCatalogEntry>, HostActionError> {
    match target {
        HostActionTarget::AllRunning => {
            let running: HashSet<String> = manager.running_app_ids().into_iter().collect();
            Ok(catalog
                .iter()
                .filter(|entry| running.contains(&entry.id))
                .cloned()
                .collect())
        }
        HostActionTarget::App(raw) => match target::resolve_app_target(&raw, catalog) {
            TargetResolution::Unique(entry) => Ok(vec![entry]),
            TargetResolution::Ambiguous(candidates) => {
                let names = candidates
                    .iter()
                    .map(|candidate| candidate.name.as_str())
                    .collect::<Vec<_>>()
                    .join("、");
                Err(HostActionError {
                    ok: false,
                    code: HostActionErrorCode::TargetAmbiguous,
                    message: format!("「{raw}」匹配到多个应用：{names}"),
                    candidates,
                })
            }
            TargetResolution::NotFound => Err(HostActionError::new(
                HostActionErrorCode::TargetNotFound,
                format!("找不到应用「{raw}」"),
            )),
        },
    }
}

#[tauri::command]
pub(crate) async fn host_action_run_command(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppLifecycleManager>>,
    command: String,
) -> Result<HostActionResponse, HostActionError> {
    crate::dev_profile::ensure_dev_profile().map_err(|message| {
        HostActionError::new(HostActionErrorCode::DevProfileRequired, message)
    })?;

    let parsed = command::parse_command(&command)?;
    let manager = state.inner().clone();
    dispatch(&app, &manager, parsed.action, parsed.target).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_is_the_only_reserved_target() {
        assert_eq!(HostActionTarget::from_raw("--all"), HostActionTarget::AllRunning);
        assert_eq!(
            HostActionTarget::from_raw("all"),
            HostActionTarget::App("all".to_string())
        );
        assert_eq!(
            HostActionTarget::from_raw("  venera  "),
            HostActionTarget::App("venera".to_string())
        );
    }

    #[test]
    fn catalog_entry_requires_id_and_falls_back_to_id_as_name() {
        assert!(catalog_entry(&serde_json::json!({ "name": "No Id" })).is_none());
        assert!(catalog_entry(&serde_json::json!({ "id": "   " })).is_none());

        let entry = catalog_entry(&serde_json::json!({ "id": "venera" })).expect("entry");
        assert_eq!(entry.id, "venera");
        assert_eq!(entry.name, "venera");
    }

    #[test]
    fn action_serializes_to_camel_case() {
        assert_eq!(
            serde_json::to_string(&HostAppAction::ForceStop).unwrap(),
            "\"forceStop\""
        );
    }

    #[test]
    fn error_code_serializes_to_screaming_snake_case() {
        assert_eq!(
            serde_json::to_string(&HostActionErrorCode::TargetNotFound).unwrap(),
            "\"TARGET_NOT_FOUND\""
        );
    }

    #[test]
    fn result_flattens_outcome_into_a_single_object() {
        let result = HostActionResult {
            app_id: "venera".to_string(),
            name: "Venera".to_string(),
            duration_ms: 12,
            outcome: HostAppOutcome::Stopped {
                method: AppStopMethod::Graceful,
            },
        };

        let value = serde_json::to_value(result).expect("serialize result");
        assert_eq!(value["appId"], "venera");
        assert_eq!(value["state"], "stopped");
        assert_eq!(value["method"], "graceful");
        assert!(value.get("outcome").is_none());
    }

    #[test]
    fn failed_outcome_carries_message() {
        let result = HostActionResult {
            app_id: "venera".to_string(),
            name: "Venera".to_string(),
            duration_ms: 5,
            outcome: HostAppOutcome::Failed {
                message: "结束进程失败".to_string(),
            },
        };

        let value = serde_json::to_value(result).expect("serialize result");
        assert_eq!(value["state"], "failed");
        assert_eq!(value["message"], "结束进程失败");
    }
}
