use std::path::PathBuf;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) mod server;

pub(crate) const DEV_CONSOLE_WINDOW_LABEL: &str = "dev-console";
const DEV_CONSOLE_URL: &str = "index.html";

/// Dev 控制台独占一份 WebView2 环境。
///
/// WebView2 在同一个 user data folder 上只认一份浏览器参数：主窗口带着远程调试端口，
/// 新窗口若共用目录却参数不同，环境创建会失败。因此这里给它独立的 data directory
/// 与独立的调试端口，两边互不干扰。
#[cfg(windows)]
const DEV_CONSOLE_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=10066";

#[tauri::command]
pub(crate) fn dev_console_open(app: AppHandle) -> Result<(), String> {
    crate::dev_profile::ensure_dev_profile()?;
    ensure_window(&app)
}

#[tauri::command]
pub(crate) fn dev_console_server_status() -> Option<server::DevConsoleServerStatus> {
    server::status().cloned()
}

/// 启动阶段先把窗口建好并藏起来。
///
/// Windows 上 WebView2 的窗口创建要占用主线程消息泵；在命令调用栈里同步建窗会互相等待，
/// 命令永远不返回。放到 setup 阶段建（和主窗口同一时机），打开动作就只剩显示与聚焦。
pub(crate) fn prewarm_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(DEV_CONSOLE_WINDOW_LABEL).is_some() {
        return Ok(());
    }
    build_window(app).map(|_| ())
}

fn ensure_window(app: &AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window(DEV_CONSOLE_WINDOW_LABEL) {
        Some(window) => window,
        None => build_window(app)?,
    };

    let _ = window.unminimize();
    window
        .show()
        .map_err(|error| format!("显示 Dev 控制台失败: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("聚焦 Dev 控制台失败: {error}"))?;
    Ok(())
}

fn build_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let builder = WebviewWindowBuilder::new(app, DEV_CONSOLE_WINDOW_LABEL, dev_console_url(app))
        .title("Fast Window-dev · 控制台")
        .inner_size(820.0, 620.0)
        .min_inner_size(560.0, 400.0)
        .resizable(true)
        .center()
        .visible(false)
        .focused(false);

    #[cfg(windows)]
    let builder = if crate::dev_profile::is_dev_profile() {
        builder
            .additional_browser_args(DEV_CONSOLE_BROWSER_ARGS)
            .data_directory(dev_console_data_directory(app))
    } else {
        builder
    };

    let window = builder
        .build()
        .map_err(|error| format!("创建 Dev 控制台失败: {error}"))?;
    window
        .hide()
        .map_err(|error| format!("隐藏 Dev 控制台失败: {error}"))?;

    Ok(window)
}

/// 开发模式直接用配置里的 devUrl 拼页面地址。
///
/// `WebviewUrl::App` 在这种「同产物多窗口」场景下会把相对路径拼成不可导航的地址，
/// webview 停在 about:blank。显式取 devUrl 只替换路径，地址是确定的，
/// 生产构建没有 devUrl，才回落到产物内的相对页面。
fn dev_console_url(app: &AppHandle) -> WebviewUrl {
    match app.config().build.dev_url.clone() {
        Some(mut url) => {
            url.set_path("/index.html");
            WebviewUrl::External(url)
        }
        None => WebviewUrl::App(PathBuf::from(DEV_CONSOLE_URL)),
    }
}

#[cfg(windows)]
fn dev_console_data_directory(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("webview-dev-console"))
        .unwrap_or_else(|_| std::env::temp_dir().join("fast-window-dev-console-webview"))
}
