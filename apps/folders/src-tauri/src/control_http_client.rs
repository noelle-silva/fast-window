use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub(crate) struct HttpControlEndpoint {
    addr: String,
    token: String,
}

impl HttpControlEndpoint {
    pub(crate) fn new(addr: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            addr: addr.into(),
            token: token.into(),
        }
    }
}

pub(crate) fn post_json_control_request(
    endpoint: &HttpControlEndpoint,
    path: &str,
    body: serde_json::Value,
    timeout: Duration,
    error_context: &str,
) -> Result<serde_json::Value, String> {
    let body = body.to_string();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nX-FW-Control-Token: {}\r\nConnection: close\r\n\r\n{}",
        endpoint.addr,
        body.as_bytes().len(),
        endpoint.token,
        body,
    );

    let mut stream = TcpStream::connect(&endpoint.addr)
        .map_err(|e| format!("{error_context}: 连接失败: {e}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("{error_context}: 设置写入超时失败: {e}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("{error_context}: 设置读取超时失败: {e}"))?;
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("{error_context}: 发送失败: {e}"))?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|e| format!("{error_context}: 读取响应失败: {e}"))?;
    let response = String::from_utf8_lossy(&response);
    if !response.starts_with("HTTP/1.1 200") {
        return Err(format!("{error_context}: {response}"));
    }
    let Some((_, body)) = response.split_once("\r\n\r\n") else {
        return Err(format!("{error_context}: 响应缺少响应体"));
    };
    serde_json::from_str::<serde_json::Value>(body)
        .map_err(|e| format!("{error_context}: 响应不是有效 JSON: {e}"))
}
