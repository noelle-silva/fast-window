//! 收纳夹业务：新增 / 编辑 / 删除（释放条目）/ 由条目自动创建 / 夹内放置 / 拖出到桌面。

use std::path::Path;

use serde::Deserialize;

use crate::collections::model::{
    clamp_grid_layout, find_container, normalize_desktop_entry_kind, normalize_group_id, now_ms,
    now_text, next_container_id, next_container_name, next_page_order, trim_max,
    validate_grid_layout, CollectionGroup, DesktopContainer, GridLayout, WorkspaceView,
    MAX_CONTAINER_NAME_CHARS,
};
use crate::collections::store::with_workspace;
use crate::collections::desktop::DesktopLayoutPatch;

#[derive(Debug, Deserialize)]
pub struct ContainerPayload {
    pub container: ContainerInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInput {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub page_order: i64,
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
}

#[derive(Debug, Deserialize)]
pub struct ContainerIdPayload {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFromItemsPayload {
    pub source_item_id: String,
    pub target_item_id: String,
    pub layout: GridLayout,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerLayoutPatch {
    pub id: String,
    pub layout: GridLayout,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerPlacePayload {
    pub container_id: String,
    #[serde(default)]
    pub moved_id: String,
    #[serde(default)]
    pub items: Vec<ContainerLayoutPatch>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractPayload {
    pub container_id: String,
    pub item_id: String,
    #[serde(default)]
    pub items: Vec<DesktopLayoutPatch>,
}

pub fn add(data_dir: &Path, input: ContainerInput) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let mut container = normalize_container_input(input, &doc.workspace.groups, true)?;
        if doc
            .workspace
            .containers
            .iter()
            .any(|current| current.id == container.id)
        {
            return Err(format!("container already exists: {}", container.id));
        }
        container.page_order = next_page_order(&doc.workspace, &container.group_id);
        doc.workspace.containers.push(container);
        Ok(())
    })
}

pub fn update(data_dir: &Path, input: ContainerInput) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let mut container = normalize_container_input(input, &doc.workspace.groups, false)?;
        let Some(index) = doc
            .workspace
            .containers
            .iter()
            .position(|current| current.id == container.id)
        else {
            return Err(format!("container not found: {}", container.id));
        };
        let existing = &doc.workspace.containers[index];
        container.created_at = existing.created_at.clone();
        container.created_at_ms = existing.created_at_ms;
        container.group_id = existing.group_id.clone();
        container.page_order = existing.page_order;
        if container.layout.is_none() {
            container.layout = existing.layout.clone();
        }
        doc.workspace.containers[index] = container;
        Ok(())
    })
}

pub fn remove(data_dir: &Path, raw_id: &str) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let id = raw_id.trim().to_string();
        if id.is_empty() {
            return Err("container id is required".to_string());
        }
        let Some(index) = doc
            .workspace
            .containers
            .iter()
            .position(|container| container.id == id)
        else {
            return Err(format!("container not found: {id}"));
        };
        doc.workspace.containers.remove(index);
        let now = now_ms();
        let now_string = now_text();
        for item in doc.workspace.items.iter_mut() {
            if item.container_id == id {
                item.container_id.clear();
                item.container_layout = None;
                item.updated_at_ms = now;
                item.updated_at = now_string.clone();
            }
        }
        Ok(())
    })
}

