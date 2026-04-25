use std::path::Path;

pub(crate) fn ensure_writable_dir(dir: &Path) -> Result<(), String> {
    // v2 兼容：沿用原始行为与错误文案（被多处 host/plugin 逻辑依赖）
    std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;
    if !dir.is_dir() {
        return Err("输出路径不是目录".to_string());
    }
    if !crate::is_dir_writable(dir) {
        return Err("目录不可写（权限不足或被占用）".to_string());
    }
    Ok(())
}
