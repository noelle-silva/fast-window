//! 桌面业务：批量布局 / 图标布局 / 壁纸 / 单条图标保存。

use std::path::Path;

use serde::Deserialize;

use crate::collections::model::{
    clamp_grid_layout, normalize_desktop_entry_kind, normalize_group_id, normalize_icon_layout,
    normalize_icon_option, normalize_wallpaper, now_ms, now_text, renumber_page_order,
    DesktopIcon, DesktopIconLayout, DesktopWallpaper, GridLayout, WorkspaceView,
};
use crate::collections::store::{with_workspace, workspace_view};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLayoutPatch {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub id: String,
    pub layout: GridLayout,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLayoutSavePayload {
    pub group_id: String,
    #[serde(default)]
    pub items: Vec<DesktopLayoutPatch>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IconLayoutPayload {
    pub icon_layout: DesktopIconLayout,
}

#[derive(Debug, Deserialize)]
pub struct WallpaperPayload {
    pub wallpaper: Option<DesktopWallpaper>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemIconPayload {
    pub id: String,
    pub icon: Option<DesktopIcon>,
}

/// 批量保存桌面图标位置；保存后按排序号压缩该分组。
pub fn save_layouts(
    data_dir: &Path,
    payload: DesktopLayoutSavePayload,
) -> Result<WorkspaceView, String> {
    if payload.items.is_empty() {
        return workspace_view(data_dir);
    }
    with_workspace(data_dir, |doc| {
        let group_id = normalize_group_id(&payload.group_id, &doc.workspace.groups)?;

        struct LayoutUpdate {
            kind: String,
            id: String,
            layout: GridLayout,
        }
        let mut updates = Vec::with_capacity(payload.items.len());
        for patch in &payload.items {
            let kind = normalize_desktop_entry_kind(&patch.kind);
            let id = patch.id.trim().to_string();
            if kind.is_empty() || id.is_empty() {
                return Err("desktop layout kind and id are required".to_string());
            }
            updates.push(LayoutUpdate {
                kind,
                id,
                layout: clamp_grid_layout(&patch.layout),
            });
        }

        let now = now_ms();
        let now_string = now_text();
        let mut found = std::collections::HashSet::new();
        for update in &updates {
            let key = format!("{}:{}", update.kind, update.id);
            match update.kind.as_str() {
                "item" => {
                    for item in doc.workspace.items.iter_mut() {
                        if item.id != update.id
                            || item.group_id != group_id
                            || !item.container_id.is_empty()
                        {
                            continue;
                        }
                        item.layout = Some(update.layout.clone());
                        item.updated_at_ms = now;
                        item.updated_at = now_string.clone();
                        found.insert(key);
                        break;
                    }
                }
                "container" => {
                    for container in doc.workspace.containers.iter_mut() {
                        if container.id != update.id || container.group_id != group_id {
                            continue;
                        }
                        container.layout = Some(update.layout.clone());
                        container.updated_at_ms = now;
                        container.updated_at = now_string.clone();
                        found.insert(key);
                        break;
                    }
                }
                _ => {}
            }
        }
        for update in &updates {
            let key = format!("{}:{}", update.kind, update.id);
            if !found.contains(&key) {
                return Err(format!("desktop entry not found: {key}"));
            }
        }
        renumber_page_order(&mut doc.workspace, &group_id);
        Ok(())
    })
}

pub fn save_icon_layout(
    data_dir: &Path,
    payload: IconLayoutPayload,
) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let mut layout = payload.icon_layout;
        normalize_icon_layout(&mut layout)?;
        doc.workspace.desktop.icon_layout = layout;
        Ok(())
    })
}

/// 保存 / 清除壁纸（`null` 表示清除）。
pub fn save_wallpaper(
    data_dir: &Path,
    payload: WallpaperPayload,
) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let mut wallpaper = payload.wallpaper;
        if let Some(wallpaper) = wallpaper.as_mut() {
            normalize_wallpaper(wallpaper)?;
        }
        doc.workspace.desktop.wallpaper = wallpaper;
        Ok(())
    })
}

/// 单独保存条目图标（`null` = 清除，使用默认色图标）。
pub fn save_icon(data_dir: &Path, payload: ItemIconPayload) -> Result<WorkspaceView, String> {
    with_workspace(data_dir, |doc| {
        let id = payload.id.trim().to_string();
        if id.is_empty() {
            return Err("item id is required".to_string());
        }
        let icon = normalize_icon_option(payload.icon)?;
        let now = now_ms();
        let now_string = now_text();
        let Some(item) = doc.workspace.items.iter_mut().find(|item| item.id == id) else {
            return Err(format!("item not found: {id}"));
        };
        item.icon = icon;
        item.updated_at_ms = now;
        item.updated_at = now_string;
        Ok(())
    })
}
