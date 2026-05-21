use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

use crate::{
    app_data_dir, ensure_writable_dir, is_https_url, now_ms, parse_sha256_hex_32, rand_u32,
    to_hex_lower,
};

const HOST_UPDATE_MAX_MSI_BYTES: usize = 300 * 1024 * 1024;
const HOST_UPDATE_DIR_NAME: &str = "updates";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostUpdateDownloadRequest {
    version: String,
    url: String,
    expected_sha256: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostUpdateInstallRequest {
    version: String,
    path: String,
    expected_sha256: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostUpdateDownloadResult {
    version: String,
    path: String,
    size_bytes: usize,
}

#[tauri::command]
pub(crate) async fn host_update_download_msi(
    app: AppHandle,
    req: HostUpdateDownloadRequest,
) -> Result<HostUpdateDownloadResult, String> {
    let req = normalize_download_request(req)?;
    ensure_remote_version_is_newer(&req.version)?;

    let update_dir = host_update_dir(&app)?;
    cleanup_old_update_files(&update_dir, &req.version).await;
    let msi_path = update_dir.join(format!("fast-window-{}-windows-x64.msi", req.version));
    let size_bytes = download_msi_to_path(&req, &msi_path).await?;

    Ok(HostUpdateDownloadResult {
        version: req.version,
        path: msi_path.to_string_lossy().to_string(),
        size_bytes,
    })
}

#[tauri::command]
pub(crate) fn host_update_install_msi(
    app: AppHandle,
    req: HostUpdateInstallRequest,
) -> Result<(), String> {
    let req = normalize_install_request(req)?;
    ensure_remote_version_is_newer(&req.version)?;
    let msi_path = PathBuf::from(&req.path);
    validate_downloaded_msi_path(&app, &msi_path)?;
    verify_file_sha256(&msi_path, &req.expected_sha256)?;

    launch_msi_installer(&msi_path)?;
    crate::host_lifecycle::request_host_shutdown(app);
    Ok(())
}

fn host_update_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app).join("__app").join(HOST_UPDATE_DIR_NAME);
    ensure_writable_dir(&dir)?;
    Ok(dir)
}

fn normalize_download_request(
    req: HostUpdateDownloadRequest,
) -> Result<HostUpdateDownloadRequest, String> {
    Ok(HostUpdateDownloadRequest {
        version: normalize_version(&req.version)?,
        url: normalize_msi_url(&req.url)?,
        expected_sha256: normalize_sha256(&req.expected_sha256)?,
    })
}

fn normalize_install_request(
    req: HostUpdateInstallRequest,
) -> Result<HostUpdateInstallRequest, String> {
    Ok(HostUpdateInstallRequest {
        version: normalize_version(&req.version)?,
        path: req.path.trim().to_string(),
        expected_sha256: normalize_sha256(&req.expected_sha256)?,
    })
}

fn normalize_msi_url(raw: &str) -> Result<String, String> {
    let url = raw.trim().to_string();
    if !is_https_url(&url) {
        return Err("更新安装包地址必须以 https:// 开头".to_string());
    }
    let path = url::Url::parse(&url)
        .map_err(|e| format!("更新安装包地址解析失败: {e}"))?
        .path()
        .to_ascii_lowercase();
    if !path.ends_with(".msi") {
        return Err("更新安装包必须是 .msi 文件".to_string());
    }
    Ok(url)
}

fn normalize_version(raw: &str) -> Result<String, String> {
    let version = raw.trim().to_string();
    if parse_semver(&version).is_none() {
        return Err("更新版本号必须是 x.y.z 格式".to_string());
    }
    Ok(version)
}

fn normalize_sha256(raw: &str) -> Result<String, String> {
    let sha = raw.trim().to_ascii_lowercase();
    let _ = parse_sha256_hex_32(&sha)?;
    Ok(sha)
}

fn parse_semver(raw: &str) -> Option<[u64; 3]> {
    let mut out = [0u64; 3];
    let mut count = 0usize;
    for part in raw.trim().split('.') {
        if count >= 3 || part.is_empty() || !part.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        out[count] = part.parse::<u64>().ok()?;
        count += 1;
    }
    (count == 3).then_some(out)
}

fn compare_semver(a: [u64; 3], b: [u64; 3]) -> std::cmp::Ordering {
    for i in 0..3 {
        match a[i].cmp(&b[i]) {
            std::cmp::Ordering::Equal => continue,
            ordering => return ordering,
        }
    }
    std::cmp::Ordering::Equal
}

