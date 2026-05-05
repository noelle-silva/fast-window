use crate::domain::{ensure_collections, normalize_deleted_map, normalize_history_items, normalize_settings, now_ms};
use crate::model::{ClipboardHistoryItem, ClipboardHistorySettings, CollectionsDoc, DeletedHistoryMap};
use crate::store::Store;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const IMPORT_KEYS: [(&str, &str); 5] = [
    ("history", "history.json"),
    ("settings", "settings.json"),
    ("deletedHistory", "deletedHistory.json"),
    ("collections", "collections.json"),
    ("recentFolders", "recentFolders.json"),
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportReport {
    pub source_dir: String,
    pub backup_dir: Option<String>,
    pub imported_files: Vec<String>,
    pub copied_images: usize,
    pub history_count: usize,
    pub collection_count: usize,
    pub recent_folder_count: usize,
}

pub struct ImportedLegacyData {
    pub settings: ClipboardHistorySettings,
    pub history: Vec<ClipboardHistoryItem>,
    pub deleted: DeletedHistoryMap,
    pub collections: CollectionsDoc,
    pub recent_folders: Vec<String>,
    pub report: LegacyImportReport,
}

pub fn import_legacy_data(store: &Store, output_root: &Path, source_dir: &Path, current_limit: usize) -> Result<ImportedLegacyData, String> {
    if !source_dir.is_dir() {
        return Err("请选择包含旧剪贴板历史数据文件的目录".to_string());
    }

    let source_root = source_dir.canonicalize().map_err(|e| format!("读取旧数据目录失败: {e}"))?;
    let legacy = read_legacy_payload(&source_root)?;
    if legacy.values.is_empty() {
        return Err("未在所选目录中找到可导入的剪贴板历史数据".to_string());
    }

    let backup_dir = backup_current_data(store.root())?;
    fs::create_dir_all(output_root).map_err(|e| format!("创建图片目录失败: {e}"))?;

    let settings = normalize_settings(legacy.values.get("settings").cloned());
    let history_limit = settings.max_history.max(current_limit).clamp(10, 1000);
    let mut copied_images = 0;
    let history = rewrite_history_images(
        normalize_history_items(legacy.values.get("history").cloned(), history_limit),
        &source_root,
        output_root,
        &mut copied_images,
    );
    let deleted = normalize_deleted_map(legacy.values.get("deletedHistory").cloned());
    let collections = ensure_collections(legacy.values.get("collections").cloned());
    let recent_folders = normalize_recent_folders(legacy.values.get("recentFolders"));

    store.save_settings(&settings)?;
    store.save_history(&history)?;
    store.save_deleted(&deleted)?;
    store.save_collections(&collections)?;
    store.save_recent_folders(&recent_folders)?;
    store.ensure_ready()?;

    let report = LegacyImportReport {
        source_dir: source_root.display().to_string(),
        backup_dir: backup_dir.map(|path| path.display().to_string()),
        imported_files: legacy.imported_files,
        copied_images,
        history_count: history.len(),
        collection_count: collections.nodes.len(),
        recent_folder_count: recent_folders.len(),
    };

    Ok(ImportedLegacyData {
        settings,
        history,
        deleted,
        collections,
        recent_folders,
        report,
    })
}

struct LegacyPayload {
    values: BTreeMap<String, Value>,
    imported_files: Vec<String>,
}

fn read_legacy_payload(source_root: &Path) -> Result<LegacyPayload, String> {
    let mut values = BTreeMap::new();
    let mut imported_files = Vec::new();

    read_legacy_pack(source_root, &mut values, &mut imported_files)?;

    for (key, file_name) in IMPORT_KEYS {
        let path = source_root.join(file_name);
        if !path.is_file() {
            continue;
        }
        let value = read_json(&path)?;
        values.insert(key.to_string(), value);
        imported_files.push(file_name.to_string());
    }

    imported_files.sort();
    imported_files.dedup();
    Ok(LegacyPayload { values, imported_files })
}

fn read_legacy_pack(source_root: &Path, values: &mut BTreeMap<String, Value>, imported_files: &mut Vec<String>) -> Result<(), String> {
    for file_name in ["clipboard-history.json", "clipboard-history.runtime.json"] {
        let path = source_root.join(file_name);
        if !path.is_file() {
            continue;
        }
        let Value::Object(map) = read_json(&path)? else {
            continue;
        };
        for (key, _) in IMPORT_KEYS {
            if let Some(value) = map.get(key) {
                values.insert(key.to_string(), value.clone());
            }
        }
        imported_files.push(file_name.to_string());
    }
    Ok(())
}

fn read_json(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
    serde_json::from_str(text.trim()).map_err(|e| format!("解析 {} 失败: {e}", path.display()))
}

fn normalize_recent_folders(raw: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(list)) = raw else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for value in list {
        let Some(folder_id) = value.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        if out.iter().any(|v| v == folder_id) {
            continue;
        }
        out.push(folder_id.to_string());
        if out.len() >= 10 {
            break;
        }
    }
    out
}

