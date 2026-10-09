//! 外部链接防护。
//!
//! 目标状态（约束集 094）：
//! - 应用内任何导航都先经本模块判断；
//! - 同源白名单：目标与应用自身同源则放行；
//! - 内部协议（tauri / asset / data 等）一律放行；
//! - 外部协议（http / https / mailto / tel）且不同源，一律取消导航，改交系统浏览器打开；
//! - 判断失败默认放行，绝不误送内部。
//!
//! 以独立插件形态落地：插件级 `on_navigation` 能覆盖 `tauri.conf.json` 声明的窗口，
//! 注册即生效，不改变窗口创建方式。

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};

/// 导航目标的处置结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationTarget {
    /// 应用自身或内部资源，放行。
    Internal,
    /// 外部目标，取消导航并交系统浏览器打开。
    External,
}

/// 纯判定：窗口当前地址 `current` 与导航目标 `target`，判断目标是否属于外部。
///
/// 规则：
/// - `http` / `https`：与当前地址同源（scheme + host + port）则内部，否则外部；
/// - `mailto` / `tel`：外部（本就应由系统处理）；
/// - 其它协议（`tauri` / `asset` / `data` / `blob` / `about` 等）：内部，放行。
pub fn classify(current: &Url, target: &Url) -> NavigationTarget {
    match target.scheme() {
        "http" | "https" => {
            if same_origin(current, target) {
                NavigationTarget::Internal
            } else {
                NavigationTarget::External
            }
        }
        "mailto" | "tel" => NavigationTarget::External,
        _ => NavigationTarget::Internal,
    }
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// 结合窗口当前地址判定导航目标。
///
/// 当前地址缺失或非网页态（如 `about:blank` 初始加载）时默认放行，
/// 保证应用自身加载不会被误拦（约束 5）。
pub fn classify_navigation(current: Option<&Url>, target: &Url) -> NavigationTarget {
    match current {
        Some(current) if matches!(current.scheme(), "http" | "https") => classify(current, target),
        _ => NavigationTarget::Internal,
    }
}

/// 外部链接的统一出口：交系统默认浏览器打开。
///
/// 前端点击拦截与导航兜底共用此出口。
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let target = url.trim();
    if target.is_empty() {
        return Err("url 不能为空".to_string());
    }
    open::that(target).map_err(|error| format!("打开外部链接失败: {error}"))
}

/// 外部链接防护插件：拦截窗口导航，外部目标取消导航并交系统浏览器打开。
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("external-link-guard")
        .on_navigation(|webview, url| {
            let current = webview.url().ok();
            let decision = classify_navigation(current.as_ref(), url);
            match decision {
                NavigationTarget::External => {
                    let _ = open::that(url.as_str());
                    false
                }
                NavigationTarget::Internal => true,
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> Url {
        Url::parse(raw).expect("测试地址应可解析")
    }

    #[test]
    fn same_origin_http_is_internal() {
        let current = url("http://tauri.localhost/index.html");
        assert_eq!(
            classify(&current, &url("http://tauri.localhost/settings")),
            NavigationTarget::Internal
        );
    }

    #[test]
    fn dev_origin_same_host_and_port_is_internal() {
        let current = url("http://127.0.0.1:1432/");
        assert_eq!(
            classify(&current, &url("http://127.0.0.1:1432/note/1")),
            NavigationTarget::Internal
        );
    }

    #[test]
    fn cross_origin_http_is_external() {
        let current = url("http://tauri.localhost/index.html");
        assert_eq!(
            classify(&current, &url("https://example.com/a")),
            NavigationTarget::External
        );
    }

    #[test]
    fn different_port_is_external() {
        let current = url("http://127.0.0.1:1432/");
        assert_eq!(
            classify(&current, &url("http://127.0.0.1:9999/")),
            NavigationTarget::External
        );
    }

    #[test]
    fn different_scheme_same_host_is_external() {
        let current = url("http://tauri.localhost/");
        assert_eq!(
            classify(&current, &url("https://tauri.localhost/")),
            NavigationTarget::External
        );
    }

    #[test]
    fn mailto_and_tel_are_external() {
        let current = url("http://tauri.localhost/");
        assert_eq!(
            classify(&current, &url("mailto:someone@example.com")),
            NavigationTarget::External
        );
        assert_eq!(
            classify(&current, &url("tel:+8613800000000")),
            NavigationTarget::External
        );
    }

    #[test]
    fn internal_schemes_are_internal() {
        let current = url("http://tauri.localhost/");
        for raw in [
            "tauri://localhost/a",
            "asset://localhost/b.png",
            "data:text/plain,hi",
            "about:blank",
        ] {
            assert_eq!(
                classify(&current, &url(raw)),
                NavigationTarget::Internal,
                "{raw}"
            );
        }
    }

    #[test]
    fn anchor_navigation_stays_internal() {
        let current = url("http://tauri.localhost/note/1");
        assert_eq!(
            classify(&current, &url("http://tauri.localhost/note/1#section")),
            NavigationTarget::Internal
        );
    }

    #[test]
    fn missing_current_is_internal() {
        let target = url("http://127.0.0.1:1432/");
        assert_eq!(
            classify_navigation(None, &target),
            NavigationTarget::Internal
        );
    }

    #[test]
    fn about_blank_current_is_internal() {
        let current = url("about:blank");
        let target = url("https://example.com/");
        assert_eq!(
            classify_navigation(Some(&current), &target),
            NavigationTarget::Internal
        );
    }
}
