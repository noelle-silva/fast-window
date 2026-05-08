use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::Manager;

use crate::backend_sidecar::BackendState;
use crate::fw_window::{report_current_window_bounds, FwWindowState};
use crate::single_instance;

#[derive(Clone)]
pub(crate) struct ShutdownState {
    backend: Arc<BackendState>,
    window: Arc<FwWindowState>,
    desktop_identifier: Arc<String>,
    shutting_down: Arc<AtomicBool>,
}

impl ShutdownState {
    pub(crate) fn new(
        backend: Arc<BackendState>,
        window: Arc<FwWindowState>,
        desktop_identifier: String,
    ) -> Self {
        Self {
            backend,
            window,
            desktop_identifier: Arc::new(desktop_identifier),
            shutting_down: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
    }

    pub(crate) fn shutdown(&self, app: tauri::AppHandle) {
        if self.shutting_down.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(window) = app.get_webview_window("main") {
            report_current_window_bounds(&window, &self.window);
        }
        self.backend.stop_sync();
        single_instance::remove_current_instance_state(&self.desktop_identifier);
        app.exit(0);
    }
}
