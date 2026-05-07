use crate::http_util::query_param;
use crate::image_store::{output_image_mime, resolve_output_image_path};
use std::fs::File;
use std::io::{self, BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

const IMAGE_PATH: &str = "/images";
const MAX_REQUEST_LINE_BYTES: usize = 8192;
const MAX_HEADERS: usize = 64;

pub fn start_image_server(output_root: PathBuf, token: String) -> Result<String, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("绑定本地图片服务失败: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("读取图片服务地址失败: {e}"))?;
    let output_root = Arc::new(output_root);
    let token = Arc::new(token);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let output_root = output_root.clone();
            let token = token.clone();
            std::thread::spawn(move || handle_connection(stream, output_root, token));
        }
    });
    Ok(format!("http://127.0.0.1:{}/images", addr.port()))
}

fn handle_connection(stream: TcpStream, output_root: Arc<PathBuf>, token: Arc<String>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let Ok((request, mut stream)) = read_request(stream) else {
        return;
    };
    if let Err(error) = serve_image_request(&mut stream, &request, &output_root, &token) {
        let _ = write_empty_response(&mut stream, error.status, error.message, &[]);
    }
}

fn serve_image_request(
    stream: &mut TcpStream,
    request: &HttpRequest,
    output_root: &Path,
    token: &str,
) -> Result<(), HttpError> {
    if request.method != "GET" && request.method != "HEAD" {
        return Err(HttpError::new(405, "Method Not Allowed"));
    }
    if request.path() != IMAGE_PATH {
        return Err(HttpError::new(404, "Not Found"));
    }
    if query_param(&request.target, "token").as_deref() != Some(token) {
        return Err(HttpError::new(401, "Unauthorized"));
    }
    let reference = query_param(&request.target, "ref")
        .ok_or_else(|| HttpError::new(400, "Missing Image Reference"))?;
    if reference.trim().is_empty() {
        return Err(HttpError::new(400, "Missing Image Reference"));
    }

    let path = resolve_output_image_path(output_root, &reference)
        .map_err(|_| HttpError::new(404, "Image Not Found"))?;
    let metadata = std::fs::metadata(&path).map_err(|_| HttpError::new(404, "Image Not Found"))?;
    let etag = image_etag(&metadata);
    let cache_control = "private, max-age=31536000, immutable";
    let content_type = output_image_mime(&path);
    let common_headers = [
        ("Cache-Control", cache_control.to_string()),
        ("ETag", etag.clone()),
        ("X-Content-Type-Options", "nosniff".to_string()),
    ];

    if request.header("if-none-match").map(str::trim) == Some(etag.as_str()) {
        return write_empty_response(stream, 304, "Not Modified", &common_headers)
            .map_err(|_| HttpError::new(500, "Internal Server Error"));
    }

    let mut file = File::open(&path).map_err(|_| HttpError::new(404, "Image Not Found"))?;
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n",
        metadata.len()
    )
    .map_err(|_| HttpError::new(500, "Internal Server Error"))?;
    for (name, value) in &common_headers {
        write!(stream, "{name}: {value}\r\n")
            .map_err(|_| HttpError::new(500, "Internal Server Error"))?;
    }
    write!(stream, "Connection: close\r\n\r\n")
        .map_err(|_| HttpError::new(500, "Internal Server Error"))?;
    if request.method == "GET" {
        io::copy(&mut file, stream).map_err(|_| HttpError::new(500, "Internal Server Error"))?;
    }
    Ok(())
}

fn read_request(stream: TcpStream) -> Result<(HttpRequest, TcpStream), String> {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;
    if request_line.len() > MAX_REQUEST_LINE_BYTES {
        return Err("HTTP 请求行过长".to_string());
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_ascii_uppercase();
    let target = parts.next().unwrap_or_default().to_string();
    if method.is_empty() || target.is_empty() {
        return Err("HTTP 请求无效".to_string());
    }

    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line == "\r\n" || line == "\n" || line.is_empty() {
            break;
        }
        if headers.len() >= MAX_HEADERS {
            return Err("HTTP 请求头过多".to_string());
        }
        if let Some((name, value)) = line.trim_end().split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
        }
    }

    Ok((
        HttpRequest {
            method,
            target,
            headers,
        },
        reader.into_inner(),
    ))
}

fn write_empty_response(
    stream: &mut TcpStream,
    status: u16,
    message: &str,
    headers: &[(&str, String)],
) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status} {message}\r\nContent-Length: 0\r\n"
    )?;
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n")?;
    }
    write!(stream, "Connection: close\r\n\r\n")
}

fn image_etag(metadata: &std::fs::Metadata) -> String {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("\"ch-{}-{modified}\"", metadata.len())
}

struct HttpRequest {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
}

impl HttpRequest {
    fn path(&self) -> &str {
        self.target
            .split_once('?')
            .map(|(path, _)| path)
            .unwrap_or(&self.target)
    }

    fn header(&self, name: &str) -> Option<&str> {
        let name = name.to_ascii_lowercase();
        self.headers
            .iter()
            .find_map(|(key, value)| (key == &name).then_some(value.as_str()))
    }
}

struct HttpError {
    status: u16,
    message: &'static str,
}

impl HttpError {
    fn new(status: u16, message: &'static str) -> Self {
        Self { status, message }
    }
}
