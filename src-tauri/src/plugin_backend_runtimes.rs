use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const VERSION_CHECK_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PluginBackendRuntimeKind {
    Bundled,
    Direct,
}

#[derive(Clone, Copy, Debug)]
struct PluginBackendRuntimeSpec {
    id: &'static str,
    kind: PluginBackendRuntimeKind,
    exe_name: &'static str,
    script_prefix_args: &'static [&'static str],
    version_arg: Option<&'static str>,
    extensions: &'static [&'static str],
}

#[derive(Debug)]
pub(crate) struct PluginBackendCommandSpec {
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
}

const NODE_EXTENSIONS: &[&str] = &["js", "mjs", "cjs"];
const PYTHON_EXTENSIONS: &[&str] = &["py"];
const DENO_EXTENSIONS: &[&str] = &["ts"];
const DIRECT_EXTENSIONS: &[&str] = &["exe"];
const NO_PREFIX_ARGS: &[&str] = &[];
const PYTHON_PREFIX_ARGS: &[&str] = &["-u"];
const DENO_PREFIX_ARGS: &[&str] = &["run", "--allow-all"];
const BUN_PREFIX_ARGS: &[&str] = &["run"];

const RUNTIME_REGISTRY: &[PluginBackendRuntimeSpec] = &[
    PluginBackendRuntimeSpec {
        id: "node",
        kind: PluginBackendRuntimeKind::Bundled,
        exe_name: "node",
        script_prefix_args: NO_PREFIX_ARGS,
        version_arg: Some("--version"),
        extensions: NODE_EXTENSIONS,
    },
    PluginBackendRuntimeSpec {
        id: "python",
        kind: PluginBackendRuntimeKind::Bundled,
        exe_name: "python",
        script_prefix_args: PYTHON_PREFIX_ARGS,
        version_arg: Some("--version"),
        extensions: PYTHON_EXTENSIONS,
    },
    PluginBackendRuntimeSpec {
        id: "deno",
        kind: PluginBackendRuntimeKind::Bundled,
        exe_name: "deno",
        script_prefix_args: DENO_PREFIX_ARGS,
        version_arg: Some("--version"),
        extensions: DENO_EXTENSIONS,
    },
    PluginBackendRuntimeSpec {
        id: "bun",
        kind: PluginBackendRuntimeKind::Bundled,
        exe_name: "bun",
        script_prefix_args: BUN_PREFIX_ARGS,
        version_arg: Some("--version"),
        extensions: &[],
    },
    PluginBackendRuntimeSpec {
        id: "direct",
        kind: PluginBackendRuntimeKind::Direct,
        exe_name: "",
        script_prefix_args: NO_PREFIX_ARGS,
        version_arg: None,
        extensions: DIRECT_EXTENSIONS,
    },
];

fn platform_exe_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn runtime_by_id(id: &str) -> Option<&'static PluginBackendRuntimeSpec> {
    let normalized = id.trim().to_ascii_lowercase();
    RUNTIME_REGISTRY
        .iter()
        .find(|runtime| runtime.id == normalized)
}

pub(crate) fn is_supported_backend_runtime(id: &str) -> bool {
    runtime_by_id(id).is_some()
}

pub(crate) fn supported_backend_runtime_label() -> String {
    RUNTIME_REGISTRY
        .iter()
        .map(|runtime| runtime.id)
        .collect::<Vec<_>>()
        .join("/")
}

fn runtime_by_extension(ext: &str) -> Option<&'static PluginBackendRuntimeSpec> {
    RUNTIME_REGISTRY
        .iter()
        .find(|runtime| runtime.extensions.iter().any(|candidate| *candidate == ext))
}

fn resolve_runtime(app: &AppHandle, runtime: &PluginBackendRuntimeSpec) -> Result<PathBuf, String> {
    let exe_name = platform_exe_name(runtime.exe_name);
    let candidates = [
        app.path()
            .resource_dir()
            .ok()
            .map(|p| p.join("runtimes").join(runtime.id).join(&exe_name)),
        std::env::current_exe().ok().and_then(|p| {
            p.parent()
                .map(|d| d.join("runtimes").join(runtime.id).join(&exe_name))
        }),
        Some(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("runtimes")
                .join(runtime.id)
                .join(&exe_name),
        ),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.is_file() {
            ensure_executable(&candidate, &format!("宿主内置 {} runtime", runtime.id))?;
            ensure_runtime_version(&candidate, runtime)?;
            return Ok(candidate);
        }
    }

    Err(format!(
        "宿主内置 {} runtime 不存在：请随宿主分发 runtimes/{}/{}；不会回退到系统 {}",
        runtime.id, runtime.id, exe_name, runtime.id
    ))
}

