use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::app_lifecycle::manager::{
    app_status_inner, app_stop_with_mode, AppRuntimePhase, AppStopMethod, AppStopMode,
};
use crate::app_lifecycle::{
    app_launch_inner_with_cold_start_policy_and_options, build_registered_app_launch_args,
    AppColdStartPolicy, AppLaunchOptions, AppLaunchOutcome, AppLifecycleManager,
    RegisteredAppLaunchConfig,
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
    Start,
    Restart,
    /// 查状态；不带目标时等价于看全部。
    Status,
    /// 看全部注册应用的清单与运行态。
    List,
    Folder,
    Info,
}

impl HostAppAction {
    /// `--all` 的含义随动作变化：停止类针对运行中的，启动针对未运行的，查询针对全部。
    fn matches_all_target(self, running: bool) -> bool {
        match self {
            Self::Stop | Self::ForceStop | Self::Restart => running,
            Self::Start => !running,
            Self::Status | Self::List | Self::Folder | Self::Info => true,
        }
    }

    fn permits_all_target(self) -> bool {
        // list 本身就是「看全部」，命令解析层已拒绝用户写 list <目标>。
        !matches!(self, Self::Folder)
    }

    fn stop_mode(self) -> Option<AppStopMode> {
        match self {
            Self::Stop => Some(AppStopMode::Graceful),
            Self::ForceStop => Some(AppStopMode::Force),
            _ => None,
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Stop => "stop",
            Self::ForceStop => "kill",
            Self::Start => "start",
            Self::Restart => "restart",
            Self::Status => "status",
            Self::List => "list",
            Self::Folder => "folder",
            Self::Info => "info",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum HostActionTarget {
    App(String),
    All,
}

/// `--all` 是保留目标：只有它表示批量，其余一律按应用名解析。
impl HostActionTarget {
    pub(crate) fn from_raw(raw: &str) -> Self {
        if raw.trim() == "--all" {
            Self::All
        } else {
            Self::App(raw.trim().to_string())
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostActionRequest {
    pub(crate) action: HostAppAction,
    #[serde(default)]
    pub(crate) target: String,
}

impl HostActionRequest {
    /// 结构化入口的目标解析：只有查询类动作允许省略目标。
    pub(crate) fn resolve_target(&self) -> Result<HostActionTarget, HostActionError> {
        let raw = self.target.trim();
        if raw.is_empty() {
            return match self.action {
                HostAppAction::Status | HostAppAction::List => Ok(HostActionTarget::All),
                _ => Err(HostActionError::new(
                    HostActionErrorCode::MissingTarget,
                    format!("{} 需要目标，例如 {} venera", self.action.label(), self.action.label()),
                )),
            };
        }
        Ok(HostActionTarget::from_raw(raw))
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum HostAppOutcome {
    Stopped {
        method: AppStopMethod,
    },
    Started {
        launch: AppLaunchOutcome,
    },
    Restarted {
        method: AppStopMethod,
    },
    Status {
        running: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        pid: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        phase: Option<AppRuntimePhase>,
        #[serde(skip_serializing_if = "Option::is_none")]
        started_at: Option<u64>,
    },
    Folder {
        path: String,
    },
    Info {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        app_kind: Option<String>,
    },
    Failed {
        message: String,
    },
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
    InvalidCommand,
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
    let targets = resolve_targets(action, manager, &catalog, target)?;

    let mut results = Vec::with_capacity(targets.len());
    for entry in targets {
        let started = Instant::now();
        let outcome = execute(app, manager, action, &entry).await;
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

async fn execute(
    app: &AppHandle,
    manager: &Arc<AppLifecycleManager>,
    action: HostAppAction,
    entry: &AppCatalogEntry,
) -> HostAppOutcome {
    let result = match action {
        HostAppAction::Stop | HostAppAction::ForceStop => stop_app(manager, action, &entry.id).await,
        HostAppAction::Start => start_app(app, manager, &entry.id).await,
        HostAppAction::Restart => restart_app(app, manager, &entry.id).await,
        HostAppAction::Status | HostAppAction::List => status_app(manager, &entry.id),
        HostAppAction::Folder => open_folder(app, &entry.id),
        HostAppAction::Info => read_info(app, &entry.id),
    };

    result.unwrap_or_else(|message| HostAppOutcome::Failed { message })
}

async fn stop_app(
    manager: &Arc<AppLifecycleManager>,
    action: HostAppAction,
    app_id: &str,
) -> Result<HostAppOutcome, String> {
    let mode = action
        .stop_mode()
        .ok_or_else(|| "该动作不支持停止".to_string())?;
    let result = app_stop_with_mode(manager, app_id.to_string(), mode).await?;
    Ok(HostAppOutcome::Stopped {
        method: result.method,
    })
}

async fn start_app(
    app: &AppHandle,
    manager: &Arc<AppLifecycleManager>,
    app_id: &str,
) -> Result<HostAppOutcome, String> {
    let config = launch_config(app, app_id)?;
    let launch = launch_registered_app(app, manager, config).await?;
    Ok(HostAppOutcome::Started { launch })
}

async fn restart_app(
    app: &AppHandle,
    manager: &Arc<AppLifecycleManager>,
    app_id: &str,
) -> Result<HostAppOutcome, String> {
    let stop = app_stop_with_mode(manager, app_id.to_string(), AppStopMode::Graceful).await?;
    let config = launch_config(app, app_id)?;
    launch_registered_app(app, manager, config).await?;
    Ok(HostAppOutcome::Restarted {
        method: stop.method,
    })
}

async fn launch_registered_app(
    app: &AppHandle,
    manager: &Arc<AppLifecycleManager>,
    config: RegisteredAppLaunchConfig,
) -> Result<AppLaunchOutcome, String> {
    let args = build_registered_app_launch_args(&config, "show", None);
    let options = AppLaunchOptions {
        extra_envs: crate::app_capabilities::app_capability_env_vars(),
    };

    app_launch_inner_with_cold_start_policy_and_options(
        app.clone(),
        manager.clone(),
        config.id,
        config.path,
        args,
        AppColdStartPolicy::Allow,
        options,
    )
    .await
}

fn status_app(
    manager: &Arc<AppLifecycleManager>,
    app_id: &str,
) -> Result<HostAppOutcome, String> {
    let status = app_status_inner(manager, app_id)?;
    Ok(HostAppOutcome::Status {
        running: status.running,
        pid: status.pid,
        phase: status.phase,
        started_at: status.started_at,
    })
}

fn open_folder(app: &AppHandle, app_id: &str) -> Result<HostAppOutcome, String> {
    let path = registered_app_path(app, app_id)?;
    let dir = Path::new(&path)
        .parent()
        .ok_or_else(|| "应用路径没有上级目录".to_string())?;
    crate::workspace::open_absolute_existing_dir(dir)?;
    Ok(HostAppOutcome::Folder {
        path: dir.to_string_lossy().to_string(),
    })
}

fn read_info(app: &AppHandle, app_id: &str) -> Result<HostAppOutcome, String> {
    let record = load_record(app, app_id)?;
    Ok(HostAppOutcome::Info {
        path: record_field(&record, "path")?,
        version: optional_field(&record, "version"),
        app_kind: optional_field(&record, "appKind"),
    })
}

fn launch_config(
    app: &AppHandle,
    app_id: &str,
) -> Result<RegisteredAppLaunchConfig, String> {
    let record = load_record(app, app_id)?;
    serde_json::from_value(record).map_err(|error| format!("解析启动配置失败: {error}"))
}

fn registered_app_path(app: &AppHandle, app_id: &str) -> Result<String, String> {
    record_field(&load_record(app, app_id)?, "path")
}

fn load_record(app: &AppHandle, app_id: &str) -> Result<Value, String> {
    crate::app_registry::load_registered_app_record(app, app_id)?
        .ok_or_else(|| format!("注册记录不存在：{app_id}"))
}

fn record_field(record: &Value, key: &str) -> Result<String, String> {
    record
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("注册记录缺少 {key}"))
}

fn optional_field(record: &Value, key: &str) -> Option<String> {
    record
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn resolve_targets(
    action: HostAppAction,
    manager: &Arc<AppLifecycleManager>,
    catalog: &[AppCatalogEntry],
    target: HostActionTarget,
) -> Result<Vec<AppCatalogEntry>, HostActionError> {
    match target {
        HostActionTarget::All => {
            if !action.permits_all_target() {
                return Err(HostActionError::new(
                    HostActionErrorCode::InvalidCommand,
                    format!("{} 不支持 --all", action.label()),
                ));
            }
            let running: HashSet<String> = manager.running_app_ids().into_iter().collect();
            Ok(catalog
                .iter()
                .filter(|entry| action.matches_all_target(running.contains(&entry.id)))
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
        assert_eq!(HostActionTarget::from_raw("--all"), HostActionTarget::All);
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
        assert_eq!(
            serde_json::to_string(&HostAppAction::Info).unwrap(),
            "\"info\""
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

    #[test]
    fn all_target_semantics_depend_on_action() {
        assert!(HostAppAction::Stop.matches_all_target(true));
        assert!(!HostAppAction::Stop.matches_all_target(false));
        assert!(HostAppAction::Start.matches_all_target(false));
        assert!(!HostAppAction::Start.matches_all_target(true));
        assert!(HostAppAction::List.matches_all_target(false));
        assert!(!HostAppAction::Folder.permits_all_target());
        assert!(HostAppAction::List.permits_all_target());
        assert!(HostAppAction::Info.permits_all_target());
    }

    #[test]
    fn status_outcome_serializes_with_state_and_optional_fields() {
        let outcome = HostAppOutcome::Status {
            running: true,
            pid: Some(42),
            phase: None,
            started_at: Some(1_700_000_000_000),
        };
        let value = serde_json::to_value(outcome).expect("serialize outcome");
        assert_eq!(value["state"], "status");
        assert_eq!(value["running"], true);
        assert_eq!(value["pid"], 42);
        assert_eq!(value["startedAt"], 1_700_000_000_000_i64);
        assert!(value.get("phase").is_none());
    }

    #[test]
    fn info_outcome_uses_camel_case_fields() {
        let outcome = HostAppOutcome::Info {
            path: "C:/apps/demo/demo.exe".to_string(),
            version: Some("1.2.3".to_string()),
            app_kind: Some("desktop-app".to_string()),
        };
        let value = serde_json::to_value(outcome).expect("serialize outcome");
        assert_eq!(value["state"], "info");
        assert_eq!(value["appKind"], "desktop-app");
        assert!(value.get("app_kind").is_none());
    }
}
