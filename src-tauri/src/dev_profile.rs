const HOST_DEV_PROFILE_ENV: &str = "FAST_WINDOW_HOST_PROFILE";
const HOST_DEV_PROFILE_VALUE: &str = "dev";

/// dev profile 的唯一判定口。
///
/// 两个条件必须同时成立：debug 构建，且运行环境显式声明 dev profile。
/// 任何开发能力都经由这里判断，避免各处自写一套「差不多」的条件而出现口径漂移。
pub(crate) fn is_dev_profile() -> bool {
    if !cfg!(debug_assertions) {
        return false;
    }
    matches!(
        std::env::var(HOST_DEV_PROFILE_ENV),
        Ok(value) if value == HOST_DEV_PROFILE_VALUE
    )
}

pub(crate) fn ensure_dev_profile() -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("当前宿主不是 debug 构建，拒绝执行宿主开发命令".to_string());
    }

    match std::env::var(HOST_DEV_PROFILE_ENV) {
        Ok(value) if value == HOST_DEV_PROFILE_VALUE => Ok(()),
        _ => Err("当前宿主不是 dev profile，拒绝执行宿主开发命令".to_string()),
    }
}
