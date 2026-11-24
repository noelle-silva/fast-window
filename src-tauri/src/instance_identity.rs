use std::env;
use std::path::{Path, PathBuf};

const HOST_SUFFIX_ENV: &str = "FAST_WINDOW_INSTANCE_SUFFIX";
const CF_SUFFIX_ENV: &str = "EUCLI_CF_INSTANCE_SUFFIX";
const HOST_DATA_DIR_ENV: &str = "FAST_WINDOW_DATA_DIR";
const CF_DATA_ROOT_ENV: &str = "EUCLI_CF_DATA_ROOT";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct IsolatedInstance {
    pub(crate) suffix: String,
    pub(crate) data_root: PathBuf,
}

pub(crate) fn resolve_isolated_instance() -> Result<Option<IsolatedInstance>, String> {
    let raw_suffix = read_first_env(&[HOST_SUFFIX_ENV, CF_SUFFIX_ENV]);
    let raw_data_dir = read_first_env(&[HOST_DATA_DIR_ENV, CF_DATA_ROOT_ENV]);
    resolve_isolated_instance_from_values(raw_suffix.as_deref(), raw_data_dir.as_deref())
}

pub(crate) fn init_isolated_environment() -> Result<Option<IsolatedInstance>, String> {
    let Some(isolated) = resolve_isolated_instance()? else {
        return Ok(None);
    };
    if env::var_os(HOST_DATA_DIR_ENV).is_none() {
        env::set_var(HOST_DATA_DIR_ENV, &isolated.data_root);
    }
    if env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        let webview_dir = isolated.data_root.join("webview2");
        let _ = std::fs::create_dir_all(&webview_dir);
        env::set_var("WEBVIEW2_USER_DATA_FOLDER", webview_dir);
    }
    Ok(Some(isolated))
}

pub(crate) fn write_ready_marker(isolated: &IsolatedInstance) -> Result<(), String> {
    let path = ready_marker_path(&isolated.data_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建隔离宿主目录失败: {e}"))?;
    }
    let payload = serde_json::json!({
        "status": "ready",
        "pid": std::process::id(),
        "suffix": isolated.suffix,
        "dataRoot": isolated.data_root.display().to_string(),
    });
    std::fs::write(&path, format!("{payload}\n"))
        .map_err(|e| format!("写入隔离宿主就绪标记失败: {e}"))
}

pub(crate) fn ready_marker_path(data_root: &Path) -> PathBuf {
    data_root.join("host-ready.json")
}

fn read_first_env(keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Ok(value) = env::var(key) {
            return Some(value);
        }
    }
    None
}

fn resolve_isolated_instance_from_values(
    raw_suffix: Option<&str>,
    raw_data_dir: Option<&str>,
) -> Result<Option<IsolatedInstance>, String> {
    let Some(raw) = raw_suffix else {
        return Ok(None);
    };
    let suffix = raw.trim();
    if !is_valid_suffix(suffix) {
        return Err(format!(
            "注入的宿主实例身份后缀 {raw:?} 非法（仅允许字母/数字开头，且只含字母、数字、点、下划线、连字符），拒绝回退到正式身份"
        ));
    }
    let Some(raw_dir) = raw_data_dir.map(str::trim).filter(|v| !v.is_empty()) else {
        return Err("隔离宿主实例缺少绝对数据目录（FAST_WINDOW_DATA_DIR / EUCLI_CF_DATA_ROOT），拒绝回退到正式数据目录".to_string());
    };
    let data_root = PathBuf::from(raw_dir);
    if !data_root.is_absolute() {
        return Err(format!(
            "隔离宿主实例的数据目录 {raw_dir:?} 不是绝对路径，拒绝回退到正式数据目录"
        ));
    }
    Ok(Some(IsolatedInstance {
        suffix: suffix.to_string(),
        data_root,
    }))
}

fn is_valid_suffix(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_when_suffix_absent() {
        assert_eq!(resolve_isolated_instance_from_values(None, None).unwrap(), None);
    }

    #[test]
    fn rejects_invalid_suffix_without_fallback() {
        assert!(resolve_isolated_instance_from_values(Some(""), Some("C:\\tmp")).is_err());
        assert!(resolve_isolated_instance_from_values(Some("../prod"), Some("C:\\tmp")).is_err());
        assert!(resolve_isolated_instance_from_values(Some("bad suffix"), Some("C:\\tmp")).is_err());
    }

    #[test]
    fn rejects_missing_or_relative_data_dir_in_isolated_mode() {
        assert!(resolve_isolated_instance_from_values(Some("186-adapter"), None).is_err());
        assert!(resolve_isolated_instance_from_values(Some("186-adapter"), Some("relative")).is_err());
    }

    #[test]
    fn accepts_valid_isolated_instance() {
        let abs = std::env::temp_dir().join("fw-isolated-test");
        let got = resolve_isolated_instance_from_values(Some("186-adapter"), abs.to_str())
            .unwrap()
            .unwrap();
        assert_eq!(got.suffix, "186-adapter");
        assert_eq!(got.data_root, abs);
    }
}
