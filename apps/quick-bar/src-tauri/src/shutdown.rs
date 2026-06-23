use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::Manager;

use crate::fw_window::{report_current_window_bounds, FwWindowState};
use crate::single_instance;

#[derive(Clone)]
pub(crate) struct ShutdownState {
    window: Arc<FwWindowState>,
    desktop_identifier: Arc<String>,
    shutting_down: Arc<AtomicBool>,
}

impl ShutdownState {
    pub(crate) fn new(window: Arc<FwWindowState>, desktop_identifier: String) -> Self {
        Self {
            window,
            desktop_identifier: Arc::new(desktop_identifier),
            shutting_down: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::Acquire)
    }

    pub(crate) fn shutdown(&self, app: tauri::AppHandle) {
        if self.shutting_down.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Some(window) = app.get_webview_window("main") {
            report_current_window_bounds(&window, &self.window);
        }
        single_instance::remove_current_instance_state(&self.desktop_identifier);
        app.exit(0);
    }
}
