use std::str::FromStr;
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::app_launcher::{app_launch_inner, AppLauncherState};

#[derive(Default)]
pub(crate) struct RegisteredAppShortcutState {
    current: Mutex<Vec<RegisteredAppShortcutBinding>>,
    paused: Mutex<bool>,
}

#[derive(Clone)]
struct RegisteredAppShortcutBinding {
    app_id: String,
    shortcut: Shortcut,
}

struct RegisteredAppShortcutTarget {
    app_id: String,
    shortcut: Shortcut,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisteredAppLaunchConfig {
    id: String,
    path: String,
    #[serde(default)]
    display_mode: Option<String>,
    #[serde(default)]
    window_width: Option<u32>,
    #[serde(default)]
    window_height: Option<u32>,
    #[serde(default)]
    window_x: Option<i32>,
    #[serde(default)]
    window_y: Option<i32>,
}

fn shortcut_targets_from_records(
    records: &[serde_json::Value],
) -> Result<Vec<RegisteredAppShortcutTarget>, String> {
    let mut targets = Vec::new();

    for value in records {
        let app_id = value
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| "appId 不能为空".to_string())?
            .to_string();
        let Some(hotkey) = value
            .get("hotkey")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|hotkey| !hotkey.is_empty())
        else {
            continue;
        };

        let shortcut = Shortcut::from_str(hotkey)
            .map_err(|e| format!("{app_id} 的快捷键格式不合法: {e}"))?;
        targets.push(RegisteredAppShortcutTarget { app_id, shortcut });
    }

    Ok(targets)
}

fn build_launch_args(app: &RegisteredAppLaunchConfig) -> Vec<String> {
    let mut args = vec!["--fw-launched".to_string(), "--fw-action".to_string(), "toggle".to_string()];

    let mode = app
        .display_mode
        .as_deref()
        .filter(|mode| matches!(*mode, "default" | "window" | "top"))
        .unwrap_or("default");
    args.push("--fw-mode".to_string());
    args.push(mode.to_string());

    if let Some(width) = app.window_width {
        args.push("--fw-width".to_string());
        args.push(width.to_string());
    }
    if let Some(height) = app.window_height {
        args.push("--fw-height".to_string());
        args.push(height.to_string());
    }
    if let Some(x) = app.window_x {
        args.push("--fw-x".to_string());
        args.push(x.to_string());
    }
    if let Some(y) = app.window_y {
        args.push("--fw-y".to_string());
        args.push(y.to_string());
    }

    args
}

async fn activate_registered_app_by_id(app: AppHandle, app_id: String) -> Result<(), String> {
    let Some(value) = crate::app_registry::load_registered_app_record(&app, &app_id)? else {
        return Err(format!("注册应用不存在: {app_id}"));
    };
    let config: RegisteredAppLaunchConfig = serde_json::from_value(value)
        .map_err(|e| format!("注册应用配置不完整: {e}"))?;
    let launcher = app.state::<Arc<AppLauncherState>>().inner().clone();
    app_launch_inner(
        app.clone(),
        launcher,
        config.id.clone(),
        config.path.clone(),
        build_launch_args(&config),
    )
    .await
}

fn register_app_shortcut(
    app: &AppHandle,
    app_id: String,
    shortcut: Shortcut,
) -> Result<RegisteredAppShortcutBinding, String> {
    let target_app_id = app_id.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }

            let app = app.clone();
            let target_app_id = target_app_id.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = activate_registered_app_by_id(app.clone(), target_app_id.clone()).await {
                    eprintln!("[app-shortcuts] failed to activate {target_app_id}: {error}");
                    crate::host_primitives::emit_toast(&app, format!("启动应用失败：{error}"));
                }
            });
        })
        .map_err(|error| error.to_string())?;

    Ok(RegisteredAppShortcutBinding { app_id, shortcut })
}

fn unregister_bindings(app: &AppHandle, bindings: Vec<RegisteredAppShortcutBinding>) {
    for binding in bindings {
        let _ = app.global_shortcut().unregister(binding.shortcut);
    }
}

fn unregister_current(
    app: &AppHandle,
    state: &RegisteredAppShortcutState,
) -> Vec<RegisteredAppShortcutBinding> {
    let previous = state
        .current
        .lock()
        .map(|mut guard| std::mem::take(&mut *guard))
        .unwrap_or_default();

    unregister_bindings(app, previous.clone());
    previous
}

