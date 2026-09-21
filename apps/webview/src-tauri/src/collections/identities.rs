//! 独立空间登录信息：列表 / 保存 / 删除 / 元数据种子。
//!
//! 登录信息的事实源是空间目录及其元数据文件；使用关系由工作区条目引用派生。

use std::path::Path;

use serde::Deserialize;

use crate::browser_data::{self, IdentityMeta};
use crate::collections::model::{now_ms, trim_max};
use crate::collections::store::workspace_view;

/// 登录信息名称上限（与条目名称同量级）。
pub const MAX_IDENTITY_NAME_CHARS: usize = 80;
/// 登录信息描述上限。
pub const MAX_IDENTITY_DESCRIPTION_CHARS: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentitySavePayload {
    pub space_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentitySpacePayload {
    pub space_id: String,
}

/// 使用某条登录信息的图标。
#[derive(Debug, serde::Serialize)]
pub struct IdentityUsage {
    pub id: String,
    pub name: String,
}

/// 一条独立空间登录信息（含使用关系）。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityInfo {
    pub space_id: String,
    pub name: String,
    pub url: String,
    pub description: String,
    pub created_at_ms: i64,
    pub used_by: Vec<IdentityUsage>,
}

/// 列出全部登录信息（名称/网址/描述/创建时间 + 使用它的图标清单）。
pub fn list(data_dir: &Path) -> Result<Vec<IdentityInfo>, String> {
    let view = workspace_view(data_dir)?;
    let mut identities = Vec::new();
    for space_id in browser_data::list_identity_spaces(data_dir) {
        let meta = browser_data::read_identity_meta(data_dir, &space_id);
        let used_by = view
            .items
            .iter()
            .filter(|item| item.browser_space_id == space_id)
            .map(|item| IdentityUsage {
                id: item.id.clone(),
                name: item.name.clone(),
            })
            .collect();
        let created_at_ms = meta
            .as_ref()
            .map(|meta| meta.created_at_ms)
            .filter(|ms| *ms > 0)
            .unwrap_or_else(|| browser_data::identity_dir_created_ms(data_dir, &space_id));
        identities.push(IdentityInfo {
            space_id,
            name: meta.as_ref().map(|meta| meta.name.clone()).unwrap_or_default(),
            url: meta.as_ref().map(|meta| meta.url.clone()).unwrap_or_default(),
            description: meta
                .as_ref()
                .map(|meta| meta.description.clone())
                .unwrap_or_default(),
            created_at_ms,
            used_by,
        });
    }
    Ok(identities)
}

/// 保存登录信息的名称与描述（保留来源网址与创建时间）。
pub fn save(data_dir: &Path, payload: IdentitySavePayload) -> Result<(), String> {
    let space_id = payload.space_id.trim();
    if !browser_data::is_safe_space_id(space_id) {
        return Err(format!("非法浏览器空间标识: {space_id}"));
    }
    let dir = browser_data::identity_dir(data_dir, space_id)?;
    if !dir.is_dir() {
        return Err(format!("登录信息不存在: {space_id}"));
    }
    let name = trim_max(&payload.name, MAX_IDENTITY_NAME_CHARS);
    if name.is_empty() {
        return Err("登录信息名称不能为空".to_string());
    }
    let existing = browser_data::read_identity_meta(data_dir, space_id);
    let meta = IdentityMeta {
        name,
        url: existing
            .as_ref()
            .map(|meta| meta.url.clone())
            .unwrap_or_default(),
        description: trim_max(&payload.description, MAX_IDENTITY_DESCRIPTION_CHARS),
        created_at_ms: existing
            .as_ref()
            .map(|meta| meta.created_at_ms)
            .filter(|ms| *ms > 0)
            .unwrap_or_else(|| browser_data::identity_dir_created_ms(data_dir, space_id)),
    };
    browser_data::write_identity_meta(data_dir, space_id, &meta)
}

/// 删除登录信息：清除空间目录，不改动引用它的条目（条目保留独立空间身份）。
pub fn remove(
    app: &tauri::AppHandle,
    data_dir: &Path,
    payload: IdentitySpacePayload,
) -> Result<(), String> {
    let space_id = payload.space_id.trim().to_string();
    if !browser_data::is_safe_space_id(&space_id) {
        return Err(format!("非法浏览器空间标识: {space_id}"));
    }
    if crate::browser_stack::pages_payload(app)
        .pages
        .iter()
        .any(|page| page.space_id == space_id)
    {
        return Err("该登录信息正在被打开的网页使用，请先关闭相关页面".to_string());
    }
    remove_space(data_dir, &space_id)
}

/// 删除空间目录本体（引用关系由调用方负责，本函数不触碰工作区）。
pub fn remove_space(data_dir: &Path, space_id: &str) -> Result<(), String> {
    let dir = browser_data::identity_dir(data_dir, space_id)?;
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("删除登录信息失败: {e}"))
}

/// 种子写入：目录尚无元数据时补一份（名称取条目名，描述为空），已有元数据则不动。
pub fn ensure_meta(data_dir: &Path, space_id: &str, name: &str, url: &str) -> Result<(), String> {
    if space_id.trim().is_empty() {
        return Ok(());
    }
    if browser_data::read_identity_meta(data_dir, space_id).is_some() {
        return Ok(());
    }
    let meta = IdentityMeta {
        name: trim_max(name, MAX_IDENTITY_NAME_CHARS),
        url: url.trim().to_string(),
        description: String::new(),
        created_at_ms: now_ms(),
    };
    browser_data::write_identity_meta(data_dir, space_id, &meta)
}
