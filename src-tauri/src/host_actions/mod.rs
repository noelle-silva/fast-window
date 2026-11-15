use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::app_capabilities::{describe_app_capabilities, AppCapabilityLaunchPolicy};
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

/// `env` 讲的是宿主自己而不是某个应用：
/// 结果里需要一个固定身份，让窗口能把这类「宿主级事实」与按应用的结果区分开。
const HOST_SCOPE_ID: &str = "host";
const HOST_SCOPE_NAME: &str = "宿主环境";

/// 变量名里出现这个片段即视为机密：能力服务 token 绝不能原样出现在窗口或脚本响应里。
const SECRET_NAME_MARKER: &str = "TOKEN";
/// 保留的前缀长度：足够认出「还是同一个 token」，又不足以拿去用。
const SECRET_PREFIX_CHARS: usize = 12;
const SECRET_MASK: &str = "…";

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
    /// 读取某个应用当前声明的能力 API；只问运行中的应用，不替用户启动。
    Capability,
    /// 看宿主注入的能力服务环境变量；与任何应用目标无关。
    Env,
}

impl HostAppAction {
    /// `--all` 的含义随动作变化：停止类针对运行中的，启动针对未运行的，查询针对全部。
    fn matches_all_target(self, running: bool) -> bool {
        match self {
            Self::Stop | Self::ForceStop | Self::Restart => running,
            Self::Start => !running,
            Self::Status | Self::List | Self::Folder | Self::Info => true,
            // capability 拒绝批量，env 完全忽略目标：两者都不存在「有哪些应用符合」这回事。
            Self::Capability | Self::Env => false,
        }
    }

    fn permits_all_target(self) -> bool {
        // list 本身就是「看全部」，命令解析层已拒绝用户写 list <目标>；
        // folder / capability 问的永远是「哪一个应用」，批量没有语义。
        !matches!(self, Self::Folder | Self::Capability)
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
            Self::Capability => "capability",
            Self::Env => "env",
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
                // env 与目标无关，省略是常态；给它一个 All 只是因为这一层需要一个值，
                // 真正的语义由 dispatcher 的早返回分支负责。
                HostAppAction::Status | HostAppAction::List | HostAppAction::Env => {
                    Ok(HostActionTarget::All)
                }
                _ => Err(HostActionError::new(
                    HostActionErrorCode::MissingTarget,
                    format!("{} 需要目标，例如 {} venera", self.action.label(), self.action.label()),
                )),
            };
        }
        Ok(HostActionTarget::from_raw(raw))
    }
}

