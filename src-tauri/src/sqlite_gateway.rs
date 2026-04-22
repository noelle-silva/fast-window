use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use rusqlite::{params_from_iter, Connection, OpenFlags, ToSql};
use serde::{Deserialize, Serialize};

use crate::{app_data_dir, is_safe_id, safe_relative_path};

// SQLite 网关：用于插件侧构建“索引/查询层”。
// 约束：
// - 数据库文件必须落在插件 scope:data 目录（data/<pluginId>/...）下。
// - 仅提供最小可用原语（execute / batch），避免把宿主变成“数据库后门”。

fn plugin_data_root(app: &tauri::AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let root = app_data_dir(app).join(plugin_id);
    std::fs::create_dir_all(&root).map_err(|e| format!("创建插件数据目录失败: {e}"))?;
    Ok(root)
}

fn resolve_db_path(
    app: &tauri::AppHandle,
    plugin_id: &str,
    db_name: &str,
) -> Result<PathBuf, String> {
    let name = db_name.trim();
    if name.is_empty() {
        return Err("dbName 不能为空".to_string());
    }
    if name.len() > 128 {
        return Err("dbName 过长".to_string());
    }
    // 强制相对路径，且禁止越界（复用现有 safe_relative_path 规则）
    let rel = safe_relative_path(name)?;
    let root = plugin_data_root(app, plugin_id)?;
    Ok(root.join(rel))
}

#[derive(Default)]
pub(crate) struct SqliteConnManager {
    conns: Mutex<HashMap<String, Arc<Mutex<Connection>>>>,
}

impl SqliteConnManager {
    fn key(plugin_id: &str, db_path: &Path) -> String {
        format!("{}:{}", plugin_id, db_path.to_string_lossy())
    }

    fn get_or_open(
        &self,
        plugin_id: &str,
        db_path: &Path,
        flags: OpenFlags,
    ) -> Result<Arc<Mutex<Connection>>, String> {
        let key = Self::key(plugin_id, db_path);
        {
            let guard = self
                .conns
                .lock()
                .map_err(|_| "sqlite 连接池锁定失败".to_string())?;
            if let Some(conn) = guard.get(&key) {
                return Ok(conn.clone());
            }
        }

        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建 sqlite 目录失败: {e}"))?;
        }
        let conn = Connection::open_with_flags(db_path, flags)
            .map_err(|e| format!("打开 sqlite 失败: {e}"))?;

        // 避免并发写入时出现 SQLITE_BUSY 立刻失败（尤其 Windows 上偶发更明显）。
        let _ = conn.busy_timeout(std::time::Duration::from_millis(2_000));

        // 推荐：WAL + NORMAL，同步写入性能与稳定性较均衡。
        // 如果宿主目录在极端文件系统（网盘/只读），插件侧可自行处理错误并退回无需 DB 的路径。
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let _ = conn.pragma_update(None, "synchronous", "NORMAL");
        let _ = conn.execute_batch("PRAGMA foreign_keys=ON;");

