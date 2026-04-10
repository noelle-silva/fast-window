use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) fn is_http_url(url: &str) -> bool {
    let u = url.trim();
    let u = u.to_ascii_lowercase();
    u.starts_with("http://") || u.starts_with("https://")
}

pub(crate) fn is_https_url(url: &str) -> bool {
    let u = url.trim();
    let u = u.to_ascii_lowercase();
    u.starts_with("https://")
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

pub(crate) fn parse_sha256_hex_32(raw: &str) -> Result<[u8; 32], String> {
    let s = raw.trim();
    if s.len() != 64 {
        return Err("sha256 必须为 64 位十六进制字符串".to_string());
    }
    let bytes = s.as_bytes();
    let mut out = [0u8; 32];
    let mut i = 0usize;
    while i < 64 {
        let hi = hex_val(bytes[i]).ok_or_else(|| "sha256 存在非十六进制字符".to_string())?;
        let lo =
            hex_val(bytes[i + 1]).ok_or_else(|| "sha256 存在非十六进制字符".to_string())?;
        out[i / 2] = (hi << 4) | lo;
        i += 2;
    }
    Ok(out)
}

pub(crate) fn to_hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = Vec::<u8>::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize]);
        out.push(HEX[(b & 0x0f) as usize]);
    }
    String::from_utf8(out).unwrap_or_default()
}

pub(crate) fn normalize_zip_name(name: &str) -> String {
    let mut s = name.replace('\\', "/");
    while s.starts_with('/') {
        s.remove(0);
    }
    if s.starts_with("./") {
        s = s.trim_start_matches("./").to_string();
    }
    s
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

pub(crate) fn rand_u32(seed: u64) -> u32 {
    let mut x = (seed as u32).wrapping_mul(1664525).wrapping_add(1013904223);
    x ^= x << 13;
    x ^= x >> 17;
    x ^ (x << 5)
}

pub(crate) fn portable_base_dir_from_env() -> Option<PathBuf> {
    let Ok(raw) = std::env::var(super::DATA_DIR_ENV) else {
        return None;
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    Some(PathBuf::from(raw))
}

pub(crate) fn is_dir_writable(dir: &Path) -> bool {
    let test = dir.join(".fast-window.write-test");
    match std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .open(&test)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&test);
            true
        }
        Err(_) => false,
    }
}

