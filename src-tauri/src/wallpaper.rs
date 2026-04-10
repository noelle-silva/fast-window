use super::*;

const WALLPAPER_SETTINGS_KEY: &str = "wallpaper";
const APP_ICON_OVERRIDES_KEY: &str = "pluginIconOverrides";

#[derive(Clone)]
struct WallpaperView {
    x: f32,
    y: f32,
    scale: f32,
}

fn parse_wallpaper_view(v: &Value) -> Option<WallpaperView> {
    let Value::Object(obj) = v else {
        return None;
    };
    let x = obj.get("x").and_then(|v| v.as_f64()).map(|v| v as f32)?;
    let y = obj.get("y").and_then(|v| v.as_f64()).map(|v| v as f32)?;
    let scale = obj
        .get("scale")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)?;
    Some(WallpaperView {
        x: clamp_f32(x, 0.0, 100.0),
        y: clamp_f32(y, 0.0, 100.0),
        scale: clamp_f32(scale, 1.0, 4.0),
    })
}

fn wallpaper_view_to_value(view: &WallpaperView) -> Value {
    let mut obj = Map::new();
    obj.insert(
        "x".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(view.x, 0.0, 100.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(50.0).unwrap()),
        ),
    );
    obj.insert(
        "y".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(view.y, 0.0, 100.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(50.0).unwrap()),
        ),
    );
    obj.insert(
        "scale".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(view.scale, 1.0, 4.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(1.0).unwrap()),
        ),
    );
    Value::Object(obj)
}

#[derive(Clone, Serialize)]
pub(crate) struct WallpaperViewOut {
    x: f32,
    y: f32,
    scale: f32,
}

fn wallpaper_view_out(v: Option<&WallpaperView>) -> WallpaperViewOut {
    let Some(v) = v else {
        return WallpaperViewOut {
            x: 50.0,
            y: 50.0,
            scale: 1.0,
        };
    };
    WallpaperViewOut {
        x: clamp_f32(v.x, 0.0, 100.0),
        y: clamp_f32(v.y, 0.0, 100.0),
        scale: clamp_f32(v.scale, 1.0, 4.0),
    }
}

#[derive(Clone)]
pub(crate) struct WallpaperItem {
    id: String,
    pub(crate) rel_path: String,
    view: Option<WallpaperView>,
}

#[derive(Clone)]
pub(crate) struct WallpaperConfig {
    enabled: bool,
    opacity: f32,
    blur: f32,
    titlebar_opacity: f32,
    titlebar_blur: f32,
    items: Vec<WallpaperItem>,
    active_id: Option<String>,
}

#[derive(Clone, Serialize)]
pub(crate) struct WallpaperItemOut {
    id: String,
    rev: u64,
}

#[derive(Clone, Serialize)]
pub(crate) struct WallpaperSettingsOut {
    enabled: bool,
    opacity: f32,
    blur: f32,
    #[serde(rename = "titlebarOpacity")]
    titlebar_opacity: f32,
    #[serde(rename = "titlebarBlur")]
    titlebar_blur: f32,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
    rev: u64,
    items: Vec<WallpaperItemOut>,
    #[serde(rename = "activeId")]
    active_id: Option<String>,
    view: Option<WallpaperViewOut>,
}

fn clamp_f32(v: f32, min: f32, max: f32) -> f32 {
    if v.is_nan() {
        return min;
    }
    v.max(min).min(max)
}