fn restore_bindings(app: &AppHandle, bindings: Vec<RegisteredAppShortcutBinding>) -> Result<(), String> {
    let mut restored = Vec::new();
    let mut errors = Vec::new();
    for binding in bindings {
        match register_app_shortcut(app, binding.app_id.clone(), binding.shortcut) {
            Ok(restored_binding) => restored.push(restored_binding),
            Err(error) => {
                errors.push(format!("{}: {error}", binding.shortcut));
                eprintln!(
                    "[app-shortcuts] failed to restore registered app shortcut {}: {}",
                    binding.shortcut, error
                );
            }
        }
    }

    let state = app.state::<RegisteredAppShortcutState>();
    if let Ok(mut guard) = state.current.lock() {
        *guard = restored;
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("恢复注册应用快捷键失败: {}", errors.join("; ")))
    }
}

pub(crate) fn refresh_registered_app_shortcuts(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<RegisteredAppShortcutState>();
    if state.paused.lock().ok().map(|guard| *guard).unwrap_or(false) {
        return Ok(());
    }

    let records = crate::app_registry::load_registered_app_records(app)?;
    let targets = shortcut_targets_from_records(&records)?;
    let previous = unregister_current(app, &state);
    let mut next = Vec::new();
    let mut errors = Vec::new();

    for target in targets {
        let shortcut_text = target.shortcut.to_string();
        match register_app_shortcut(app, target.app_id, target.shortcut) {
            Ok(binding) => next.push(binding),
            Err(error) => {
                let message = format!("注册应用快捷键失败：{shortcut_text}（{error}）");
                eprintln!("[app-shortcuts] {message}");
                crate::host_primitives::emit_toast(app, message);
                errors.push(format!("{shortcut_text}: {error}"));
            }
        }
    }

    if errors.is_empty() {
        if let Ok(mut guard) = state.current.lock() {
            *guard = next;
        }
        Ok(())
    } else {
        unregister_bindings(app, next);
        let restore_error = restore_bindings(app, previous).err();
        let message = format!("注册应用快捷键失败: {}", errors.join("; "));
        match restore_error {
            Some(error) => Err(format!("{message}; {error}")),
            None => Err(message),
        }
    }
}

pub(crate) fn validate_registered_app_shortcuts_available(
    app: &AppHandle,
    records: &[serde_json::Value],
) -> Result<(), String> {
    let state = app.state::<RegisteredAppShortcutState>();
    let was_paused = state.paused.lock().ok().map(|guard| *guard).unwrap_or(false);
    let previous = unregister_current(app, &state);

    let targets = shortcut_targets_from_records(records);
    let mut registered = Vec::new();
    let mut result = Ok(());

    match targets {
        Ok(targets) => {
            for target in targets {
                let shortcut = target.shortcut;
                let shortcut_text = shortcut.to_string();
                if let Err(error) =
                    app.global_shortcut()
                        .on_shortcut(shortcut, |_app, _shortcut, _event| {})
                {
                    result = Err(format!("注册应用快捷键不可用：{shortcut_text}（{error}）"));
                    break;
                }
                registered.push(shortcut);
            }
        }
        Err(error) => {
            result = Err(error);
        }
    }

    for shortcut in registered {
        let _ = app.global_shortcut().unregister(shortcut);
    }

    let restore_result = if !was_paused {
        restore_bindings(app, previous)
    } else {
        Ok(())
    };

    match (result, restore_result) {
        (Err(error), Err(restore_error)) => Err(format!("{error}; {restore_error}")),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(restore_error)) => Err(restore_error),
        (Ok(()), Ok(())) => Ok(()),
    }
}

#[tauri::command]
pub(crate) fn pause_registered_app_shortcuts(app: AppHandle) -> Result<(), String> {
    let state = app.state::<RegisteredAppShortcutState>();
    let mut paused = state
        .paused
        .lock()
        .map_err(|_| "应用快捷键状态锁定失败".to_string())?;
    if *paused {
        return Ok(());
    }

    unregister_current(&app, &state);
    *paused = true;
    Ok(())
}

#[tauri::command]
pub(crate) fn resume_registered_app_shortcuts(app: AppHandle) -> Result<(), String> {
    let state = app.state::<RegisteredAppShortcutState>();
    {
        let mut paused = state
            .paused
            .lock()
            .map_err(|_| "应用快捷键状态锁定失败".to_string())?;
        if !*paused {
            return Ok(());
        }
        *paused = false;
    }

    refresh_registered_app_shortcuts(&app)
}
