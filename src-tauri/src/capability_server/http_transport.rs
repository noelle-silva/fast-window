use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use super::{capability_service::CapabilityService, CapabilityHttpResponse};

const CONTROL_TOKEN_HEADER: &str = "x-fw-control-token";
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;

struct CapabilityHttpRequest {
    method: String,
    path: String,
    token: String,
    body: Vec<u8>,
}

pub(super) fn handle_connection(
    mut stream: TcpStream,
    expected_token: &str,
    service: &CapabilityService,
) {
    let request = match read_http_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            write_json_response(&mut stream, CapabilityHttpResponse::error(400, error));
            return;
        }
    };

    if request.token != expected_token {
        write_json_response(
            &mut stream,
            CapabilityHttpResponse::error(401, "控制令牌无效"),
        );
        return;
    }

    let response = service.handle_request(&request.method, &request.path, &request.body);
    write_json_response(&mut stream, response);
}

fn read_http_request(stream: &mut TcpStream) -> Result<CapabilityHttpRequest, String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));

    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    let header_end = loop {
        let n = stream
            .read(&mut chunk)
            .map_err(|e| format!("读取能力HTTP请求失败: {e}"))?;
        if n == 0 {
            return Err("能力HTTP请求为空".to_string());
        }
        buffer.extend_from_slice(&chunk[..n]);
        if let Some(end) = find_header_end(&buffer) {
            break end;
        }
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("能力HTTP请求头过大".to_string());
        }
    };

    let header = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();

    if method.is_empty() || path.is_empty() {
        return Err("能力HTTP请求行不完整".to_string());
    }

    let mut content_length = 0usize;
    let mut token = String::new();
    for line in lines {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.eq_ignore_ascii_case("content-length") {
            content_length = value
                .parse::<usize>()
                .map_err(|_| "Content-Length 不合法".to_string())?;
            if content_length > MAX_BODY_BYTES {
                return Err("能力HTTP请求体过大".to_string());
            }
        }
        if key.eq_ignore_ascii_case(CONTROL_TOKEN_HEADER) {
            token = value.to_string();
        }
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let n = stream
            .read(&mut chunk)
            .map_err(|e| format!("读取能力HTTP请求体失败: {e}"))?;
        if n == 0 {
            return Err(format!(
                "能力HTTP请求体不完整: 已读取 {} 字节，期望 {} 字节",
                body.len(),
                content_length
            ));
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);

    Ok(CapabilityHttpRequest {
        method,
        path,
        token,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

fn write_json_response(stream: &mut TcpStream, response: CapabilityHttpResponse) {
    let reason = match response.status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    };
    let payload = response.body.to_string();
    let head = format!(
        "HTTP/1.1 {} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response.status,
        payload.as_bytes().len(),
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(payload.as_bytes());
    let _ = stream.flush();
}
