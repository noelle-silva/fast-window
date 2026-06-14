use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostCapabilityConfig {
    pub(crate) url: String,
    pub(crate) token: String,
}

#[tauri::command]
pub(crate) fn get_host_capability_config() -> Result<HostCapabilityConfig, String> {
    let url = std::env::var("FW_HOST_CAPABILITY_URL")
        .map_err(|_| "环境变量 FW_HOST_CAPABILITY_URL 未设置".to_string())?;
    let token = std::env::var("FW_HOST_CAPABILITY_TOKEN")
        .map_err(|_| "环境变量 FW_HOST_CAPABILITY_TOKEN 未设置".to_string())?;
    Ok(HostCapabilityConfig { url, token })
}
