use std::sync::Arc;

use serde_json::{Map, Value};
use tauri::AppHandle;

use super::CapabilityHttpResponse;
use crate::app_capabilities::{
    app_capability_invoke_inner, app_capability_query_options_inner, describe_app_capabilities,
    AppCapabilityInvokeRequest, AppCapabilityLaunchPolicy, AppCapabilityOptionsRequest,
};
use crate::app_lifecycle::manager::{
    AppLaunchOptions, AppLifecycleManager, RegisteredAppLaunchConfig,
};

pub(super) struct CapabilityService {
    app: AppHandle,
    lifecycle: Arc<AppLifecycleManager>,
}

impl CapabilityService {
    pub(super) fn new(app: AppHandle, lifecycle: Arc<AppLifecycleManager>) -> Self {
        Self { app, lifecycle }
    }

    pub(super) fn handle_request(
        &self,
        method: &str,
        path: &str,
        body: &[u8],
    ) -> CapabilityHttpResponse {
        let route = path.split('?').next().unwrap_or_default();
        match (method, route) {
            ("GET", "/capabilities") => self.handle_capabilities(path),
            ("POST", "/capability/invoke") => self.handle_capability_invoke(body),
            ("POST", "/capability/query-options") => self.handle_capability_query_options(body),
            ("GET" | "POST", _) => CapabilityHttpResponse::error(404, "能力HTTP入口不存在"),
            _ => CapabilityHttpResponse::error(405, "能力HTTP入口不支持该请求方法"),
        }
    }

    fn handle_capabilities(&self, path: &str) -> CapabilityHttpResponse {
        let query = match CapabilityListQuery::from_path(path) {
            Ok(query) => query,
            Err(error) => return CapabilityHttpResponse::error(400, error),
        };
        match tauri::async_runtime::block_on(capability_list(
            self.app.clone(),
            self.lifecycle.clone(),
            query,
        )) {
            Ok((capabilities, errors)) => CapabilityHttpResponse::json(
                200,
                serde_json::json!({ "capabilities": capabilities, "errors": errors }),
            ),
            Err(error) => CapabilityHttpResponse::error(500, error),
        }
    }

    fn handle_capability_invoke(&self, body: &[u8]) -> CapabilityHttpResponse {
        let request = match serde_json::from_slice::<AppCapabilityInvokeRequest>(body) {
            Ok(request) => request,
            Err(error) => {
                return CapabilityHttpResponse::error(
                    400,
                    format!("能力调用请求解析失败: {error}"),
                );
            }
        };

        match tauri::async_runtime::block_on(app_capability_invoke_inner(
            self.app.clone(),
            self.lifecycle.clone(),
            request,
        )) {
            Ok(response) => CapabilityHttpResponse::serialized(200, response),
            Err(error) => CapabilityHttpResponse::error(400, error),
        }
    }

    fn handle_capability_query_options(&self, body: &[u8]) -> CapabilityHttpResponse {
        let request = match serde_json::from_slice::<AppCapabilityOptionsRequest>(body) {
            Ok(request) => request,
            Err(error) => {
                return CapabilityHttpResponse::error(
                    400,
                    format!("选项查询请求解析失败: {error}"),
                );
            }
        };

        match tauri::async_runtime::block_on(app_capability_query_options_inner(
            self.app.clone(),
            self.lifecycle.clone(),
            request,
        )) {
            Ok(response) => CapabilityHttpResponse::serialized(200, response),
            Err(error) => CapabilityHttpResponse::error(400, error),
        }
    }
}