/// 拖到条目上自动创建收纳夹：两者装入新夹，source 在 (1,0)，target 在 (0,0)。
pub fn create_from_items(
    data_dir: &Path,
    payload: CreateFromItemsPayload,
) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let source_item_id = payload.source_item_id.trim().to_string();
        let target_item_id = payload.target_item_id.trim().to_string();
        if source_item_id.is_empty() || target_item_id.is_empty() {
            return Err("source and target item ids are required".to_string());
        }
        if source_item_id == target_item_id {
            return Err("source and target item ids must be different".to_string());
        }
        let source_index = doc
            .workspace
            .items
            .iter()
            .position(|item| item.id == source_item_id);
        let target_index = doc
            .workspace
            .items
            .iter()
            .position(|item| item.id == target_item_id);
        let Some(source_index) = source_index else {
            return Err(format!("item not found: {source_item_id}"));
        };
        let Some(target_index) = target_index else {
            return Err(format!("item not found: {target_item_id}"));
        };
        if !doc.workspace.items[target_index].container_id.is_empty() {
            return Err("target item must be on desktop".to_string());
        }
        if doc.workspace.items[source_index].group_id != doc.workspace.items[target_index].group_id
        {
            return Err("source and target items must be in the same group".to_string());
        }

        let now = now_ms();
        let now_string = now_text();
        let container_id = next_container_id(&doc.workspace, now);
        let container_group_id = doc.workspace.items[target_index].group_id.clone();
        let page_order = next_page_order(&doc.workspace, &container_group_id);
        let container_layout = clamp_grid_layout(&payload.layout);
        doc.workspace.containers.insert(
            0,
            DesktopContainer {
                id: container_id.clone(),
                name: next_container_name(&doc.workspace),
                group_id: container_group_id,
                page_order,
                created_at: now_string.clone(),
                updated_at: now_string.clone(),
                created_at_ms: now,
                updated_at_ms: now,
                layout: Some(container_layout),
            },
        );
        for index in [source_index, target_index] {
            let item = &mut doc.workspace.items[index];
            item.container_id = container_id.clone();
            item.layout = None;
            item.updated_at_ms = now;
            item.updated_at = now_string.clone();
            item.container_layout = Some(if item.id == source_item_id {
                GridLayout { x: 1, y: 0 }
            } else {
                GridLayout { x: 0, y: 0 }
            });
        }
        Ok(())
    })
}

/// 收纳夹内放置：写入前端算好的夹内位置；`moved_id` 可把桌面条目拖入夹内。
pub fn place(data_dir: &Path, payload: ContainerPlacePayload) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let container_id = payload.container_id.trim().to_string();
        let moved_id = payload.moved_id.trim().to_string();
        if container_id.is_empty() {
            return Err("container id is required".to_string());
        }
        if payload.items.is_empty() {
            if moved_id.is_empty() {
                return Ok(());
            }
            return Err("moved item layout is required".to_string());
        }
        let Some(container) = find_container(&doc.workspace, &container_id) else {
            return Err(format!("container not found: {container_id}"));
        };
        let mut placements = std::collections::HashMap::new();
        for placement in &payload.items {
            let id = placement.id.trim().to_string();
            if id.is_empty() {
                return Err("item id is required".to_string());
            }
            if placements
                .insert(id.clone(), clamp_grid_layout(&placement.layout))
                .is_some()
            {
                return Err(format!("duplicate item placement: {id}"));
            }
        }
        if !moved_id.is_empty() && !placements.contains_key(&moved_id) {
            return Err("moved item layout is required".to_string());
        }

        let container_group_id = container.group_id.clone();
        let now = now_ms();
        let now_string = now_text();
        let mut found = std::collections::HashSet::new();
        let mut moved_found = moved_id.is_empty();
        for item in doc.workspace.items.iter_mut() {
            if item.id == moved_id {
                if item.group_id != container_group_id {
                    return Err(format!(
                        "item group mismatch for container {container_id}: {}",
                        item.id
                    ));
                }
                item.container_id = container_id.clone();
                moved_found = true;
            }
            let Some(layout) = placements.get(&item.id) else {
                continue;
            };
            if item.container_id != container_id {
                return Err(format!("item is not in container {container_id}: {}", item.id));
            }
            if item.group_id != container_group_id {
                return Err(format!(
                    "item group mismatch for container {container_id}: {}",
                    item.id
                ));
            }
            item.container_layout = Some(layout.clone());
            item.updated_at_ms = now;
            item.updated_at = now_string.clone();
            found.insert(item.id.clone());
        }
        if !moved_found {
            return Err(format!("item not found: {moved_id}"));
        }
        for id in placements.keys() {
            if !found.contains(id) {
                return Err(format!("item not found: {id}"));
            }
        }
        Ok(())
    })
}

