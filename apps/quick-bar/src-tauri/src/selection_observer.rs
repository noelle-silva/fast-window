use std::sync::Arc;

use crate::{toolbar_display::ToolbarDisplayModeState, toolbar_window::ToolbarState};

pub(crate) fn install(
    app: tauri::AppHandle,
    toolbar_state: Arc<ToolbarState>,
    display_mode_state: Arc<ToolbarDisplayModeState>,
) {
    #[cfg(target_os = "windows")]
    {
        if let Err(error) = std::thread::Builder::new()
            .name("quick-bar-selection-observer".to_string())
            .spawn(move || windows_observer::run(app, toolbar_state, display_mode_state))
        {
            eprintln!("[quick-bar] 启动选区观察失败: {error}");
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = toolbar_state;
        let _ = display_mode_state;
    }
}

#[cfg(target_os = "windows")]
mod windows_observer {
    use std::{sync::Arc, time::Duration};

    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

    use crate::{
        selection_capture::{capture_current_selection, SelectionCapture},
        toolbar_display::{ToolbarDisplayMode, ToolbarDisplayModeState},
        toolbar_window::{self, ToolbarState},
    };

    const POLL_INTERVAL: Duration = Duration::from_millis(40);
    const CAPTURE_DELAY: Duration = Duration::from_millis(80);
    const VK_LBUTTON: i32 = 0x01;
    const VK_CONTROL: i32 = 0x11;
    const VK_C: i32 = 0x43;

    #[derive(Clone, PartialEq, Eq)]
    struct SelectionSignature {
        text: String,
        anchor_x: i32,
        anchor_y: i32,
    }

    impl SelectionSignature {
        fn from_capture(capture: &SelectionCapture) -> Self {
            Self {
                text: capture.text.clone(),
                anchor_x: capture.anchor_x,
                anchor_y: capture.anchor_y,
            }
        }
    }

    struct SelectionInputState {
        left_pressed: bool,
        ctrl_c_pressed: bool,
    }

    impl SelectionInputState {
        fn new() -> Self {
            Self {
                left_pressed: is_key_pressed(VK_LBUTTON),
                ctrl_c_pressed: is_ctrl_c_pressed(),
            }
        }

        fn poll_capture_signal(&mut self) -> bool {
            let next_left_pressed = is_key_pressed(VK_LBUTTON);
            let next_ctrl_c_pressed = is_ctrl_c_pressed();
            let mouse_released = self.left_pressed && !next_left_pressed;
            let copy_released = self.ctrl_c_pressed && !next_ctrl_c_pressed;
            self.left_pressed = next_left_pressed;
            self.ctrl_c_pressed = next_ctrl_c_pressed;
            mouse_released || copy_released
        }
    }

    pub(super) fn run(
        app: tauri::AppHandle,
        toolbar_state: Arc<ToolbarState>,
        display_mode_state: Arc<ToolbarDisplayModeState>,
    ) {
        let mut input = SelectionInputState::new();
        let mut last_signature = None;
        loop {
            if input.poll_capture_signal() {
                std::thread::sleep(CAPTURE_DELAY);
                match capture_selection() {
                    Some(capture) => {
                        let signature = SelectionSignature::from_capture(&capture);
                        if last_signature.as_ref() != Some(&signature) {
                            last_signature = Some(signature);
                            if let Err(error) =
                                toolbar_window::remember_selection(&toolbar_state, capture.clone())
                            {
                                eprintln!("[quick-bar] 记录最近选区失败: {error}");
                            } else if display_mode_state.mode() == ToolbarDisplayMode::Automatic {
                                if let Err(error) = toolbar_window::show_toolbar_from_capture(
                                    &app,
                                    &toolbar_state,
                                    capture,
                                ) {
                                    eprintln!("[quick-bar] 自动显示浮动条失败: {error}");
                                }
                            }
                        }
                    }
                    None if !toolbar_window::toolbar_visible(&app) => {
                        last_signature = None;
                        if let Err(error) = toolbar_state.clear_payload() {
                            eprintln!("[quick-bar] 清理最近选区失败: {error}");
                        }
                    }
                    None => {}
                }
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    }

    fn capture_selection() -> Option<SelectionCapture> {
        capture_current_selection().ok()
    }

    fn is_ctrl_c_pressed() -> bool {
        is_key_pressed(VK_CONTROL) && is_key_pressed(VK_C)
    }

    fn is_key_pressed(vk: i32) -> bool {
        unsafe { (GetAsyncKeyState(vk) as i32 & 0x8000) != 0 }
    }
}
