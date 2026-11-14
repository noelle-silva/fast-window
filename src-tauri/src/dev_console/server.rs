use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, OnceLock};
use std::thread;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::app_lifecycle::manager::{app_status_inner, AppLifecycleManager};
use crate::host_actions::{
    self, HostActionErrorCode, HostActionRequest, HostActionTarget,
};
use crate::local_http::{self, LocalHttpRequest};

/// 固定端口：脚本需要一个可写死的地址，因此端口被占用时宁可启动失败也不静默换端口。
pub(crate) const DEV_CONSOLE_PORT: u16 = 47821;
const BIND_ADDR: &str = "127.0.0.1";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevConsoleServerStatus {
    pub(crate) port: u16,
    pub(crate) listening: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

static SERVER_STATUS: OnceLock<DevConsoleServerStatus> = OnceLock::new();

pub(crate) fn status() -> Option<&'static DevConsoleServerStatus> {
    SERVER_STATUS.get()
}

/// 启动本地脚本入口。
///
/// 只在 dev profile 由 setup 调用；正式宿主不监听该端口。
pub(crate) fn start(app: AppHandle, lifecycle: Arc<AppLifecycleManager>) {
    let status = match TcpListener::bind((BIND_ADDR, DEV_CONSOLE_PORT)) {
        Ok(listener) => match thread::Builder::new()
            .name("fw-dev-console-server".to_string())
            .spawn(move || accept_loop(listener, app, lifecycle))
        {
            Ok(_) => DevConsoleServerStatus {
                port: DEV_CONSOLE_PORT,
                listening: true,
                error: None,
            },
            Err(error) => DevConsoleServerStatus {
                port: DEV_CONSOLE_PORT,
                listening: false,
                error: Some(format!("启动 Dev 控制台服务线程失败: {error}")),
            },
        },
        Err(error) => {
            let message = format!("绑定 {BIND_ADDR}:{DEV_CONSOLE_PORT} 失败: {error}");
            eprintln!("[dev-console] {message}");
            DevConsoleServerStatus {
                port: DEV_CONSOLE_PORT,
                listening: false,
                error: Some(message),
            }
        }
    };

    let _ = SERVER_STATUS.set(status);
}

fn accept_loop(listener: TcpListener, app: AppHandle, lifecycle: Arc<AppLifecycleManager>) {
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => handle_connection(stream, &app, &lifecycle),
            Err(error) => {
                eprintln!("[dev-console] connection failed: {error}");
                break;
            }
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    app: &AppHandle,
    lifecycle: &Arc<AppLifecycleManager>,
) {
    let request = match local_http::read_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            local_http::write_json(&mut stream, 400, &error_body("BAD_REQUEST", error));
            return;
        }
    };

    let (status, body) = route(&request, app, lifecycle);
    local_http::write_json(&mut stream, status, &body);
}

fn route(
    request: &LocalHttpRequest,
    app: &AppHandle,
    lifecycle: &Arc<AppLifecycleManager>,
) -> (u16, Value) {
    let route = request.path.split('?').next().unwrap_or_default();
    match (request.method.as_str(), route) {
        ("GET", "/health") => (200, health_body(app)),
        ("GET", "/apps") => apps_body(app, lifecycle),
        ("POST", "/actions") => actions_body(request, app, lifecycle),
        (_, "/health") | (_, "/apps") | (_, "/actions") => (
            405,
            error_body("METHOD_NOT_ALLOWED", "该入口不支持此请求方法"),
        ),
        _ => (404, error_body("NOT_FOUND", "Dev 控制台入口不存在")),
    }
}

fn health_body(app: &AppHandle) -> Value {
    let package = app.package_info();
    json!({
        "ok": true,
        "name": package.name,
        "version": package.version.to_string(),
        "profile": "dev",
        "port": DEV_CONSOLE_PORT,
    })
}

fn apps_body(app: &AppHandle, lifecycle: &Arc<AppLifecycleManager>) -> (u16, Value) {
    let catalog = match host_actions::list_catalog(app) {
        Ok(catalog) => catalog,
        Err(error) => return (500, to_value(error, "读取应用注册表失败")),
    };

    let apps = catalog
        .iter()
        .map(|entry| {
            let status = app_status_inner(lifecycle, &entry.id).ok();
            json!({
                "id": entry.id,
                "name": entry.name,
                "running": status.as_ref().map(|value| value.running).unwrap_or(false),
                "phase": status.as_ref().and_then(|value| value.phase.clone()),
                "pid": status.as_ref().and_then(|value| value.pid),
            })
        })
        .collect::<Vec<_>>();

    (200, json!({ "ok": true, "apps": apps }))
}

fn actions_body(
    request: &LocalHttpRequest,
    app: &AppHandle,
    lifecycle: &Arc<AppLifecycleManager>,
) -> (u16, Value) {
    let payload = match serde_json::from_slice::<HostActionRequest>(&request.body) {
        Ok(payload) => payload,
        Err(error) => {
            return (
                400,
                error_body("BAD_REQUEST", format!("请求体解析失败: {error}")),
            )
        }
    };

    let target = HostActionTarget::from_raw(&payload.target);
    let outcome = tauri::async_runtime::block_on(host_actions::dispatch(
        app,
        lifecycle,
        payload.action,
        target,
    ));

    match outcome {
        Ok(response) => (200, to_value(response, "结果序列化失败")),
        Err(error) => (error_status(error.code), to_value(error, "错误序列化失败")),
    }
}

fn error_status(code: HostActionErrorCode) -> u16 {
    match code {
        HostActionErrorCode::DevProfileRequired => 403,
        HostActionErrorCode::CatalogUnavailable => 500,
        _ => 400,
    }
}

fn to_value<T: Serialize>(value: T, fallback: &str) -> Value {
    serde_json::to_value(value).unwrap_or_else(|error| {
        error_body("SERIALIZE_FAILED", format!("{fallback}: {error}"))
    })
}

fn error_body(code: &str, message: impl Into<String>) -> Value {
    json!({ "ok": false, "code": code, "message": message.into() })
}
