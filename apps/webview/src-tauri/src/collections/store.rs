//! 收藏数据文档的读写：默认文档、版本门、整文档归一化与原子写。

use std::path::{Path, PathBuf};

use crate::collections::model::{
    normalize_doc, now_text, repair_ui_state_selection, CollectionsDoc, WorkspaceView, DATA_VERSION,
    SCHEMA_VERSION,
};

pub const COLLECTIONS_FILE: &str = "collections.json";

pub fn collections_file(data_dir: &Path) -> PathBuf {
    data_dir.join(COLLECTIONS_FILE)
}

/// 写事务：读取文档 → 变更 → 修正界面选择 → 归一化后原子写 → 返回工作区视图。
/// 变更返回错误时不落盘。
pub fn with_workspace<F>(data_dir: &Path, mutate: F) -> Result<WorkspaceView, String>
where
    F: FnOnce(&mut CollectionsDoc) -> Result<(), String>,
{
    let mut doc = ensure_doc(data_dir)?;
    mutate(&mut doc)?;
    repair_ui_state_selection(&mut doc);
    save_doc(data_dir, &mut doc)?;
    Ok(WorkspaceView::from_doc(&doc))
}

/// 只读工作区视图。
pub fn workspace_view(data_dir: &Path) -> Result<WorkspaceView, String> {
    Ok(WorkspaceView::from_doc(&ensure_doc(data_dir)?))
}

/// 就绪文档：优先读新数据文件；不存在时尝试旧书签迁移；再否则创建默认文档。
/// 首次初始化会写入 `collections.json`。
pub fn ensure_doc(data_dir: &Path) -> Result<CollectionsDoc, String> {
    let path = collections_file(data_dir);
    if path.is_file() {
        return read_doc(&path);
    }
    let mut doc = if crate::collections::migration::legacy_bookmarks_present(data_dir) {
        crate::collections::migration::build_doc_from_legacy_bookmarks(data_dir)?
    } else {
        CollectionsDoc::default()
    };
    save_doc(data_dir, &mut doc)?;
    Ok(doc)
}

/// 读取并校验数据文件；版本高于当前支持时拒绝。
pub fn read_doc(path: &Path) -> Result<CollectionsDoc, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("读取收藏数据失败: {e}"))?;
    if text.trim().is_empty() {
        return Err("收藏数据文件为空".to_string());
    }
    let mut doc: CollectionsDoc =
        serde_json::from_str(&text).map_err(|e| format!("解析收藏数据失败: {e}"))?;
    if doc.schema_version > SCHEMA_VERSION || doc.data_version > DATA_VERSION {
        return Err(format!(
            "收藏数据版本过高（schema {} / data {}），当前程序最高支持 schema {} / data {}，请升级程序",
            doc.schema_version, doc.data_version, SCHEMA_VERSION, DATA_VERSION
        ));
    }
    if doc.schema_version != SCHEMA_VERSION || doc.data_version != DATA_VERSION {
        return Err(format!(
            "收藏数据版本不受支持（schema {} / data {}），无法升级",
            doc.schema_version, doc.data_version
        ));
    }
    normalize_doc(&mut doc)?;
    Ok(doc)
}

/// 归一化后原子写入（先写临时文件再替换）。
pub fn save_doc(data_dir: &Path, doc: &mut CollectionsDoc) -> Result<(), String> {
    normalize_doc(doc)?;
    doc.updated_at = now_text();
    let path = collections_file(data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建收藏数据目录失败: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(doc).map_err(|e| format!("序列化收藏数据失败: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, format!("{payload}\n")).map_err(|e| format!("写入收藏数据失败: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("替换收藏数据失败: {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collections::model::{GridLayout, DEFAULT_GROUP_ID};

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fw-webview-store-{tag}-{}",
            crate::collections::model::now_ms()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn initializes_default_document() {
        let dir = temp_dir("default");
        let doc = ensure_doc(&dir).expect("init");
        assert_eq!(doc.workspace.groups.len(), 1);
        assert_eq!(doc.workspace.groups[0].id, DEFAULT_GROUP_ID);
        assert_eq!(doc.ui_state.group_id, DEFAULT_GROUP_ID);
        assert!(collections_file(&dir).is_file());
        let again = ensure_doc(&dir).expect("reload");
        assert_eq!(again.workspace.groups.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_newer_data_version() {
        let dir = temp_dir("newer");
        let path = collections_file(&dir);
        let mut doc = CollectionsDoc::default();
        doc.data_version = DATA_VERSION + 1;
        let payload = serde_json::to_string_pretty(&doc).expect("serialize");
        std::fs::write(&path, payload).expect("write");
        assert!(ensure_doc(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn round_trips_layout_and_ui_state() {
        let dir = temp_dir("roundtrip");
        let mut doc = ensure_doc(&dir).expect("init");
        doc.workspace.items.push(crate::collections::model::CollectionItem {
            id: "item-1".to_string(),
            name: "example".to_string(),
            target: crate::collections::model::CollectionTarget {
                kind: "url".to_string(),
                url: "https://example.com".to_string(),
            },
            group_id: DEFAULT_GROUP_ID.to_string(),
            page_order: 0,
            container_id: String::new(),
            created_at: now_text(),
            updated_at: now_text(),
            created_at_ms: 0,
            updated_at_ms: 0,
            layout: Some(GridLayout { x: 1, y: 2 }),
            container_layout: None,
            icon: None,
        });
        save_doc(&dir, &mut doc).expect("save");
        let loaded = ensure_doc(&dir).expect("reload");
        assert_eq!(loaded.workspace.items.len(), 1);
        assert_eq!(
            loaded.workspace.items[0].layout,
            Some(GridLayout { x: 1, y: 2 })
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
