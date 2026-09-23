//! 宿主快捷命令声明：把收藏图标映射为宿主可读取的命令清单。
//!
//! 一条命令对应一个收藏条目，动作 = 打开该图标（内嵌浏览页）。
//! 命令图标统一返回宿主可显示的 data URL：图片图标读取资产文件
//! （源文件超过 512KB 时不带图标），颜色 / 默认图标生成与桌面一致的同色圆角块 SVG。

use std::path::Path;

use base64::engine::general_purpose;
use base64::Engine as _;
use serde::Serialize;

use crate::collections::assets::asset_file_path;
use crate::collections::model::{CollectionItem, WorkspaceView};
use crate::collections::store::workspace_view;

/// 图片图标源文件上限：base64 后仍在宿主命令图标 data URL 上限（700KB）内。
const MAX_IMAGE_ICON_SOURCE_BYTES: usize = 512 * 1024;

/// 桌面默认图标色板，与前端 `desktopIconTokens` 保持一致。
const DESKTOP_ICON_COLORS: [&str; 8] = [
    "#8FA99B",
    "#8FA6B8",
    "#A79AB4",
    "#B7A38C",
    "#A9A18E",
    "#9AA38F",
    "#A08F8F",
    "#8F9FA3",
];

const DESKTOP_ICON_SURFACE_SIZE: u32 = 88;
const DESKTOP_ICON_SURFACE_RADIUS: u32 = 26;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostShortcutCommand {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// 读取当前收藏文档并生成宿主快捷命令清单。
pub fn list(app: &tauri::AppHandle) -> Result<Vec<HostShortcutCommand>, String> {
    let data_dir = crate::data_dir::resolve_data_dir(app)?;
    let view = workspace_view(&data_dir)?;
    Ok(build_commands(&data_dir, &view))
}

/// 清单按分组顺序与组内页面顺序排列。
fn build_commands(data_dir: &Path, view: &WorkspaceView) -> Vec<HostShortcutCommand> {
    let group_rank: std::collections::HashMap<&str, usize> = view
        .groups
        .iter()
        .enumerate()
        .map(|(index, group)| (group.id.as_str(), index))
        .collect();

    let mut items: Vec<&CollectionItem> = view.items.iter().collect();
    items.sort_by_key(|item| {
        (
            group_rank
                .get(item.group_id.as_str())
                .copied()
                .unwrap_or(usize::MAX),
            item.page_order,
        )
    });

    items
        .into_iter()
        .map(|item| HostShortcutCommand {
            id: item.id.clone(),
            title: item.name.clone(),
            icon: command_icon(data_dir, item),
        })
        .collect()
}

fn command_icon(data_dir: &Path, item: &CollectionItem) -> Option<String> {
    if let Some(icon) = item.icon.as_ref() {
        if icon.kind == "image" {
            return image_icon_data_url(data_dir, icon.asset_id.trim());
        }
    }
    Some(color_block_data_url(desktop_icon_color(item)))
}

fn image_icon_data_url(data_dir: &Path, asset_id: &str) -> Option<String> {
    let path = asset_file_path(data_dir, asset_id).ok()?;
    let bytes = std::fs::read(&path).ok()?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_ICON_SOURCE_BYTES {
        return None;
    }
    let mime = image_mime_by_ext(path.extension().and_then(|ext| ext.to_str()).unwrap_or(""))?;
    Some(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

fn image_mime_by_ext(ext: &str) -> Option<&'static str> {
    match ext.trim().to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "ico" => Some("image/x-icon"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// 与桌面一致的取色：颜色图标命中色板时用该色，否则按 `url:{id}:{name}` 哈希取默认色。
fn desktop_icon_color(item: &CollectionItem) -> &'static str {
    if let Some(icon) = item.icon.as_ref() {
        if icon.kind == "color" {
            let color = icon.color.trim().to_ascii_uppercase();
            for candidate in DESKTOP_ICON_COLORS {
                if candidate == color {
                    return candidate;
                }
            }
        }
    }

    let seed = format!("url:{}:{}", item.id, item.name);
    let mut hash: i32 = 0;
    for unit in seed.encode_utf16() {
        hash = hash.wrapping_mul(31).wrapping_add(i32::from(unit));
    }
    let index = (hash as i64).unsigned_abs() as usize % DESKTOP_ICON_COLORS.len();
    DESKTOP_ICON_COLORS[index]
}

fn color_block_data_url(color: &str) -> String {
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {size} {size}\"><rect width=\"{size}\" height=\"{size}\" rx=\"{radius}\" fill=\"{color}\"/></svg>",
        size = DESKTOP_ICON_SURFACE_SIZE,
        radius = DESKTOP_ICON_SURFACE_RADIUS,
    );
    format!(
        "data:image/svg+xml;base64,{}",
        general_purpose::STANDARD.encode(svg.as_bytes())
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collections::model::{CollectionGroup, CollectionTarget, CollectionsDoc, DesktopIcon};

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fw-webview-host-shortcuts-{tag}-{}",
            crate::collections::model::now_ms()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn item(
        id: &str,
        name: &str,
        page_order: i64,
        group_id: &str,
        icon: Option<DesktopIcon>,
    ) -> CollectionItem {
        CollectionItem {
            id: id.to_string(),
            name: name.to_string(),
            target: CollectionTarget {
                kind: "url".to_string(),
                url: "https://example.com".to_string(),
            },
            group_id: group_id.to_string(),
            page_order,
            container_id: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            created_at_ms: 0,
            updated_at_ms: 0,
            layout: None,
            container_layout: None,
            icon,
            browser_space_id: String::new(),
        }
    }

    #[test]
    fn default_color_matches_frontend_hash() {
        let cases = [
            ("1700000000000", "示例站点", "#A9A18E"),
            ("item-1", "GitHub", "#9AA38F"),
            ("1700000000001", "中文名称测试", "#8F9FA3"),
            ("42", "A", "#8FA99B"),
        ];
        for (id, name, expected) in cases {
            let collection_item = item(id, name, 0, "default", None);
            assert_eq!(desktop_icon_color(&collection_item), expected, "{id} {name}");
        }
    }

    #[test]
    fn palette_color_used_only_for_palette_members() {
        let palette_icon = DesktopIcon {
            kind: "color".to_string(),
            color: "#8fa99b".to_string(),
            asset_id: String::new(),
        };
        assert_eq!(
            desktop_icon_color(&item("42", "A", 0, "default", Some(palette_icon))),
            "#8FA99B"
        );

        let custom_icon = DesktopIcon {
            kind: "color".to_string(),
            color: "#FF0000".to_string(),
            asset_id: String::new(),
        };
        let without_icon = item("42", "A", 0, "default", None);
        assert_eq!(
            desktop_icon_color(&item("42", "A", 0, "default", Some(custom_icon))),
            desktop_icon_color(&without_icon)
        );
    }

    #[test]
    fn color_block_is_svg_data_url() {
        let url = color_block_data_url("#8FA99B");
        let encoded = url
            .strip_prefix("data:image/svg+xml;base64,")
            .expect("svg data url");
        let svg = String::from_utf8(general_purpose::STANDARD.decode(encoded).expect("decode"))
            .expect("utf8");
        assert!(svg.contains("fill=\"#8FA99B\""));
        assert!(svg.contains("rx=\"26\""));
    }

    #[test]
    fn image_icon_respects_size_limit() {
        let dir = temp_dir("image");
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89";
        let small_id = format!("icons/{}.png", "0".repeat(40));
        let small_path = asset_file_path(&dir, &small_id).expect("small path");
        std::fs::create_dir_all(small_path.parent().expect("parent")).expect("dirs");
        std::fs::write(&small_path, png).expect("write small");

        let url = image_icon_data_url(&dir, &small_id).expect("small url");
        assert!(url.starts_with("data:image/png;base64,"));

        let big_id = format!("icons/{}.png", "1".repeat(40));
        let big_path = asset_file_path(&dir, &big_id).expect("big path");
        std::fs::write(&big_path, vec![0u8; MAX_IMAGE_ICON_SOURCE_BYTES + 1]).expect("write big");
        assert!(image_icon_data_url(&dir, &big_id).is_none());

        let missing_id = format!("icons/{}.png", "2".repeat(40));
        assert!(image_icon_data_url(&dir, &missing_id).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn builds_commands_in_group_and_page_order() {
        let dir = temp_dir("order");
        let mut doc = CollectionsDoc::default();
        doc.workspace.groups = vec![
            CollectionGroup {
                id: "g1".to_string(),
                name: "第一组".to_string(),
            },
            CollectionGroup {
                id: "g2".to_string(),
                name: "第二组".to_string(),
            },
        ];
        doc.workspace.items = vec![
            item("i3", "第三", 0, "g2", None),
            item("i1", "第一", 0, "g1", None),
            item("i2", "第二", 1, "g1", None),
        ];

        let view = WorkspaceView::from_doc(&doc);
        let commands = build_commands(&dir, &view);
        let ids: Vec<&str> = commands.iter().map(|command| command.id.as_str()).collect();
        assert_eq!(ids, ["i1", "i2", "i3"]);
        assert_eq!(commands[0].title, "第一");
        assert!(commands[0].icon.as_deref().unwrap_or_default().starts_with("data:image/"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