fn backup_current_data(root: &Path) -> Result<Option<PathBuf>, String> {
    if !root.exists() {
        return Ok(None);
    }

    let has_data = IMPORT_KEYS.iter().any(|(_, file)| root.join(file).is_file()) || root.join("images").is_dir();
    if !has_data {
        return Ok(None);
    }

    let backup_dir = root.join(format!("_backup-legacy-import-{}", now_ms()));
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建导入备份失败: {e}"))?;
    for (_, file_name) in IMPORT_KEYS {
        let from = root.join(file_name);
        if from.is_file() {
            fs::copy(&from, backup_dir.join(file_name)).map_err(|e| format!("备份 {file_name} 失败: {e}"))?;
        }
    }
    let images_dir = root.join("images");
    if images_dir.is_dir() {
        copy_dir(&images_dir, &backup_dir.join("images"))?;
    }
    Ok(Some(backup_dir))
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("创建备份目录失败: {e}"))?;
    for entry in fs::read_dir(from).map_err(|e| format!("读取备份源目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取备份源条目失败: {e}"))?;
        let path = entry.path();
        let target = to.join(entry.file_name());
        if path.is_dir() {
            copy_dir(&path, &target)?;
        } else if path.is_file() {
            fs::copy(&path, &target).map_err(|e| format!("备份图片失败: {e}"))?;
        }
    }
    Ok(())
}

fn rewrite_history_images(
    history: Vec<ClipboardHistoryItem>,
    source_root: &Path,
    output_root: &Path,
    copied_images: &mut usize,
) -> Vec<ClipboardHistoryItem> {
    history
        .into_iter()
        .map(|mut item| {
            if item.item_type != "image" || item.content.starts_with("data:") {
                return item;
            }

            let requested = item.path.as_deref().unwrap_or(&item.content);
            let Some(file_name) = managed_image_file_name(requested).or_else(|| image_name_from_content(&item.content)) else {
                return item;
            };
            let Some(source_file) = find_source_image(source_root, requested, &file_name) else {
                return item;
            };

            let target = output_root.join(&file_name);
            if fs::copy(&source_file, &target).is_ok() {
                *copied_images += 1;
                item.path = Some(target.display().to_string());
                if let Some(hash) = hash_from_file_name(&file_name) {
                    item.content = format!("img:{hash}");
                }
            }
            item
        })
        .collect()
}

fn find_source_image(source_root: &Path, requested: &str, file_name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    let raw = PathBuf::from(requested.trim());
    if raw.is_relative() && !raw.as_os_str().is_empty() {
        candidates.push(source_root.join(&raw));
    }
    candidates.push(source_root.join("images").join(file_name));
    candidates.push(source_root.join(file_name));

    for candidate in candidates {
        let Ok(canonical) = candidate.canonicalize() else {
            continue;
        };
        if canonical.is_file() && canonical.starts_with(source_root) {
            return Some(canonical);
        }
    }
    None
}

fn image_name_from_content(content: &str) -> Option<String> {
    let value = content.trim();
    let hash = value.strip_prefix("img:")?;
    if is_8_hex(hash) {
        Some(format!("clipboard-image-{hash}.png"))
    } else {
        None
    }
}

fn managed_image_file_name(path: &str) -> Option<String> {
    let name = path.replace('\\', "/").split('/').last()?.to_ascii_lowercase();
    if name.starts_with("clipboard-image-") && name.ends_with(".png") && name.len() == "clipboard-image-00000000.png".len() {
        let hash = &name["clipboard-image-".len().."clipboard-image-00000000".len()];
        if is_8_hex(hash) {
            return Some(name);
        }
    }
    None
}

fn hash_from_file_name(file_name: &str) -> Option<&str> {
    let hash = file_name.strip_prefix("clipboard-image-")?.strip_suffix(".png")?;
    is_8_hex(hash).then_some(hash)
}

fn is_8_hex(value: &str) -> bool {
    value.len() == 8 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
