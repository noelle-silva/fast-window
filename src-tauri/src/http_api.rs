use std::collections::HashMap;
use std::error::Error;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use url::Url;

use base64::engine::general_purpose;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::Channel;
use crate::{is_http_url, make_http_stream_id};

// ── HTTP 客户端策略 ──────────────────────────────────────────────────────────
//
// 部分 AI 服务网关在 HTTP/2、自动解压、连接复用上存在兼容问题。
// 这里统一按 URL 特征决定客户端行为，避免在业务层散落各种魔法配置。

/// 描述单次请求应使用的 HTTP 客户端行为。
struct HttpClientPolicy {
    /// 是否强制 HTTP/1.1（禁用 HTTP/2 协商）。
    /// 适用于 HTTP/2 支持不稳定的 AI 网关。
    force_http1: bool,
    /// 是否禁用 idle 连接复用。
    /// 适用于服务端不发送 TLS close_notify、复用死连接概率较高的场景。
    no_idle_pool: bool,
    /// 是否禁用自动内容解压（gzip/brotli/deflate）。
    /// 适用于服务端声明了 Content-Encoding 但实际内容已解压的情况。
    no_decompress: bool,
}

impl HttpClientPolicy {
    fn default() -> Self {
        HttpClientPolicy {
            force_http1: false,
            no_idle_pool: false,
            no_decompress: false,
        }
    }

    fn aggressive_ai_compat() -> Self {
        HttpClientPolicy {
            force_http1: true,
            no_idle_pool: true,
            no_decompress: true,
        }
    }

    /// 根据请求 URL 自动选择兼容策略。
    /// 现在改为 host 级策略表，避免仅靠 path 特征做模糊判断。
    fn for_url(url: &str) -> Self {
        let host = Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(|s| s.to_ascii_lowercase()))
            .unwrap_or_default();

        match host.as_str() {
            // PackyAPI：已验证存在 HTTP/2 / keep-alive / 自动解压兼容问题，使用保守策略
            "www.packyapi.com" | "packyapi.com" => HttpClientPolicy::aggressive_ai_compat(),
            _ => HttpClientPolicy::default(),
        }
    }
}

// ── 结构化 HTTP 错误类型 ─────────────────────────────────────────────────────

/// 对 reqwest 错误的结构化分类，用于调用方判断是否可安全重试。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HttpErrorKind {
    /// TCP 连接建立失败（DNS / 连接超时 / 连接被拒绝）
    Connect,
    /// 请求发送中途连接被关闭（死连接复用 / 服务端提前断开）
    SendClosed,
    /// 请求超时
    Timeout,
    /// 响应体读取失败（解压失败 / 连接截断）
    BodyDecode,
    /// 其他不可重试的错误（4xx/5xx / 请求构建失败 / 重定向失败）
    Other,
}

impl HttpErrorKind {
    /// 从 reqwest::Error 直接推断 kind，不依赖字符串解析。
    fn from_reqwest(err: &reqwest::Error) -> Self {
        if err.is_timeout() {
            return HttpErrorKind::Timeout;
        }
        if err.is_connect() {
            return HttpErrorKind::Connect;
        }
        if err.is_body() || err.is_decode() {
            return HttpErrorKind::BodyDecode;
        }
        if err.is_request() {
            // is_request() 在 reqwest 里表示请求构建/发送层失败，
            // 对应 SendRequest / connection closed 等场景
            return HttpErrorKind::SendClosed;
        }
        HttpErrorKind::Other
    }

    /// 发送阶段失败（服务端未处理请求），可以安全重试。
    pub(crate) fn is_retryable(&self) -> bool {
        matches!(self, HttpErrorKind::Connect | HttpErrorKind::SendClosed)
    }
}

/// http_request_send / http_request_raw 内部使用的结构化错误，
/// 携带 kind 供任务层直接判断，避免字符串反推。
pub(crate) struct HttpGatewayError {
    pub(crate) kind: HttpErrorKind,
    pub(crate) message: String,
}

impl HttpGatewayError {
    fn from_reqwest(prefix: &str, err: &reqwest::Error) -> Self {
        HttpGatewayError {
            kind: HttpErrorKind::from_reqwest(err),
            message: format_reqwest_error(prefix, err),
        }
    }

