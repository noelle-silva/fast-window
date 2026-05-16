use crate::clipboard::{
    read_image_clipboard, read_text_clipboard, write_image_clipboard_from_data_url,
    write_text_clipboard,
};
use crate::domain::*;
use crate::image_codec::{decode_image_data_url, image_data_url, normalize_image_bytes_to_png};
use crate::image_store::{
    delete_orphan_managed_images, delete_unreferenced_managed_collection_images,
    delete_unreferenced_managed_history_images, managed_image_reference_from_reference,
    read_output_image, scan_orphan_managed_images, write_managed_png_image,
};
use crate::legacy_import::import_legacy_data;
use crate::model::*;
use crate::store::Store;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;

const RPC_STATE_LOAD: &str = "clipboardHistory.state.load";
const RPC_STATE_SAVE_SETTINGS: &str = "clipboardHistory.state.saveSettings";
const RPC_STATE_CLEAR_HISTORY: &str = "clipboardHistory.state.clearHistory";
const RPC_STATE_DELETE_HISTORY_ITEM: &str = "clipboardHistory.state.deleteHistoryItem";
const RPC_CLIPBOARD_WRITE_TEXT: &str = "clipboardHistory.clipboard.writeText";
const RPC_CLIPBOARD_WRITE_IMAGE: &str = "clipboardHistory.clipboard.writeImage";
const RPC_IMAGES_READ_OUTPUT: &str = "clipboardHistory.images.readOutput";
const RPC_IMAGES_READ_CLIPBOARD: &str = "clipboardHistory.images.readClipboard";
const RPC_IMAGES_SCAN_ORPHANS: &str = "clipboardHistory.images.scanOrphans";
const RPC_IMAGES_DELETE_ORPHANS: &str = "clipboardHistory.images.deleteOrphans";
const RPC_COLLECTIONS_CREATE_FOLDER: &str = "clipboardHistory.collections.createFolder";
const RPC_COLLECTIONS_CREATE_ITEM: &str = "clipboardHistory.collections.createItem";
const RPC_COLLECTIONS_UPDATE_FOLDER: &str = "clipboardHistory.collections.updateFolder";
const RPC_COLLECTIONS_UPDATE_ITEM: &str = "clipboardHistory.collections.updateItem";
const RPC_COLLECTIONS_MOVE_NODE: &str = "clipboardHistory.collections.moveNode";
const RPC_COLLECTIONS_COPY_ITEM: &str = "clipboardHistory.collections.copyItem";
const RPC_COLLECTIONS_DELETE_NODE: &str = "clipboardHistory.collections.deleteNode";
const RPC_COLLECTIONS_SAVE_RECENT_FOLDER: &str = "clipboardHistory.collections.saveRecentFolder";
const RPC_LEGACY_IMPORT: &str = "clipboardHistory.legacy.import";

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
        let current_text = history
            .iter()
            .find(|item| item.item_type == "text")
            .map(|v| v.content.clone())
            .unwrap_or_default();
        let current_image = history
            .iter()
            .find(|item| item.item_type == "image")
            .map(|v| v.content.clone())
            .unwrap_or_default();
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

    pub fn output_root(&self) -> &std::path::Path {
        &self.output_root
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
            RPC_CLIPBOARD_WRITE_TEXT => {
                self.write_text(params.get("text").and_then(Value::as_str).unwrap_or(""))
            }
            RPC_CLIPBOARD_WRITE_IMAGE => self.write_image(params),
            RPC_IMAGES_READ_OUTPUT => read_output_image(
                &self.output_root,
                params.get("path").and_then(Value::as_str).unwrap_or(""),
            )
            .map(Value::String),
            RPC_IMAGES_READ_CLIPBOARD => self.read_clipboard_image_draft(),
            RPC_IMAGES_SCAN_ORPHANS => serde_json::to_value(scan_orphan_managed_images(
                &self.output_root,
                &self.history,
                &self.collections,
            )?)
            .map_err(|e| e.to_string()),
            RPC_IMAGES_DELETE_ORPHANS => serde_json::to_value(delete_orphan_managed_images(
                &self.output_root,
                &self.history,
                &self.collections,
            )?)
            .map_err(|e| e.to_string()),
            RPC_COLLECTIONS_CREATE_FOLDER => {
                create_folder(
                    &mut self.collections,
                    str_param(&params, "parentId"),
                    str_param(&params, "name"),
                );
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_CREATE_ITEM => self.create_collection_item(params),
            RPC_COLLECTIONS_UPDATE_FOLDER => {
                update_folder_name(
                    &mut self.collections,
                    str_param(&params, "folderId"),
                    str_param(&params, "name"),
                );
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_UPDATE_ITEM => self.update_collection_item(params),
            RPC_COLLECTIONS_MOVE_NODE => {
                let index = params
                    .get("toIndex")
                    .and_then(Value::as_u64)
                    .map(|v| v as usize);
                move_node(
                    &mut self.collections,
                    str_param(&params, "movingId"),
                    str_param(&params, "toParentId"),
                    index,
                );
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_COPY_ITEM => {
                copy_item(
                    &mut self.collections,
                    str_param(&params, "itemId"),
                    str_param(&params, "toParentId"),
                );
                self.save_collections_and_emit()
            }
            RPC_COLLECTIONS_DELETE_NODE => {
                let previous = self.collections.clone();
                delete_node(&mut self.collections, str_param(&params, "nodeId"));
                self.save_collections_and_emit_after(previous)
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
            RPC_LEGACY_IMPORT => self.import_legacy(str_param(&params, "sourceDir")),
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
                let item = ClipboardHistoryItem {
                    item_type: "text".to_string(),
                    content: text,
                    time: now_ms(),
                    path: None,
                };
                let _ = self.handle_monitor_change(item);
            }
        }

        let Ok(image) = read_image_clipboard() else {
            return;
        };
        let Some(image) = image else {
            return;
        };
        let Ok(asset) =
            write_managed_png_image(&self.output_root, &image.png, image.width, image.height)
        else {
            return;
        };
        if asset.reference == self.current_image {
            return;
        }
        let item = ClipboardHistoryItem {
            item_type: "image".to_string(),
            content: asset.reference,
            time: now_ms(),
            path: Some(asset.path),
        };
        let _ = self.handle_monitor_change(item);
    }

    fn handle_monitor_change(&mut self, item: ClipboardHistoryItem) -> Result<(), String> {
        if self.internal_copy.at > 0
            && within_internal_window(&self.internal_copy, self.settings.poll_interval)
            && self.internal_copy.item_type == item.item_type
        {
            self.internal_copy = empty_internal_copy();
            if item.item_type == "text" {
                self.current_text = item.content;
            } else if item.item_type == "image" {
                self.current_image = item.content;
            }
            return Ok(());
        }
        if self.internal_copy.at > 0
            && !within_internal_window(&self.internal_copy, self.settings.poll_interval)
        {
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
        let next_history =
            merge_history_items(vec![item], self.history.clone(), self.settings.max_history);
        self.replace_history(next_history);
        self.save_clipboard()?;
        self.emit_snapshot();
        Ok(())
    }

    fn apply_settings(&mut self, raw: Option<Value>) -> Result<Value, String> {
        self.settings = normalize_settings(raw);
        let next_history =
            merge_history_items(Vec::new(), self.history.clone(), self.settings.max_history);
        self.replace_history(next_history);
        self.save_clipboard()?;
        self.emit_snapshot();
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn clear_history(&mut self) -> Result<Value, String> {
        self.replace_history(Vec::new());
        self.save_clipboard()?;
        self.emit_snapshot();
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn delete_history_item(&mut self, raw: Option<Value>) -> Result<Value, String> {
        if let Some(item) = raw
            .as_ref()
            .and_then(|v| normalize_history_item(v, now_ms()))
        {
            self.deleted.insert(history_uniq_key(&item), now_ms());
            let mut next = self.history.clone();
            next.retain(|entry| history_uniq_key(entry) != history_uniq_key(&item));
            self.replace_history(next);
            self.save_clipboard()?;
            self.emit_snapshot();
        }
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn write_text(&mut self, text: &str) -> Result<Value, String> {
        self.internal_copy = internal_copy("text");
        write_text_clipboard(text)?;
        let item = ClipboardHistoryItem {
            item_type: "text".to_string(),
            content: text.to_string(),
            time: now_ms(),
            path: None,
        };
        let next_history =
            merge_history_items(vec![item], self.history.clone(), self.settings.max_history);
        self.replace_history(next_history);
        self.save_clipboard()?;
        self.emit_snapshot();
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn write_image(&mut self, params: Value) -> Result<Value, String> {
        let data_url = params
            .get("dataUrl")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let (content, item_path) = if !data_url.is_empty() {
            write_image_clipboard_from_data_url(data_url)?;
            let bytes = decode_image_data_url(data_url)?;
            let encoded = normalize_image_bytes_to_png(&bytes)?;
            let asset = write_managed_png_image(
                &self.output_root,
                &encoded.png,
                encoded.width,
                encoded.height,
            )?;
            (asset.reference, asset.path)
        } else if !path.is_empty() {
            let data_url = read_output_image(&self.output_root, path)?;
            write_image_clipboard_from_data_url(&data_url)?;
            (
                managed_image_reference_from_reference(path).unwrap_or_else(|| path.to_string()),
                path.to_string(),
            )
        } else {
            return Err("图片剪贴板写入需要 dataUrl 或 path".to_string());
        };

        self.internal_copy = internal_copy("image");
        self.current_image = content.clone();
        let item = ClipboardHistoryItem {
            item_type: "image".to_string(),
            content,
            time: now_ms(),
            path: if item_path.is_empty() {
                None
            } else {
                Some(item_path)
            },
        };
        let next_history =
            merge_history_items(vec![item], self.history.clone(), self.settings.max_history);
        self.replace_history(next_history);
        self.save_clipboard()?;
        self.emit_snapshot();
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn save_collections_and_emit(&mut self) -> Result<Value, String> {
        self.save_collections_state()?;
        self.emit_snapshot();
        serde_json::to_value(self.snapshot()).map_err(|e| e.to_string())
    }

    fn save_collections_and_emit_after(
        &mut self,
        previous: CollectionsDoc,
    ) -> Result<Value, String> {
        delete_unreferenced_managed_collection_images(
            &self.output_root,
            &previous,
            &self.history,
            &self.collections,
        );
        self.save_collections_and_emit()
    }

    fn read_clipboard_image_draft(&mut self) -> Result<Value, String> {
        let Some(image) = read_image_clipboard()? else {
            return Err("剪贴板中没有图片".to_string());
        };
        serde_json::to_value(ClipboardImageDraft {
            data_url: image_data_url("image/png", &image.png),
            mime: "image/png".to_string(),
            width: image.width,
            height: image.height,
        })
        .map_err(|e| e.to_string())
    }

    fn create_collection_item(&mut self, params: Value) -> Result<Value, String> {
        let parent_id = str_param(&params, "parentId");
        let title = str_param(&params, "title");
        let content = collection_content_param(&self.output_root, &params)?;
        match content {
            CollectionItemContent::Text { text } => {
                create_text_item(&mut self.collections, parent_id, title, &text);
                self.save_collections_and_emit()
            }
            image @ CollectionItemContent::Image { .. } => {
                create_image_item(&mut self.collections, parent_id, title, image);
                self.save_collections_and_emit()
            }
        }
    }

    fn update_collection_item(&mut self, params: Value) -> Result<Value, String> {
        let previous = self.collections.clone();
        let item_id = str_param(&params, "itemId");
        let title = str_param(&params, "title");
        let content = collection_content_param(&self.output_root, &params)?;
        match content {
            CollectionItemContent::Text { text } => {
                update_text_item(&mut self.collections, item_id, title, &text);
            }
            image @ CollectionItemContent::Image { .. } => {
                update_image_item(&mut self.collections, item_id, title, image);
            }
        }
        self.save_collections_and_emit_after(previous)
    }

    fn import_legacy(&mut self, source_dir: &str) -> Result<Value, String> {
        let imported = import_legacy_data(
            &self.store,
            &self.output_root,
            &PathBuf::from(source_dir.trim()),
            self.settings.max_history,
        )?;
        self.settings = imported.settings;
        self.history = imported.history;
        self.deleted = imported.deleted;
        self.history.retain(|item| !is_deleted(item, &self.deleted));
        self.collections = imported.collections;
        self.recent_folders = imported.recent_folders;
        self.current_text = self
            .history
            .iter()
            .find(|item| item.item_type == "text")
            .map(|v| v.content.clone())
            .unwrap_or_default();
        self.current_image = self
            .history
            .iter()
            .find(|item| item.item_type == "image")
            .map(|v| v.content.clone())
            .unwrap_or_default();
        self.internal_copy = empty_internal_copy();
        self.emit_snapshot();
        Ok(json!({ "report": imported.report, "snapshot": self.snapshot() }))
    }

    fn save_clipboard(&self) -> Result<(), String> {
        self.store.save_history(&self.history)?;
        self.store.save_settings(&self.settings)?;
        self.store.save_deleted(&self.deleted)
    }

    fn replace_history(&mut self, next_history: Vec<ClipboardHistoryItem>) {
        let previous = std::mem::replace(&mut self.history, next_history);
        delete_unreferenced_managed_history_images(
            &self.output_root,
            &previous,
            &self.history,
            &self.collections,
        );
    }

    fn save_collections_state(&self) -> Result<(), String> {
        self.store.save_collections(&self.collections)?;
        self.store.save_recent_folders(&self.recent_folders)
    }

    fn emit_snapshot(&mut self) {
        let Ok(snapshot) = serde_json::to_value(self.snapshot()) else {
            return;
        };
        let frame =
            json!({ "type": "event", "event": "snapshot", "snapshot": snapshot }).to_string();
        self.event_senders
            .retain(|sender| sender.send(frame.clone()).is_ok());
    }
}

fn str_param<'a>(params: &'a Value, key: &str) -> &'a str {
    params.get(key).and_then(Value::as_str).unwrap_or("")
}

fn collection_content_param(
    output_root: &Path,
    params: &Value,
) -> Result<CollectionItemContent, String> {
    let content = params
        .get("content")
        .ok_or_else(|| "收藏条目内容不能为空".to_string())?;
    let content_type = content
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    match content_type {
        "text" => {
            let text = content
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if text.is_empty() {
                return Err("正文内容不能为空".to_string());
            }
            Ok(CollectionItemContent::Text {
                text: text.to_string(),
            })
        }
        "image" => collection_image_content_param(output_root, content),
        _ => Err("收藏条目类型无效".to_string()),
    }
}

fn collection_image_content_param(
    output_root: &Path,
    content: &Value,
) -> Result<CollectionItemContent, String> {
    let data_url = content
        .get("dataUrl")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let source_name = content
        .get("sourceName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);

    if !data_url.is_empty() {
        let bytes = decode_image_data_url(data_url)?;
        let encoded = normalize_image_bytes_to_png(&bytes)?;
        let asset =
            write_managed_png_image(output_root, &encoded.png, encoded.width, encoded.height)?;
        return Ok(CollectionItemContent::Image {
            reference: asset.reference,
            path: asset.path,
            mime: asset.mime,
            width: asset.width,
            height: asset.height,
            source_name,
        });
    }

    let reference = content
        .get("reference")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let path = content
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let lookup = if path.is_empty() { reference } else { path };
    if lookup.is_empty() {
        return Err("图片内容不能为空".to_string());
    }
    let managed_reference = managed_image_reference_from_reference(lookup)
        .or_else(|| managed_image_reference_from_reference(reference))
        .ok_or_else(|| "图片引用必须来自托管图片仓库".to_string())?;
    read_output_image(output_root, lookup)?;
    let width = content
        .get("width")
        .and_then(Value::as_u64)
        .filter(|v| *v > 0)
        .ok_or_else(|| "图片宽度无效".to_string())? as u32;
    let height = content
        .get("height")
        .and_then(Value::as_u64)
        .filter(|v| *v > 0)
        .ok_or_else(|| "图片高度无效".to_string())? as u32;
    let mime = content
        .get("mime")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/png")
        .to_string();
    Ok(CollectionItemContent::Image {
        reference: managed_reference,
        path: lookup.to_string(),
        mime,
        width,
        height,
        source_name,
    })
}
