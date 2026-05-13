use std::path::{Path, PathBuf};

pub const STORAGE_SCHEMA_VERSION: u64 = 1;
pub const DATA_VERSION: u64 = 2;
pub const META_FILE_NAME: &str = "_meta.json";
pub const MIGRATIONS_FILE_NAME: &str = "_migrations.json";
pub const OUTPUT_IMAGES_DIR_NAME: &str = "output-images";
pub const FALLBACK_IMAGES_DIR_NAME: &str = "images";

pub const STORAGE_FILES: [(&str, &str); 5] = [
    ("history", "history.json"),
    ("settings", "settings.json"),
    ("deletedHistory", "deletedHistory.json"),
    ("collections", "collections.json"),
    ("recentFolders", "recentFolders.json"),
];

pub fn output_images_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(OUTPUT_IMAGES_DIR_NAME)
}

pub fn image_data_dirs(root: &Path) -> Vec<PathBuf> {
    vec![
        root.join(OUTPUT_IMAGES_DIR_NAME),
        root.join(FALLBACK_IMAGES_DIR_NAME),
    ]
}

pub fn image_lookup_dirs(root: &Path) -> Vec<PathBuf> {
    vec![
        root.join(OUTPUT_IMAGES_DIR_NAME),
        root.join(FALLBACK_IMAGES_DIR_NAME),
        root.to_path_buf(),
    ]
}
