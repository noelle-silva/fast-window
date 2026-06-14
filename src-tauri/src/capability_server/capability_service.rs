use std::sync::Arc;

use serde_json::{Map, Value};
use tauri::AppHandle;

use super::CapabilityHttpResponse;
use crate::app_capabilities::{
    app_capability_invoke_inner, app_capability_query_options_inner, AppCapabilityInvokeRequest,
    AppCapabilityOptionsRequest,
};
use crate::app_lifecycle::manager::AppLifecycleManager;

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
            ("GET", "/capabilities") => self.handle_capabilities(),
            ("POST", "/capability/invoke") => self.handle_capability_invoke(body),
            ("POST", "/capability/query-options") => self.handle_capability_query_options(body),
            ("GET" | "POST", _) => CapabilityHttpResponse::error(404, "能力HTTP入口不存在"),
            _ => CapabilityHttpResponse::error(405, "能力HTTP入口不支持该请求方法"),
        }
    }

    fn handle_capabilities(&self) -> CapabilityHttpResponse {
        match capability_list(&self.app) {
            Ok(capabilities) => CapabilityHttpResponse::json(
                200,
                serde_json::json!({ "capabilities": capabilities }),
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

fn capability_list(app: &AppHandle) -> Result<Vec<Value>, String> {
    let records = crate::app_registry::load_registered_app_records(app)?;
    let mut capabilities = Vec::new();
    for record in records {
        let Some(app_id) = record.get("id").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        if app_id.is_empty() {
            continue;
        }
        let Some(commands) = record.get("availableCommands").and_then(Value::as_array) else {
            continue;
        };
        let app_launch = app_launch_value(&record);
        let app_name = app_display_name(&record);
        for command in commands {
            let Some(command_id) = command.get("id").and_then(Value::as_str).map(str::trim) else {
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
            copy_command_field(&mut item, command, "title");
            copy_command_field(&mut item, command, "icon");
            copy_command_field(&mut item, command, "hotkey");
            copy_command_field(&mut item, command, "description");
            copy_command_field(&mut item, command, "configFields");
            capabilities.push(Value::Object(item));
        }
    }
    Ok(capabilities)
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
