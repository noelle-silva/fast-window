use crate::domain::{ensure_collections, normalize_deleted_map, normalize_history_items, normalize_settings, now_ms};
use crate::model::{ClipboardHistoryItem, ClipboardHistorySettings, CollectionsDoc, DeletedHistoryMap};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const LEGACY_AGGREGATE_PATH: &str = "clipboard-history.json";
const STORAGE_KEYS: [&str; 5] = ["history", "settings", "deletedHistory", "collections", "recentFolders"];

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn ensure_ready(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|e| format!("创建数据目录失败: {e}"))?;
        self.migrate_legacy_aggregate_if_needed()?;
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

    fn migrate_legacy_aggregate_if_needed(&self) -> Result<(), String> {
        let legacy_path = self.root.join(LEGACY_AGGREGATE_PATH);
        if !legacy_path.exists() {
            return Ok(());
        }
        let legacy = read_json_file(&legacy_path)?.unwrap_or(Value::Null);
        if !legacy.is_object() {
            return Ok(());
        }
        let backup = self.root.join(format!("_backup-migrate-{}.json", now_id()));
        let _ = fs::copy(&legacy_path, backup);
        for key in STORAGE_KEYS {
            let Some(legacy_value) = pick_legacy_part(&legacy, key) else { continue };
            let path = self.key_path(key);
            let current = read_json_file(&path)?;
            if let Some(value) = merge_legacy_value(key, current.as_ref(), legacy_value) {
                atomic_write_json(&path, &value)?;
            }
        }
        Ok(())
    }

    fn write_meta(&self) -> Result<(), String> {
        let value = serde_json::json!({ "schemaVersion": 1, "updatedAt": now_ms() });
        atomic_write_json(&self.root.join("_meta.json"), &value)
    }
}

fn read_json_file(path: &Path) -> Result<Option<Value>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("读取 JSON 失败: {e}")),
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    serde_json::from_str(trimmed).map(Some).map_err(|e| format!("解析 JSON 失败: {e}"))
}

fn pick_legacy_part<'a>(legacy: &'a Value, key: &str) -> Option<&'a Value> {
    let obj = legacy.as_object()?;
    if let Some(value) = obj.get(key) {
        return Some(value);
    }
    if key == "deletedHistory" {
        return obj.get("deleted");
    }
    None
}

fn merge_legacy_value(key: &str, current: Option<&Value>, legacy: &Value) -> Option<Value> {
    match key {
        "history" => Some(merge_history_value(current, legacy)),
        "deletedHistory" => Some(merge_deleted_value(current, legacy)),
        "settings" | "collections" | "recentFolders" => {
            if current.is_none() || current.is_some_and(|v| is_bootstrap_value(key, v)) {
                Some(legacy.clone())
            } else {
                None
            }
        }
        _ => None,
    }
}

fn merge_history_value(current: Option<&Value>, legacy: &Value) -> Value {
    let mut map = std::collections::BTreeMap::<String, Value>::new();
    for item in legacy.as_array().into_iter().flatten().chain(current.and_then(Value::as_array).into_iter().flatten()) {
        let Some(obj) = item.as_object() else { continue };
        let item_type = obj.get("type").and_then(Value::as_str).unwrap_or("text");
        let content = obj.get("content").and_then(Value::as_str).unwrap_or("");
        if content.trim().is_empty() {
            continue;
        }
        let key = format!("{item_type}\n{content}");
        let prev_time = map.get(&key).and_then(|v| v.get("time")).and_then(Value::as_u64).unwrap_or(0);
        let item_time = obj.get("time").and_then(Value::as_u64).unwrap_or(0);
        if item_time >= prev_time {
            map.insert(key, item.clone());
        }
    }
    let mut items = map.into_values().collect::<Vec<_>>();
    items.sort_by(|a, b| {
        let at = a.get("time").and_then(Value::as_u64).unwrap_or(0);
        let bt = b.get("time").and_then(Value::as_u64).unwrap_or(0);
        bt.cmp(&at)
    });
    Value::Array(items)
}

fn merge_deleted_value(current: Option<&Value>, legacy: &Value) -> Value {
    let mut out = serde_json::Map::new();
    for source in [Some(legacy), current].into_iter().flatten() {
        let Some(obj) = source.as_object() else { continue };
        for (key, value) in obj {
            let ts = value.as_u64().unwrap_or(0);
            let prev = out.get(key).and_then(Value::as_u64).unwrap_or(0);
            if ts > prev {
                out.insert(key.clone(), Value::from(ts));
            }
        }
    }
    Value::Object(out)
}

fn is_bootstrap_value(key: &str, value: &Value) -> bool {
    match key {
        "settings" => value == &serde_json::json!({
            "autoMonitor": true,
            "pollInterval": 1000,
            "maxHistory": 50,
            "collapseLines": 6,
        }),
        "collections" => is_default_collections(value),
        "recentFolders" => value.as_array().is_some_and(Vec::is_empty),
        _ => false,
    }
}

fn is_default_collections(value: &Value) -> bool {
    let Some(obj) = value.as_object() else { return false };
    if obj.get("version").and_then(Value::as_u64) != Some(1) {
        return false;
    }
    if obj.get("rootId").and_then(Value::as_str) != Some("root") {
        return false;
    }
    let Some(nodes) = obj.get("nodes").and_then(Value::as_object) else { return false };
    if nodes.len() != 1 {
        return false;
    }
    let Some(root) = nodes.get("root").and_then(Value::as_object) else { return false };
    root.get("type").and_then(Value::as_str) == Some("folder")
        && root.get("children").and_then(Value::as_array).is_some_and(Vec::is_empty)
}

fn now_id() -> String {
    let secs = (now_ms() / 1000) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400) as u32;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year as i32, month as u32, day as u32)
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