async fn capability_list(
    app: AppHandle,
    lifecycle: Arc<AppLifecycleManager>,
    query: CapabilityListQuery,
) -> Result<(Vec<Value>, Vec<Value>), String> {
    let records = crate::app_registry::load_registered_app_records(&app)?;
    let mut capability_items = Vec::new();
    let mut errors = Vec::new();
    for record in records {
        let Some(app_id) = record.get("id").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        if app_id.is_empty() {
            continue;
        }
        if let Some(target_app_id) = query.app_id.as_deref() {
            if target_app_id != app_id {
                continue;
            }
        }
        let app_name = app_display_name(&record);
        let app_launch = app_launch_value(&record);
        let app_config =
            match serde_json::from_value::<RegisteredAppLaunchConfig>(app_launch.clone()) {
                Ok(app_config) => app_config,
                Err(error) => {
                    errors.push(serde_json::json!({
                        "appId": app_id,
                        "appName": app_name,
                        "message": format!("应用启动信息不完整: {error}"),
                        "canLaunch": false,
                    }));
                    continue;
                }
            };
        let runtime_capabilities = match describe_app_capabilities(
            app.clone(),
            lifecycle.clone(),
            &app_config,
            AppLaunchOptions::default(),
            query.launch_policy,
        )
        .await
        {
            Ok(capabilities) => capabilities,
            Err(error) => {
                errors.push(serde_json::json!({
                    "appId": app_id,
                    "appName": app_name,
                    "message": error,
                    "canLaunch": true,
                }));
                continue;
            }
        };
        for capability in runtime_capabilities {
            let capability = serde_json::to_value(capability)
                .map_err(|e| format!("序列化应用能力清单失败: {e}"))?;
            let Some(command_id) = capability.get("id").and_then(Value::as_str).map(str::trim)
            else {
                continue;
            };
            if command_id.is_empty() {
                continue;
            }
            let mut item = Map::new();
            item.insert("app".to_string(), app_launch.clone());
            item.insert("appId".to_string(), Value::String(app_id.to_string()));
            if let Some(name) = app_name.clone() {
                item.insert("appName".to_string(), Value::String(name));
            }
            item.insert(
                "capabilityId".to_string(),
                Value::String(command_id.to_string()),
            );
            copy_command_field(&mut item, &capability, "title");
            copy_command_field(&mut item, &capability, "icon");
            copy_command_field(&mut item, &capability, "hotkey");
            copy_command_field(&mut item, &capability, "description");
            copy_command_field(&mut item, &capability, "configFields");
            capability_items.push(Value::Object(item));
        }
    }
    Ok((capability_items, errors))
}

struct CapabilityListQuery {
    app_id: Option<String>,
    launch_policy: AppCapabilityLaunchPolicy,
}

impl CapabilityListQuery {
    fn from_path(path: &str) -> Result<Self, String> {
        let query = path
            .split_once('?')
            .map(|(_, query)| query)
            .unwrap_or_default();
        let mut app_id = None;
        let mut launch_policy = AppCapabilityLaunchPolicy::RunningOnly;

        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            match key.as_ref() {
                "appId" => {
                    let value = value.trim().to_string();
                    if !value.is_empty() {
                        if !crate::is_safe_id(&value) {
                            return Err("appId 不合法".to_string());
                        }
                        app_id = Some(value);
                    }
                }
                "launchPolicy" => {
                    launch_policy = match value.as_ref() {
                        "" | "runningOnly" => AppCapabilityLaunchPolicy::RunningOnly,
                        "allowLaunch" => AppCapabilityLaunchPolicy::AllowLaunch,
                        _ => return Err("launchPolicy 不合法".to_string()),
                    };
                }
                _ => {}
            }
        }

        Ok(Self {
            app_id,
            launch_policy,
        })
    }
}

fn app_launch_value(record: &Value) -> Value {
    let mut app = Map::new();
    copy_app_field(&mut app, record, "id");
    copy_app_field(&mut app, record, "path");
    copy_app_field(&mut app, record, "displayMode");
    copy_app_field(&mut app, record, "windowWidth");
    copy_app_field(&mut app, record, "windowHeight");
    copy_app_field(&mut app, record, "windowX");
    copy_app_field(&mut app, record, "windowY");
    copy_app_field(&mut app, record, "autoStart");
    Value::Object(app)
}

fn app_display_name(record: &Value) -> Option<String> {
    ["name", "title", "displayName"]
        .into_iter()
        .find_map(|key| record.get(key).and_then(Value::as_str).map(str::trim))
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

fn copy_app_field(target: &mut Map<String, Value>, source: &Value, key: &str) {
    if let Some(value) = source.get(key) {
        target.insert(key.to_string(), value.clone());
    }
}

fn copy_command_field(target: &mut Map<String, Value>, source: &Value, key: &str) {
    if let Some(value) = source.get(key) {
        target.insert(key.to_string(), value.clone());
    }
}
