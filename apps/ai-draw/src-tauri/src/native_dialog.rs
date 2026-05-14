use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::Manager;

static NATIVE_DIALOG_DEPTH: AtomicUsize = AtomicUsize::new(0);

struct NativeDialogGuard {
    _private: (),
}

impl Drop for NativeDialogGuard {
    fn drop(&mut self) {
        NATIVE_DIALOG_DEPTH
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |depth| {
                depth.checked_sub(1)
            })
            .expect("native dialog depth underflow");
    }
}

pub(crate) fn has_native_dialog() -> bool {
    NATIVE_DIALOG_DEPTH.load(Ordering::SeqCst) > 0
}

fn enter_native_dialog() -> NativeDialogGuard {
    NATIVE_DIALOG_DEPTH.fetch_add(1, Ordering::SeqCst);
    NativeDialogGuard { _private: () }
}

pub(crate) fn main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())
}

pub(crate) fn run_file_dialog<T>(
    app: &tauri::AppHandle,
    run: impl FnOnce(rfd::FileDialog) -> T,
) -> Result<T, String> {
    let window = main_window(app)?;
    let _native_dialog = enter_native_dialog();
    Ok(run(rfd::FileDialog::new().set_parent(&window)))
}
