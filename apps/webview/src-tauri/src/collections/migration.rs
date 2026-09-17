//! 旧书签数据的一次性升级：bookmarks.json → 收藏文档。
//!
//! 迁移整体成功后由调用方落盘；旧文件保留作为备份。
//! 无效网址条目跳过；本地图标尽力迁移为图标资产。

use std::path::Path;

use serde::Deserialize;

use crate::collections::assets;
use crate::collections::model::{
    default_item_name, now_ms, now_text, rfc3339_from_ms, trim_max, validate_target,
    CollectionItem, CollectionTarget, CollectionsDoc, DesktopIcon, DEFAULT_GROUP_ID,
    MAX_ITEM_NAME_CHARS,
};

pub const LEGACY_BOOKMARKS_FILE: &str = "bookmarks.json";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyBookmark {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    icon_url: String,
    #[serde(default)]
    icon_data_url: String,
    #[serde(default)]
    icon_path: String,
    #[serde(default)]
    created_at: u64,
    #[serde(default)]
    updated_at: u64,
}

pub fn legacy_bookmarks_present(data_dir: &Path) -> bool {
    data_dir.join(LEGACY_BOOKMARKS_FILE).is_file()
}

/// 从旧书签构造收藏文档；不写文档文件，但会把可迁移的本地图标写入资产目录。
pub fn build_doc_from_legacy_bookmarks(data_dir: &Path) -> Result<CollectionsDoc, String> {
    let path = data_dir.join(LEGACY_BOOKMARKS_FILE);
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取旧书签数据失败: {e}"))?;
    if text.trim().is_empty() {
        return Ok(CollectionsDoc::default());
    }
    let bookmarks: Vec<LegacyBookmark> =
        serde_json::from_str(&text).map_err(|e| format!("解析旧书签数据失败: {e}"))?;

    let mut doc = CollectionsDoc::default();
    doc.workspace.items.clear();
    let base_ms = now_ms();
    let mut seen_ids = std::collections::HashSet::new();
    let mut page_order = 0i64;

    for (index, bookmark) in bookmarks.iter().enumerate() {
        let mut target = CollectionTarget {
            kind: "url".to_string(),
            url: bookmark.url.trim().to_string(),
        };
        if validate_target(&target).is_err() {
            continue;
        }
        target.url = target.url.trim().to_string();

        let mut name = trim_max(&bookmark.title, MAX_ITEM_NAME_CHARS);
        if name.is_empty() {
            name = default_item_name(&target);
        }
        if name.is_empty() {
            continue;
        }

        let created_at_ms = bookmark.created_at as i64;
        let updated_at_ms = bookmark.updated_at as i64;
        let icon = migrate_legacy_icon(data_dir, bookmark);

        doc.workspace.items.push(CollectionItem {
            id: unique_item_id(&mut seen_ids, &bookmark.id, index, base_ms),
            name,
            target,
            group_id: DEFAULT_GROUP_ID.to_string(),
            page_order,
            container_id: String::new(),
            created_at: if created_at_ms > 0 {
                rfc3339_from_ms(created_at_ms)
            } else {
                now_text()
            },
            updated_at: if updated_at_ms > 0 {
                rfc3339_from_ms(updated_at_ms)
            } else {
                now_text()
            },
            created_at_ms: if created_at_ms > 0 { created_at_ms } else { base_ms },
            updated_at_ms: if updated_at_ms > 0 { updated_at_ms } else { base_ms },
            layout: None,
            container_layout: None,
            icon,
        });
        page_order += 1;
    }

    Ok(doc)
}

fn unique_item_id(
    seen: &mut std::collections::HashSet<String>,
    raw: &str,
    index: usize,
    base_ms: i64,
) -> String {
    let candidate = raw.trim().to_string();
    if !candidate.is_empty() && seen.insert(candidate.clone()) {
        return candidate;
    }
    let mut n = index;
    loop {
        let generated = format!("{base_ms}-migrated-{n}");
        if seen.insert(generated.clone()) {
            return generated;
        }
        n += 1;
    }
}

fn migrate_legacy_icon(data_dir: &Path, bookmark: &LegacyBookmark) -> Option<DesktopIcon> {
    let icon_path = bookmark.icon_path.trim();
    if !icon_path.is_empty() {
        if let Ok(asset) = assets::import_asset(data_dir, "icon", icon_path, "") {
            return Some(DesktopIcon {
                kind: "image".to_string(),
                color: String::new(),
                asset_id: asset.id,
            });
        }
    }
    let data_url = bookmark.icon_data_url.trim();
    if !data_url.is_empty() {
        if let Ok(asset) = assets::import_asset(data_dir, "icon", "", data_url) {
            return Some(DesktopIcon {
                kind: "image".to_string(),
                color: String::new(),
                asset_id: asset.id,
            });
        }
    }
    let _ = bookmark.icon_url.trim();
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose;
    use base64::Engine as _;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("fw-webview-migrate-{tag}-{}", now_ms()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn migrates_valid_bookmarks_and_skips_invalid() {
        let dir = temp_dir("basic");
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89";
        let icon_file = dir.join("icon-old.png");
        std::fs::write(&icon_file, png).expect("write icon");
        let payload = serde_json::json!([
            {
                "id": "b1",
                "title": "示例",
                "url": "https://example.com",
                "iconPath": icon_file.display().to_string(),
                "createdAt": 1_700_000_000_000u64,
                "updatedAt": 1_700_000_100_000u64
            },
            { "id": "b2", "title": "坏数据", "url": "not-a-url" },
            { "id": "b1", "title": "", "url": "http://dup.example" }
        ]);
        std::fs::write(dir.join(LEGACY_BOOKMARKS_FILE), payload.to_string()).expect("write legacy");

        let doc = build_doc_from_legacy_bookmarks(&dir).expect("migrate");
        assert_eq!(doc.workspace.items.len(), 2);
        assert_eq!(doc.workspace.items[0].name, "示例");
        assert_eq!(doc.workspace.items[0].group_id, DEFAULT_GROUP_ID);
        assert_eq!(doc.workspace.items[0].created_at, "2023-11-14T22:13:20Z");
        let icon = doc.workspace.items[0].icon.as_ref().expect("icon migrated");
        assert_eq!(icon.kind, "image");
        assert!(assets::asset_file_path(&dir, &icon.asset_id).expect("path").is_file());
        assert_ne!(doc.workspace.items[1].id, "b1");
        assert_eq!(doc.workspace.items[1].name, "dup.example");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrates_icon_from_data_url() {
        let dir = temp_dir("dataurl");
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89";
        let data_url = format!(
            "data:image/png;base64,{}",
            general_purpose::STANDARD.encode(png)
        );
        let payload = serde_json::json!([
            { "id": "b1", "title": "x", "url": "https://x.example", "iconDataUrl": data_url }
        ]);
        std::fs::write(dir.join(LEGACY_BOOKMARKS_FILE), payload.to_string()).expect("write legacy");
        let doc = build_doc_from_legacy_bookmarks(&dir).expect("migrate");
        assert!(doc.workspace.items[0].icon.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_legacy_file_yields_empty_default() {
        let dir = temp_dir("empty");
        std::fs::write(dir.join(LEGACY_BOOKMARKS_FILE), "[]").expect("write legacy");
        let doc = build_doc_from_legacy_bookmarks(&dir).expect("migrate");
        assert!(doc.workspace.items.is_empty());
        assert_eq!(doc.workspace.groups.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
