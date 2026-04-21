use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFilesDeleteTreeReq {
    scope: String,
    path: String,
}

#[tauri::command]
pub(crate) fn plugin_files_delete_tree(
    app: tauri::AppHandle,
    plugin_id: String,
    req: PluginFilesDeleteTreeReq,
) -> Result<(), String> {
    if !crate::is_safe_id(&plugin_id) {
        return Err("pluginId 不合法".to_string());
    }

    let scope = req.scope.trim().to_string();
    let (root_c, full_c) = crate::resolve_existing_file_in_scope(&app, &plugin_id, &scope, &req.path)?;
    if full_c == root_c {
        return Err("禁止删除根目录".to_string());
    }

    let parent = full_c.parent().map(|p| p.to_path_buf());

    if full_c.is_file() {
        std::fs::remove_file(&full_c).map_err(|e| format!("删除文件失败: {e}"))?;
    } else if full_c.is_dir() {
        std::fs::remove_dir_all(&full_c).map_err(|e| format!("删除目录失败: {e}"))?;
    } else {
        return Err("路径不存在".to_string());
    }

    // 仅清理 plugin 私有 data scope 产生的空目录；output scope 不做清理（避免误删用户目录结构）。
    if scope == "data" {
        let mut cur = parent;
        while let Some(dir) = cur {
            if dir == root_c {
                break;
            }
            let Ok(mut rd) = std::fs::read_dir(&dir) else {
                break;
            };
            if rd.next().is_some() {
                break;
            }
            let _ = std::fs::remove_dir(&dir);
            cur = dir.parent().map(|p| p.to_path_buf());
        }
    }

    Ok(())
}