fn ensure_runtime_version(path: &Path, runtime: &PluginBackendRuntimeSpec) -> Result<(), String> {
    let Some(version_arg) = runtime.version_arg else {
        return Ok(());
    };

    let mut child = std::process::Command::new(path)
        .arg(version_arg)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("宿主内置 {} runtime 无法执行版本检查: {e}", runtime.id))?;

    let deadline = Instant::now() + VERSION_CHECK_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    return Ok(());
                }
                return Err(format!(
                    "宿主内置 {} runtime 版本检查失败: {status}",
                    runtime.id
                ));
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("宿主内置 {} runtime 版本检查超时", runtime.id));
            }
            Err(e) => return Err(format!("宿主内置 {} runtime 版本检查失败: {e}", runtime.id)),
        }
    }
}

fn ensure_executable(path: &Path, label: &str) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("{label} 不是可执行文件"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .map_err(|e| format!("读取 {label} 权限失败: {e}"))?
            .permissions()
            .mode();
        if mode & 0o111 == 0 {
            return Err(format!("{label} 没有可执行权限"));
        }
    }

    #[cfg(windows)]
    {
        let ext = extension(path);
        if ext != "exe" {
            return Err(format!("{label} 必须是 .exe 文件"));
        }
    }

    Ok(())
}

fn build_script_args(runtime: &PluginBackendRuntimeSpec, main: &Path) -> Vec<String> {
    let mut args = runtime
        .script_prefix_args
        .iter()
        .map(|arg| (*arg).to_string())
        .collect::<Vec<_>>();
    args.push(main.to_string_lossy().to_string());
    args
}

fn resolve_direct(main: &Path) -> Result<PluginBackendCommandSpec, String> {
    ensure_executable(main, "插件自带后台入口")?;
    Ok(PluginBackendCommandSpec {
        command: main.to_string_lossy().to_string(),
        args: Vec::new(),
    })
}

pub(crate) fn command_for_backend_main(
    app: &AppHandle,
    main: &Path,
    declared_runtime: Option<&str>,
) -> Result<PluginBackendCommandSpec, String> {
    let ext = extension(main);
    let runtime = match declared_runtime.map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => runtime_by_id(id).ok_or_else(|| format!("background.runtime 不支持：{id}"))?,
        None => runtime_by_extension(&ext)
            .unwrap_or_else(|| runtime_by_id("direct").expect("direct runtime registered")),
    };

    if runtime.kind == PluginBackendRuntimeKind::Direct {
        return resolve_direct(main);
    }

    let command = resolve_runtime(app, runtime)?;
    Ok(PluginBackendCommandSpec {
        command: command.to_string_lossy().to_string(),
        args: build_script_args(runtime, main),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_python_with_unbuffered_stdio() {
        let runtime = runtime_by_id("python").expect("python runtime registered");
        let args = build_script_args(runtime, Path::new("backend/index.py"));
        assert_eq!(args, vec!["-u".to_string(), "backend/index.py".to_string()]);
    }

    #[test]
    fn builds_deno_with_run_command() {
        let runtime = runtime_by_id("deno").expect("deno runtime registered");
        let args = build_script_args(runtime, Path::new("backend/index.ts"));
        assert_eq!(
            args,
            vec![
                "run".to_string(),
                "--allow-all".to_string(),
                "backend/index.ts".to_string()
            ]
        );
    }

    #[test]
    fn maps_script_extensions_to_builtin_runtimes() {
        assert_eq!(
            runtime_by_extension("js").map(|runtime| runtime.id),
            Some("node")
        );
        assert_eq!(
            runtime_by_extension("py").map(|runtime| runtime.id),
            Some("python")
        );
        assert_eq!(
            runtime_by_extension("ts").map(|runtime| runtime.id),
            Some("deno")
        );
        assert_eq!(
            runtime_by_extension("exe").map(|runtime| runtime.id),
            Some("direct")
        );
    }
}