/// 一条宿主注入的环境变量：脱敏后的值可以直接展示给人和脚本。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostEnvVar {
    pub(crate) name: String,
    pub(crate) value: String,
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
    Capability {
        items: Vec<crate::app_registry::AppRuntimeDeclaration>,
    },
    Env {
        vars: Vec<HostEnvVar>,
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
    // env 描述的是宿主自身，没有目标语义：
    // 提前结算，既不读应用清单，也不让用户写下的目标影响结果。
    if action == HostAppAction::Env {
        return Ok(HostActionResponse {
            ok: true,
            action,
            results: vec![host_env_result()],
        });
    }

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
        HostAppAction::Capability => read_capabilities(app, manager, &entry.id).await,
        // env 已在 dispatch 里结算，永远不会带着目标走到这里。
        HostAppAction::Env => unreachable!("env 由 dispatch 提前结算，不进入单目标执行"),
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

/// 读取应用运行时的能力声明。
///
/// 只问运行中的应用：能力清单回答的是「此刻真的能调什么」，
/// 为了一次查询自动拉起应用会让「看一眼」变成有副作用的操作。
async fn read_capabilities(
    app: &AppHandle,
    manager: &Arc<AppLifecycleManager>,
    app_id: &str,
) -> Result<HostAppOutcome, String> {
    let config = launch_config(app, app_id)?;
    let items = describe_app_capabilities(
        app.clone(),
        manager.clone(),
        &config,
        AppLaunchOptions::default(),
        AppCapabilityLaunchPolicy::RunningOnly,
    )
    .await?;
    Ok(HostAppOutcome::Capability { items })
}

/// 宿主环境只有一份，所以 env 的结果恒为单条。
fn host_env_result() -> HostActionResult {
    let started = Instant::now();
    let vars = host_env_vars();
    HostActionResult {
        app_id: HOST_SCOPE_ID.to_string(),
        name: HOST_SCOPE_NAME.to_string(),
        duration_ms: started.elapsed().as_millis() as u64,
        outcome: HostAppOutcome::Env { vars },
    }
}

/// 能力服务尚未启动时宿主不注入任何变量，空列表本身就是答案，无需报错。
fn host_env_vars() -> Vec<HostEnvVar> {
    crate::app_capabilities::app_capability_env_vars()
        .into_iter()
        .map(|(name, value)| HostEnvVar {
            value: mask_secret_value(&name, &value),
            name,
        })
        .collect()
}

/// 按变量名判定是否需要脱敏：同一个变量名走到哪里都是机密，值本身不必猜。
fn mask_secret_value(name: &str, value: &str) -> String {
    if !name.contains(SECRET_NAME_MARKER) {
        return value.to_string();
    }
    if value.chars().count() < SECRET_PREFIX_CHARS {
        return SECRET_MASK.to_string();
    }
    let head: String = value.chars().take(SECRET_PREFIX_CHARS).collect();
    format!("{head}{SECRET_MASK}")
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
        // 这两个词会被前端联合类型原样消费，必须与窗口里敲的动作词一致。
        assert_eq!(
            serde_json::to_string(&HostAppAction::Capability).unwrap(),
            "\"capability\""
        );
        assert_eq!(
            serde_json::to_string(&HostAppAction::Env).unwrap(),
            "\"env\""
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
        // 能力的答案是「这一个应用声明了什么」，批量问没有意义。
        assert!(!HostAppAction::Capability.permits_all_target());
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

    #[test]
    fn capability_outcome_serializes_items_as_array() {
        let outcome = HostAppOutcome::Capability {
            items: vec![crate::app_registry::AppRuntimeDeclaration {
                id: "overseer.capability.search".to_string(),
                title: "搜索".to_string(),
                kind: Some("capability".to_string()),
                icon: None,
                hotkey: None,
                description: Some("在当前空间里搜索".to_string()),
                config_fields: Vec::new(),
            }],
        };

        let value = serde_json::to_value(outcome).expect("serialize outcome");
        assert_eq!(value["state"], "capability");
        let items = value["items"].as_array().expect("items 必须是数组");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["id"], "overseer.capability.search");
        assert_eq!(items[0]["title"], "搜索");
        assert_eq!(items[0]["description"], "在当前空间里搜索");
    }

    #[test]
    fn env_outcome_serializes_vars() {
        let outcome = HostAppOutcome::Env {
            vars: vec![HostEnvVar {
                name: "FW_HOST_CAPABILITY_URL".to_string(),
                value: "http://127.0.0.1:54321".to_string(),
            }],
        };

        let value = serde_json::to_value(outcome).expect("serialize outcome");
        assert_eq!(value["state"], "env");
        assert_eq!(value["vars"][0]["name"], "FW_HOST_CAPABILITY_URL");
        assert_eq!(value["vars"][0]["value"], "http://127.0.0.1:54321");
    }

    #[test]
    fn masks_secret_values_by_variable_name() {
        assert_eq!(
            mask_secret_value("FW_HOST_CAPABILITY_TOKEN", "abcdef0123456789abcd"),
            "abcdef012345…"
        );
        // 不足 12 位时保留前缀等于泄露全部，只能整体打码。
        assert_eq!(mask_secret_value("FW_HOST_CAPABILITY_TOKEN", "short"), "…");
        assert_eq!(
            mask_secret_value("FW_HOST_CAPABILITY_TOKEN", "abcdef012345"),
            "abcdef012345…"
        );
        // 非机密的变量原样展示，脱敏只针对名字带 TOKEN 的。
        assert_eq!(
            mask_secret_value("FW_HOST_CAPABILITY_URL", "http://127.0.0.1:1"),
            "http://127.0.0.1:1"
        );
    }
}
