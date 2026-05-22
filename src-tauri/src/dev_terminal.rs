use std::path::{Path, PathBuf};
use tokio::process::Command;

#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

pub(crate) struct DevTerminalCommandSpec {
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) args: Vec<String>,
}

impl DevTerminalCommandSpec {
    pub(crate) fn command_preview(&self) -> Vec<String> {
        let mut command = vec!["pnpm".to_string(), "run".to_string()];
        command.extend(self.args.clone());
        command
    }
}

pub(crate) fn host_workspace_root(required_scripts: &[&str]) -> Result<PathBuf, String> {
    let tauri_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let Some(root) = tauri_dir.parent() else {
        return Err("无法定位宿主仓库根目录".to_string());
    };
    let root = root.to_path_buf();
    for script in required_scripts {
        let script_path = root.join(script);
        if !script_path.is_file() {
            return Err(format!(
                "无法定位 dev 终端命令脚本: {}",
                script_path.display()
            ));
        }
    }
    Ok(root)
}

pub(crate) async fn run_dev_terminal_command(
    workspace_root: &Path,
    spec: &DevTerminalCommandSpec,
) -> Result<(), String> {
    let mut command = dev_terminal_command(workspace_root, spec)?;
    let status = command
        .status()
        .await
        .map_err(|error| format!("启动 dev 终端命令失败: {error}"))?;

    if !status.success() {
        return Err(format!("dev 终端命令失败，退出码: {status}"));
    }

    Ok(())
}

#[cfg(windows)]
fn dev_terminal_command(
    workspace_root: &Path,
    spec: &DevTerminalCommandSpec,
) -> Result<Command, String> {
    let command_text = cmd_display_command(spec);
    let command_args = cmd_command_args(spec);
    let script = format!(
        "title {} && \
         echo [fast-window] {} && \
         echo [fast-window] command: {} && \
         echo. && \
         call pnpm.cmd {} & \
         set \"FW_EXIT_CODE=!ERRORLEVEL!\" & \
         echo. & \
         if !FW_EXIT_CODE! EQU 0 (echo [fast-window] command completed.) else (echo [fast-window] command failed with exit code !FW_EXIT_CODE!.) & \
         echo [fast-window] window will close in 5 seconds... & \
         timeout /t 5 /nobreak >nul & \
         exit /b !FW_EXIT_CODE!",
        cmd_quote(&spec.title),
        spec.description,
        command_text,
        command_args,
    );

    let mut command = Command::new("cmd.exe");
    command
        .current_dir(workspace_root)
        .creation_flags(CREATE_NEW_CONSOLE)
        .arg("/d")
        .arg("/s")
        .arg("/v:on")
        .arg("/c")
        .arg(script);
    Ok(command)
}

#[cfg(not(windows))]
fn dev_terminal_command(
    _workspace_root: &Path,
    _spec: &DevTerminalCommandSpec,
) -> Result<Command, String> {
    Err("当前平台暂不支持可视化 dev 终端命令".to_string())
}

#[cfg(windows)]
fn cmd_display_command(spec: &DevTerminalCommandSpec) -> String {
    spec.command_preview()
        .into_iter()
        .map(|arg| cmd_quote(&arg))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(windows)]
fn cmd_command_args(spec: &DevTerminalCommandSpec) -> String {
    let mut args = vec!["run".to_string()];
    args.extend(spec.args.clone());
    args.into_iter()
        .map(|arg| cmd_quote(&arg))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(windows)]
fn cmd_quote(value: &str) -> String {
    if value.is_empty() {
        return "\"\"".to_string();
    }
    if !value
        .chars()
        .any(|c| matches!(c, ' ' | '"' | '^' | '&' | '|' | '<' | '>' | '%'))
    {
        return value.to_string();
    }
    let escaped = value
        .replace('%', "%%")
        .replace('^', "^^")
        .replace('"', "^\"");
    format!("\"{escaped}\"")
}
