use std::sync::Arc;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::fw_window::{show_wake_surface, FwArgs, FwWindowState};

pub(crate) fn install_standalone_tray(
    app: &tauri::App,
    args: &FwArgs,
    window_state: Arc<FwWindowState>,
    on_quit: Arc<dyn Fn(tauri::AppHandle) + Send + Sync>,
) -> tauri::Result<()> {
    if args.launched {
        return Ok(());
    }

    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let state_for_menu = window_state.clone();
    let state_for_click = window_state;

    let _tray = TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .expect("default window icon missing")
                .clone(),
        )
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                show_wake_surface(app, &state_for_menu);
            }
            "quit" => {
                on_quit(app.clone());
            }
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                show_wake_surface(&app, &state_for_click);
            }
        })
        .build(app)?;

    Ok(())
}
