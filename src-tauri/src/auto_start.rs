use std::io;
use std::path::Path;

use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
use winreg::RegKey;

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

fn open_run_key(read_only: bool) -> Result<RegKey, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let flags = if read_only { KEY_READ } else { KEY_READ | KEY_WRITE };
    hkcu.open_subkey_with_flags(RUN_KEY, flags)
        .map_err(|e| format!("打开注册表失败: {e}"))
}

fn current_exe_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {e}"))?;
    Ok(format!("\"{}\"", exe.to_string_lossy()))
}

fn split_command(cmd: &str) -> (String, String) {
    let s = cmd.trim();
    if s.starts_with('"') {
        let rest = &s[1..];
        if let Some(end) = rest.find('"') {
            let exe = rest[..end].to_string();
            let args = rest[end + 1..].trim().to_string();
            return (exe, args);
        }
    }

    if let Some(idx) = s.find(char::is_whitespace) {
        let exe = s[..idx].to_string();
        let args = s[idx..].trim().to_string();
        return (exe, args);
    }

    (s.to_string(), String::new())
}

fn should_rewrite_to_current_exe(existing_exe: &str) -> bool {
    if existing_exe.trim().is_empty() {
        return false;
    }
    if !Path::new(existing_exe).exists() {
        return true;
    }
    let lower = existing_exe.to_ascii_lowercase();
    lower.contains("\\target\\debug\\")
        || lower.contains("/target/debug/")
        || lower.contains("\\target\\release\\")
        || lower.contains("/target/release/")
}

pub fn ensure_enabled_points_to_current_exe(value_name: &str) -> Result<(), String> {
    let key = open_run_key(false)?;
    let Ok(existing) = key.get_value::<String, _>(value_name) else {
        return Ok(());
    };

    let (existing_exe, existing_args) = split_command(&existing);
    if !should_rewrite_to_current_exe(&existing_exe) {
        return Ok(());
    }

    let current_exe = std::env::current_exe()
        .map_err(|e| format!("获取程序路径失败: {e}"))?
        .to_string_lossy()
        .to_string();
    if existing_exe.eq_ignore_ascii_case(&current_exe) {
        return Ok(());
    }

    let next = if existing_args.is_empty() {
        format!("\"{}\"", current_exe)
    } else {
        format!("\"{}\" {}", current_exe, existing_args)
    };
    key.set_value(value_name, &next)
        .map_err(|e| format!("写入自启注册表项失败: {e}"))?;

    Ok(())
}

pub fn is_enabled(value_name: &str) -> bool {
    let Ok(key) = open_run_key(true) else {
        return false;
    };
    key.get_raw_value(value_name).is_ok()
}

pub fn set_enabled(value_name: &str, enabled: bool) -> Result<bool, String> {
    let key = open_run_key(false)?;

    if enabled {
        let cmd = current_exe_command()?;
        key.set_value(value_name, &cmd)
            .map_err(|e| format!("写入自启注册表项失败: {e}"))?;
    } else {
        match key.delete_value(value_name) {
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("删除自启注册表项失败: {e}")),
        }
    }

    Ok(is_enabled(value_name))
}

