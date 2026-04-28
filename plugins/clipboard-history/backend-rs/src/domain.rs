use crate::model::{
    ClipboardHistoryItem, ClipboardHistorySettings, CollectionNode, CollectionsDoc, DeletedHistoryMap,
    InternalCopyMarker,
};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_millis() as u64)
        .unwrap_or(0)
}

pub fn make_id() -> String {
    let now = now_ms();
    let seq = ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{now}-{seq:x}")
}

pub fn default_settings() -> ClipboardHistorySettings {
    ClipboardHistorySettings {
        auto_monitor: true,
        poll_interval: 1000,
        max_history: 50,
        collapse_lines: 6,
    }
}

pub fn normalize_settings(raw: Option<Value>) -> ClipboardHistorySettings {
    let mut out = default_settings();
    let Some(Value::Object(map)) = raw else { return out };
    if let Some(v) = map.get("autoMonitor") {
        out.auto_monitor = !matches!(v, Value::Bool(false));
    }
    if let Some(v) = map.get("pollInterval").and_then(Value::as_u64) {
        out.poll_interval = v.clamp(200, 15_000);
    }
    if let Some(v) = map.get("maxHistory").and_then(Value::as_u64) {
        out.max_history = (v as usize).clamp(10, 1000);
    }
    if let Some(v) = map.get("collapseLines").and_then(Value::as_u64) {
        out.collapse_lines = v.clamp(1, 50);
    }
    out
}

pub fn history_uniq_key(item: &ClipboardHistoryItem) -> String {
    format!("{}\n{}", item.item_type, item.content)
}

pub fn normalize_history_item(raw: &Value, fallback_now: u64) -> Option<ClipboardHistoryItem> {
    let obj = raw.as_object()?;
    let item_type = if obj.get("type").and_then(Value::as_str) == Some("image") {
        "image"
    } else {
        "text"
    };
    let content = obj.get("content").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if content.is_empty() {
        return None;
    }
    let time = obj.get("time").and_then(Value::as_u64).filter(|v| *v > 0).unwrap_or(fallback_now);
    let path = obj
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .filter(|_| item_type == "image");
    Some(ClipboardHistoryItem {
        item_type: item_type.to_string(),
        content,
        time,
        path,
    })
}

pub fn normalize_history_items(raw: Option<Value>, limit: usize) -> Vec<ClipboardHistoryItem> {
    let now = now_ms();
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let Some(Value::Array(list)) = raw else { return out };
    for item in list {
        let Some(normalized) = normalize_history_item(&item, now) else { continue };
        let key = history_uniq_key(&normalized);
        if seen.insert(key) {
            out.push(normalized);
        }
        if out.len() >= limit {
            break;
        }
    }
    out
}

pub fn merge_history_items(
    primary: Vec<ClipboardHistoryItem>,
    secondary: Vec<ClipboardHistoryItem>,
    limit: usize,
) -> Vec<ClipboardHistoryItem> {
    let mut map: HashMap<String, ClipboardHistoryItem> = HashMap::new();
    for item in primary.into_iter().chain(secondary) {
        if item.content.trim().is_empty() {
            continue;
        }
        let key = history_uniq_key(&item);
        let replace = map.get(&key).map(|prev| item.time > prev.time).unwrap_or(true);
        if replace {
            map.insert(key, item);
        }
    }
    let mut values = map.into_values().collect::<Vec<_>>();
    values.sort_by(|a, b| b.time.cmp(&a.time));
    values.truncate(limit);
    values
}

pub fn normalize_deleted_map(raw: Option<Value>) -> DeletedHistoryMap {
    let now = now_ms();
    let cutoff = now.saturating_sub(30 * 24 * 60 * 60 * 1000);
    let mut out = BTreeMap::new();
    let Some(Value::Object(map)) = raw else { return out };
    for (k, v) in map {
        let Some(ts) = v.as_u64() else { continue };
        if ts > 0 && ts >= cutoff {
            out.insert(k, ts);
        }
    }
    if out.len() <= 800 {
        return out;
    }
    let mut entries = out.into_iter().collect::<Vec<_>>();
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    entries.truncate(800);
    entries.into_iter().collect()
}

