use crate::domain::{ensure_collections, normalize_deleted_map, normalize_history_items, normalize_settings, now_ms};
use crate::model::{ClipboardHistoryItem, ClipboardHistorySettings, CollectionsDoc, DeletedHistoryMap};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn ensure_ready(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|e| format!("创建数据目录失败: {e}"))?;
        self.write_meta()
    }

    pub fn load_settings(&self) -> ClipboardHistorySettings {
        normalize_settings(self.read_value("settings"))
    }

    pub fn save_settings(&self, settings: &ClipboardHistorySettings) -> Result<(), String> {
        self.write_key("settings", settings)
    }

    pub fn load_history(&self, limit: usize) -> Vec<ClipboardHistoryItem> {
        normalize_history_items(self.read_value("history"), limit)
    }

    pub fn save_history(&self, history: &[ClipboardHistoryItem]) -> Result<(), String> {
        self.write_key("history", history)
    }

    pub fn load_deleted(&self) -> DeletedHistoryMap {
        normalize_deleted_map(self.read_value("deletedHistory"))
    }

    pub fn save_deleted(&self, deleted: &DeletedHistoryMap) -> Result<(), String> {
        self.write_key("deletedHistory", deleted)
    }

    pub fn load_collections(&self) -> CollectionsDoc {
        ensure_collections(self.read_value("collections"))
    }

    pub fn save_collections(&self, collections: &CollectionsDoc) -> Result<(), String> {
        self.write_key("collections", collections)
    }

    pub fn load_recent_folders(&self) -> Vec<String> {
        match self.read_value("recentFolders") {
            Some(Value::Array(list)) => list.into_iter().filter_map(|v| v.as_str().map(ToOwned::to_owned)).collect(),
            _ => Vec::new(),
        }
    }

    pub fn save_recent_folders(&self, recent: &[String]) -> Result<(), String> {
        self.write_key("recentFolders", recent)
    }

    fn key_path(&self, key: &str) -> PathBuf {
        self.root.join(format!("{key}.json"))
    }

    fn read_value(&self, key: &str) -> Option<Value> {
        let raw = fs::read_to_string(self.key_path(key)).ok()?;
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
        serde_json::from_str(trimmed).ok()
    }

    fn write_key<T: Serialize + ?Sized>(&self, key: &str, value: &T) -> Result<(), String> {
        let path = self.key_path(key);
        atomic_write_json(&path, value)?;
        self.write_meta()
    }

    fn write_meta(&self) -> Result<(), String> {
        let value = serde_json::json!({ "schemaVersion": 1, "updatedAt": now_ms() });
        atomic_write_json(&self.root.join("_meta.json"), &value)
    }
}

fn atomic_write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let temp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let text = serde_json::to_string_pretty(value).map_err(|e| format!("序列化 JSON 失败: {e}"))? + "\n";
    fs::write(&temp, text).map_err(|e| format!("写入临时文件失败: {e}"))?;
    fs::rename(&temp, path).map_err(|e| format!("替换数据文件失败: {e}"))
}
