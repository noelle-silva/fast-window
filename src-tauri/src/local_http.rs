use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde_json::Value;

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// 宿主对内网暴露的极简 HTTP 请求。
///
/// 只承担一件事：把一条回环连接上的请求读成结构化的方法、路径、头与正文。
/// 鉴权、路由、业务语义全部留给调用方，避免把管理策略写进传输层。
pub(crate) struct LocalHttpRequest {
    pub(crate) method: String,
    pub(crate) path: String,
    headers: Vec<(String, String)>,
    pub(crate) body: Vec<u8>,
}

impl LocalHttpRequest {
    pub(crate) fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

pub(crate) fn read_request(stream: &mut TcpStream) -> Result<LocalHttpRequest, String> {
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));

    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    let header_end = loop {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("读取 HTTP 请求失败: {error}"))?;
        if read == 0 {
            return Err("HTTP 请求为空".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(end) = find_header_end(&buffer) {
            break end;
        }
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("HTTP 请求头过大".to_string());
        }
    };

    let header = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();

    if method.is_empty() || path.is_empty() {
        return Err("HTTP 请求行不完整".to_string());
    }

    let mut content_length = 0usize;
    let mut headers = Vec::new();
    for line in lines {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() {
            continue;
        }
        if key.eq_ignore_ascii_case("content-length") {
            content_length = value
                .parse::<usize>()
                .map_err(|_| "Content-Length 不合法".to_string())?;
            if content_length > MAX_BODY_BYTES {
                return Err("HTTP 请求体过大".to_string());
            }
        }
        headers.push((key.to_string(), value.to_string()));
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("读取 HTTP 请求体失败: {error}"))?;
        if read == 0 {
            return Err(format!(
                "HTTP 请求体不完整: 已读取 {} 字节，期望 {} 字节",
                body.len(),
                content_length
            ));
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(LocalHttpRequest {
        method,
        path,
        headers,
        body,
    })
}

pub(crate) fn write_json(stream: &mut TcpStream, status: u16, body: &Value) {
    let payload = body.to_string();
    let head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status_reason(status),
        payload.len(),
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(payload.as_bytes());
    let _ = stream.flush();
}

fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    }
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    /// 用一条真实的回环连接验证解析结果，避免只测字符串切片而漏掉读取时序。
    fn parse_over_loopback(raw: Vec<u8>) -> Result<LocalHttpRequest, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind loopback");
        let address = listener.local_addr().expect("local addr");

        let sender = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept client");
            stream.write_all(&raw).expect("write request");
            let _ = stream.flush();
        });

        let mut client = TcpStream::connect(address).expect("connect");
        let request = read_request(&mut client);
        sender.join().expect("join sender");
        request
    }

    #[test]
    fn parses_post_body_and_headers() {
        let body = r#"{"action":"stop","target":"venera"}"#;
        let raw = format!(
            "POST /actions HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body,
        );

        let request = parse_over_loopback(raw.into_bytes()).expect("request should parse");
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/actions");
        assert_eq!(request.body, body.as_bytes());
        assert_eq!(
            request.header("content-type"),
            Some("application/json"),
        );
    }

    #[test]
    fn parses_get_without_body() {
        let raw = "GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let request = parse_over_loopback(raw.as_bytes().to_vec()).expect("request should parse");

        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/health");
        assert!(request.body.is_empty());
        assert_eq!(request.header("host"), Some("127.0.0.1"));
    }

    #[test]
    fn rejects_incomplete_request_line() {
        let raw = "GET\r\n\r\n";
        assert!(parse_over_loopback(raw.as_bytes().to_vec()).is_err());
    }
}
