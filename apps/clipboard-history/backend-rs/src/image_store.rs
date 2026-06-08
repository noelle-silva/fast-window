use crate::data_contract::{FALLBACK_IMAGES_DIR_NAME, OUTPUT_IMAGES_DIR_NAME};
use crate::image_codec::image_data_url;
use crate::model::{
    ClipboardHistoryItem, CollectionItemContent, CollectionNode, CollectionsDoc,
    OrphanImageCleanupReport, OrphanImageDeleteFailure, OrphanImageEntry, OrphanImageReport,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const MANAGED_IMAGE_PREFIX: &str = "clipboard-image-";
const MANAGED_IMAGE_SUFFIX: &str = ".png";

pub struct ManagedImageAsset {
    pub reference: String,
    pub path: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
}

pub fn write_managed_png_image(
    output_root: &Path,
    png: &[u8],
    width: u32,
    height: u32,
) -> Result<ManagedImageAsset, String> {
    if png.is_empty() {
        return Err("图片数据为空".to_string());
    }
    if width == 0 || height == 0 {
        return Err("图片尺寸无效".to_string());
    }

    fs::create_dir_all(output_root).map_err(|e| format!("创建图片目录失败: {e}"))?;
    let hash = sha256_hex(png);
    let filename = format!("{MANAGED_IMAGE_PREFIX}{hash}{MANAGED_IMAGE_SUFFIX}");
    let full = output_root.join(&filename);
    fs::write(&full, png).map_err(|e| format!("写入图片失败: {e}"))?;
    Ok(ManagedImageAsset {
        reference: format!("img:{hash}"),
        path: full.to_string_lossy().to_string(),
        mime: "image/png".to_string(),
        width,
        height,
    })
}

pub fn read_output_image(output_root: &Path, requested: &str) -> Result<String, String> {
    let path = resolve_output_image_path(output_root, requested)?;
    let bytes = fs::read(&path).map_err(|e| format!("读取图片失败: {e}"))?;
    Ok(image_data_url(output_image_mime(&path), &bytes))
}

pub fn resolve_output_image_path(output_root: &Path, requested: &str) -> Result<PathBuf, String> {
    let path = resolve_output_path(output_root, requested)?;
    if !path.is_file() {
        return Err("图片不可用".to_string());
    }
    Ok(path)
}

pub fn output_image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
}

pub fn delete_unreferenced_managed_history_images(
    output_root: &Path,
    previous: &[ClipboardHistoryItem],
    current: &[ClipboardHistoryItem],
    collections: &CollectionsDoc,
) {
    let live_paths = referenced_managed_image_paths(output_root, current, collections);
    let mut seen = BTreeSet::new();
    for item in previous {
        if item.item_type != "image" {
            continue;
        }
        for reference in history_image_references(item) {
            delete_reference_if_unreferenced(output_root, &reference, &live_paths, &mut seen);
        }
    }
}

pub fn delete_unreferenced_managed_collection_images(
    output_root: &Path,
    previous: &CollectionsDoc,
    history: &[ClipboardHistoryItem],
    current: &CollectionsDoc,
) {
    let live_paths = referenced_managed_image_paths(output_root, history, current);
    let mut seen = BTreeSet::new();
    for reference in collection_image_references(previous) {
        delete_reference_if_unreferenced(output_root, &reference, &live_paths, &mut seen);
    }
}

pub fn scan_orphan_managed_images(
    output_root: &Path,
    history: &[ClipboardHistoryItem],
    collections: &CollectionsDoc,
) -> Result<OrphanImageReport, String> {
    let referenced_paths = referenced_managed_image_paths(output_root, history, collections);
    let mut scanned_files = 0;
    let mut orphan_bytes = 0;
    let mut orphans = Vec::new();

    for dir in managed_image_dirs(output_root) {
        if !dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&dir).map_err(|e| format!("读取图片目录失败: {e}"))? {
            let entry = entry.map_err(|e| format!("读取图片条目失败: {e}"))?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name_raw = entry.file_name().to_string_lossy().to_string();
            let Some(file_name) = managed_clipboard_image_file_name(&file_name_raw) else {
                continue;
            };

            scanned_files += 1;
            if referenced_paths.contains(&path_key(&path)) {
                continue;
            }

            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            orphan_bytes += size_bytes;
            orphans.push(OrphanImageEntry {
                file_name,
                path: path.display().to_string(),
                size_bytes,
            });
        }
    }

    orphans.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(OrphanImageReport {
        scanned_files,
        referenced_files: referenced_paths.len(),
        orphan_count: orphans.len(),
        orphan_bytes,
        orphans,
    })
}

