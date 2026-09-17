//! 分组业务：新增 / 改名 / 排序 / 删除（级联搬迁）。

use std::path::Path;

use serde::Deserialize;

use crate::collections::model::{
    now_ms, now_text, next_page_order, renumber_page_order, safe_id, trim_max, CollectionGroup,
    WorkspaceView, MAX_GROUP_NAME_CHARS,
};
use crate::collections::store::with_workspace;

#[derive(Debug, Deserialize)]
pub struct GroupPayload {
    pub group: GroupInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInput {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct GroupIdPayload {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupOrderPayload {
    pub group_order: Vec<String>,
}

pub fn add(data_dir: &Path, input: GroupInput) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let group = normalize_group(&input, true)?;
        if doc.workspace.groups.iter().any(|g| g.id == group.id) {
            return Err(format!("group already exists: {}", group.id));
        }
        doc.workspace.groups.push(group);
        Ok(())
    })
}

pub fn update(data_dir: &Path, input: GroupInput) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let group = normalize_group(&input, false)?;
        let Some(target) = doc.workspace.groups.iter_mut().find(|g| g.id == group.id) else {
            return Err(format!("group not found: {}", group.id));
        };
        target.name = group.name;
        Ok(())
    })
}

pub fn save_order(data_dir: &Path, raw_order: Vec<String>) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let ordered = ordered_groups_by_id(&doc.workspace.groups, &raw_order)?;
        doc.workspace.groups = ordered;
        Ok(())
    })
}

pub fn remove(data_dir: &Path, raw_id: &str) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let id = safe_id(raw_id, 32);
        if id.is_empty() {
            return Err("group id is required".to_string());
        }
        let Some(index) = doc.workspace.groups.iter().position(|g| g.id == id) else {
            return Err(format!("group not found: {id}"));
        };
        doc.workspace.groups.remove(index);
        let target_group_id = doc
            .workspace
            .groups
            .first()
            .map(|group| group.id.clone())
            .unwrap_or_default();
        let removed_object_count = doc.workspace.items.iter().filter(|i| i.group_id == id).count()
            + doc
                .workspace
                .containers
                .iter()
                .filter(|c| c.group_id == id)
                .count();
        if target_group_id.is_empty() && removed_object_count > 0 {
            return Err("cannot remove the last non-empty group".to_string());
        }

        let mut next_order = next_page_order(&doc.workspace, &target_group_id);
        let now = now_ms();
        let now_string = now_text();
        for item in doc.workspace.items.iter_mut() {
            if item.group_id != id {
                continue;
            }
            item.group_id = target_group_id.clone();
            item.page_order = next_order;
            item.container_id.clear();
            item.container_layout = None;
            item.layout = None;
            item.updated_at_ms = now;
            item.updated_at = now_string.clone();
            next_order += 1;
        }
        for container in doc.workspace.containers.iter_mut() {
            if container.group_id != id {
                continue;
            }
            container.group_id = target_group_id.clone();
            container.page_order = next_order;
            container.layout = None;
            container.updated_at_ms = now;
            container.updated_at = now_string.clone();
            next_order += 1;
        }
        if !target_group_id.is_empty() {
            renumber_page_order(&mut doc.workspace, &target_group_id);
        }
        Ok(())
    })
}

fn normalize_group(input: &GroupInput, allow_generated_id: bool) -> Result<CollectionGroup, String> {
    let mut id = safe_id(&input.id, 32);
    if id.is_empty() && allow_generated_id {
        id = format!("group-{}", now_ms());
    }
    if id.is_empty() {
        return Err("group id is required".to_string());
    }
    let name = trim_max(&input.name, MAX_GROUP_NAME_CHARS);
    if name.is_empty() {
        return Err("group name is required".to_string());
    }
    Ok(CollectionGroup { id, name })
}

fn ordered_groups_by_id(
    groups: &[CollectionGroup],
    raw_order: &[String],
) -> Result<Vec<CollectionGroup>, String> {
    if raw_order.len() != groups.len() {
        return Err("groupOrder must include every group exactly once".to_string());
    }
    let mut ordered = Vec::with_capacity(groups.len());
    let mut seen = std::collections::HashSet::new();
    for raw in raw_order {
        let id = raw.trim();
        if id.is_empty() {
            return Err("groupOrder group id is required".to_string());
        }
        if !seen.insert(id.to_string()) {
            return Err(format!("duplicate groupOrder group: {id}"));
        }
        let Some(group) = groups.iter().find(|group| group.id == id) else {
            return Err(format!("groupOrder group not found: {id}"));
        };
        ordered.push(group.clone());
    }
    for group in groups {
        if !seen.contains(&group.id) {
            return Err(format!("groupOrder group is required: {}", group.id));
        }
    }
    Ok(ordered)
}
