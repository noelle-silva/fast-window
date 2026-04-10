use super::*;

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else if ty.is_file() {
            if let Some(parent) = to.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn replace_dir_from_tmp(dst: &Path, tmp: &Path, tag: &str) -> Result<(), String> {
    let Some(parent) = dst.parent() else {
        let _ = std::fs::remove_dir_all(tmp);
        return Err("目标目录没有父目录".to_string());
    };

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();

    let safe_tag: String = tag
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let bak = parent.join(format!(".bak-{safe_tag}-{stamp}"));

    // Windows 上 remove_dir_all 可能“删到一半失败”（文件被占用），会留下空壳目录。
    // 这里用 rename 交换：要么完整替换成功，要么原目录保持不动。
    if dst.exists() {
        if let Err(e) = std::fs::rename(dst, &bak) {
            let _ = std::fs::remove_dir_all(tmp);
            return Err(format!("重命名旧目录失败（可能被占用）: {e}"));
        }
    }

    if let Err(e) = std::fs::rename(tmp, dst) {
        // 回滚：尽力把旧目录改回去
        if bak.exists() {
            let _ = std::fs::rename(&bak, dst);
        }
        let _ = std::fs::remove_dir_all(tmp);
        return Err(format!("替换目录失败: {e}"));
    }

    if bak.exists() {
        let _ = std::fs::remove_dir_all(&bak);
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn is_dir_empty(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => true,
    }
}

// Release/MSI 不再随包预置任何插件（纯净宿主）。插件只通过商店安装到 plugins/ 目录。

#[tauri::command]
pub(crate) fn get_plugins_dir(app: tauri::AppHandle) -> String {
    // 统一使用 App 本地数据目录（避免 cwd 漂移），插件默认放到这里
    let plugins_dir = app_plugins_dir(&app);
    let _ = std::fs::create_dir_all(&plugins_dir);

    // 开发模式：把仓库里的 plugins 同步到本地数据目录（方便开发，且配合 fs scope 收紧）
    #[cfg(debug_assertions)]
    {
        fn collect_referenced_seed_files(manifest: &Value) -> Result<Vec<String>, String> {
            let mut out: Vec<String> = Vec::new();
            out.push("manifest.json".to_string());

            let main = manifest
                .get("main")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if main.is_empty() {
                return Err("manifest.main is required".to_string());
            }
            let _ = safe_relative_path(&main)?;
            out.push(main.clone());

            let bg_main = manifest
                .get("background")
                .and_then(|v| v.as_object())
                .and_then(|obj| obj.get("main"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if !bg_main.is_empty() && bg_main != main {
                let _ = safe_relative_path(&bg_main)?;
                out.push(bg_main);
            }

            let icon = manifest
                .get("icon")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if icon.starts_with("svg:") {
                let rel = icon["svg:".len()..].trim().to_string();
                if !rel.is_empty() && rel.to_ascii_lowercase().ends_with(".svg") {
                    let _ = safe_relative_path(&rel)?;
                    out.push(rel);
                }
            }

            // 去重（保持稳定顺序）
            let mut seen = std::collections::HashSet::<String>::new();
            out.retain(|p| seen.insert(p.clone()));
            Ok(out)
        }

        fn sync_repo_plugins_into(repo_plugins: &Path, plugins_dir: &Path) -> Result<(), String> {
            let Ok(entries) = std::fs::read_dir(repo_plugins) else {
                return Ok(());
            };

            for e in entries.flatten() {
                let Ok(ty) = e.file_type() else { continue };
                if !ty.is_dir() {
                    continue;
                }
                let plugin_id = e.file_name().to_string_lossy().to_string();
                if plugin_id.starts_with('.') || !is_safe_id(&plugin_id) {
                    continue;
                }

                let src = e.path();
                let manifest_path = src.join("manifest.json");
                if !manifest_path.is_file() {
                    continue;
                }

                let manifest_raw = match std::fs::read_to_string(&manifest_path) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let manifest: Value = match serde_json::from_str(&manifest_raw) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let files = match collect_referenced_seed_files(&manifest) {
                    Ok(v) => v,
                    Err(_) => vec!["manifest.json".to_string()],
                };

                let dst = plugins_dir.join(&plugin_id);
                let _ = std::fs::create_dir_all(&dst);
                for rel in files {
                    let from = src.join(&rel);
                    let to = dst.join(&rel);
                    if let Some(parent) = to.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    // dev 同步：尽力覆盖写入；失败不阻断其它插件（不破坏用户空间）
                    let _ = std::fs::copy(&from, &to);
                }
            }

            Ok(())
        }

        let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
        let repo_plugins = workspace_root.join("plugins");
        if repo_plugins.is_dir() && !same_path(&repo_plugins, &plugins_dir) {
            // 每次都覆盖同步：以仓库为真源。
            // 只同步运行时需要的最小集合（manifest/main/bg/icon），避免 node_modules 等大目录拖慢/失败。
            let _ = sync_repo_plugins_into(&repo_plugins, &plugins_dir);
        }
    }

    plugins_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub(crate) fn get_data_dir(app: tauri::AppHandle) -> String {
    // 统一使用 App 本地数据目录（避免 cwd 漂移）
    let data_dir = app_data_dir(&app);
    let _ = std::fs::create_dir_all(&data_dir);

    // 开发模式：仅在目标目录为空时，把仓库里的 data 迁移一份过来（不覆盖用户数据）
    #[cfg(debug_assertions)]
    {
        if is_dir_empty(&data_dir) {
            let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
            let repo_data = workspace_root.join("data");
            if repo_data.is_dir() && !same_path(&repo_data, &data_dir) {
                let _ = copy_dir_all(&repo_data, &data_dir);
            }
        }
    }

    data_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub(crate) fn open_data_root_dir(app: tauri::AppHandle) -> Result<(), String> {
    let root = app_local_base_dir(&app);
    open_dir_in_file_manager(&root)
}

#[tauri::command]
pub(crate) fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app_data_dir(&app);
    open_dir_in_file_manager(&dir)
}

#[tauri::command]
pub(crate) fn open_plugins_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app_plugins_dir(&app);
    open_dir_in_file_manager(&dir)
}

pub(crate) fn is_safe_id(id: &str) -> bool {
    if id.is_empty() {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn safe_relative_path(rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.is_absolute() {
        return Err("路径不允许为绝对路径".to_string());
    }
    for c in p.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err("路径不合法（不允许包含 .. 等）".to_string()),
        }
    }
    Ok(p.to_path_buf())
}

pub(crate) fn safe_relative_path_no_curdir(rel: &str) -> Result<PathBuf, String> {
    let p = safe_relative_path(rel)?;
    for c in Path::new(rel).components() {
        if matches!(c, Component::CurDir) {
            return Err("路径不合法（不允许包含 .）".to_string());
        }
    }
    Ok(p)
}

pub(crate) fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn percent_decode_query_component(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' => {
                if i + 2 >= bytes.len() {
                    return None;
                }
                let hi = hex_val(bytes[i + 1])?;
                let lo = hex_val(bytes[i + 2])?;
                out.push((hi << 4) | lo);
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

pub(crate) fn query_get_param(uri: &tauri::http::Uri, key: &str) -> Option<String> {
    let q = uri.query()?;
    for part in q.split('&') {
        if part.is_empty() {
            continue;
        }
        let (k_raw, v_raw) = part.split_once('=').unwrap_or((part, ""));
        let k = percent_decode_query_component(k_raw).unwrap_or_else(|| k_raw.to_string());
        if k != key {
            continue;
        }
        let v = percent_decode_query_component(v_raw).unwrap_or_else(|| v_raw.to_string());
        return Some(v);
    }
    None
}

#[derive(Clone, Serialize)]
pub(crate) struct FsDirEntry {
    name: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
}

#[tauri::command]
pub(crate) fn list_plugins(app: tauri::AppHandle) -> Vec<String> {
    let dir = app_plugins_dir(&app);
    let mut out: Vec<String> = Vec::new();

    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };

    for e in entries.flatten() {
        let Ok(ty) = e.file_type() else {
            continue;
        };
        if !ty.is_dir() {
            continue;
        }
        // 目录里没有 manifest.json 就不认为是插件，避免空目录/残留目录造成噪音。
        if !e.path().join("manifest.json").is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if is_safe_id(&name) {
            out.push(name);
        }
    }

    out.sort();
    out
}

#[tauri::command]
pub(crate) fn read_plugin_file(
    app: tauri::AppHandle,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let rel = safe_relative_path(&path)?;

    let plugin_dir = app_plugins_dir(&app).join(&plugin_id);
    let full = plugin_dir.join(rel);
    std::fs::read_to_string(&full).map_err(|e| format!("读取插件文件失败: {e}"))
}

#[tauri::command]
pub(crate) fn read_plugin_file_base64(
    app: tauri::AppHandle,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let rel = safe_relative_path(&path)?;

    let plugin_dir = app_plugins_dir(&app).join(&plugin_id);
    let full = plugin_dir.join(rel);
    let bytes = std::fs::read(&full).map_err(|e| format!("读取插件文件失败: {e}"))?;
    if bytes.len() > 512 * 1024 {
        return Err("图标文件过大（>512KB）".to_string());
    }
    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub(crate) fn set_plugin_auto_update_enabled(
    app: tauri::AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let plugin_dir = app_plugins_dir(&app).join(&plugin_id);
    if !plugin_dir.is_dir() || !plugin_dir.join("manifest.json").is_file() {
        return Err("插件不存在或缺少 manifest.json".to_string());
    }

    let mut prefs = read_plugin_auto_update_prefs(&app);
    // 默认：false。只持久化 true（开启）即可，避免文件变大。
    if enabled {
        prefs.insert(plugin_id, true);
    } else {
        prefs.remove(&plugin_id);
    }
    write_plugin_auto_update_prefs(&app, &prefs)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_plugins_auto_update_enabled(app: tauri::AppHandle) -> Vec<String> {
    let prefs = read_plugin_auto_update_prefs(&app);
    let ids = list_plugins(app.clone());
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        if prefs.get(&id).copied().unwrap_or(false) == true {
            out.push(id);
        }
    }
    out.sort();
    out
}

// 兼容旧前端/旧命令名：过去用于“允许覆盖更新”，现在语义改为“自动更新”。
#[tauri::command]
pub(crate) fn set_plugin_allow_overwrite_on_update(
    app: tauri::AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    set_plugin_auto_update_enabled(app, plugin_id, enabled)
}

#[tauri::command]
pub(crate) fn get_plugins_allow_overwrite_on_update(app: tauri::AppHandle) -> Vec<String> {
    get_plugins_auto_update_enabled(app)
}

#[tauri::command]
pub(crate) fn read_plugins_dir(
    app: tauri::AppHandle,
    rel_dir: String,
) -> Result<Vec<FsDirEntry>, String> {
    let rel = safe_relative_path(&rel_dir)?;
    let base = app_plugins_dir(&app);
    let dir = base.join(rel);

    let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {e}"))?;
    let mut out: Vec<FsDirEntry> = Vec::new();

    for e in entries {
        let e = e.map_err(|e| format!("读取目录项失败: {e}"))?;
        let ty = e
            .file_type()
            .map_err(|e| format!("读取目录项类型失败: {e}"))?;
        out.push(FsDirEntry {
            name: e.file_name().to_string_lossy().to_string(),
            is_directory: ty.is_dir(),
        });
    }

    Ok(out)
}

#[derive(Deserialize)]
pub(crate) struct PluginWriteFile {
    path: String,
    bytes: Vec<u8>,
}

#[tauri::command]
pub(crate) fn install_plugin_files(
    app: tauri::AppHandle,
    plugin_id: String,
    overwrite: bool,
    files: Vec<PluginWriteFile>,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    if files.is_empty() {
        return Err("没有可安装的文件".to_string());
    }
    if files.len() > 256 {
        return Err("文件数量过多".to_string());
    }

    let total: usize = files.iter().map(|f| f.bytes.len()).sum();
    if total > 10 * 1024 * 1024 {
        return Err("插件体积过大".to_string());
    }

    let base = app_plugins_dir(&app);
    std::fs::create_dir_all(&base).map_err(|e| format!("创建插件目录失败: {e}"))?;

    let plugin_dir = base.join(&plugin_id);
    if plugin_dir.exists() && !overwrite {
        return Err("同 ID 插件已存在（未勾选覆盖）".to_string());
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let tmp_dir = base.join(format!(".tmp-install-{plugin_id}-{stamp}"));
    if tmp_dir.exists() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
    if let Err(e) = std::fs::create_dir_all(&tmp_dir) {
        return Err(format!("创建临时目录失败: {e}"));
    }

    for f in &files {
        let rel = match safe_relative_path(&f.path) {
            Ok(p) => p,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return Err(e);
            }
        };
        let full = tmp_dir.join(rel);
        if let Some(parent) = full.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return Err(format!("创建目录失败: {e}"));
            }
        }
        if let Err(e) = std::fs::write(&full, &f.bytes) {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(format!("写入插件文件失败: {e}"));
        }
    }

    if let Err(e) = replace_dir_from_tmp(&plugin_dir, &tmp_dir, &format!("install-{plugin_id}")) {
        return Err(format!("安装插件失败: {e}"));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginStoreInstallResult {
    #[serde(rename = "pluginId")]
    plugin_id: String,
    version: String,
}

#[tauri::command]
pub(crate) async fn plugin_store_install(
    app: tauri::AppHandle,
    url: String,
    expected_sha256: String,
    expected_id: String,
    expected_version: String,
    expected_requires: Vec<String>,
) -> Result<PluginStoreInstallResult, String> {
    let u = url.trim().to_string();
    if u.is_empty() {
        return Err("url 不能为空".to_string());
    }
    if !is_https_url(&u) {
        return Err("url 必须以 https:// 开头".to_string());
    }
    let expected = parse_sha256_hex_32(&expected_sha256)?;

    let expected_id = expected_id.trim().to_string();
    if !is_safe_id(&expected_id) {
        return Err("expectedId 不合法（仅允许字母/数字/_/-）".to_string());
    }
    let expected_version = expected_version.trim().to_string();
    if expected_version.is_empty() {
        return Err("expectedVersion 不能为空".to_string());
    }
    if expected_requires.len() > 256 {
        return Err("expectedRequires 数量过多".to_string());
    }
    let mut expected_requires_set = BTreeSet::<String>::new();
    for it in expected_requires {
        let s = it.trim().to_string();
        if s.is_empty() {
            continue;
        }
        if !s.starts_with("tauri:") || s.len() > 256 || s.contains('\n') || s.contains('\r') {
            return Err("expectedRequires 存在不合法能力声明".to_string());
        }
        expected_requires_set.insert(s);
    }

    let plugins_dir = app_plugins_dir(&app);
    std::fs::create_dir_all(&plugins_dir).map_err(|e| format!("创建插件目录失败: {e}"))?;

    // 用户空间优先：如果目标路径已存在但不是“已安装插件目录”，拒绝覆盖。
    let dst_dir = plugins_dir.join(&expected_id);
    if dst_dir.exists() {
        if !dst_dir.is_dir() {
            return Err("目标插件路径已存在但不是目录，拒绝覆盖".to_string());
        }
        if !dst_dir.join("manifest.json").is_file() {
            return Err("目标插件目录已存在但缺少 manifest.json，拒绝覆盖".to_string());
        }
    }

    let stamp = now_ms();
    let rnd = rand_u32(stamp);
    let tmp_zip = plugins_dir.join(format!(".tmp-download-{stamp}-{rnd:08x}.zip"));
    if tmp_zip.exists() {
        let _ = tokio::fs::remove_file(&tmp_zip).await;
    }

    let client = reqwest::Client::builder()
        .user_agent(format!("fast-window/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|e| format!("创建 http client 失败: {e}"))?;

    let resp = client
        .get(&u)
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status().as_u16()));
    }

    let mut total = 0usize;
    let mut hasher = Sha256::new();
    let mut f = tokio::fs::File::create(&tmp_zip)
        .await
        .map_err(|e| format!("创建临时文件失败: {e}"))?;

    let mut r = resp;
    let download_result: Result<(), String> = (async {
        while let Some(chunk) = r
            .chunk()
            .await
            .map_err(|e| format!("读取下载流失败: {e}"))?
        {
            total = total.saturating_add(chunk.len());
            if total > PLUGIN_STORE_MAX_ZIP_BYTES {
                return Err("压缩包过大（>50MB）".to_string());
            }
            hasher.update(&chunk);
            f.write_all(&chunk)
                .await
                .map_err(|e| format!("写入临时文件失败: {e}"))?;
        }
        f.flush()
            .await
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        Ok(())
    })
    .await;

    if let Err(e) = download_result {
        let _ = tokio::fs::remove_file(&tmp_zip).await;
        return Err(e);
    }

    let actual = hasher.finalize();
    if actual.as_slice() != expected.as_slice() {
        let _ = tokio::fs::remove_file(&tmp_zip).await;
        return Err(format!(
            "sha256 校验失败：expected={}, got={}",
            to_hex_lower(&expected),
            to_hex_lower(actual.as_slice())
        ));
    }

    let plugins_dir2 = plugins_dir.clone();
    let zip_path2 = tmp_zip.clone();
    let expected_id2 = expected_id.clone();
    let expected_version2 = expected_version.clone();
    let expected_requires2: BTreeSet<String> = expected_requires_set.clone();
    let install_result: Result<PluginStoreInstallResult, String> =
        match tokio::task::spawn_blocking(move || -> Result<PluginStoreInstallResult, String> {
            use std::io::Read;
            use zip::ZipArchive;

            let file =
                std::fs::File::open(&zip_path2).map_err(|e| format!("打开压缩包失败: {e}"))?;
            let mut zip = ZipArchive::new(file).map_err(|e| format!("解析压缩包失败: {e}"))?;

            let mut manifest_idx: Option<usize> = None;
            let mut manifest_name = String::new();
            for i in 0..zip.len() {
                let zf = zip
                    .by_index(i)
                    .map_err(|e| format!("读取压缩包条目失败: {e}"))?;
                if zf.is_dir() {
                    continue;
                }
                let name = normalize_zip_name(zf.name());
                if name.ends_with("manifest.json") {
                    if manifest_idx.is_some() {
                        return Err("压缩包内存在多个 manifest.json，拒绝安装".to_string());
                    }
                    manifest_idx = Some(i);
                    manifest_name = name;
                }
            }

            let idx = manifest_idx.ok_or_else(|| "压缩包缺少 manifest.json".to_string())?;
            let prefix = manifest_name
                .strip_suffix("manifest.json")
                .unwrap_or("")
                .to_string();

            let mut mf = zip
                .by_index(idx)
                .map_err(|e| format!("读取 manifest.json 失败: {e}"))?;
            let mut manifest_text = String::new();
            mf.read_to_string(&mut manifest_text)
                .map_err(|e| format!("读取 manifest.json 失败: {e}"))?;
            drop(mf);
            let manifest: Value = serde_json::from_str(&manifest_text)
                .map_err(|e| format!("manifest.json 解析失败: {e}"))?;

            let plugin_id = manifest
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if !is_safe_id(&plugin_id) {
                return Err("manifest.id 不合法（仅允许字母/数字/_/-）".to_string());
            }
            if plugin_id != expected_id2 {
                return Err(format!(
                    "manifest.id 不匹配：expected={}, got={}",
                    expected_id2, plugin_id
                ));
            }

            let name = manifest
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if name.is_empty() {
                return Err("manifest.name 不能为空".to_string());
            }

            let version = manifest
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if version.is_empty() {
                return Err("manifest.version 不能为空".to_string());
            }
            if version != expected_version2 {
                return Err(format!(
                    "manifest.version 不匹配：expected={}, got={}",
                    expected_version2, version
                ));
            }

            let _description = manifest
                .get("description")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "manifest.description 必须是字符串".to_string())?;

            let api_version = manifest
                .get("apiVersion")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            if api_version != 2 {
                return Err("manifest.apiVersion 必须为 2".to_string());
            }

            let ui_type = manifest
                .get("ui")
                .and_then(|v| v.as_object())
                .and_then(|obj| obj.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if ui_type != "iframe" {
                return Err("manifest.ui.type 必须为 \"iframe\"".to_string());
            }

            let requires = manifest
                .get("requires")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "manifest.requires 必须是数组（即使为空）".to_string())?;
            let mut actual_requires_set = BTreeSet::<String>::new();
            for item in requires {
                let cap = item.as_str().unwrap_or("").trim();
                if cap.is_empty()
                    || !cap.starts_with("tauri:")
                    || cap.len() > 256
                    || cap.contains('\n')
                    || cap.contains('\r')
                {
                    return Err("manifest.requires 存在不合法能力声明".to_string());
                }
                actual_requires_set.insert(cap.to_string());
            }
            if actual_requires_set != expected_requires2 {
                let expected_list = expected_requires2.iter().cloned().collect::<Vec<_>>();
                let actual_list = actual_requires_set.iter().cloned().collect::<Vec<_>>();
                return Err(format!(
                    "manifest.requires 不匹配：expected={:?}, got={:?}",
                    expected_list, actual_list
                ));
            }

            let main = manifest
                .get("main")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if main.is_empty() {
                return Err("manifest.main 不能为空".to_string());
            }
            let main_rel = safe_relative_path_no_curdir(&main)?;

            let bg_main = manifest
                .get("background")
                .and_then(|v| v.as_object())
                .and_then(|obj| obj.get("main"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let bg_rel = if !bg_main.is_empty() && bg_main != main {
                Some(safe_relative_path_no_curdir(&bg_main)?)
            } else {
                None
            };

            let icon = manifest
                .get("icon")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let icon_rel = if icon.starts_with("svg:") {
                let rel = icon["svg:".len()..].trim().to_string();
                if rel.is_empty() {
                    None
                } else {
                    Some(safe_relative_path_no_curdir(&rel)?)
                }
            } else {
                None
            };

            let tmp_dir = plugins_dir2.join(format!(".tmp-install-{plugin_id}-{stamp}"));
            if tmp_dir.exists() {
                let _ = std::fs::remove_dir_all(&tmp_dir);
            }
            std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

            let mut extracted_bytes = 0usize;
            let mut extracted_files = 0usize;

            let extract_result = (|| -> Result<(), String> {
                for i in 0..zip.len() {
                    let mut zf = zip
                        .by_index(i)
                        .map_err(|e| format!("读取压缩包条目失败: {e}"))?;
                    let raw_name = normalize_zip_name(zf.name());
                    if !raw_name.starts_with(&prefix) {
                        continue;
                    }
                    let rel_raw = raw_name[prefix.len()..].to_string();
                    if rel_raw.is_empty() {
                        continue;
                    }

                    if zf.is_dir() {
                        let rel = safe_relative_path_no_curdir(&rel_raw)?;
                        let full = tmp_dir.join(rel);
                        std::fs::create_dir_all(&full).map_err(|e| format!("创建目录失败: {e}"))?;
                        continue;
                    }

                    extracted_files += 1;
                    if extracted_files > 512 {
                        return Err("文件数量过多（>512）".to_string());
                    }

                    let rel = safe_relative_path_no_curdir(&rel_raw)?;
                    let full = tmp_dir.join(rel);
                    if let Some(parent) = full.parent() {
                        std::fs::create_dir_all(parent)
                            .map_err(|e| format!("创建目录失败: {e}"))?;
                    }

                    let mut out =
                        std::fs::File::create(&full).map_err(|e| format!("写入文件失败: {e}"))?;
                    let copied = std::io::copy(&mut zf, &mut out)
                        .map_err(|e| format!("解压失败: {e}"))?
                        as usize;
                    extracted_bytes = extracted_bytes.saturating_add(copied);
                    if extracted_bytes > PLUGIN_STORE_MAX_EXTRACT_BYTES {
                        return Err("解压后体积过大（>120MB）".to_string());
                    }
                }
                Ok(())
            })();

            if let Err(e) = extract_result {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return Err(e);
            }

            if !tmp_dir.join("manifest.json").is_file() {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return Err("解压结果缺少 manifest.json".to_string());
            }
            if !tmp_dir.join(&main_rel).is_file() {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return Err("插件入口文件不存在（manifest.main）".to_string());
            }
            if let Some(bg) = bg_rel.as_ref() {
                if !tmp_dir.join(bg).is_file() {
                    let _ = std::fs::remove_dir_all(&tmp_dir);
                    return Err("后台入口文件不存在（manifest.background.main）".to_string());
                }
            }
            if let Some(svg) = icon_rel.as_ref() {
                if !tmp_dir.join(svg).is_file() {
                    let _ = std::fs::remove_dir_all(&tmp_dir);
                    return Err("插件图标文件不存在（manifest.icon=svg:...）".to_string());
                }
            }

            // 二次校验：以“解压后的 manifest.json”为准，防止前端展示与实际安装不一致。
            let extracted_manifest_text = std::fs::read_to_string(tmp_dir.join("manifest.json"))
                .map_err(|e| format!("读取解压后的 manifest.json 失败: {e}"))?;
            let extracted_manifest: Value = serde_json::from_str(&extracted_manifest_text)
                .map_err(|e| format!("解压后的 manifest.json 解析失败: {e}"))?;

            let extracted_id = extracted_manifest
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let extracted_version = extracted_manifest
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let extracted_requires = extracted_manifest
                .get("requires")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "解压后的 manifest.requires 必须是数组（即使为空）".to_string())?;
            let mut extracted_requires_set = BTreeSet::<String>::new();
            for item in extracted_requires {
                let cap = item.as_str().unwrap_or("").trim();
                if cap.is_empty()
                    || !cap.starts_with("tauri:")
                    || cap.len() > 256
                    || cap.contains('\n')
                    || cap.contains('\r')
                {
                    let _ = std::fs::remove_dir_all(&tmp_dir);
                    return Err("解压后的 manifest.requires 存在不合法能力声明".to_string());
                }
                extracted_requires_set.insert(cap.to_string());
            }

            if extracted_id != expected_id2 {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return Err(format!(
                    "解压后的 manifest.id 不匹配：expected={}, got={}",
                    expected_id2, extracted_id
                ));
            }
            if extracted_version != expected_version2 {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return Err(format!(
                    "解压后的 manifest.version 不匹配：expected={}, got={}",
                    expected_version2, extracted_version
                ));
            }
            if extracted_requires_set != expected_requires2 {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                let expected_list = expected_requires2.iter().cloned().collect::<Vec<_>>();
                let actual_list = extracted_requires_set.iter().cloned().collect::<Vec<_>>();
                return Err(format!(
                    "解压后的 manifest.requires 不匹配：expected={:?}, got={:?}",
                    expected_list, actual_list
                ));
            }

            let dst = plugins_dir2.join(&plugin_id);
            if let Err(e) = replace_dir_from_tmp(&dst, &tmp_dir, &format!("store-{plugin_id}")) {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return Err(format!("安装插件失败: {e}"));
            }

            Ok(PluginStoreInstallResult { plugin_id, version })
        })
        .await
        {
            Ok(r) => r,
            Err(_) => Err("安装插件失败: 后台任务异常退出".to_string()),
        };

    let _ = tokio::fs::remove_file(&tmp_zip).await;
    install_result
}