        let conn = Arc::new(Mutex::new(conn));
        let mut guard = self
            .conns
            .lock()
            .map_err(|_| "sqlite 连接池锁定失败".to_string())?;
        guard.insert(key, conn.clone());
        Ok(conn)
    }

    fn remove(&self, plugin_id: &str, db_path: &Path) -> Result<bool, String> {
        let key = Self::key(plugin_id, db_path);
        let mut guard = self
            .conns
            .lock()
            .map_err(|_| "sqlite 连接池锁定失败".to_string())?;
        Ok(guard.remove(&key).is_some())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqliteExecuteReq {
    pub(crate) plugin_id: String,
    pub(crate) db_name: String,
    pub(crate) sql: String,
    #[serde(default)]
    pub(crate) params: Vec<SqliteValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqliteQueryReq {
    pub(crate) plugin_id: String,
    pub(crate) db_name: String,
    pub(crate) sql: String,
    #[serde(default)]
    pub(crate) params: Vec<SqliteValue>,
    #[serde(default)]
    pub(crate) max_rows: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqliteBatchReq {
    pub(crate) plugin_id: String,
    pub(crate) db_name: String,
    pub(crate) statements: Vec<SqliteStatement>,
    #[serde(default)]
    pub(crate) transaction: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqliteCloseReq {
    pub(crate) plugin_id: String,
    pub(crate) db_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqliteStatement {
    pub(crate) sql: String,
    #[serde(default)]
    pub(crate) params: Vec<SqliteValue>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum SqliteValue {
    Null,
    Integer { value: i64 },
    Real { value: f64 },
    Text { value: String },
    BlobBase64 { value: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqliteExecuteResult {
    pub(crate) rows_affected: u64,
    pub(crate) last_insert_rowid: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqliteQueryResult {
    pub(crate) columns: Vec<String>,
    pub(crate) rows: Vec<Vec<SqliteValue>>,
}

fn with_query_guard<T>(
    conn: &Connection,
    f: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    // 防止恶意/误写 SQL 造成宿主线程长时间卡死：
    // - progress_handler 每 N 条虚拟机指令回调一次，返回 true 则中断。
    // - 这里用一个保守上限，足够索引层使用；如果未来需要更长的任务，应改用后台线程/任务队列。
    const OPS_PER_TICK: i32 = 1_000;
    const MAX_TICKS: usize = 30_000; // 约 3e7 VM ops

    let ticks = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let ticks2 = ticks.clone();
    conn.progress_handler(
        OPS_PER_TICK,
        Some(move || {
            let n = ticks2.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            n >= MAX_TICKS
        }),
    );

    let result = f();
    conn.progress_handler(0, None::<fn() -> bool>);

    match result {
        Ok(v) => Ok(v),
        Err(e) => {
            // 若被中断，rusqlite 会返回 Error::Interrupted；这里统一成更友好的字符串
            if e.to_ascii_lowercase().contains("interrupted") {
                return Err("sqlite 操作被中断（可能是查询过慢）".to_string());
            }
            Err(e)
        }
    }
}

fn to_rusqlite_params(values: &[SqliteValue]) -> Result<Vec<Box<dyn ToSql>>, String> {
    let mut out: Vec<Box<dyn ToSql>> = Vec::with_capacity(values.len());
    for v in values {
        match v {
            SqliteValue::Null => out.push(Box::new(rusqlite::types::Null)),
            SqliteValue::Integer { value } => out.push(Box::new(*value)),
            SqliteValue::Real { value } => out.push(Box::new(*value)),
            SqliteValue::Text { value } => out.push(Box::new(value.clone())),
            SqliteValue::BlobBase64 { value } => {
                // 仅用于索引层的二进制（通常不需要）。给出能力但限制大小，避免滥用。
                let raw = value.trim();
                if raw.len() > 4 * 1024 * 1024 {
                    return Err("blobBase64 过大".to_string());
                }
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(raw)
                    .map_err(|e| format!("blobBase64 解码失败: {e}"))?;
                if bytes.len() > 2 * 1024 * 1024 {
                    return Err("blob 过大".to_string());
                }
                out.push(Box::new(bytes));
            }
        }
    }
    Ok(out)
}

pub(crate) fn sqlite_execute(
    app: tauri::AppHandle,
    manager: tauri::State<'_, Arc<SqliteConnManager>>,
    req: SqliteExecuteReq,
) -> Result<SqliteExecuteResult, String> {
    let plugin_id = req.plugin_id.trim().to_string();
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let sql = req.sql.trim().to_string();
    if sql.is_empty() {
        return Err("sql 不能为空".to_string());
    }
    if sql.len() > 256 * 1024 {
        return Err("sql 过大".to_string());
    }

    let db_path = resolve_db_path(&app, &plugin_id, &req.db_name)?;
    let conn = manager.get_or_open(
        &plugin_id,
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    let params = to_rusqlite_params(&req.params)?;

    let guard = conn.lock().map_err(|_| "sqlite 连接锁定失败".to_string())?;
    with_query_guard(&guard, || {
        let mut stmt = guard
            .prepare(&sql)
            .map_err(|e| format!("prepare 失败: {e}"))?;
        let rows = stmt
            .execute(params_from_iter(params.iter().map(|b| b.as_ref())))
            .map_err(|e| format!("execute 失败: {e}"))?;
        let last_id = guard.last_insert_rowid();
        Ok(SqliteExecuteResult {
            rows_affected: rows as u64,
            last_insert_rowid: last_id,
        })
    })
}

fn value_ref_to_sqlite_value(v: rusqlite::types::ValueRef<'_>) -> Result<SqliteValue, String> {
    use rusqlite::types::ValueRef;
    match v {
        ValueRef::Null => Ok(SqliteValue::Null),
        ValueRef::Integer(i) => Ok(SqliteValue::Integer { value: i }),
        ValueRef::Real(f) => Ok(SqliteValue::Real { value: f }),
        ValueRef::Text(t) => {
            // 防滥用：单个 cell 文本上限（2MB）
            if t.len() > 2 * 1024 * 1024 {
                return Err("sqlite text cell 过大".to_string());
            }
            let s =
                String::from_utf8(t.to_vec()).map_err(|_| "sqlite text 不是 UTF-8".to_string())?;
            Ok(SqliteValue::Text { value: s })
        }
        ValueRef::Blob(b) => {
            // 索引层一般不需要 blob。提供返回但限制大小。
            if b.len() > 256 * 1024 {
                return Err("sqlite blob cell 过大".to_string());
            }
            let s = base64::engine::general_purpose::STANDARD.encode(b);
            Ok(SqliteValue::BlobBase64 { value: s })
        }
    }
}

#[tauri::command]
pub(crate) fn plugin_sqlite_execute(
    app: tauri::AppHandle,
    manager: tauri::State<'_, Arc<SqliteConnManager>>,
    req: SqliteExecuteReq,
) -> Result<SqliteExecuteResult, String> {
    sqlite_execute(app, manager, req)
}

#[tauri::command]
pub(crate) fn plugin_sqlite_query(
    app: tauri::AppHandle,
    manager: tauri::State<'_, Arc<SqliteConnManager>>,
    req: SqliteQueryReq,
) -> Result<SqliteQueryResult, String> {
    let plugin_id = req.plugin_id.trim().to_string();
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let sql = req.sql.trim().to_string();
    if sql.is_empty() {
        return Err("sql 不能为空".to_string());
    }
    if sql.len() > 256 * 1024 {
        return Err("sql 过大".to_string());
    }

    let max_rows = req.max_rows.unwrap_or(200).max(1).min(2000) as usize;

    let db_path = resolve_db_path(&app, &plugin_id, &req.db_name)?;
    let conn = manager.get_or_open(
        &plugin_id,
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    let params = to_rusqlite_params(&req.params)?;

    let guard = conn.lock().map_err(|_| "sqlite 连接锁定失败".to_string())?;
    with_query_guard(&guard, || {
        let mut stmt = guard
            .prepare(&sql)
            .map_err(|e| format!("prepare 失败: {e}"))?;

        let col_count = stmt.column_count();
        if col_count > 128 {
            return Err("查询列过多".to_string());
        }
        let mut columns: Vec<String> = Vec::with_capacity(col_count);
        for i in 0..col_count {
            columns.push(stmt.column_name(i).unwrap_or("").to_string());
        }

        let mut rows = stmt
            .query(params_from_iter(params.iter().map(|b| b.as_ref())))
            .map_err(|e| format!("query 失败: {e}"))?;

        let mut out: Vec<Vec<SqliteValue>> = Vec::new();
        while let Some(r) = rows.next().map_err(|e| format!("读取行失败: {e}"))? {
            if out.len() >= max_rows {
                break;
            }
            let mut row_out: Vec<SqliteValue> = Vec::with_capacity(col_count);
            for i in 0..col_count {
                let v = r.get_ref(i).map_err(|e| format!("读取列失败: {e}"))?;
                row_out.push(value_ref_to_sqlite_value(v)?);
            }
            out.push(row_out);
        }

        Ok(SqliteQueryResult { columns, rows: out })
    })
}

#[tauri::command]
pub(crate) fn plugin_sqlite_batch(
    app: tauri::AppHandle,
    manager: tauri::State<'_, Arc<SqliteConnManager>>,
    req: SqliteBatchReq,
) -> Result<Vec<SqliteExecuteResult>, String> {
    let plugin_id = req.plugin_id.trim().to_string();
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    if req.statements.is_empty() {
        return Ok(vec![]);
    }
    if req.statements.len() > 256 {
        return Err("statements 过多".to_string());
    }

    let db_path = resolve_db_path(&app, &plugin_id, &req.db_name)?;
    let conn = manager.get_or_open(
        &plugin_id,
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;

    let mut guard = conn.lock().map_err(|_| "sqlite 连接锁定失败".to_string())?;

    let mut out: Vec<SqliteExecuteResult> = Vec::with_capacity(req.statements.len());

    if req.transaction {
        let tx = guard
            .transaction()
            .map_err(|e| format!("BEGIN 失败: {e}"))?;

        for st in &req.statements {
            let sql = st.sql.trim();
            if sql.is_empty() {
                return Err("statement.sql 不能为空".to_string());
            }
            if sql.len() > 256 * 1024 {
                return Err("statement.sql 过大".to_string());
            }
            let params = to_rusqlite_params(&st.params)?;
            let mut stmt = tx.prepare(sql).map_err(|e| format!("prepare 失败: {e}"))?;
            let rows = stmt
                .execute(params_from_iter(params.iter().map(|b| b.as_ref())))
                .map_err(|e| format!("execute 失败: {e}"))?;
            out.push(SqliteExecuteResult {
                rows_affected: rows as u64,
                last_insert_rowid: tx.last_insert_rowid(),
            });
        }

        tx.commit().map_err(|e| format!("COMMIT 失败: {e}"))?;
        Ok(out)
    } else {
        with_query_guard(&guard, || {
            for st in &req.statements {
                let sql = st.sql.trim();
                if sql.is_empty() {
                    return Err("statement.sql 不能为空".to_string());
                }
                if sql.len() > 256 * 1024 {
                    return Err("statement.sql 过大".to_string());
                }
                let params = to_rusqlite_params(&st.params)?;
                let mut stmt = guard
                    .prepare(sql)
                    .map_err(|e| format!("prepare 失败: {e}"))?;
                let rows = stmt
                    .execute(params_from_iter(params.iter().map(|b| b.as_ref())))
                    .map_err(|e| format!("execute 失败: {e}"))?;
                out.push(SqliteExecuteResult {
                    rows_affected: rows as u64,
                    last_insert_rowid: guard.last_insert_rowid(),
                });
            }
            Ok(out)
        })
    }
}

#[tauri::command]
pub(crate) fn plugin_sqlite_close(
    app: tauri::AppHandle,
    manager: tauri::State<'_, Arc<SqliteConnManager>>,
    req: SqliteCloseReq,
) -> Result<bool, String> {
    let plugin_id = req.plugin_id.trim().to_string();
    if !is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }
    let db_path = resolve_db_path(&app, &plugin_id, &req.db_name)?;
    manager.remove(&plugin_id, &db_path)
}
