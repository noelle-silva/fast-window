use std::str::FromStr;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::app_lifecycle::{
    app_launch_inner_with_cold_start_policy, build_registered_app_launch_args, AppColdStartPolicy,
    AppLifecycleManager, RegisteredAppLaunchConfig,
};

#[derive(Default)]
pub(crate) struct RegisteredAppShortcutState {
    current: Mutex<Vec<RegisteredAppShortcutBinding>>,
    paused: Mutex<bool>,
}

#[derive(Clone)]
struct RegisteredAppShortcutBinding {
    target: RegisteredAppShortcutTarget,
    shortcut: Shortcut,
}

#[derive(Clone)]
struct RegisteredAppShortcutTarget {
    app_id: String,
    command_id: Option<String>,
    shortcut: Shortcut,
    cold_start_policy: AppColdStartPolicy,
}

impl RegisteredAppShortcutTarget {
    fn label(&self) -> String {
        match &self.command_id {
            Some(command_id) => format!("{}/{}", self.app_id, command_id),
            None => self.app_id.clone(),
        }
    }

    fn action(&self) -> &'static str {
        if self.command_id.is_some() {
            "show"
        } else {
            "toggle"
        }
    }
}

fn cold_start_policy_from_record(
    value: &serde_json::Value,
    app_id: &str,
) -> Result<AppColdStartPolicy, String> {
    match value
        .get("hotkeyLaunchBehavior")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|behavior| !behavior.is_empty())
        .unwrap_or("launch")
    {
        "launch" => Ok(AppColdStartPolicy::Allow),
        "runningOnly" => Ok(AppColdStartPolicy::Skip),
        value => Err(format!("{app_id} 的快捷键启动方式不合法: {value}")),
    }
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
        if let Some(hotkey) = value
            .get("hotkey")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|hotkey| !hotkey.is_empty())
        {
            let shortcut = Shortcut::from_str(hotkey)
                .map_err(|e| format!("{app_id} 的快捷键格式不合法: {e}"))?;
            let cold_start_policy = cold_start_policy_from_record(value, &app_id)?;
            targets.push(RegisteredAppShortcutTarget {
                app_id: app_id.clone(),
                command_id: None,
                shortcut,
                cold_start_policy,
            });
        }

        let Some(commands) = value.get("commands").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for command in commands {
            let command_id = command
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .ok_or_else(|| format!("{app_id} 的宿主快捷命令 ID 不能为空"))?
                .to_string();
            let Some(hotkey) = command
                .get("hotkey")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|hotkey| !hotkey.is_empty())
            else {
                continue;
            };
            let shortcut = Shortcut::from_str(hotkey).map_err(|e| {
                format!("{app_id}/{command_id} 的宿主快捷命令快捷键格式不合法: {e}")
            })?;
            targets.push(RegisteredAppShortcutTarget {
                app_id: app_id.clone(),
                command_id: Some(command_id),
                shortcut,
                cold_start_policy: AppColdStartPolicy::Allow,
            });
        }
    }

    Ok(targets)
}

async fn activate_registered_app_shortcut_target(
    app: AppHandle,
    target: RegisteredAppShortcutTarget,
) -> Result<(), String> {
    let Some(value) = crate::app_registry::load_registered_app_record(&app, &target.app_id)? else {
        return Err(format!("注册应用不存在: {}", target.app_id));
    };
    let config: RegisteredAppLaunchConfig =
        serde_json::from_value(value).map_err(|e| format!("注册应用配置不完整: {e}"))?;
    let launcher = app.state::<Arc<AppLifecycleManager>>().inner().clone();
    app_launch_inner_with_cold_start_policy(
        app.clone(),
        launcher,
        config.id.clone(),
        config.path.clone(),
        build_registered_app_launch_args(&config, target.action(), target.command_id.as_deref()),
        target.cold_start_policy,
    )
    .await
    .map(|_| ())
}

fn register_app_shortcut(
    app: &AppHandle,
    target: RegisteredAppShortcutTarget,
) -> Result<RegisteredAppShortcutBinding, String> {
    let shortcut = target.shortcut;
    let shortcut_target = target.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }

            let app = app.clone();
            let shortcut_target = shortcut_target.clone();
            tauri::async_runtime::spawn(async move {
                let target_label = shortcut_target.label();
                if let Err(error) =
                    activate_registered_app_shortcut_target(app.clone(), shortcut_target).await
                {
                    eprintln!("[app-shortcuts] failed to activate {target_label}: {error}");
                    crate::host_primitives::emit_toast(&app, format!("启动应用失败：{error}"));
                }
            });
        })
        .map_err(|error| error.to_string())?;

    Ok(RegisteredAppShortcutBinding { target, shortcut })
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

fn restore_bindings(
    app: &AppHandle,
    bindings: Vec<RegisteredAppShortcutBinding>,
) -> Result<(), String> {
    let mut restored = Vec::new();
    let mut errors = Vec::new();
    for binding in bindings {
        match register_app_shortcut(app, binding.target.clone()) {
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
    if state
        .paused
        .lock()
        .ok()
        .map(|guard| *guard)
        .unwrap_or(false)
    {
        return Ok(());
    }

    let records = crate::app_registry::load_registered_app_records(app)?;
    let targets = shortcut_targets_from_records(&records)?;
    let previous = unregister_current(app, &state);
    let mut next = Vec::new();
    let mut errors = Vec::new();

    for target in targets {
        let shortcut_text = target.shortcut.to_string();
        match register_app_shortcut(app, target) {
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
    let was_paused = state
        .paused
        .lock()
        .ok()
        .map(|guard| *guard)
        .unwrap_or(false);
    let previous = unregister_current(app, &state);

    let targets = shortcut_targets_from_records(records);
    let mut registered = Vec::new();
    let mut result = Ok(());

    match targets {
        Ok(targets) => {
            for target in targets {
                let shortcut = target.shortcut;
                let shortcut_text = shortcut.to_string();
                if let Err(error) = app
                    .global_shortcut()
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
