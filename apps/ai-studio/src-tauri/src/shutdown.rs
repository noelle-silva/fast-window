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
        }
    }

    pub(crate) fn shutdown(&self, app: tauri::AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            report_current_window_bounds(&window, &self.window);
        }
        self.backend.stop_sync();
        single_instance::remove_current_instance_state(&self.desktop_identifier);
        app.exit(0);
    }
}