pub fn delete_orphan_managed_images(
    output_root: &Path,
    history: &[ClipboardHistoryItem],
    collections: &CollectionsDoc,
) -> Result<OrphanImageCleanupReport, String> {
    let detected = scan_orphan_managed_images(output_root, history, collections)?;
    let mut deleted_count = 0;
    let mut deleted_bytes = 0;
    let mut failed = Vec::new();

    for orphan in &detected.orphans {
        if managed_clipboard_image_file_name_from_reference(&orphan.file_name).is_none() {
            continue;
        }
        let path = PathBuf::from(&orphan.path);
        match fs::remove_file(&path) {
            Ok(()) => {
                deleted_count += 1;
                deleted_bytes += orphan.size_bytes;
            }
            Err(error) => failed.push(OrphanImageDeleteFailure {
                path: orphan.path.clone(),
                error: error.to_string(),
            }),
        }
    }

    let remaining = scan_orphan_managed_images(output_root, history, collections)?;
    Ok(OrphanImageCleanupReport {
        detected,
        deleted_count,
        deleted_bytes,
        failed,
        remaining,
    })
}

pub fn managed_clipboard_image_file_name_from_reference(reference: &str) -> Option<String> {
    managed_clipboard_image_file_name(reference).or_else(|| image_file_name_from_token(reference))
}

pub fn managed_image_reference_from_reference(reference: &str) -> Option<String> {
    let file_name = managed_clipboard_image_file_name_from_reference(reference)?;
    let hash = file_name
        .strip_prefix(MANAGED_IMAGE_PREFIX)?
        .strip_suffix(MANAGED_IMAGE_SUFFIX)?;
    Some(format!("img:{hash}"))
}

fn delete_reference_if_unreferenced(
    output_root: &Path,
    reference: &str,
    live_paths: &BTreeSet<String>,
    seen: &mut BTreeSet<String>,
) {
    if managed_clipboard_image_file_name_from_reference(reference).is_none() {
        return;
    }
    let Ok(path) = resolve_output_path(output_root, reference) else {
        return;
    };
    let key = path_key(&path);
    if live_paths.contains(&key) || !seen.insert(key) {
        return;
    }
    let _ = fs::remove_file(path);
}

fn resolve_output_path(output_root: &Path, requested: &str) -> Result<PathBuf, String> {
    let raw = requested.trim();
    if raw.is_empty() || raw.contains('\0') {
        return Err("图片路径无效".to_string());
    }

    let candidate = PathBuf::from(raw);
    if candidate.is_absolute()
        && candidate.is_file()
        && is_path_inside_allowed_roots(output_root, &candidate)
    {
        return Ok(candidate);
    }

    if let Some(file_name) = managed_clipboard_image_file_name_from_reference(raw) {
        return Ok(output_root.join(file_name));
    }

    let full = if candidate.is_absolute() {
        candidate
    } else {
        output_root.join(candidate)
    };
    if !is_path_inside_allowed_roots(output_root, &full) {
        return Err("路径越界".to_string());
    }
    Ok(full)
}

fn referenced_managed_image_paths(
    output_root: &Path,
    history: &[ClipboardHistoryItem],
    collections: &CollectionsDoc,
) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for item in history {
        if item.item_type != "image" {
            continue;
        }
        for reference in history_image_references(item) {
            insert_managed_reference_path(output_root, &reference, &mut out);
        }
    }
    for reference in collection_image_references(collections) {
        insert_managed_reference_path(output_root, &reference, &mut out);
    }
    out
}

