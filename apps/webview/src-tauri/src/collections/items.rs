//! 条目业务：新增 / 更新 / 删除 / 打开 / 跨分组移动复制 / 移入收纳夹。

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::collections::identities;
use crate::collections::model::{
    default_item_name, find_container, next_browser_space_id, next_copy_item_id,
    next_identity_item_id, next_page_order, normalize_group_id, normalize_icon_option, now_ms,
    now_text, trim_max, validate_grid_layout, validate_target, CollectionItem, CollectionTarget,
    DesktopIcon, GridLayout, Workspace, WorkspaceView, MAX_ITEM_NAME_CHARS,
};
use crate::collections::store::{with_workspace, workspace_view};

#[derive(Debug, Deserialize)]
pub struct ItemPayload {
    pub item: ItemInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInput {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub target: CollectionTarget,
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub page_order: i64,
    #[serde(default)]
    pub container_id: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub created_at_ms: i64,
    #[serde(default)]
    pub updated_at_ms: i64,
    #[serde(default)]
    pub layout: Option<GridLayout>,
    #[serde(default)]
    pub container_layout: Option<GridLayout>,
    #[serde(default)]
    pub icon: Option<DesktopIcon>,
    /// 显式指定登录空间：None = 保持原值（编辑）/ 默认空间（新建）；Some("") = 解绑到默认空间。
    #[serde(default)]
    pub browser_space_id: Option<String>,
    /// 新建时为条目分配独立登录空间（browserSpaceId 未显式给出时生效）。
    #[serde(default)]
    pub independent_browser_space: bool,
}

#[derive(Debug, Deserialize)]
pub struct IdPayload {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveItemPayload {
    pub id: String,
    #[serde(default = "default_true")]
    pub delete_browser_space: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddIdentityPayload {
    pub id: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPayload {
    pub id: String,
    pub group_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerSavePayload {
    pub ids: Vec<String>,
    #[serde(default)]
    pub container_id: String,
}

pub fn add(data_dir: &Path, input: ItemInput) -> Result<WorkspaceView, String> {
    let mut created_space: Option<(String, String, String)> = None;
    let view = with_workspace(data_dir, |doc| {
        let mut item = normalize_item_input(input, &doc.workspace, true)?;
        item.page_order = next_page_order(&doc.workspace, &item.group_id);
        if !item.browser_space_id.is_empty() {
            created_space = Some((
                item.browser_space_id.clone(),
                item.name.clone(),
                item.target.url.clone(),
            ));
        }
        doc.workspace.items.push(item);
        Ok(())
    })?;
    if let Some((space_id, name, url)) = created_space {
        if let Err(error) = identities::ensure_meta(data_dir, &space_id, &name, &url) {
            eprintln!("[webview] 身份元数据种子写入失败: {error}");
        }
    }
    Ok(view)
}

pub fn update(data_dir: &Path, input: ItemInput) -> Result<WorkspaceView, String> {
    let mut touched_space: Option<(String, String, String)> = None;
    let view = with_workspace(data_dir, |doc| {
        let keep_browser_space = input.browser_space_id.is_none();
        let mut item = normalize_item_input(input, &doc.workspace, false)?;
        let Some(index) = doc.workspace.items.iter().position(|i| i.id == item.id) else {
            return Err(format!("item not found: {}", item.id));
        };
        let existing = doc.workspace.items[index].clone();
        item.created_at_ms = existing.created_at_ms;
        item.created_at = existing.created_at.clone();
        // 未显式指定登录空间时保持原值（编辑不改变身份）。
        if keep_browser_space {
            item.browser_space_id = existing.browser_space_id.clone();
        }
        if item.group_id == existing.group_id {
            item.page_order = existing.page_order;
            item.container_id = existing.container_id.clone();
            if item.layout.is_none() {
                item.layout = existing.layout.clone();
            }
            if item.container_layout.is_none() {
                item.container_layout = existing.container_layout.clone();
            }
        } else {
            item.page_order = next_page_order(&doc.workspace, &item.group_id);
        }
        if !item.browser_space_id.is_empty() && item.browser_space_id != existing.browser_space_id {
            touched_space = Some((
                item.browser_space_id.clone(),
                item.name.clone(),
                item.target.url.clone(),
            ));
        }
        doc.workspace.items[index] = item;
        Ok(())
    })?;
    // 绑定到尚无元数据的空间（新建独立分配/手工目录缺失）时补种子；已有元数据不动。
    if let Some((space_id, name, url)) = touched_space {
        if let Err(error) = identities::ensure_meta(data_dir, &space_id, &name, &url) {
            eprintln!("[webview] 身份元数据种子写入失败: {error}");
        }
    }
    Ok(view)
}

pub fn remove(
    data_dir: &Path,
    raw_id: &str,
    delete_browser_space: bool,
) -> Result<WorkspaceView, String> {
    let mut removed_space_id = String::new();
    let view = with_workspace(data_dir, |doc| {
        let id = raw_id.trim().to_string();
        if id.is_empty() {
            return Err("item id is required".to_string());
        }
        let Some(index) = doc.workspace.items.iter().position(|item| item.id == id) else {
            return Err(format!("item not found: {id}"));
        };
        let removed = doc.workspace.items.remove(index);
        removed_space_id = removed.browser_space_id;
        Ok(())
    })?;
    // 同一身份空间可能被多个条目共享（如复制到分组）；仅当没有其他引用时才清理。
    if delete_browser_space
        && !removed_space_id.is_empty()
        && !view
            .items
            .iter()
            .any(|item| item.browser_space_id == removed_space_id)
    {
        crate::browser_data::remove_identity_dir(data_dir, &removed_space_id);
    }
    Ok(view)
}

/// 新建多账号身份：复制源条目为独立浏览器空间的副本，落在同分组桌面。
pub fn add_identity(data_dir: &Path, payload: AddIdentityPayload) -> Result<WorkspaceView, String> {
    let mut created_space: Option<(String, String, String)> = None;
    let view = with_workspace(data_dir, |doc| {
        let source_id = payload.id.trim();
        if source_id.is_empty() {
            return Err("item id is required".to_string());
        }
        let Some(source) = doc
            .workspace
            .items
            .iter()
            .find(|item| item.id == source_id)
            .cloned()
        else {
            return Err(format!("item not found: {source_id}"));
        };

        let now = now_ms();
        let now_string = now_text();
        let mut identity = source;
        identity.id = next_identity_item_id(&doc.workspace, now);
        identity.browser_space_id = next_browser_space_id(&doc.workspace, now);
        identity.name = identity_name(&payload.name, &identity.name);
        identity.page_order = next_page_order(&doc.workspace, &identity.group_id);
        identity.container_id.clear();
        identity.container_layout = None;
        identity.layout = None;
        identity.created_at = now_string.clone();
        identity.updated_at = now_string.clone();
        identity.created_at_ms = now;
        identity.updated_at_ms = now;
        created_space = Some((
            identity.browser_space_id.clone(),
            identity.name.clone(),
            identity.target.url.clone(),
        ));
        doc.workspace.items.push(identity);
        Ok(())
    })?;
    if let Some((space_id, name, url)) = created_space {
        if let Err(error) = identities::ensure_meta(data_dir, &space_id, &name, &url) {
            eprintln!("[webview] 身份元数据种子写入失败: {error}");
        }
    }
    Ok(view)
}

fn identity_name(input: &str, source_name: &str) -> String {
    let trimmed = input.trim();
    if !trimmed.is_empty() {
        return trim_max(trimmed, MAX_ITEM_NAME_CHARS);
    }
    let base = trim_max(source_name, MAX_ITEM_NAME_CHARS);
    trim_max(&format!("{base} · 新身份"), MAX_ITEM_NAME_CHARS)
}

/// 打开条目：交给内嵌浏览栈（新建独立页面）。
pub async fn open(
    app: &tauri::AppHandle,
    data_dir: &Path,
    raw_id: &str,
) -> Result<Value, String> {
    let view = workspace_view(data_dir)?;
    let id = raw_id.trim();
    let item = view
        .items
        .iter()
        .find(|item| item.id == id)
        .ok_or_else(|| format!("item not found: {id}"))?;

    // 只在空间尚无元数据时补种子（不覆盖登录信息自己的名称）。
    if let Err(error) = identities::ensure_meta(
        data_dir,
        &item.browser_space_id,
        &item.name,
        &item.target.url,
    ) {
        eprintln!("[webview] 身份元数据种子写入失败: {error}");
    }

    let icon = item
        .icon
        .as_ref()
        .map(|icon| crate::browser_stack::BrowserPageIcon {
            kind: icon.kind.clone(),
            color: icon.color.clone(),
            asset_id: icon.asset_id.clone(),
        });

    crate::browser_commands::open_browser_window_impl(
        app.clone(),
        item.target.url.clone(),
        item.name.clone(),
        icon,
        item.browser_space_id.clone(),
    )
    .await?;
    Ok(json!({ "ok": true, "target": item.target }))
}

pub fn move_to_group(data_dir: &Path, payload: TransferPayload) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let id = payload.id.trim().to_string();
        if id.is_empty() {
            return Err("item id is required".to_string());
        }
        let target_group_id = normalize_group_id(&payload.group_id, &doc.workspace.groups)?;
        let Some(index) = doc.workspace.items.iter().position(|item| item.id == id) else {
            return Err(format!("item not found: {id}"));
        };
        if doc.workspace.items[index].group_id == target_group_id {
            return Ok(());
        }
        let page_order = next_page_order(&doc.workspace, &target_group_id);
        let now = now_ms();
        let now_string = now_text();
        let item = &mut doc.workspace.items[index];
        item.group_id = target_group_id;
        item.page_order = page_order;
        item.container_id.clear();
        item.container_layout = None;
        item.layout = None;
        item.updated_at_ms = now;
        item.updated_at = now_string;
        Ok(())
    })
}

pub fn copy_to_group(data_dir: &Path, payload: TransferPayload) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let id = payload.id.trim().to_string();
        if id.is_empty() {
            return Err("item id is required".to_string());
        }
        let target_group_id = normalize_group_id(&payload.group_id, &doc.workspace.groups)?;
        let Some(source) = doc.workspace.items.iter().find(|item| item.id == id).cloned() else {
            return Err(format!("item not found: {id}"));
        };
        if source.group_id == target_group_id {
            return Err("target group must be different".to_string());
        }
        let now = now_ms();
        let now_string = now_text();
        let mut copy = source;
        copy.id = next_copy_item_id(&doc.workspace, now);
        copy.group_id = target_group_id;
        copy.page_order = next_page_order(&doc.workspace, &copy.group_id);
        copy.container_id.clear();
        copy.container_layout = None;
        copy.layout = None;
        copy.created_at_ms = now;
        copy.updated_at_ms = now;
        copy.created_at = now_string.clone();
        copy.updated_at = now_string;
        doc.workspace.items.push(copy);
        Ok(())
    })
}

