use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClipboardHistoryItem {
    #[serde(rename = "type")]
    pub item_type: String,
    pub content: String,
    pub time: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardHistorySettings {
    pub auto_monitor: bool,
    pub poll_interval: u64,
    pub max_history: usize,
    pub collapse_lines: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CollectionNode {
    #[serde(rename = "folder", rename_all = "camelCase")]
    Folder {
        id: String,
        name: String,
        children: Vec<String>,
        created_at: u64,
        updated_at: u64,
    },
    #[serde(rename = "item", rename_all = "camelCase")]
    Item {
        id: String,
        title: String,
        content: String,
        created_at: u64,
        updated_at: u64,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionsDoc {
    pub version: u64,
    pub root_id: String,
    pub nodes: BTreeMap<String, CollectionNode>,
}

pub type DeletedHistoryMap = BTreeMap<String, u64>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardHistorySnapshot {
    pub history: Vec<ClipboardHistoryItem>,
    pub settings: ClipboardHistorySettings,
    pub deleted: DeletedHistoryMap,
    pub collections: CollectionsDoc,
    pub recent_folders: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct InternalCopyMarker {
    pub item_type: String,
    pub at: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ClipboardMonitorSnapshot {
    pub latest: Option<ClipboardHistoryItem>,
    pub items: Vec<ClipboardHistoryItem>,
}

#[derive(Debug, Deserialize)]
pub struct RequestFrame {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub frame_type: Option<String>,
    pub method: Option<String>,
    #[serde(default)]
    pub params: serde_json::Value,
}