    fn other(message: impl Into<String>) -> Self {
        HttpGatewayError {
            kind: HttpErrorKind::Other,
            message: message.into(),
        }
    }
}

// ── 错误格式化 ────────────────────────────────────────────────────────────────

fn format_reqwest_error(prefix: &str, err: &reqwest::Error) -> String {
    let kind = if err.is_timeout() {
        "超时"
    } else if err.is_connect() {
        "连接失败"
    } else if err.is_body() {
        "请求体/响应体处理失败"
    } else if err.is_decode() {
        "响应解码失败"
    } else if err.is_request() {
        "请求构建失败"
    } else if err.is_redirect() {
        "重定向失败"
    } else if err.is_status() {
        "HTTP 状态异常"
    } else {
        "网络请求失败"
    };

    let mut parts: Vec<String> = Vec::new();
    parts.push(format!("{prefix}: {kind}"));

    if let Some(url) = err.url() {
        parts.push(format!("url={url}"));
    }

    parts.push(format!("detail={err}"));

    let mut cur = err.source();
    let mut depth = 0usize;
    while let Some(src) = cur {
        depth += 1;
        parts.push(format!("cause{depth}={src}"));
        cur = src.source();
        if depth >= 8 {
            break;
        }
    }

    parts.join(" | ")
}

