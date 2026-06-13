use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

#[derive(Clone)]
pub(crate) struct AppControlEndpoint {
    pub(crate) url: String,
    pub(crate) token: String,
}

pub(crate) fn send_control_json(
    endpoint: AppControlEndpoint,
    body_value: Value,
) -> Result<Value, String> {
    let url = endpoint.url.trim().trim_end_matches('/');
    let Some(addr) = url.strip_prefix("http://") else {
        return Err("应用控制地址不支持".to_string());
    };

    let body = body_value.to_string();
    let request = format!(
        "POST /control HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nX-FW-Control-Token: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        endpoint.token,
        body,
    );

    let mut stream = TcpStream::connect(addr).map_err(|e| format!("连接应用控制通道失败: {e}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| format!("设置应用控制写入超时失败: {e}"))?;
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("发送应用控制指令失败: {e}"))?;
    let response = read_http_response(&mut stream)?;
    if response.starts_with("HTTP/1.1 200") {
        response_json_body(&response)
    } else {
        Err(format!("应用控制指令失败: {response}"))
    }
}

fn response_json_body(response: &str) -> Result<Value, String> {
    let Some((_, body)) = response.split_once("\r\n\r\n") else {
        return Err("应用控制响应缺少响应体".to_string());
    };
    serde_json::from_str::<Value>(body).map_err(|e| format!("应用控制响应不是有效 JSON: {e}"))
}

fn read_http_response(stream: &mut TcpStream) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| format!("设置应用控制读取超时失败: {e}"))?;
    let mut buffer = Vec::new();
    stream
        .read_to_end(&mut buffer)
        .map_err(|e| format!("读取应用控制响应失败: {e}"))?;
    Ok(String::from_utf8_lossy(&buffer).to_string())
}