fn ensure_remote_version_is_newer(remote: &str) -> Result<(), String> {
    let remote = parse_semver(remote).ok_or_else(|| "更新版本号必须是 x.y.z 格式".to_string())?;
    let current = parse_semver(env!("CARGO_PKG_VERSION"))
        .ok_or_else(|| "当前宿主版本号不是 x.y.z 格式".to_string())?;
    if compare_semver(remote, current) != std::cmp::Ordering::Greater {
        return Err(format!(
            "远端版本未高于当前版本：远端={}.{}.{}，当前={}",
            remote[0],
            remote[1],
            remote[2],
            env!("CARGO_PKG_VERSION")
        ));
    }
    Ok(())
}

async fn cleanup_old_update_files(update_dir: &Path, keep_version: &str) {
    let Ok(mut entries) = tokio::fs::read_dir(update_dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".msi") && !name.contains(keep_version) {
            let _ = tokio::fs::remove_file(entry.path()).await;
        }
    }
}

async fn download_msi_to_path(
    req: &HostUpdateDownloadRequest,
    msi_path: &Path,
) -> Result<usize, String> {
    let expected = parse_sha256_hex_32(&req.expected_sha256)?;
    let stamp = now_ms();
    let rnd = rand_u32(stamp);
    let tmp_path = msi_path.with_file_name(format!(".tmp-host-update-{stamp}-{rnd:08x}.msi"));
    if tmp_path.exists() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
    }

    let client = reqwest::Client::builder()
        .user_agent(format!("fast-window/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20 * 60))
        .build()
        .map_err(|e| format!("创建 http client 失败: {e}"))?;

    let resp = client
        .get(&req.url)
        .send()
        .await
        .map_err(|e| format!("下载安装包失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载安装包失败: HTTP {}", resp.status().as_u16()));
    }

    let mut total = 0usize;
    let mut hasher = Sha256::new();
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("创建临时安装包失败: {e}"))?;
    let mut stream = resp;
    let download_result: Result<(), String> = async {
        while let Some(chunk) = stream
            .chunk()
            .await
            .map_err(|e| format!("读取安装包下载流失败: {e}"))?
        {
            total = total.saturating_add(chunk.len());
            if total > HOST_UPDATE_MAX_MSI_BYTES {
                return Err("宿主安装包过大（>300MB）".to_string());
            }
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("写入临时安装包失败: {e}"))?;
        }
        file.flush()
            .await
            .map_err(|e| format!("写入临时安装包失败: {e}"))?;
        Ok(())
    }
    .await;

    if let Err(error) = download_result {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(error);
    }

    let actual = hasher.finalize();
    if actual.as_slice() != expected.as_slice() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(format!(
            "安装包 sha256 校验失败：expected={}, got={}",
            to_hex_lower(&expected),
            to_hex_lower(actual.as_slice())
        ));
    }

    if msi_path.exists() {
        let _ = tokio::fs::remove_file(msi_path).await;
    }
    tokio::fs::rename(&tmp_path, msi_path)
        .await
        .map_err(|e| format!("保存安装包失败: {e}"))?;
    Ok(total)
}

fn validate_downloaded_msi_path(app: &AppHandle, path: &Path) -> Result<(), String> {
    let update_dir = host_update_dir(app)?;
    let canonical_dir = update_dir
        .canonicalize()
        .map_err(|e| format!("定位更新目录失败: {e}"))?;
    let canonical_file = path
        .canonicalize()
        .map_err(|e| format!("定位安装包失败: {e}"))?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err("安装包必须来自宿主更新目录".to_string());
    }
    if canonical_file
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        != "msi"
    {
        return Err("安装包必须是 .msi 文件".to_string());
    }
    Ok(())
}

fn verify_file_sha256(path: &Path, expected_sha256: &str) -> Result<(), String> {
    let expected = parse_sha256_hex_32(expected_sha256)?;
    let mut file = std::fs::File::open(path).map_err(|e| format!("打开安装包失败: {e}"))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| format!("读取安装包失败: {e}"))?;
    let actual = hasher.finalize();
    if actual.as_slice() != expected.as_slice() {
        return Err(format!(
            "安装包 sha256 校验失败：expected={}, got={}",
            to_hex_lower(&expected),
            to_hex_lower(actual.as_slice())
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn launch_msi_installer(path: &Path) -> Result<(), String> {
    Command::new("msiexec")
        .arg("/i")
        .arg(path)
        .spawn()
        .map_err(|e| format!("启动 MSI 安装器失败: {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_msi_installer(_path: &Path) -> Result<(), String> {
    Err("宿主 MSI 更新仅支持 Windows".to_string())
}
