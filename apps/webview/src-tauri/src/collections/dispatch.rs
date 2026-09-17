//! `collections_request` 统一命令：方法路由、参数解析与写锁。
//!
//! 写文档的方法串行执行；只读方法与网页图标发现不持写锁。

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

use crate::collections::{assets, containers, desktop, groups, items, web_icons, workspace};

/// 文档写锁：串行化读-改-写，避免并发写互相覆盖。
#[derive(Default, Clone)]
pub struct CollectionsIoLock(std::sync::Arc<tokio::sync::Mutex<()>>);

impl CollectionsIoLock {
    pub async fn lock(&self) -> tokio::sync::OwnedMutexGuard<()> {
        self.0.clone().lock_owned().await
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct DiscoverPayload {
    pub url: String,
}

#[tauri::command]
pub async fn collections_request(
    app: tauri::AppHandle,
    method: String,
    params: Option<Value>,
    on_progress: tauri::ipc::Channel<Value>,
) -> Result<Value, String> {
    handle(
        &app,
        method.trim(),
        params.unwrap_or(Value::Null),
        Some(on_progress),
    )
    .await
}

pub async fn handle(
    app: &tauri::AppHandle,
    method: &str,
    params: Value,
    on_progress: Option<tauri::ipc::Channel<Value>>,
) -> Result<Value, String> {
    let data_dir = crate::data_dir::resolve_data_dir(app)?;
    allow_asset_directory(app, &data_dir);
    match method {
        "collections.health" => Ok(workspace::health(&data_dir)),
        "collections.workspace.get" => workspace::view(&data_dir),
        "collections.ui-state.get" => to_value(workspace::ui_state_get(&data_dir)?),
        "collections.ui-state.save" => {
            let payload: workspace::UiStatePayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(workspace::ui_state_save(&data_dir, payload)?)
        }
        "collections.groups.add" => {
            let payload: groups::GroupPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(groups::add(&data_dir, payload.group)?)
        }
        "collections.groups.update" => {
            let payload: groups::GroupPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(groups::update(&data_dir, payload.group)?)
        }
        "collections.groups.order.save" => {
            let payload: groups::GroupOrderPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(groups::save_order(&data_dir, payload.group_order)?)
        }
        "collections.groups.remove" => {
            let payload: groups::GroupIdPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(groups::remove(&data_dir, &payload.id)?)
        }
        "collections.items.add" => {
            let payload: items::ItemPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(items::add(&data_dir, payload.item)?)
        }
        "collections.items.update" => {
            let payload: items::ItemPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(items::update(&data_dir, payload.item)?)
        }
        "collections.items.remove" => {
            let payload: items::IdPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(items::remove(&data_dir, &payload.id)?)
        }
        "collections.items.open" => {
            let payload: items::IdPayload = parse(params)?;
            items::open(app, &data_dir, &payload.id).await
        }
        "collections.items.move-to-group" => {
            let payload: items::TransferPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(items::move_to_group(&data_dir, payload)?)
        }
        "collections.items.copy-to-group" => {
            let payload: items::TransferPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(items::copy_to_group(&data_dir, payload)?)
        }
        "collections.items.container.save" => {
            let payload: items::ContainerSavePayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(items::container_save(&data_dir, payload)?)
        }
        "collections.containers.add" => {
            let payload: containers::ContainerPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(containers::add(&data_dir, payload.container)?)
        }
        "collections.containers.update" => {
            let payload: containers::ContainerPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(containers::update(&data_dir, payload.container)?)
        }
        "collections.containers.remove" => {
            let payload: containers::ContainerIdPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(containers::remove(&data_dir, &payload.id)?)
        }
        "collections.containers.create-from-items" => {
            let payload: containers::CreateFromItemsPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(containers::create_from_items(&data_dir, payload)?)
        }
        "collections.container.items.place" => {
            let payload: containers::ContainerPlacePayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(containers::place(&data_dir, payload)?)
        }
        "collections.container.item.extract-to-desktop" => {
            let payload: containers::ExtractPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(containers::extract_to_desktop(&data_dir, payload)?)
        }
        "collections.desktop.layout.save" => {
            let payload: desktop::DesktopLayoutSavePayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(desktop::save_layouts(&data_dir, payload)?)
        }
        "collections.desktop.icon-layout.save" => {
            let payload: desktop::IconLayoutPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(desktop::save_icon_layout(&data_dir, payload)?)
        }
        "collections.desktop.wallpaper.save" => {
            let payload: desktop::WallpaperPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(desktop::save_wallpaper(&data_dir, payload)?)
        }
        "collections.icon.save" => {
            let payload: desktop::ItemIconPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(desktop::save_icon(&data_dir, payload)?)
        }
        "collections.assets.import" => {
            let payload: assets::AssetImportPayload = parse(params)?;
            let _guard = write_lock(app).await;
            to_value(assets::import_asset(
                &data_dir,
                &payload.kind,
                &payload.source_path,
                &payload.data_url,
            )?)
        }
        "collections.web-icons.discover" => {
            let payload: DiscoverPayload = parse(params)?;
            let channel = on_progress;
            let asset_dir = data_dir.clone();
            let result = web_icons::discover(&payload.url, move |mut candidate| {
                let data_url = candidate.data_url.clone().unwrap_or_default();
                let asset = assets::import_asset(&asset_dir, "icon", "", &data_url)?;
                candidate.asset_id = Some(asset.id);
                candidate.data_url = None;
                if let Some(channel) = channel.as_ref() {
                    let frame = serde_json::json!({
                        "event": "candidate",
                        "payload": candidate.clone(),
                    });
                    let _ = channel.send(frame);
                }
                Ok(candidate)
            })
            .await?;
            to_value(result)
        }
        other => Err(format!("unknown method: {other}")),
    }
}

async fn write_lock(app: &tauri::AppHandle) -> tokio::sync::OwnedMutexGuard<()> {
    app.state::<CollectionsIoLock>().lock().await
}

/// 允许前端经 asset protocol 读取当前数据目录下的资产文件。
fn allow_asset_directory(app: &tauri::AppHandle, data_dir: &std::path::Path) {
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(data_dir, true);
}

fn parse<T: DeserializeOwned>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|e| format!("invalid params: {e}"))
}

fn to_value<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| format!("serialize result failed: {e}"))
}