pub(crate) fn read_wallpaper_config(app: &tauri::AppHandle) -> Result<WallpaperConfig, String> {
    let vp = storage_value_path(app, "__app", WALLPAPER_SETTINGS_KEY)?;
    let obj = if vp.is_file() {
        match read_json_value(&vp)? {
            Value::Object(obj) => Some(obj),
            _ => None,
        }
    } else {
        None
    };
    let Some(obj) = obj else {
        return Ok(WallpaperConfig {
            enabled: false,
            opacity: 0.65,
            blur: 0.0,
            titlebar_opacity: 0.62,
            titlebar_blur: 12.0,
            items: Vec::new(),
            active_id: None,
        });
    };

    let enabled = obj
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let opacity = obj
        .get("opacity")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(0.65);
    let blur = obj
        .get("blur")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(0.0);
    let titlebar_opacity = obj
        .get("titlebarOpacity")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(0.62);
    let titlebar_blur = obj
        .get("titlebarBlur")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(12.0);
    let active_id = obj
        .get("activeId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && is_safe_id(s))
        .map(|s| s.to_string());

    let mut items: Vec<WallpaperItem> = Vec::new();
    if let Some(Value::Array(arr)) = obj.get("items") {
        for v in arr {
            let Value::Object(it) = v else { continue };
            let Some(id) = it
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            if !is_safe_id(id) {
                continue;
            }
            let Some(rel_raw) = it
                .get("path")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            let rel = rel_raw.to_string();
            if safe_relative_path(&rel).is_err() {
                continue;
            }
            if items.iter().any(|x| x.id == id) {
                continue;
            }
            let view = it.get("view").and_then(parse_wallpaper_view);
            items.push(WallpaperItem {
                id: id.to_string(),
                rel_path: rel,
                view,
            });
        }
    }

    // 兼容旧格式：path 单值
    let mut legacy_added = false;
    if items.is_empty() {
        let legacy_rel = obj
            .get("path")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .and_then(|s| safe_relative_path(&s).ok().map(|_| s));
        if let Some(rel) = legacy_rel {
            items.push(WallpaperItem {
                id: "legacy".to_string(),
                rel_path: rel,
                view: None,
            });
            legacy_added = true;
        }
    }

    let mut active_id = active_id;
    if active_id.is_none() && legacy_added {
        active_id = Some("legacy".to_string());
    }
    if active_id.is_none() && items.len() == 1 {
        active_id = Some(items[0].id.clone());
    }

    Ok(WallpaperConfig {
        enabled,
        opacity: clamp_f32(opacity, 0.0, 1.0),
        blur: clamp_f32(blur, 0.0, 40.0),
        titlebar_opacity: clamp_f32(titlebar_opacity, 0.0, 1.0),
        titlebar_blur: clamp_f32(titlebar_blur, 0.0, 40.0),
        items,
        active_id,
    })
}

fn wallpaper_item_rev(app: &tauri::AppHandle, rel_path: &str) -> u64 {
    safe_relative_path(rel_path)
        .ok()
        .map(|rel_ok| app_data_dir(app).join(rel_ok))
        .and_then(|full| std::fs::metadata(full).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn resolve_wallpaper_item<'a>(
    app: &tauri::AppHandle,
    cfg: &'a WallpaperConfig,
    want_id: Option<&str>,
) -> Option<&'a WallpaperItem> {
    let data_root = app_data_dir(app);
    let is_ok = |it: &'a WallpaperItem| {
        safe_relative_path(&it.rel_path)
            .ok()
            .map(|rel_ok| data_root.join(rel_ok))
            .filter(|full| full.is_file())
            .is_some()
    };

    if let Some(id) = want_id.filter(|id| is_safe_id(id)) {
        if let Some(it) = cfg.items.iter().find(|x| x.id == id) {
            if is_ok(it) {
                return Some(it);
            }
        }
    }
    if let Some(id) = cfg.active_id.as_deref() {
        if let Some(it) = cfg.items.iter().find(|x| x.id == id) {
            if is_ok(it) {
                return Some(it);
            }
        }
    }
    cfg.items.iter().find(|it| is_ok(it))
}

fn write_wallpaper_config(app: &tauri::AppHandle, cfg: &WallpaperConfig) -> Result<(), String> {
    let mut obj = Map::new();
    obj.insert("enabled".to_string(), Value::Bool(cfg.enabled));
    obj.insert(
        "opacity".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(cfg.opacity, 0.0, 1.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(0.65).unwrap()),
        ),
    );
    obj.insert(
        "blur".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(cfg.blur, 0.0, 40.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(0.0).unwrap()),
        ),
    );
    obj.insert(
        "titlebarOpacity".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(cfg.titlebar_opacity, 0.0, 1.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(0.62).unwrap()),
        ),
    );
    obj.insert(
        "titlebarBlur".to_string(),
        Value::Number(
            serde_json::Number::from_f64(clamp_f32(cfg.titlebar_blur, 0.0, 40.0) as f64)
                .unwrap_or_else(|| serde_json::Number::from_f64(12.0).unwrap()),
        ),
    );

    let mut arr: Vec<Value> = Vec::new();
    for it in &cfg.items {
        if !is_safe_id(&it.id) {
            continue;
        }
        if safe_relative_path(&it.rel_path).is_err() {
            continue;
        }
        let mut it_obj = Map::new();
        it_obj.insert("id".to_string(), Value::String(it.id.clone()));
        it_obj.insert("path".to_string(), Value::String(it.rel_path.clone()));
        if let Some(view) = it.view.as_ref() {
            it_obj.insert("view".to_string(), wallpaper_view_to_value(view));
        }
        arr.push(Value::Object(it_obj));
    }
    obj.insert("items".to_string(), Value::Array(arr));

    if let Some(id) = cfg.active_id.as_ref().filter(|s| is_safe_id(s)) {
        obj.insert("activeId".to_string(), Value::String(id.clone()));
    }

    // 兼容旧版本读取：保留 path 单值（当前激活项）
    if let Some(it) = resolve_wallpaper_item(app, cfg, None) {
        obj.insert("path".to_string(), Value::String(it.rel_path.clone()));
    }

    let vp = storage_value_path(app, "__app", WALLPAPER_SETTINGS_KEY)?;
    write_json_value(&vp, &Value::Object(obj))
}

