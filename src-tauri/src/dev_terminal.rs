use std::path::{Path, PathBuf};
use tokio::process::Command;

// CREATE_NO_WINDOW 让宿主启动的外层进程保持隐藏：可见窗口由脚本用 start 自己创建。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// DEV_TERMINAL_HOLD_SECONDS 是命令结束后 dev 终端窗口停留的秒数。
#[cfg(windows)]
const DEV_TERMINAL_HOLD_SECONDS: u32 = 5;

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
    let (mut command, script_path) = dev_terminal_command(workspace_root, spec)?;
    let status = command.status().await;
    let _ = std::fs::remove_file(&script_path);
    let status = status.map_err(|error| format!("启动 dev 终端命令失败: {error}"))?;

    if !status.success() {
        return Err(format!("dev 终端命令失败，退出码: {status}"));
    }

    Ok(())
}

#[cfg(windows)]
fn dev_terminal_command(
    workspace_root: &Path,
    spec: &DevTerminalCommandSpec,
) -> Result<(Command, PathBuf), String> {
    let script_path = write_dev_terminal_script(spec)?;
    let mut command = Command::new("cmd.exe");
    command
        .current_dir(workspace_root)
        .creation_flags(CREATE_NO_WINDOW)
        .arg("/d")
        .arg("/s")
        .arg("/c")
        // 路径按原文交给 cmd（call + 引号）：常规参数传递会把引号转义成 cmd 不认识的 \"，
        // 破坏解析；call 前缀同时避开 /s 对首个引号的剥离规则，带空格的路径也能正确执行。
        .raw_arg(format!("call {}", cmd_quote(&script_path.to_string_lossy())));
    Ok((command, script_path))
}

#[cfg(not(windows))]
fn dev_terminal_command(
    _workspace_root: &Path,
    _spec: &DevTerminalCommandSpec,
) -> Result<(Command, PathBuf), String> {
    Err("当前平台暂不支持可视化 dev 终端命令".to_string())
}

// write_dev_terminal_script 把命令写成临时批处理脚本：批处理自带清晰的语句结构，
// 避免把整段逻辑压进一条命令行时的引号与转义陷阱。
#[cfg(windows)]
fn write_dev_terminal_script(spec: &DevTerminalCommandSpec) -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let script_path = std::env::temp_dir().join(format!(
        "fast-window-dev-terminal-{}-{stamp}.bat",
        std::process::id()
    ));
    std::fs::write(&script_path, dev_terminal_script(spec))
        .map_err(|error| format!("写入 dev 终端脚本失败: {error}"))?;
    Ok(script_path)
}

// dev_terminal_script 生成的脚本有两种角色：
// 宿主以隐藏进程启动它时，它用 start 把真正的命令放进一个独立可见控制台再执行，
// 并把那次运行的退出码带回来；独立控制台里的那次运行负责输出进度、结果与停留。
// 这样窗口的输出由窗口自己的控制台承载，宿主启动环境的重定向句柄不会影响显示；
// 结束后用 ping 等待（timeout 需要读取控制台输入），任何场景都能稳定停留。
#[cfg(windows)]
fn dev_terminal_script(spec: &DevTerminalCommandSpec) -> String {
    let command_text = cmd_display_command(spec);
    let command_args = cmd_command_args(spec);
    format!(
        "@echo off\r\n\
         if \"%~1\"==\"run\" goto run\r\n\
         start \"\" /wait cmd.exe /d /s /c call \"%~f0\" run\r\n\
         exit /b %ERRORLEVEL%\r\n\
         \r\n\
         :run\r\n\
         title {}\r\n\
         echo [fast-window] {}\r\n\
         echo [fast-window] command: {}\r\n\
         echo.\r\n\
         call pnpm.cmd {}\r\n\
         set \"FW_EXIT_CODE=%ERRORLEVEL%\"\r\n\
         echo.\r\n\
         if %FW_EXIT_CODE% EQU 0 (echo [fast-window] command completed.) else (echo [fast-window] command failed with exit code %FW_EXIT_CODE%.)\r\n\
         echo [fast-window] window will close in {} seconds...\r\n\
         ping -n {} 127.0.0.1 >nul\r\n\
         exit /b %FW_EXIT_CODE%\r\n",
        spec.title,
        spec.description,
        command_text,
        command_args,
        DEV_TERMINAL_HOLD_SECONDS,
        DEV_TERMINAL_HOLD_SECONDS + 1,
    )
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
