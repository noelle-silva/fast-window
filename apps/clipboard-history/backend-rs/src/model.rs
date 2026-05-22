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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<ClipboardFileEntry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFileEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardHistorySettings {
    pub auto_monitor: bool,
    pub poll_interval: u64,
    pub max_history: usize,
    pub collapse_lines: u64,
    pub theme: String,
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
        content: CollectionItemContent,
        created_at: u64,
        updated_at: u64,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CollectionItemContent {
    #[serde(rename = "text", rename_all = "camelCase")]
    Text { text: String },
    #[serde(rename = "image", rename_all = "camelCase")]
    Image {
        reference: String,
        path: String,
        mime: String,
        width: u32,
        height: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        source_name: Option<String>,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanImageEntry {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanImageReport {
    pub scanned_files: usize,
    pub referenced_files: usize,
    pub orphan_count: usize,
    pub orphan_bytes: u64,
    pub orphans: Vec<OrphanImageEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanImageDeleteFailure {
    pub path: String,
    pub error: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanImageCleanupReport {
    pub detected: OrphanImageReport,
    pub deleted_count: usize,
    pub deleted_bytes: u64,
    pub failed: Vec<OrphanImageDeleteFailure>,
    pub remaining: OrphanImageReport,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImageDraft {
    pub data_url: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug)]
pub struct InternalCopyMarker {
    pub item_type: String,
    pub at: u64,
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
