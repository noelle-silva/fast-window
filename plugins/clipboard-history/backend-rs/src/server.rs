use crate::model::RequestFrame;
use crate::service::ClipboardHistoryService;
use serde_json::json;
use std::net::{TcpListener, TcpStream};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::{accept_hdr, Error, Message};

pub fn start_server(service: Arc<Mutex<ClipboardHistoryService>>, token: String) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("绑定本地 WebSocket 失败: {e}"))?;
    let addr = listener.local_addr().map_err(|e| format!("读取监听地址失败: {e}"))?;
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let service = service.clone();
            let token = token.clone();
            std::thread::spawn(move || handle_client(stream, service, token));
        }
    });
    Ok(format!("ws://127.0.0.1:{}", addr.port()))
}

fn handle_client(stream: TcpStream, service: Arc<Mutex<ClipboardHistoryService>>, token: String) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));
    let expected_token = token.clone();
    let Ok(mut ws) = accept_hdr(stream, move |req: &Request, res: Response| {
        if request_has_token(req, &expected_token) {
            Ok(res)
        } else {
            Err(ErrorResponse::new(None))
        }
    }) else { return };
    let (tx, rx) = mpsc::channel::<String>();
    if let Ok(mut svc) = service.lock() {
        svc.add_event_sender(tx);
    }

    loop {
        while let Ok(frame) = rx.try_recv() {
            if ws.send(Message::Text(frame)).is_err() {
                return;
            }
        }

        match ws.read() {
            Ok(Message::Text(text)) => {
                if let Some(response) = handle_text_frame(&text, &service) {
                    if ws.send(Message::Text(response)).is_err() {
                        return;
                    }
                }
            }
            Ok(Message::Close(_)) => return,
            Ok(_) => {}
            Err(Error::Io(err)) if err.kind() == std::io::ErrorKind::WouldBlock || err.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => return,
        }
    }
}

fn request_has_token(req: &Request, expected_token: &str) -> bool {
    let uri = req.uri().to_string();
    let Some(query) = uri.split_once('?').map(|(_, q)| q) else { return false };
    query.split('&').any(|part| {
        let (key, value) = part.split_once('=').unwrap_or((part, ""));
        key == "token" && percent_decode(value) == expected_token
    })
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(hex);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn handle_text_frame(text: &str, service: &Arc<Mutex<ClipboardHistoryService>>) -> Option<String> {
    let req: RequestFrame = serde_json::from_str(text).ok()?;
    let id = req.id.unwrap_or_default();
    if id.is_empty() || req.frame_type.as_deref() != Some("request") {
        return None;
    }
    let method = req.method.unwrap_or_default();
    let result = service.lock().map_err(|_| "后端状态锁定失败".to_string()).and_then(|mut svc| svc.dispatch(&method, req.params));
    let frame = match result {
        Ok(value) => json!({ "id": id, "type": "response", "ok": true, "result": value }),
        Err(message) => json!({ "id": id, "type": "response", "ok": false, "error": { "message": message } }),
    };
    Some(frame.to_string())
}
