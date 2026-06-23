use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{data_dir, quick_bar_backend};

const REGISTRY_FILE: &str = "registry.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegistryButton {
    pub(crate) id: String,
    pub(crate) app: Value,
    pub(crate) app_id: String,
    pub(crate) capability_id: String,
    pub(crate) title: String,
    pub(crate) icon: String,
    pub(crate) config: Value,
    pub(crate) enabled: Option<bool>,
    pub(crate) created_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryDoc {
    buttons: Vec<RegistryButton>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddRegistryButtonParams {
    app: Value,
    app_id: String,
    capability_id: String,
    title: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    config: Value,
}

#[derive(Deserialize)]
struct RemoveRegistryButtonParams {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRegistryButtonParams {
    id: String,
    title: Option<String>,
    icon: Option<String>,
    config: Option<Value>,
    enabled: Option<bool>,
}

pub(crate) fn list(app: &tauri::AppHandle) -> Result<Vec<RegistryButton>, String> {
    Ok(read_doc(app)?.buttons)
}

pub(crate) fn add(app: &tauri::AppHandle, params: Value) -> Result<RegistryButton, String> {
    let input: AddRegistryButtonParams = quick_bar_backend::decode_params(params)?;
    let app_id = input.app_id.trim().to_string();
    let capability_id = input.capability_id.trim().to_string();
    let title = input.title.trim().to_string();
    if input.app.is_null() {
        return Err("注册按钮缺少应用信息".to_string());
    }
    if app_id.is_empty() {
        return Err("注册按钮缺少应用编号".to_string());
    }
    if capability_id.is_empty() {
        return Err("注册按钮缺少能力编号".to_string());
    }
    if title.is_empty() {
        return Err("注册按钮名称不能为空".to_string());
    }

    let mut doc = read_doc(app)?;
    let id = new_button_id()?;
    let icon = resolve_icon(&input.icon, &format!("{id}:{app_id}:{capability_id}:{title}"));
    let button = RegistryButton {
        id,
        app: input.app,
        app_id,
        capability_id,
        title,
        icon,
        config: non_null_object(input.config),
        enabled: Some(true),
        created_at: quick_bar_backend::now_text()?,
    };
    doc.buttons.push(button.clone());
    write_doc(app, &doc)?;
    Ok(button)
}

pub(crate) fn remove(app: &tauri::AppHandle, params: Value) -> Result<(), String> {
    let input: RemoveRegistryButtonParams = quick_bar_backend::decode_params(params)?;
    let id = input.id.trim();
    if id.is_empty() {
        return Err("按钮编号不能为空".to_string());
    }
    let mut doc = read_doc(app)?;
    let before_len = doc.buttons.len();
    doc.buttons.retain(|button| button.id != id);
    if doc.buttons.len() == before_len {
        return Err(format!("按钮不存在: {id}"));
    }
    write_doc(app, &doc)
}

pub(crate) fn update(app: &tauri::AppHandle, params: Value) -> Result<RegistryButton, String> {
    let input: UpdateRegistryButtonParams = quick_bar_backend::decode_params(params)?;
    let id = input.id.trim();
    if id.is_empty() {
        return Err("按钮编号不能为空".to_string());
    }
    if input.title.is_none()
        && input.icon.is_none()
        && input.config.is_none()
        && input.enabled.is_none()
    {
        return Err("按钮更新内容不能为空".to_string());
    }

    let mut doc = read_doc(app)?;
    let index = doc
        .buttons
        .iter()
        .position(|button| button.id == id)
        .ok_or_else(|| format!("按钮不存在: {id}"))?;
    if let Some(title) = input.title {
        let title = title.trim().to_string();
        if title.is_empty() {
            return Err("按钮名称不能为空".to_string());
        }
        doc.buttons[index].title = title;
    }
    if let Some(icon) = input.icon {
        let seed = icon_seed(&doc.buttons[index]);
        doc.buttons[index].icon = resolve_icon(&icon, &seed);
    }
    if let Some(config) = input.config {
        doc.buttons[index].config = non_null_object(config);
    }
    if let Some(enabled) = input.enabled {
        doc.buttons[index].enabled = Some(enabled);
    }
    let button = doc.buttons[index].clone();
    write_doc(app, &doc)?;
    Ok(button)
}

pub(crate) fn find_enabled(
    app: &tauri::AppHandle,
    id: &str,
) -> Result<RegistryButton, String> {
    let doc = read_doc(app)?;
    let button = doc
        .buttons
        .into_iter()
        .find(|button| button.id == id)
        .ok_or_else(|| format!("按钮不存在: {id}"))?;
    if button.enabled == Some(false) {
        return Err(format!("按钮已停用: {id}"));
    }
    Ok(button)
}

fn read_doc(app: &tauri::AppHandle) -> Result<RegistryDoc, String> {
    let path = registry_path(app)?;
    let doc = if path.is_file() {
        let text = std::fs::read_to_string(&path)
            .map_err(|e| format!("读取按钮数据失败: {e}"))?;
        serde_json::from_str::<RegistryDoc>(&text)
            .map_err(|e| format!("解析按钮数据失败: {e}"))?
    } else {
        RegistryDoc { buttons: Vec::new() }
    };
    Ok(normalize_doc(doc))
}

fn write_doc(app: &tauri::AppHandle, doc: &RegistryDoc) -> Result<(), String> {
    quick_bar_backend::write_backend_json(&registry_path(app)?, &normalize_doc(doc.clone()))
}

fn registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir::resolve_data_dir(app)?.join(REGISTRY_FILE))
}

fn normalize_doc(mut doc: RegistryDoc) -> RegistryDoc {
    for button in &mut doc.buttons {
        button.config = non_null_object(std::mem::take(&mut button.config));
        if button.enabled.is_none() {
            button.enabled = Some(true);
        }
        button.icon = resolve_icon(&button.icon, &icon_seed(button));
    }
    doc
}

fn icon_seed(button: &RegistryButton) -> String {
    format!(
        "{}:{}:{}:{}",
        button.id, button.app_id, button.capability_id, button.title
    )
}

fn non_null_object(value: Value) -> Value {
    if value.is_null() {
        return serde_json::json!({});
    }
    value
}

fn new_button_id() -> Result<String, String> {
    let mut bytes = [0_u8; 6];
    getrandom::fill(&mut bytes).map_err(|e| format!("生成按钮编号失败: {e}"))?;
    let hex = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("生成按钮编号时间失败: {e}"))?
        .as_millis();
    Ok(format!("btn-{millis}-{hex}"))
}

fn resolve_icon(value: &str, seed: &str) -> String {
    let icon = value.trim();
    if !icon.is_empty() {
        return icon.to_string();
    }
    seeded_icon(seed)
}

fn seeded_icon(seed: &str) -> String {
    const ICONS: [&str; 19] = [
        "sparkles",
        "message-square",
        "book-open",
        "pencil-line",
        "languages",
        "search",
        "brain-circuit",
        "code-2",
        "file-text",
        "zap",
        "star",
        "wand-sparkles",
        "clipboard-list",
        "globe",
        "mail",
        "chart-bar",
        "shield-check",
        "link-2",
        "activity",
    ];
    let mut hash = 0_u32;
    for char in seed.trim().chars() {
        hash = hash.wrapping_mul(31).wrapping_add(char as u32);
    }
    ICONS[(hash as usize) % ICONS.len()].to_string()
}