/// 收纳夹内条目拖出到桌面：被拖条目落桌面，其余桌面补丁同步让位。
pub fn extract_to_desktop(data_dir: &Path, payload: ExtractPayload) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let container_id = payload.container_id.trim().to_string();
        let item_id = payload.item_id.trim().to_string();
        if container_id.is_empty() {
            return Err("container id is required".to_string());
        }
        if item_id.is_empty() {
            return Err("item id is required".to_string());
        }
        if payload.items.is_empty() {
            return Err("desktop layout patches are required".to_string());
        }
        let Some(container) = find_container(&doc.workspace, &container_id) else {
            return Err(format!("container not found: {container_id}"));
        };
        let container_group_id = container.group_id.clone();

        let mut updates: std::collections::HashMap<String, GridLayout> =
            std::collections::HashMap::new();
        for patch in &payload.items {
            let kind = normalize_desktop_entry_kind(&patch.kind);
            let id = patch.id.trim().to_string();
            if kind.is_empty() || id.is_empty() {
                return Err("desktop layout kind and id are required".to_string());
            }
            let key = format!("{kind}:{id}");
            if updates.insert(key.clone(), clamp_grid_layout(&patch.layout)).is_some() {
                return Err(format!("duplicate desktop layout patch: {key}"));
            }
        }
        let Some(moved_layout) = updates.get(&format!("item:{item_id}")).cloned() else {
            return Err("moved item desktop layout is required".to_string());
        };

        let now = now_ms();
        let now_string = now_text();
        let mut found = std::collections::HashSet::new();
        let mut moved_found = false;
        for item in doc.workspace.items.iter_mut() {
            let key = format!("item:{}", item.id);
            if item.id == item_id {
                if item.container_id != container_id {
                    return Err(format!("item is not in container {container_id}: {item_id}"));
                }
                if item.group_id != container_group_id {
                    return Err(format!(
                        "item group mismatch for container {container_id}: {item_id}"
                    ));
                }
                item.container_id.clear();
                item.container_layout = None;
                item.layout = Some(moved_layout.clone());
                item.updated_at_ms = now;
                item.updated_at = now_string.clone();
                found.insert(key);
                moved_found = true;
                continue;
            }
            let Some(layout) = updates.get(&key).cloned() else {
                continue;
            };
            if !item.container_id.is_empty() {
                return Err(format!("item is not on desktop: {}", item.id));
            }
            item.layout = Some(layout);
            item.updated_at_ms = now;
            item.updated_at = now_string.clone();
            found.insert(key);
        }
        if !moved_found {
            return Err(format!("item not found: {item_id}"));
        }
        for container in doc.workspace.containers.iter_mut() {
            let key = format!("container:{}", container.id);
            let Some(layout) = updates.get(&key).cloned() else {
                continue;
            };
            container.layout = Some(layout);
            container.updated_at_ms = now;
            container.updated_at = now_string.clone();
            found.insert(key);
        }
        for key in updates.keys() {
            if !found.contains(key) {
                return Err(format!("desktop entry not found: {key}"));
            }
        }
        Ok(())
    })
}

fn normalize_container_input(
    input: ContainerInput,
    groups: &[CollectionGroup],
    allow_generated_id: bool,
) -> Result<DesktopContainer, String> {
    let now = now_ms();
    let now_string = now_text();
    let mut id = input.id.trim().to_string();
    if id.is_empty() && allow_generated_id {
        id = format!("container-{now}");
    }
    if id.is_empty() {
        return Err("container id is required".to_string());
    }
    let name = trim_max(&input.name, MAX_CONTAINER_NAME_CHARS);
    if name.is_empty() {
        return Err("container name is required".to_string());
    }
    let group_id = normalize_group_id(&input.group_id, groups)?;
    if input.page_order < 0 {
        return Err("container pageOrder must be non-negative".to_string());
    }
    let layout = match input.layout {
        None => None,
        Some(layout) => {
            validate_grid_layout(&layout)?;
            Some(layout)
        }
    };
    Ok(DesktopContainer {
        id,
        name,
        group_id,
        page_order: input.page_order,
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
    })
}
