//! 工作区读取、界面状态与健康检查。

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::collections::model::{now_text, safe_id, CollectionsUiState};
use crate::collections::store::{ensure_doc, save_doc, workspace_view};

pub fn health(data_dir: &Path) -> Value {
    let data = match ensure_doc(data_dir) {
        Ok(doc) => json!({
            "ok": true,
            "schemaVersion": doc.schema_version,
            "dataVersion": doc.data_version,
        }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    let mut payload = Map::new();
    payload.insert("ok".to_string(), json!(true));
    payload.insert("dataDir".to_string(), json!(data_dir.display().to_string()));
    payload.insert("time".to_string(), json!(now_text()));
    payload.insert("data".to_string(), data);
    Value::Object(payload)
}

pub fn view(data_dir: &Path) -> Result<Value, String> {
    let view = workspace_view(data_dir)?;
    serde_json::to_value(view).map_err(|e| format!("serialize workspace view failed: {e}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiStatePayload {
    pub ui_state: CollectionsUiState,
}

pub fn ui_state_get(data_dir: &Path) -> Result<CollectionsUiState, String> {
    Ok(ensure_doc(data_dir)?.ui_state)
}

pub fn ui_state_save(
    data_dir: &Path,
    payload: UiStatePayload,
) -> Result<CollectionsUiState, String> {
    let mut doc = ensure_doc(data_dir)?;
    let group_id = safe_id(&payload.ui_state.group_id, 32);
    if group_id.is_empty() {
        if !doc.workspace.groups.is_empty() {
            return Err("uiState groupId is required".to_string());
        }
    } else if !doc.workspace.groups.iter().any(|group| group.id == group_id) {
        return Err(format!("uiState groupId not found: {group_id}"));
    }
    doc.ui_state.group_id = group_id;
    save_doc(data_dir, &mut doc)?;
    Ok(doc.ui_state.clone())
}
