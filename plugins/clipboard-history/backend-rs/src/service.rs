use crate::clipboard::{
    read_image_clipboard, read_text_clipboard, write_image_clipboard_from_data_url,
    write_text_clipboard,
};
use crate::domain::*;
use crate::image_store::{
    delete_managed_output_image, delete_output_image, read_output_image, write_clipboard_image,
};
use crate::model::*;
use crate::store::Store;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::mpsc::Sender;

const RPC_STATE_LOAD: &str = "clipboardHistory.state.load";
const RPC_STATE_SAVE_SETTINGS: &str = "clipboardHistory.state.saveSettings";
const RPC_STATE_CLEAR_HISTORY: &str = "clipboardHistory.state.clearHistory";
const RPC_STATE_DELETE_HISTORY_ITEM: &str = "clipboardHistory.state.deleteHistoryItem";
const RPC_CLIPBOARD_WRITE_TEXT: &str = "clipboardHistory.clipboard.writeText";
const RPC_CLIPBOARD_WRITE_IMAGE: &str = "clipboardHistory.clipboard.writeImage";
const RPC_IMAGES_READ_OUTPUT: &str = "clipboardHistory.images.readOutput";
const RPC_IMAGES_DELETE_OUTPUT: &str = "clipboardHistory.images.deleteOutput";
const RPC_COLLECTIONS_CREATE_FOLDER: &str = "clipboardHistory.collections.createFolder";
const RPC_COLLECTIONS_CREATE_ITEM: &str = "clipboardHistory.collections.createItem";
const RPC_COLLECTIONS_UPDATE_FOLDER: &str = "clipboardHistory.collections.updateFolder";
const RPC_COLLECTIONS_UPDATE_ITEM: &str = "clipboardHistory.collections.updateItem";
const RPC_COLLECTIONS_MOVE_NODE: &str = "clipboardHistory.collections.moveNode";
const RPC_COLLECTIONS_COPY_ITEM: &str = "clipboardHistory.collections.copyItem";
const RPC_COLLECTIONS_DELETE_NODE: &str = "clipboardHistory.collections.deleteNode";
const RPC_COLLECTIONS_SAVE_RECENT_FOLDER: &str = "clipboardHistory.collections.saveRecentFolder";
const RPC_MONITOR_RESTART: &str = "clipboardHistory.monitor.restart";
const RPC_MONITOR_SNAPSHOT: &str = "clipboardHistory.monitor.snapshot";

pub struct ClipboardHistoryService {
    store: Store,
    output_root: PathBuf,
    history: Vec<ClipboardHistoryItem>,
    settings: ClipboardHistorySettings,
    deleted: DeletedHistoryMap,
    collections: CollectionsDoc,
    recent_folders: Vec<String>,
    internal_copy: InternalCopyMarker,
    current_text: String,
    current_image: String,
    monitor_latest_text: String,
    monitor_latest: Option<ClipboardHistoryItem>,
    event_senders: Vec<Sender<String>>,
}

impl ClipboardHistoryService {
    pub fn warmup(store: Store, output_root: PathBuf) -> Result<Self, String> {
        store.ensure_ready()?;
        let settings = store.load_settings();
        let deleted = store.load_deleted();
        let mut history = store.load_history(settings.max_history);
        history.retain(|item| !is_deleted(item, &deleted));
        let collections = store.load_collections();
        let recent_folders = store.load_recent_folders();
        let current_text = history.iter().find(|item| item.item_type == "text").map(|v| v.content.clone()).unwrap_or_default();
        let current_image = history.iter().find(|item| item.item_type == "image").map(|v| v.content.clone()).unwrap_or_default();
        let service = Self {
            store,
            output_root,
            history,
            settings,
            deleted,
            collections,
            recent_folders,
            internal_copy: empty_internal_copy(),
            current_text,
            current_image,
            monitor_latest_text: String::new(),
            monitor_latest: None,
            event_senders: Vec::new(),
        };
        service.save_clipboard()?;
        service.save_collections_state()?;
        Ok(service)
    }

    pub fn add_event_sender(&mut self, sender: Sender<String>) {
        self.event_senders.push(sender);
    }

    pub fn settings(&self) -> ClipboardHistorySettings {
        self.settings.clone()
    }

    pub fn snapshot(&self) -> ClipboardHistorySnapshot {
        ClipboardHistorySnapshot {
            history: self.history.clone(),
            settings: self.settings.clone(),
            deleted: self.deleted.clone(),
            collections: self.collections.clone(),
            recent_folders: self.recent_folders.clone(),
        }
    }

