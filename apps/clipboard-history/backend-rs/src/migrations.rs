use crate::data_contract::{DATA_VERSION, META_FILE_NAME, MIGRATIONS_FILE_NAME, STORAGE_SCHEMA_VERSION};
use crate::domain::now_ms;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreMeta {
    pub schema_version: u64,
    pub data_version: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRecord {
    pub id: String,
    pub from_version: u64,
    pub to_version: u64,
    pub description: String,
    pub applied_at: u64,
}

struct MigrationStep {
    id: &'static str,
    from_version: u64,
    to_version: u64,
    description: &'static str,
    apply: fn(&Path) -> Result<(), String>,
}

const MIGRATION_STEPS: &[MigrationStep] = &[];

pub fn ensure_ready(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let meta = read_meta(root)?;
    if meta.schema_version > STORAGE_SCHEMA_VERSION {
        return Err(format!(
            "数据容器版本过高：当前程序支持 {STORAGE_SCHEMA_VERSION}，数据目录为 {}",
            meta.schema_version
        ));
    }
    if meta.data_version > DATA_VERSION {
        return Err(format!(
            "业务数据版本过高：当前程序支持 {DATA_VERSION}，数据目录为 {}",
            meta.data_version
        ));
    }

    let records = apply_pending_migrations(root, meta.data_version, read_migration_records(root)?)?;
    write_migration_records(root, &records)?;
    write_meta(root)
}

pub fn write_meta(root: &Path) -> Result<(), String> {
    let path = root.join(META_FILE_NAME);
    let mut raw = read_meta_object(&path).unwrap_or_default();
    raw.insert("schemaVersion".to_string(), Value::from(STORAGE_SCHEMA_VERSION));
    raw.insert("dataVersion".to_string(), Value::from(DATA_VERSION));
    raw.insert("updatedAt".to_string(), Value::from(now_ms()));
    atomic_write_json(&path, &Value::Object(raw))
}

fn apply_pending_migrations(
    root: &Path,
    from_data_version: u64,
    mut records: Vec<MigrationRecord>,
) -> Result<Vec<MigrationRecord>, String> {
    let mut current_version = from_data_version;
    while current_version < DATA_VERSION {
        let Some(step) = MIGRATION_STEPS.iter().find(|step| step.from_version == current_version) else {
            return Err(format!(
                "缺少数据迁移步骤：当前数据版本 {current_version}，目标版本 {DATA_VERSION}"
            ));
        };
        if step.to_version <= step.from_version || step.to_version > DATA_VERSION {
            return Err(format!("数据迁移步骤版本无效：{}", step.id));
        }
        (step.apply)(root)?;
        records.push(MigrationRecord {
            id: step.id.to_string(),
            from_version: step.from_version,
            to_version: step.to_version,
            description: step.description.to_string(),
            applied_at: now_ms(),
        });
        current_version = step.to_version;
    }
    Ok(records)
}

fn read_meta(root: &Path) -> Result<StoreMeta, String> {
    let path = root.join(META_FILE_NAME);
    let Some(raw) = read_meta_object(&path) else {
        return Ok(current_meta());
    };
    let schema_version = raw.get("schemaVersion").and_then(Value::as_u64).unwrap_or(STORAGE_SCHEMA_VERSION);
    let data_version = raw.get("dataVersion").and_then(Value::as_u64).unwrap_or(DATA_VERSION);
    let updated_at = raw.get("updatedAt").and_then(Value::as_u64).unwrap_or(0);
    Ok(StoreMeta { schema_version, data_version, updated_at })
}

fn current_meta() -> StoreMeta {
    StoreMeta {
        schema_version: STORAGE_SCHEMA_VERSION,
        data_version: DATA_VERSION,
        updated_at: now_ms(),
    }
}

fn read_meta_object(path: &Path) -> Option<Map<String, Value>> {
    let raw = fs::read_to_string(path).ok()?;
    match serde_json::from_str::<Value>(raw.trim()).ok()? {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

fn read_migration_records(root: &Path) -> Result<Vec<MigrationRecord>, String> {
    let path = root.join(MIGRATIONS_FILE_NAME);
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(Vec::new());
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str::<Vec<MigrationRecord>>(trimmed).map_err(|e| format!("解析迁移日志失败: {e}"))
}

fn write_migration_records(root: &Path, records: &[MigrationRecord]) -> Result<(), String> {
    atomic_write_json(&root.join(MIGRATIONS_FILE_NAME), records)
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
