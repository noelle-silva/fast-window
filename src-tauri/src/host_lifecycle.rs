use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::app_lifecycle::{stop_all_running_apps, AppLifecycleManager};
use crate::windowing::{
    persist_browser_window_bounds, persist_main_window_bounds, save_bounds_if_valid,
    save_browser_stack_bounds_if_valid, BrowserWindowState, WindowState,
};

#[derive(Default)]
pub(crate) struct HostLifecycleState {
    shutting_down: AtomicBool,
}

impl HostLifecycleState {
    pub(crate) fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::Acquire)
    }

    fn begin_shutdown(&self) -> bool {
        self.shutting_down
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
}

pub(crate) fn request_host_shutdown(app: AppHandle) {
    let state = app.state::<Arc<HostLifecycleState>>().inner().clone();
    if !state.begin_shutdown() {
        return;
    }

    persist_host_window_state(&app);
    tauri::async_runtime::spawn(async move {
        stop_host_managed_apps(&app).await;
        app.exit(0);
    });
}

pub(crate) fn host_shutdown_in_progress(app: &AppHandle) -> bool {
    app.state::<Arc<HostLifecycleState>>()
        .inner()
        .is_shutting_down()
}

fn persist_host_window_state(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<WindowState>();
        save_bounds_if_valid(&window, &state);
        persist_main_window_bounds(app, &state);
    }

    save_browser_stack_bounds_if_valid(app);
    let browser_state = app.state::<BrowserWindowState>();
    persist_browser_window_bounds(app, &browser_state);
}

async fn stop_host_managed_apps(app: &AppHandle) {
    let launcher = app.state::<Arc<AppLifecycleManager>>().inner().clone();
    for (app_id, result) in stop_all_running_apps(&launcher).await {
        if let Err(error) = result {
            eprintln!("[host-lifecycle] failed to stop registered app {app_id}: {error}");
        }
    }
}