pub fn is_deleted(item: &ClipboardHistoryItem, deleted: &DeletedHistoryMap) -> bool {
    let deleted_at = deleted.get(&history_uniq_key(item)).copied().unwrap_or(0);
    deleted_at > 0 && item.time <= deleted_at
}

pub fn ensure_collections(raw: Option<Value>) -> CollectionsDoc {
    let now = now_ms();
    let root_id = "root".to_string();
    let mut nodes = BTreeMap::new();
    nodes.insert(
        root_id.clone(),
        CollectionNode::Folder {
            id: root_id.clone(),
            name: "收藏夹".to_string(),
            children: Vec::new(),
            created_at: now,
            updated_at: now,
        },
    );
    let empty = CollectionsDoc { version: 1, root_id: root_id.clone(), nodes };
    let Some(value) = raw else { return empty };
    let Ok(doc) = serde_json::from_value::<CollectionsDoc>(value) else { return empty };
    let Some(CollectionNode::Folder { children, .. }) = doc.nodes.get(&doc.root_id) else { return empty };
    if children.iter().any(|id| !doc.nodes.contains_key(id)) {
        return empty;
    }
    doc
}

pub fn get_node<'a>(doc: &'a CollectionsDoc, id: &str) -> Option<&'a CollectionNode> {
    doc.nodes.get(id)
}

fn get_node_mut<'a>(doc: &'a mut CollectionsDoc, id: &str) -> Option<&'a mut CollectionNode> {
    doc.nodes.get_mut(id)
}

pub fn is_folder(doc: &CollectionsDoc, id: &str) -> bool {
    matches!(get_node(doc, id), Some(CollectionNode::Folder { .. }))
}

fn build_parent_map(doc: &CollectionsDoc) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for (id, node) in &doc.nodes {
        if let CollectionNode::Folder { children, .. } = node {
            for child in children {
                map.insert(child.clone(), id.clone());
            }
        }
    }
    map
}

pub fn can_move_into(doc: &CollectionsDoc, target_folder_id: &str, moving_id: &str) -> bool {
    if !is_folder(doc, target_folder_id) || target_folder_id == moving_id {
        return false;
    }
    let parent = build_parent_map(doc);
    let mut cur = target_folder_id.to_string();
    while !cur.is_empty() {
        if cur == moving_id {
            return false;
        }
        cur = parent.get(&cur).cloned().unwrap_or_default();
    }
    true
}

fn remove_child(doc: &mut CollectionsDoc, parent_id: &str, child_id: &str) {
    if let Some(CollectionNode::Folder { children, updated_at, .. }) = get_node_mut(doc, parent_id) {
        children.retain(|id| id != child_id);
        *updated_at = now_ms();
    }
}

fn insert_child(doc: &mut CollectionsDoc, parent_id: &str, child_id: &str, index: Option<usize>) {
    if let Some(CollectionNode::Folder { children, updated_at, .. }) = get_node_mut(doc, parent_id) {
        children.retain(|id| id != child_id);
        let at = index.unwrap_or(children.len()).min(children.len());
        children.insert(at, child_id.to_string());
        *updated_at = now_ms();
    }
}

fn find_parent_id(doc: &CollectionsDoc, child_id: &str) -> Option<String> {
    build_parent_map(doc).get(child_id).cloned()
}

pub fn create_folder(doc: &mut CollectionsDoc, parent_id: &str, name: &str) {
    if !is_folder(doc, parent_id) {
        return;
    }
    let now = now_ms();
    let id = make_id();
    let safe_name = name.trim();
    doc.nodes.insert(
        id.clone(),
        CollectionNode::Folder {
            id: id.clone(),
            name: if safe_name.is_empty() { "未命名收藏夹" } else { safe_name }.to_string(),
            children: Vec::new(),
            created_at: now,
            updated_at: now,
        },
    );
    insert_child(doc, parent_id, &id, None);
}