fn wallpaper_settings_out(app: &tauri::AppHandle, cfg: &WallpaperConfig) -> WallpaperSettingsOut {
    let resolved = resolve_wallpaper_item(app, cfg, None);
    let file_path = resolved
        .and_then(|it| {
            safe_relative_path(&it.rel_path)
                .ok()
                .map(|rel_ok| app_data_dir(app).join(rel_ok))
        })
        .filter(|full| full.is_file())
        .map(|full| full.to_string_lossy().to_string());
    let rev = resolved
        .map(|it| wallpaper_item_rev(app, &it.rel_path))
        .unwrap_or(0);
    let view = file_path
        .as_ref()
        .and_then(|_| resolved.map(|it| wallpaper_view_out(it.view.as_ref())));

    let mut items: Vec<WallpaperItemOut> = Vec::new();
    for it in &cfg.items {
        let full = safe_relative_path(&it.rel_path)
            .ok()
            .map(|rel_ok| app_data_dir(app).join(rel_ok));
        let Some(full) = full else { continue };
        if !full.is_file() {
            continue;
        }
        items.push(WallpaperItemOut {
            id: it.id.clone(),
            rev: wallpaper_item_rev(app, &it.rel_path),
        });
    }

    let enabled = cfg.enabled && file_path.is_some();
    WallpaperSettingsOut {
        enabled,
        opacity: clamp_f32(cfg.opacity, 0.0, 1.0),
        blur: clamp_f32(cfg.blur, 0.0, 40.0),
        titlebar_opacity: clamp_f32(cfg.titlebar_opacity, 0.0, 1.0),
        titlebar_blur: clamp_f32(cfg.titlebar_blur, 0.0, 40.0),
        file_path,
        rev,
        items,
        active_id: resolved.map(|it| it.id.clone()),
        view,
    }
}