/// 移入 / 移出收纳夹。`container_id` 为空串表示移出到桌面。
pub fn container_save(data_dir: &Path, payload: ContainerSavePayload) -> Result<WorkspaceView, String> {
    if payload.ids.is_empty() {
        return workspace_view(data_dir);
    }
    with_workspace(data_dir, |doc| {
        let container_id = payload.container_id.trim().to_string();
        let target_group_id = if container_id.is_empty() {
            String::new()
        } else {
            let container = find_container(&doc.workspace, &container_id)
                .ok_or_else(|| format!("container not found: {container_id}"))?;
            container.group_id.clone()
        };
        let mut updates = std::collections::HashSet::new();
        for id in &payload.ids {
            let id = id.trim();
            if id.is_empty() {
                return Err("item id is required".to_string());
            }
            updates.insert(id.to_string());
        }
        let now = now_ms();
        let now_string = now_text();
        let mut found = std::collections::HashSet::new();
        for item in doc.workspace.items.iter_mut() {
            if !updates.contains(&item.id) {
                continue;
            }
            if !target_group_id.is_empty() && item.group_id != target_group_id {
                return Err(format!(
                    "item group mismatch for container {container_id}: {}",
                    item.id
                ));
            }
            if item.container_id != container_id {
                item.container_layout = None;
            }
            item.container_id = container_id.clone();
            item.updated_at_ms = now;
            item.updated_at = now_string.clone();
            found.insert(item.id.clone());
        }
        for id in &updates {
            if !found.contains(id) {
                return Err(format!("item not found: {id}"));
            }
        }
        Ok(())
    })
}