    pub fn dispatch(&mut self, method: &str, params: Value) -> Result<Value, String> {
        match method {
            RPC_STATE_LOAD => serde_json::to_value(self.snapshot()).map_err(|e| e.to_string()),
            RPC_STATE_SAVE_SETTINGS => self.apply_settings(params.get("settings").cloned()),
            RPC_STATE_CLEAR_HISTORY => self.clear_history(),
            RPC_STATE_DELETE_HISTORY_ITEM => self.delete_history_item(params.get("item").cloned()),
            RPC_CLIPBOARD_WRITE_TEXT => self.write_text(params.get("text").and_then(Value::as_str).unwrap_or("")),
            RPC_CLIPBOARD_WRITE_IMAGE => self.write_image(params),
            RPC_IMAGES_READ_OUTPUT => read_output_image(&self.output_root, params.get("path").and_then(Value::as_str).unwrap_or(""))
                .map(Value::String),
            RPC_IMAGES_DELETE_OUTPUT => {
                delete_output_image(&self.output_root, params.get("path").and_then(Value::as_str).unwrap_or(""))?;
                Ok(Value::Null)
            }
            RPC_COLLECTIONS_CREATE_FOLDER => {
                create_folder(&mut self.collections, str_param(&params, "parentId"), str_param(&params, "name"));
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_CREATE_ITEM => {
                create_item(&mut self.collections, str_param(&params, "parentId"), str_param(&params, "title"), str_param(&params, "content"));
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_UPDATE_FOLDER => {
                update_folder_name(&mut self.collections, str_param(&params, "folderId"), str_param(&params, "name"));
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_UPDATE_ITEM => {
                update_item(&mut self.collections, str_param(&params, "itemId"), str_param(&params, "title"), str_param(&params, "content"));
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_MOVE_NODE => {
                let index = params.get("toIndex").and_then(Value::as_u64).map(|v| v as usize);
                move_node(&mut self.collections, str_param(&params, "movingId"), str_param(&params, "toParentId"), index);
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_COPY_ITEM => {
                copy_item(&mut self.collections, str_param(&params, "itemId"), str_param(&params, "toParentId"));
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_DELETE_NODE => {
                delete_node(&mut self.collections, str_param(&params, "nodeId"));
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_SAVE_RECENT_FOLDER => {
                let folder_id = str_param(&params, "folderId");
                if !folder_id.is_empty() && is_folder(&self.collections, folder_id) {
                    self.recent_folders.retain(|id| id != folder_id);
                    self.recent_folders.insert(0, folder_id.to_string());
                    self.recent_folders.truncate(10);
                }
                self.save_collections_and_emit()
            }
            RPC_MONITOR_RESTART => serde_json::to_value(self.snapshot()).map_err(|e| e.to_string()),
            RPC_MONITOR_SNAPSHOT => serde_json::to_value(ClipboardMonitorSnapshot {
                latest: self.monitor_latest.clone(),
                items: self.monitor_latest.clone().into_iter().collect(),
            }).map_err(|e| e.to_string()),
            _ => Err(format!("未知方法：{method}")),
        }
    }

    pub fn poll_clipboard_once(&mut self) {
        if !self.settings.auto_monitor {
            return;
        }

        if let Ok(text) = read_text_clipboard() {
            if text.trim().is_empty() {
                self.monitor_latest_text.clear();
            } else if text != self.monitor_latest_text {
                self.monitor_latest_text = text.clone();
                let item = ClipboardHistoryItem { item_type: "text".to_string(), content: text, time: now_ms(), path: None };
                self.monitor_latest = Some(item.clone());
                let _ = self.handle_monitor_change(item);
            }
        }

        let Ok(image) = read_image_clipboard() else { return };
        let Some(image) = image else {
            return;
        };
        let Ok((content, path)) = write_clipboard_image(&self.output_root, image.hash, &image.png) else { return };
        if content == self.current_image {
            return;
        }
        let item = ClipboardHistoryItem { item_type: "image".to_string(), content, time: now_ms(), path: Some(path) };
        self.monitor_latest = Some(item.clone());
        let _ = self.handle_monitor_change(item);
    }

    fn handle_monitor_change(&mut self, item: ClipboardHistoryItem) -> Result<(), String> {
        if self.internal_copy.at > 0 && within_internal_window(&self.internal_copy, self.settings.poll_interval) && self.internal_copy.item_type == item.item_type {
            self.internal_copy = empty_internal_copy();
            if item.item_type == "text" {
                self.current_text = item.content;
            } else if item.item_type == "image" {
                self.current_image = item.content;
            }
            return Ok(());
        }
        if self.internal_copy.at > 0 && !within_internal_window(&self.internal_copy, self.settings.poll_interval) {
            self.internal_copy = empty_internal_copy();
        }
        if is_deleted(&item, &self.deleted) {
            return Ok(());
        }
        if item.item_type == "text" {
            if item.content == self.current_text {
                return Ok(());
            }
            self.current_text = item.content.clone();
        }
        if item.item_type == "image" {
            if item.content == self.current_image {
                return Ok(());
            }
            self.current_image = item.content.clone();
        }
        self.history = merge_history_items(vec![item], self.history.clone(), self.settings.max_history);
        self.save_clipboard()?;
        self.emit_snapshot();
        Ok(())
    }

    fn apply_settings(&mut self, raw: Option<Value>) -> Result<Value, String> {
        self.settings = normalize_settings(raw);
        self.history = merge_history_items(Vec::new(), self.history.clone(), self.settings.max_history);
        self.save_clipboard()?;
        self.emit_snapshot();
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn clear_history(&mut self) -> Result<Value, String> {
        for item in &self.history {
            if item.item_type == "image" {
                delete_managed_output_image(&self.output_root, item.path.as_deref().unwrap_or(&item.content));
            }
        }
        self.history.clear();
        self.save_clipboard()?;
        self.emit_snapshot();
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn delete_history_item(&mut self, raw: Option<Value>) -> Result<Value, String> {
        if let Some(item) = raw.as_ref().and_then(|v| normalize_history_item(v, now_ms())) {
            self.deleted.insert(history_uniq_key(&item), now_ms());
            self.history.retain(|entry| history_uniq_key(entry) != history_uniq_key(&item));
            if item.item_type == "image" {
                delete_managed_output_image(&self.output_root, item.path.as_deref().unwrap_or(&item.content));
            }
            self.save_clipboard()?;
            self.emit_snapshot();
        }
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn write_text(&mut self, text: &str) -> Result<Value, String> {
        self.internal_copy = internal_copy("text");
        write_text_clipboard(text)?;
        let item = ClipboardHistoryItem { item_type: "text".to_string(), content: text.to_string(), time: now_ms(), path: None };
        self.history = merge_history_items(vec![item], self.history.clone(), self.settings.max_history);
        self.save_clipboard()?;
        self.emit_snapshot();
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn write_image(&mut self, params: Value) -> Result<Value, String> {
        let data_url = params.get("dataUrl").and_then(Value::as_str).unwrap_or("").trim();
        let path = params.get("path").and_then(Value::as_str).unwrap_or("").trim();
        let (content, item_path) = if !data_url.is_empty() {
            write_image_clipboard_from_data_url(data_url)?;
            match read_image_clipboard()? {
                Some(image) => write_clipboard_image(&self.output_root, image.hash, &image.png)?,
                None => (data_url.to_string(), String::new()),
            }
        } else if !path.is_empty() {
            let data_url = read_output_image(&self.output_root, path)?;
            write_image_clipboard_from_data_url(&data_url)?;
            (path.to_string(), path.to_string())
        } else {
            return Err("图片剪贴板写入需要 dataUrl 或 path".to_string());
        };

        self.internal_copy = internal_copy("image");
        self.current_image = content.clone();
        let item = ClipboardHistoryItem {
            item_type: "image".to_string(),
            content,
            time: now_ms(),
            path: if item_path.is_empty() { None } else { Some(item_path) },
        };
        self.history = merge_history_items(vec![item], self.history.clone(), self.settings.max_history);
        self.save_clipboard()?;
        self.emit_snapshot();
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn save_collections_and_emit(&mut self) -> Result<Value, String> {
        self.save_collections_state()?;
        self.emit_snapshot();
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn save_clipboard(&self) -> Result<(), String> {
        self.store.save_history(&self.history)?;
        self.store.save_settings(&self.settings)?;
        self.store.save_deleted(&self.deleted)
    }

    fn save_collections_state(&self) -> Result<(), String> {
        self.store.save_collections(&self.collections)?;
        self.store.save_recent_folders(&self.recent_folders)
    }

    fn emit_snapshot(&mut self) {
        let Ok(snapshot) = serde_json::to_value(self.snapshot()) else { return };
        let frame = json!({ "type": "event", "event": "snapshot", "snapshot": snapshot }).to_string();
        self.event_senders.retain(|sender| sender.send(frame.clone()).is_ok());
    }
}

fn str_param<'a>(params: &'a Value, key: &str) -> &'a str {
    params.get(key).and_then(Value::as_str).unwrap_or("")
}
