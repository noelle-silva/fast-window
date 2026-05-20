pub(crate) mod manager;
mod process_owner;

pub(crate) use manager::{
    app_launch_inner, app_launch_inner_with_cold_start_policy, build_registered_app_launch_args,
    stop_all_running_apps, stop_registered_app_for_update, AppColdStartPolicy, AppLifecycleManager,
    RegisteredAppLaunchConfig,
};
pub(crate) use process_owner::{ManagedAppChild, ManagedAppCommand, ManagedAppStdout};