fn normalize_item_input(
    input: ItemInput,
    workspace: &Workspace,
    allow_new_id: bool,
) -> Result<CollectionItem, String> {
    let now = now_ms();
    let now_string = now_text();

    let mut id = input.id.trim().to_string();
    if id.is_empty() && allow_new_id {
        id = format!("{now}");
    }
    if id.is_empty() {
        return Err("item id is required".to_string());
    }

    let mut target = input.target;
    target.kind = target.kind.trim().to_ascii_lowercase();
    target.url = target.url.trim().to_string();
    validate_target(&target)?;

    let mut name = trim_max(&input.name, MAX_ITEM_NAME_CHARS);
    if name.is_empty() {
        name = trim_max(&default_item_name(&target), MAX_ITEM_NAME_CHARS);
        if name.is_empty() || name == "." {
            return Err("item name is required".to_string());
        }
    }

    let group_id = normalize_group_id(&input.group_id, &workspace.groups)?;
    if input.page_order < 0 {
        return Err("item pageOrder must be non-negative".to_string());
    }
    let layout = match input.layout {
        None => None,
        Some(layout) => {
            validate_grid_layout(&layout)?;
            Some(layout)
        }
    };
    let container_layout = match input.container_layout {
        None => None,
        Some(layout) => {
            validate_grid_layout(&layout)?;
            Some(layout)
        }
    };
    let independent_browser_space = input.independent_browser_space;
    // 空值（未提供 / 空串 / 空白）统一视为"未指定空间"：由独立空间意图决定，
    // 编辑解绑与新建共享都不会吞掉独立空间请求（事实源唯一）。
    let browser_space_id = match input
        .browser_space_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            if crate::browser_data::is_safe_space_id(value) {
                value.to_string()
            } else {
                return Err(format!("非法浏览器空间标识: {value}"));
            }
        }
        None if independent_browser_space => next_browser_space_id(workspace, now),
        None => String::new(),
    };

    Ok(CollectionItem {
        id,
        name,
        target,
        group_id,
        page_order: input.page_order,
        container_id: input.container_id.trim().to_string(),
        created_at: if input.created_at.trim().is_empty() {
            now_string.clone()
        } else {
            input.created_at.trim().to_string()
        },
        updated_at: if input.updated_at.trim().is_empty() {
            now_string
        } else {
            input.updated_at.trim().to_string()
        },
        created_at_ms: if input.created_at_ms > 0 {
            input.created_at_ms
        } else {
            now
        },
        updated_at_ms: if input.updated_at_ms > 0 {
            input.updated_at_ms
        } else {
            now
        },
        layout,
        container_layout,
        icon: normalize_icon_option(input.icon)?,
        browser_space_id,
    })
}
