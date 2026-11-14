use serde::{Deserialize, Serialize};

use crate::dev_terminal::{host_workspace_root, run_dev_terminal_command, DevTerminalCommandSpec};

const HOST_PUBLISH_SCRIPT: &str = "scripts/publish-host-msi.mjs";

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum HostDevTerminalCommandRequest {
    Publish { version: HostPublishVersionRequest },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum HostPublishVersionRequest {
    Bump { bump: HostReleaseBump },
    Version { version: String },
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HostReleaseBump {
    Patch,
    Minor,
    Major,
}

impl HostReleaseBump {
    fn as_arg(self) -> &'static str {
        match self {
            Self::Patch => "patch",
            Self::Minor => "minor",
            Self::Major => "major",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostDevTerminalCommandResult {
    command: Vec<String>,
}

#[tauri::command]
pub(crate) async fn host_dev_run_terminal_command(
    request: HostDevTerminalCommandRequest,
) -> Result<HostDevTerminalCommandResult, String> {
    crate::dev_profile::ensure_dev_profile()?;
    let workspace_root = host_workspace_root(&[HOST_PUBLISH_SCRIPT])?;
    let spec = request.to_spec()?;
    run_dev_terminal_command(&workspace_root, &spec).await?;
    Ok(HostDevTerminalCommandResult {
        command: spec.command_preview(),
    })
}

impl HostDevTerminalCommandRequest {
    fn to_spec(&self) -> Result<DevTerminalCommandSpec, String> {
        match self {
            Self::Publish { version } => host_publish_spec(version),
        }
    }
}

fn host_publish_spec(
    version: &HostPublishVersionRequest,
) -> Result<DevTerminalCommandSpec, String> {
    let mut args = vec!["host:publish".to_string(), "--".to_string()];
    let description = match version {
        HostPublishVersionRequest::Bump { bump } => {
            let bump = bump.as_arg();
            args.push("--bump".to_string());
            args.push(bump.to_string());
            format!("publish host release ({bump})")
        }
        HostPublishVersionRequest::Version { version } => {
            let version = normalize_host_release_version(version)?;
            args.push("--version".to_string());
            args.push(version.clone());
            format!("publish host release ({version})")
        }
    };

    Ok(DevTerminalCommandSpec {
        title: format!("Fast Window Host Publish - {description}"),
        description,
        args,
    })
}

fn normalize_host_release_version(version: &str) -> Result<String, String> {
    let version = version.trim();
    if version.is_empty() {
        return Err("版本号不能为空".to_string());
    }
    let mut parts = version.split('.');
    let Some(major) = parts.next() else {
        return Err("版本号必须是 x.y.z".to_string());
    };
    let Some(minor) = parts.next() else {
        return Err("版本号必须是 x.y.z".to_string());
    };
    let Some(patch) = parts.next() else {
        return Err("版本号必须是 x.y.z".to_string());
    };
    if parts.next().is_some() {
        return Err("版本号必须是 x.y.z".to_string());
    }
    for part in [major, minor, patch] {
        if part.is_empty() || part.len() > 8 || !part.chars().all(|c| c.is_ascii_digit()) {
            return Err("版本号必须是 x.y.z".to_string());
        }
    }
    Ok(version.to_string())
}