#[tauri::command]
pub(crate) fn get_wallpaper_settings(app: tauri::AppHandle) -> Result<WallpaperSettingsOut, String> {
    let cfg = read_wallpaper_config(&app)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
pub(crate) fn set_wallpaper_settings(
    app: tauri::AppHandle,
    enabled: bool,
    opacity: f32,
    blur: f32,
    titlebar_opacity: Option<f32>,
    titlebar_blur: Option<f32>,
) -> Result<WallpaperSettingsOut, String> {
    let mut cfg = read_wallpaper_config(&app)?;
    cfg.opacity = clamp_f32(opacity, 0.0, 1.0);
    cfg.blur = clamp_f32(blur, 0.0, 40.0);
    if let Some(v) = titlebar_opacity {
        cfg.titlebar_opacity = clamp_f32(v, 0.0, 1.0);
    }
    if let Some(v) = titlebar_blur {
        cfg.titlebar_blur = clamp_f32(v, 0.0, 40.0);
    }
    let has_file = resolve_wallpaper_item(&app, &cfg, None).is_some();
    cfg.enabled = enabled && has_file;
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
pub(crate) fn set_wallpaper_view(
    app: tauri::AppHandle,
    id: Option<String>,
    x: f32,
    y: f32,
    scale: f32,
) -> Result<WallpaperSettingsOut, String> {
    let want_id = id
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    if let Some(id) = want_id.as_ref() {
        if !is_safe_id(id) {
            return Err("壁纸 id 不合法".to_string());
        }
    }

    let mut cfg = read_wallpaper_config(&app)?;
    let resolved_id =
        resolve_wallpaper_item(&app, &cfg, want_id.as_deref()).map(|it| it.id.clone());
    let Some(resolved_id) = resolved_id else {
        return Err("壁纸不存在".to_string());
    };
    let Some(target) = cfg.items.iter_mut().find(|it| it.id == resolved_id) else {
        return Err("壁纸不存在".to_string());
    };

    target.view = Some(WallpaperView {
        x: clamp_f32(x, 0.0, 100.0),
        y: clamp_f32(y, 0.0, 100.0),
        scale: clamp_f32(scale, 1.0, 4.0),
    });
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
pub(crate) fn set_wallpaper_image(
    app: tauri::AppHandle,
    data_url: String,
) -> Result<WallpaperSettingsOut, String> {
    let (bytes, ext) = decode_base64_image_payload(&data_url)?;
    if bytes.is_empty() {
        return Err("图片数据为空".to_string());
    }
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("图片过大（>12MB）".to_string());
    }

    let rel_dir = "__app/wallpaper";
    let mut cfg = read_wallpaper_config(&app)?;
    let dir = app_data_dir(&app).join(rel_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut id = format!("{now_ms}");
    if !is_safe_id(&id) {
        id = "wallpaper".to_string();
    }
    let mut filename = format!("{id}.{ext}");
    let mut attempt = 0u32;
    loop {
        let full = dir.join(&filename);
        if !full.exists() {
            std::fs::write(&full, &bytes).map_err(|e| format!("写入壁纸失败: {e}"))?;
            break;
        }
        attempt += 1;
        id = format!("{now_ms}-{attempt}");
        filename = format!("{id}.{ext}");
        if attempt > 128 {
            return Err("生成壁纸文件名失败".to_string());
        }
    }

    let new_rel = format!("{rel_dir}/{filename}");
    cfg.items.retain(|x| x.id != id);
    cfg.items.push(WallpaperItem {
        id: id.clone(),
        rel_path: new_rel,
        view: Some(WallpaperView {
            x: 50.0,
            y: 50.0,
            scale: 1.0,
        }),
    });
    cfg.active_id = Some(id);
    cfg.enabled = true;
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
pub(crate) fn remove_wallpaper(app: tauri::AppHandle) -> Result<WallpaperSettingsOut, String> {
    let mut cfg = read_wallpaper_config(&app)?;
    for it in &cfg.items {
        if let Ok(old_rel) = safe_relative_path(&it.rel_path) {
            let old_full = app_data_dir(&app).join(old_rel);
            let _ = std::fs::remove_file(old_full);
        }
    }
    cfg.items.clear();
    cfg.active_id = None;
    cfg.enabled = false;
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
pub(crate) fn set_active_wallpaper(
    app: tauri::AppHandle,
    id: String,
) -> Result<WallpaperSettingsOut, String> {
    let id = id.trim().to_string();
    if !is_safe_id(&id) {
        return Err("壁纸 id 不合法".to_string());
    }
    let mut cfg = read_wallpaper_config(&app)?;
    let Some(it) = cfg.items.iter().find(|x| x.id == id) else {
        return Err("壁纸不存在".to_string());
    };
    let full = safe_relative_path(&it.rel_path)
        .ok()
        .map(|rel_ok| app_data_dir(&app).join(rel_ok))
        .filter(|full| full.is_file());
    if full.is_none() {
        return Err("壁纸文件不存在".to_string());
    }
    cfg.active_id = Some(id);
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
pub(crate) fn remove_wallpaper_item(
    app: tauri::AppHandle,
    id: String,
) -> Result<WallpaperSettingsOut, String> {
    let id = id.trim().to_string();
    if !is_safe_id(&id) {
        return Err("壁纸 id 不合法".to_string());
    }
    let mut cfg = read_wallpaper_config(&app)?;
    let idx = cfg.items.iter().position(|x| x.id == id);
    let Some(idx) = idx else {
        return Err("壁纸不存在".to_string());
    };
    if let Ok(rel) = safe_relative_path(&cfg.items[idx].rel_path) {
        let full = app_data_dir(&app).join(rel);
        let _ = std::fs::remove_file(full);
    }
    cfg.items.remove(idx);

    if cfg.active_id.as_deref() == Some(&id) {
        cfg.active_id = None;
        if let Some(next) = resolve_wallpaper_item(&app, &cfg, None) {
            cfg.active_id = Some(next.id.clone());
        }
    }
    if resolve_wallpaper_item(&app, &cfg, None).is_none() {
        cfg.enabled = false;
    }
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
pub(crate) fn cycle_wallpaper(
    app: tauri::AppHandle,
    delta: i32,
) -> Result<WallpaperSettingsOut, String> {
    let mut cfg = read_wallpaper_config(&app)?;
    if cfg.items.len() < 2 {
        return Ok(wallpaper_settings_out(&app, &cfg));
    }
    let mut existing: Vec<&WallpaperItem> = Vec::new();
    for it in &cfg.items {
        let full = safe_relative_path(&it.rel_path)
            .ok()
            .map(|rel_ok| app_data_dir(&app).join(rel_ok));
        match full {
            Some(f) if f.is_file() => existing.push(it),
            _ => {}
        }
    }
    if existing.len() < 2 {
        return Ok(wallpaper_settings_out(&app, &cfg));
    }

    let current = resolve_wallpaper_item(&app, &cfg, None);
    let cur_idx = current
        .and_then(|it| existing.iter().position(|x| x.id == it.id))
        .unwrap_or(0);
    let len = existing.len() as i32;
    let next_idx = (cur_idx as i32 + delta).rem_euclid(len) as usize;
    cfg.active_id = Some(existing[next_idx].id.clone());
    write_wallpaper_config(&app, &cfg)?;
    Ok(wallpaper_settings_out(&app, &cfg))
}

#[tauri::command]
pub(crate) fn get_plugin_icon_overrides(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let vp = storage_value_path(&app, "__app", APP_ICON_OVERRIDES_KEY)?;
    let overrides = if vp.is_file() {
        match read_json_value(&vp)? {
            Value::Object(obj) => Some(obj),
            _ => None,
        }
    } else {
        None
    };
    let Some(overrides) = overrides else {
        return Ok(HashMap::new());
    };

    let data_root = app_data_dir(&app);
    let mut out: HashMap<String, String> = HashMap::new();
    for (plugin_id, v) in overrides {
        let Value::String(rel_path) = v else {
            continue;
        };
        if !is_safe_id(&plugin_id) {
            continue;
        }
        let Ok(rel) = safe_relative_path(&rel_path) else {
            continue;
        };
        let full = data_root.join(rel);
        let Ok(bytes) = std::fs::read(&full) else {
            continue;
        };
        if bytes.is_empty() || bytes.len() > 512 * 1024 {
            continue;
        }
        let mime = image_mime_by_ext(&full);
        let b64 = general_purpose::STANDARD.encode(bytes);
        out.insert(plugin_id.to_string(), format!("data:{mime};base64,{b64}"));
    }

    Ok(out)
}

#[tauri::command]
pub(crate) fn set_plugin_icon_override(
    app: tauri::AppHandle,
    plugin_id: String,
    data_url: String,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let (bytes, ext) = decode_base64_image_payload(&data_url)?;
    if bytes.is_empty() {
        return Err("图片数据为空".to_string());
    }
    if bytes.len() > 512 * 1024 {
        return Err("缩略图过大（>512KB）".to_string());
    }

    let vp = storage_value_path(&app, "__app", APP_ICON_OVERRIDES_KEY)?;
    let mut overrides = if vp.is_file() {
        match read_json_value(&vp)? {
            Value::Object(obj) => obj,
            _ => Map::new(),
        }
    } else {
        Map::new()
    };

    let icons_dir_rel = "plugin-icons";
    let filename = format!("{plugin_id}.{ext}");
    let new_rel = format!("{icons_dir_rel}/{filename}");

    if let Some(Value::String(old_rel_raw)) = overrides.get(&plugin_id) {
        if old_rel_raw != &new_rel {
            if let Ok(old_rel) = safe_relative_path(old_rel_raw) {
                let old_full = app_data_dir(&app).join(old_rel);
                let _ = std::fs::remove_file(old_full);
            }
        }
    }

    let icons_dir = app_data_dir(&app).join(icons_dir_rel);
    std::fs::create_dir_all(&icons_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    let full = icons_dir.join(&filename);
    std::fs::write(&full, bytes).map_err(|e| format!("写入图标失败: {e}"))?;

    overrides.insert(plugin_id.clone(), Value::String(new_rel));
    write_json_value(&vp, &Value::Object(overrides))
}

#[tauri::command]
pub(crate) fn remove_plugin_icon_override(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let vp = storage_value_path(&app, "__app", APP_ICON_OVERRIDES_KEY)?;
    let overrides = if vp.is_file() {
        match read_json_value(&vp)? {
            Value::Object(obj) => Some(obj),
            _ => None,
        }
    } else {
        None
    };
    let Some(mut overrides) = overrides else {
        return Ok(());
    };

    if let Some(Value::String(old_rel)) = overrides.remove(&plugin_id) {
        if let Ok(old_rel) = safe_relative_path(&old_rel) {
            let old_full = app_data_dir(&app).join(old_rel);
            let _ = std::fs::remove_file(old_full);
        }
    }

    write_json_value(&vp, &Value::Object(overrides))
}