fn insert_managed_reference_path(output_root: &Path, reference: &str, out: &mut BTreeSet<String>) {
    if managed_clipboard_image_file_name_from_reference(reference).is_none() {
        return;
    }
    if let Ok(path) = resolve_output_path(output_root, reference) {
        out.insert(path_key(&path));
    }
}

fn history_image_references(item: &ClipboardHistoryItem) -> Vec<String> {
    let mut refs = Vec::new();
    if let Some(path) = item
        .path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        refs.push(path.to_string());
    }
    let content = item.content.trim();
    if !content.is_empty() && !refs.iter().any(|item| item == content) {
        refs.push(content.to_string());
    }
    refs
}

fn collection_image_references(collections: &CollectionsDoc) -> Vec<String> {
    let mut refs = Vec::new();
    for node in collections.nodes.values() {
        let CollectionNode::Item { content, .. } = node else {
            continue;
        };
        collect_collection_content_image_references(content, &mut refs);
    }
    refs
}

fn collect_collection_content_image_references(
    content: &CollectionItemContent,
    refs: &mut Vec<String>,
) {
    match content {
        CollectionItemContent::Image {
            reference, path, ..
        } => push_collection_image_reference(reference, path, refs),
        CollectionItemContent::Mixed { image, .. } => {
            push_collection_image_reference(&image.reference, &image.path, refs)
        }
        CollectionItemContent::Text { .. } => {}
    }
}

fn push_collection_image_reference(reference: &str, path: &str, refs: &mut Vec<String>) {
    let trimmed_path = path.trim();
    if !trimmed_path.is_empty() {
        refs.push(trimmed_path.to_string());
    }
    let trimmed_reference = reference.trim();
    if !trimmed_reference.is_empty() && !refs.iter().any(|item| item == trimmed_reference) {
        refs.push(trimmed_reference.to_string());
    }
}

fn managed_image_dirs(output_root: &Path) -> Vec<PathBuf> {
    let data_root = output_root.parent().unwrap_or(output_root);
    let mut dirs = vec![
        output_root.to_path_buf(),
        data_root.join(FALLBACK_IMAGES_DIR_NAME),
    ];
    let mut seen = BTreeSet::new();
    dirs.retain(|dir| seen.insert(path_key(dir)));
    dirs
}

fn path_key(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_ascii_lowercase()
}

fn is_path_inside_allowed_roots(output_root: &Path, full: &Path) -> bool {
    let data_root = output_root.parent().unwrap_or(output_root);
    let roots = [
        output_root.to_path_buf(),
        data_root.join(OUTPUT_IMAGES_DIR_NAME),
        data_root.join(FALLBACK_IMAGES_DIR_NAME),
    ];
    let parent = full
        .parent()
        .unwrap_or(output_root)
        .canonicalize()
        .unwrap_or_else(|_| output_root.to_path_buf());
    roots.iter().any(|root| {
        let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        parent.starts_with(root)
    })
}

fn image_file_name_from_token(value: &str) -> Option<String> {
    let hash = value.trim().strip_prefix("img:")?.to_ascii_lowercase();
    is_managed_hash(&hash).then(|| format!("{MANAGED_IMAGE_PREFIX}{hash}{MANAGED_IMAGE_SUFFIX}"))
}

fn managed_clipboard_image_file_name(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let name = normalized.split('/').last()?.to_ascii_lowercase();
    if !name.starts_with(MANAGED_IMAGE_PREFIX) || !name.ends_with(MANAGED_IMAGE_SUFFIX) {
        return None;
    }
    let hash = name
        .strip_prefix(MANAGED_IMAGE_PREFIX)?
        .strip_suffix(MANAGED_IMAGE_SUFFIX)?;
    is_managed_hash(hash).then_some(name)
}

fn is_managed_hash(value: &str) -> bool {
    matches!(value.len(), 8 | 64) && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}
