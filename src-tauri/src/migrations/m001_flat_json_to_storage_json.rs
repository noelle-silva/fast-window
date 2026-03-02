pub fn needs(app: &tauri::AppHandle) -> bool {
    let root = crate::app_data_dir(app);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return false;
    };
    for e in entries.flatten() {
        let Ok(ty) = e.file_type() else {
            continue;
        };
        if !ty.is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name == "app.json" {
            continue;
        }
        if !name.to_lowercase().ends_with(".json") {
            continue;
        }
        let plugin_id = name.trim_end_matches(".json").to_string();
        if crate::is_safe_id(&plugin_id) {
            return true;
        }
    }
    false
}

pub fn run(app: &tauri::AppHandle) -> Result<bool, String> {
    // 旧布局：data/<pluginId>.json
    // 新布局：data/<pluginId>/storage.json
    let root = crate::app_data_dir(app);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok(false);
    };

    let mut changed = false;
    for e in entries.flatten() {
        let Ok(ty) = e.file_type() else {
            continue;
        };
        if !ty.is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name == "app.json" {
            continue;
        }
        if !name.to_lowercase().ends_with(".json") {
            continue;
        }
        let plugin_id = name.trim_end_matches(".json").to_string();
        if !crate::is_safe_id(&plugin_id) {
            continue;
        }

        let old_path = e.path();
        let new_path = crate::app_data_dir(app).join(&plugin_id).join("storage.json");
        if new_path.is_file() {
            continue;
        }
        if let Some(parent) = new_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("创建迁移目录失败: {plugin_id}: {err}"))?;
        }

        if std::fs::rename(&old_path, &new_path).is_err() {
            std::fs::copy(&old_path, &new_path)
                .map_err(|err| format!("迁移 storage.json 失败: {plugin_id}: {err}"))?;
            let _ = std::fs::remove_file(&old_path);
        }
        changed = true;
    }

    Ok(changed)
}
