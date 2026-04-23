use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::Channel;
use crate::{is_http_url, make_http_stream_id};

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
    let (status, headers, bytes) = http_request_raw(req).await?;
    // 用 lossy 解码：非 UTF-8 字节用 U+FFFD 替换，确保响应体始终可读（调试/错误分析友好）
    let body = String::from_utf8_lossy(&bytes).into_owned();
    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

#[tauri::command]
pub(crate) async fn http_request_base64(req: HttpRequest) -> Result<HttpResponseBase64, String> {
    let (status, headers, bytes) = http_request_raw(req).await?;
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
                let _ = channel.send(HttpStreamEvent::Error { message: e });
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
) -> Result<(u16, HashMap<String, String>, reqwest::Response), String> {
    let method = req.method.trim().to_uppercase();
    if method.is_empty() {
        return Err("method 不能为空".to_string());
    }
    if !is_http_url(&req.url) {
        return Err("url 必须以 http(s):// 开头".to_string());
    }

    let timeout = Duration::from_millis(
        req.timeout_ms
            .unwrap_or(20_000)
            .min(timeout_cap_ms.max(10_000)),
    );
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("创建 http client 失败: {e}"))?;

    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| "不支持的 method".to_string())?;
    let mut rb = client.request(m, req.url);

    if let Some(h) = req.headers {
        if h.len() > 64 {
            return Err("headers 过多".to_string());
        }
        for (k, v) in h {
            if k.len() > 128 || v.len() > 4096 {
                return Err("header 太长".to_string());
            }
            rb = rb.header(k, v);
        }
    }

    // JSON 里内嵌 data:image/... base64（例如多模态 chat）会非常大。
    // 这里给 body 做一个更现实的上限；否则参考图一上来就会“秒失败”。
    const MAX_HTTP_REQUEST_BODY_BYTES: usize = 12 * 1024 * 1024; // 12MB

    if let Some(body_base64) = req.body_base64 {
        // 允许插件以 base64 发送二进制（用于图片等），避免 body 只能传字符串的限制
        // 控制大小：解码后最多 6MB，防止滥用
        let raw = body_base64.trim();
        if raw.len() > 12 * 1024 * 1024 {
            return Err("bodyBase64 过大".to_string());
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
            .map_err(|e| format!("bodyBase64 解码失败: {e}"))?;
        if bytes.len() > 6 * 1024 * 1024 {
            return Err("bodyBase64 解码后数据过大".to_string());
        }
        rb = rb.body(bytes);
    } else if let Some(body) = req.body {
        if body.len() > MAX_HTTP_REQUEST_BODY_BYTES {
            return Err(format!(
                "body 过大（{} > {}）",
                body.len(),
                MAX_HTTP_REQUEST_BODY_BYTES
            ));
        }
        rb = rb.body(body);
    }

    let resp = rb.send().await.map_err(|e| format!("请求失败: {e}"))?;
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
) -> Result<(u16, HashMap<String, String>, Vec<u8>), String> {
    let (status, headers, resp) = http_request_send(req, 120_000).await?;

    // 图片相关的 JSON/base64 响应可能很大（尤其是 chat/completions 返回 b64）。
    // 这里做上限保护，避免插件拉取无限大响应导致内存爆炸。
    const MAX_HTTP_RESPONSE_BYTES: usize = 25 * 1024 * 1024; // 25MB

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    if bytes.len() > MAX_HTTP_RESPONSE_BYTES {
        return Err(format!(
            "响应过大（{} > {}）",
            bytes.len(),
            MAX_HTTP_RESPONSE_BYTES
        ));
    }
    Ok((status, headers, bytes.to_vec()))
}