pub fn create_item(doc: &mut CollectionsDoc, parent_id: &str, title: &str, content: &str) {
    if !is_folder(doc, parent_id) {
        return;
    }
    let safe_content = content.trim();
    if safe_content.is_empty() {
        return;
    }
    let now = now_ms();
    let id = make_id();
    let safe_title = title.trim();
    let default_title = safe_content.lines().next().unwrap_or("未命名条目").chars().take(24).collect::<String>();
    doc.nodes.insert(
        id.clone(),
        CollectionNode::Item {
            id: id.clone(),
            title: if safe_title.is_empty() { default_title } else { safe_title.to_string() },
            content: safe_content.to_string(),
            created_at: now,
            updated_at: now,
        },
    );
    insert_child(doc, parent_id, &id, None);
}

pub fn update_folder_name(doc: &mut CollectionsDoc, folder_id: &str, name: &str) {
    if let Some(CollectionNode::Folder { name: folder_name, updated_at, .. }) = get_node_mut(doc, folder_id) {
        let safe = name.trim();
        *folder_name = if safe.is_empty() { "未命名收藏夹" } else { safe }.to_string();
        *updated_at = now_ms();
    }
}

pub fn update_item(doc: &mut CollectionsDoc, item_id: &str, title: &str, content: &str) {
    let safe_content = content.trim();
    if safe_content.is_empty() {
        return;
    }
    if let Some(CollectionNode::Item { title: item_title, content: item_content, updated_at, .. }) = get_node_mut(doc, item_id) {
        let safe_title = title.trim();
        let default_title = safe_content.lines().next().unwrap_or("未命名条目").chars().take(24).collect::<String>();
        *item_title = if safe_title.is_empty() { default_title } else { safe_title.to_string() };
        *item_content = safe_content.to_string();
        *updated_at = now_ms();
    }
}

pub fn move_node(doc: &mut CollectionsDoc, moving_id: &str, to_parent_id: &str, to_index: Option<usize>) {
    if !can_move_into(doc, to_parent_id, moving_id) {
        return;
    }
    let Some(from_parent_id) = find_parent_id(doc, moving_id) else { return };
    remove_child(doc, &from_parent_id, moving_id);
    insert_child(doc, to_parent_id, moving_id, to_index);
}

fn delete_node_recursive(doc: &mut CollectionsDoc, node_id: &str) {
    let children = match doc.nodes.get(node_id) {
        Some(CollectionNode::Folder { children, .. }) => children.clone(),
        _ => Vec::new(),
    };
    for child in children {
        delete_node_recursive(doc, &child);
    }
    doc.nodes.remove(node_id);
}

pub fn delete_node(doc: &mut CollectionsDoc, node_id: &str) {
    if node_id.is_empty() || node_id == doc.root_id {
        return;
    }
    if let Some(parent_id) = find_parent_id(doc, node_id) {
        remove_child(doc, &parent_id, node_id);
    }
    delete_node_recursive(doc, node_id);
}

pub fn copy_item(doc: &mut CollectionsDoc, item_id: &str, to_parent_id: &str) {
    let Some(CollectionNode::Item { title, content, .. }) = doc.nodes.get(item_id).cloned() else { return };
    create_item(doc, to_parent_id, &title, &content);
}

pub fn empty_internal_copy() -> InternalCopyMarker {
    InternalCopyMarker { item_type: String::new(), at: 0 }
}

pub fn internal_copy(item_type: &str) -> InternalCopyMarker {
    InternalCopyMarker { item_type: item_type.to_string(), at: now_ms() }
}

pub fn within_internal_window(marker: &InternalCopyMarker, poll_interval: u64) -> bool {
    marker.at > 0 && now_ms().saturating_sub(marker.at) < poll_interval.saturating_mul(2).max(1500)
}