#[derive(Deserialize)]
pub(crate) struct HttpRequest {
    pub(crate) method: String,
    pub(crate) url: String,
    pub(crate) headers: Option<HashMap<String, String>>,
    pub(crate) body: Option<String>,
    #[serde(rename = "bodyBase64")]
    pub(crate) body_base64: Option<String>,
    #[serde(rename = "timeoutMs")]
    pub(crate) timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub(crate) struct HttpResponse {
    pub(crate) status: u16,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpResponseBase64 {
    pub(crate) status: u16,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body_base64: String,
}

#[derive(Default)]
pub(crate) struct HttpStreamManagerState {
    pub(crate) cancels: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum HttpStreamEvent {
    Start {
        status: u16,
        headers: HashMap<String, String>,
    },
    Chunk {
        text: String,
    },
    End {
        canceled: bool,
    },
    Error {
        message: String,
    },
}

#[tauri::command]
pub(crate) async fn http_request(req: HttpRequest) -> Result<HttpResponse, String> {
    let (status, headers, bytes) = http_request_raw(req).await.map_err(|e| e.message)?;
    // 用 lossy 解码：非 UTF-8 字节用 U+FFFD 替换，确保响应体始终可读（调试/错误分析友好）
    let body = String::from_utf8_lossy(&bytes).into_owned();
    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

/// tasks.rs 专用：同时返回结构化 HttpGatewayError，
/// 让任务层直接从 kind 判断是否重试，无需字符串反推。
pub(crate) async fn http_request_for_task(
    req: HttpRequest,
) -> Result<HttpResponse, HttpGatewayError> {
    let (status, headers, bytes) = http_request_raw(req).await?;
    let body = String::from_utf8_lossy(&bytes).into_owned();
    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

#[tauri::command]
pub(crate) async fn http_request_base64(req: HttpRequest) -> Result<HttpResponseBase64, String> {
    let (status, headers, bytes) = http_request_raw(req).await.map_err(|e| e.message)?;
    let body_base64 = general_purpose::STANDARD.encode(bytes);
    Ok(HttpResponseBase64 {
        status,
        headers,
        body_base64,
    })
}

#[tauri::command]
pub(crate) async fn http_request_stream(
    app: tauri::AppHandle,
    req: HttpRequest,
    channel: Channel<HttpStreamEvent>,
) -> Result<String, String> {
    let stream_id = make_http_stream_id();
    let manager = app.state::<Arc<HttpStreamManagerState>>().inner().clone();

    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut cancels = manager
            .cancels
            .lock()
            .map_err(|_| "流式请求状态锁定失败".to_string())?;
        cancels.insert(stream_id.clone(), tx);
    }

    struct Cleanup {
        manager: Arc<HttpStreamManagerState>,
        stream_id: String,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if let Ok(mut cancels) = self.manager.cancels.lock() {
                cancels.remove(&self.stream_id);
            }
        }
    }

    let manager_clone = manager.clone();
    let stream_id_clone = stream_id.clone();
    tauri::async_runtime::spawn(async move {
        let _cleanup = Cleanup {
            manager: manager_clone,
            stream_id: stream_id_clone,
        };

        const MAX_TIMEOUT_MS: u64 = 15 * 60 * 1000;
        let (status, headers, mut resp) = match http_request_send(req, MAX_TIMEOUT_MS).await {
            Ok(v) => v,
            Err(e) => {
                let _ = channel.send(HttpStreamEvent::Error { message: e.message });
                let _ = channel.send(HttpStreamEvent::End { canceled: false });
                return;
            }
        };

        if channel
            .send(HttpStreamEvent::Start { status, headers })
            .is_err()
        {
            return;
        }

        const MAX_HTTP_STREAM_BYTES: usize = 50 * 1024 * 1024; // 50MB
        let mut total: usize = 0;
        let mut pending: Vec<u8> = Vec::new();

        let mut canceled = false;
        loop {
            tokio::select! {
                _ = &mut rx => {
                    canceled = true;
                    break;
                }
                chunk = resp.chunk() => {
                    match chunk {
                        Ok(Some(bytes)) => {
                            total = total.saturating_add(bytes.len());
                            if total > MAX_HTTP_STREAM_BYTES {
                                let _ = channel.send(HttpStreamEvent::Error { message: "响应过大（超过 50MB）".to_string() });
                                break;
                            }
                            pending.extend_from_slice(&bytes);

                            loop {
                                if pending.is_empty() { break; }
                                match std::str::from_utf8(&pending) {
                                    Ok(s) => {
                                        let text = s.to_string();
                                        pending.clear();
                                        if !text.is_empty()
                                            && channel.send(HttpStreamEvent::Chunk { text }).is_err()
                                        {
                                            return;
                                        }
                                    }
                                    Err(e) => {
                                        let n = e.valid_up_to();
                                        if n == 0 {
                                            // 无效 UTF-8：丢掉 1 字节避免卡死
                                            pending.remove(0);
                                            break;
                                        }
                                        let text = String::from_utf8_lossy(&pending[..n]).to_string();
                                        pending.drain(..n);
                                        if !text.is_empty() && channel.send(HttpStreamEvent::Chunk { text }).is_err() {
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                        Ok(None) => break,
                        Err(e) => {
                            let _ = channel.send(HttpStreamEvent::Error { message: format!("读取响应失败: {e}") });
                            break;
                        }
                    }
                }
            }
        }

        // flush pending utf8
        if !pending.is_empty() {
            if let Ok(s) = std::str::from_utf8(&pending) {
                let _ = channel.send(HttpStreamEvent::Chunk {
                    text: s.to_string(),
                });
            }
        }

        let _ = channel.send(HttpStreamEvent::End { canceled });
    });

    Ok(stream_id)
}

#[tauri::command]
pub(crate) fn http_request_stream_cancel(
    app: tauri::AppHandle,
    stream_id: String,
) -> Result<(), String> {
    if stream_id.trim().is_empty() {
        return Err("streamId 不能为空".to_string());
    }
    let manager = app.state::<Arc<HttpStreamManagerState>>().inner().clone();
    let tx = {
        let mut cancels = manager
            .cancels
            .lock()
            .map_err(|_| "流式请求状态锁定失败".to_string())?;
        cancels.remove(stream_id.trim())
    };
    if let Some(tx) = tx {
        let _ = tx.send(());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GatewayTestChannelRequest {
    total: u32,
    delay_ms: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GatewayTestChannelEvent {
    seq: u32,
    total: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GatewayTestChannelResult {
    total: u32,
}

#[tauri::command]
pub(crate) async fn gateway_test_channel(
    req: GatewayTestChannelRequest,
    channel: Channel<GatewayTestChannelEvent>,
) -> Result<GatewayTestChannelResult, String> {
    let total = req.total.max(1).min(200);
    let delay_ms = req.delay_ms.unwrap_or(50).min(2_000);

    for seq in 1..=total {
        let _ = channel.send(GatewayTestChannelEvent { seq, total });
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }

    Ok(GatewayTestChannelResult { total })
}

async fn http_request_send(
    req: HttpRequest,
    timeout_cap_ms: u64,
) -> Result<(u16, HashMap<String, String>, reqwest::Response), HttpGatewayError> {
    let method = req.method.trim().to_uppercase();
    if method.is_empty() {
        return Err(HttpGatewayError::other("method 不能为空"));
    }
    if !is_http_url(&req.url) {
        return Err(HttpGatewayError::other("url 必须以 http(s):// 开头"));
    }

    let timeout = Duration::from_millis(
        req.timeout_ms
            .unwrap_or(20_000)
            .min(timeout_cap_ms.max(10_000)),
    );
    let policy = HttpClientPolicy::for_url(&req.url);

    let mut client_builder = reqwest::Client::builder().timeout(timeout);

    if policy.force_http1 {
        client_builder = client_builder.http1_only();
    }
    if policy.no_idle_pool {
        client_builder = client_builder.pool_max_idle_per_host(0);
    }
    if policy.no_decompress {
        client_builder = client_builder.no_gzip().no_brotli().no_deflate();
    }

    let client = client_builder
        .build()
        .map_err(|e| HttpGatewayError::other(format!("创建 http client 失败: {e}")))?;

    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| HttpGatewayError::other("不支持的 method"))?;
    let mut rb = client.request(m, req.url);

    if let Some(h) = req.headers {
        if h.len() > 64 {
            return Err(HttpGatewayError::other("headers 过多"));
        }
        for (k, v) in h {
            if k.len() > 128 || v.len() > 4096 {
                return Err(HttpGatewayError::other("header 太长"));
            }
            rb = rb.header(k, v);
        }
    }

    // JSON 里内嵌 data:image/... base64（例如多模态 chat）会非常大。
    // 这里给 body 做一个更现实的上限；否则参考图一上来就会"秒失败"。
    const MAX_HTTP_REQUEST_BODY_BYTES: usize = 12 * 1024 * 1024; // 12MB

    if let Some(body_base64) = req.body_base64 {
        // 允许插件以 base64 发送二进制（用于图片等），避免 body 只能传字符串的限制
        // 控制大小：解码后最多 6MB，防止滥用
        let raw = body_base64.trim();
        if raw.len() > 12 * 1024 * 1024 {
            return Err(HttpGatewayError::other("bodyBase64 过大"));
        }

        let pure = if raw.starts_with("data:") {
            match raw.find("base64,") {
                Some(i) => &raw[(i + "base64,".len())..],
                None => raw,
            }
        } else {
            raw
        };

        let bytes = general_purpose::STANDARD
            .decode(pure.trim())
            .map_err(|e| HttpGatewayError::other(format!("bodyBase64 解码失败: {e}")))?;
        if bytes.len() > 6 * 1024 * 1024 {
            return Err(HttpGatewayError::other("bodyBase64 解码后数据过大"));
        }
        rb = rb.body(bytes);
    } else if let Some(body) = req.body {
        if body.len() > MAX_HTTP_REQUEST_BODY_BYTES {
            return Err(HttpGatewayError::other(format!(
                "body 过大（{} > {}）",
                body.len(),
                MAX_HTTP_REQUEST_BODY_BYTES
            )));
        }
        rb = rb.body(body);
    }

    let resp = rb
        .send()
        .await
        .map_err(|e| HttpGatewayError::from_reqwest("请求失败", &e))?;
    let status = resp.status().as_u16();

    let mut headers: HashMap<String, String> = HashMap::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(vs) = v.to_str() {
            headers.insert(k.as_str().to_string(), vs.to_string());
        }
    }

    Ok((status, headers, resp))
}

async fn http_request_raw(
    req: HttpRequest,
) -> Result<(u16, HashMap<String, String>, Vec<u8>), HttpGatewayError> {
    let (status, headers, resp) = http_request_send(req, 120_000).await?;

    // 图片相关的 JSON/base64 响应可能很大（尤其是 chat/completions 返回 b64）。
    // 这里做上限保护，避免插件拉取无限大响应导致内存爆炸。
    const MAX_HTTP_RESPONSE_BYTES: usize = 25 * 1024 * 1024; // 25MB

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| HttpGatewayError::from_reqwest("读取响应失败", &e))?;
    if bytes.len() > MAX_HTTP_RESPONSE_BYTES {
        return Err(HttpGatewayError::other(format!(
            "响应过大（{} > {}）",
            bytes.len(),
            MAX_HTTP_RESPONSE_BYTES
        )));
    }
    Ok((status, headers, bytes.to_vec()))
}
