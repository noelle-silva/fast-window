use std::path::{Path, PathBuf};

const PACKAGE_DIR_NAME: &str = "package";
const DATA_DIR_NAME: &str = "data";

pub(crate) fn default_data_dir() -> Result<PathBuf, String> {
    let exe_dir = current_exe_dir()?;
    default_data_dir_from_exe_dir(&exe_dir)
}

fn default_data_dir_from_exe_dir(exe_dir: &Path) -> Result<PathBuf, String> {
    let container_dir = if is_package_dir(exe_dir) {
        exe_dir
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "应用 package 目录没有父目录".to_string())?
    } else {
        exe_dir.to_path_buf()
    };
    Ok(container_dir.join(DATA_DIR_NAME))
}

fn current_exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("读取当前程序路径失败: {e}"))?;
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "当前程序路径没有父目录".to_string())
}

fn is_package_dir(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some(PACKAGE_DIR_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_package_exe_dir_to_container_data_dir() {
        assert_eq!(
            default_data_dir_from_exe_dir(Path::new("app/package")).unwrap(),
            PathBuf::from("app").join("data")
        );
    }

    #[test]
    fn maps_standalone_exe_dir_to_local_data_dir() {
        assert_eq!(
            default_data_dir_from_exe_dir(Path::new("dist-app/v5-windows")).unwrap(),
            PathBuf::from("dist-app/v5-windows").join("data")
        );
    }
}
