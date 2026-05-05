use crate::domain::now_ms;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const SCHEMA_VERSION: u64 = 1;
pub const DATA_VERSION: u64 = 1;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreMeta {
    pub schema_version: u64,
    pub data_version: u64,
    pub updated_at: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRecord {
    pub id: String,
    pub from_version: u64,
    pub to_version: u64,
    pub description: String,
    pub applied_at: u64,
}

pub fn ensure_baseline(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("创建数据目录失败: {e}"))?;

    if let Some(meta) = read_meta(root)? {
        if meta.schema_version > SCHEMA_VERSION {
            return Err(format!(
                "数据容器版本过高：当前程序支持 {SCHEMA_VERSION}，数据目录为 {}",
                meta.schema_version
            ));
        }
        if meta.data_version > DATA_VERSION {
            return Err(format!(
                "业务数据版本过高：当前程序支持 {DATA_VERSION}，数据目录为 {}",
                meta.data_version
            ));
        }
    }

    ensure_migration_log(root)?;
    write_meta(root)
}

pub fn write_meta(root: &Path) -> Result<(), String> {
    let value = StoreMeta {
        schema_version: SCHEMA_VERSION,
        data_version: DATA_VERSION,
        updated_at: now_ms(),
    };
    write_json(&root.join("_meta.json"), &value)
}

fn read_meta(root: &Path) -> Result<Option<StoreMeta>, String> {
    let path = root.join("_meta.json");
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(None);
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let value = serde_json::from_str::<serde_json::Value>(trimmed)
        .map_err(|e| format!("读取数据版本失败: {e}"))?;
    Ok(Some(StoreMeta {
        schema_version: value.get("schemaVersion").and_then(serde_json::Value::as_u64).unwrap_or(1),
        data_version: value.get("dataVersion").and_then(serde_json::Value::as_u64).unwrap_or(1),
        updated_at: value.get("updatedAt").and_then(serde_json::Value::as_u64).unwrap_or(0),
    }))
}

fn ensure_migration_log(root: &Path) -> Result<(), String> {
    let path = root.join("_migrations.json");
    if path.exists() {
        return Ok(());
    }
    let records: Vec<MigrationRecord> = Vec::new();
    write_json(&path, &records)
}

fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let temp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let text = serde_json::to_string_pretty(value).map_err(|e| format!("序列化 JSON 失败: {e}"))? + "\n";
    fs::write(&temp, text).map_err(|e| format!("写入临时文件失败: {e}"))?;
    fs::rename(&temp, path).map_err(|e| format!("替换数据文件失败: {e}"))
}
