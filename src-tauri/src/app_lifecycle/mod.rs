mod control_channel;
pub(crate) mod manager;
mod process_owner;

pub(crate) use control_channel::send_control_json;
pub(crate) use manager::{
    app_launch_inner_with_cold_start_policy, app_launch_inner_with_options,
    build_registered_app_launch_args, stop_all_running_apps, stop_registered_app_for_update,
    AppColdStartPolicy, AppLaunchOptions, AppLifecycleManager, RegisteredAppLaunchConfig,
};
pub(crate) use process_owner::{ManagedAppChild, ManagedAppCommand, ManagedAppStdout};
