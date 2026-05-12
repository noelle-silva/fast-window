use std::path::{Path, PathBuf};

const PACKAGE_DIR_NAME: &str = "package";

pub(crate) fn app_container_dir(install_root: &Path, app_id: &str) -> PathBuf {
    install_root.join(app_id)
}

pub(crate) fn app_package_dir(app_container: &Path) -> PathBuf {
    app_container.join(PACKAGE_DIR_NAME)
}

pub(crate) fn app_container_dir_from_manifest_dir(manifest_dir: &Path) -> Result<PathBuf, String> {
    if is_package_dir(manifest_dir) {
        return manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "应用 package 目录没有父目录".to_string());
    }
    Ok(manifest_dir.to_path_buf())
}

pub(crate) fn is_package_dir(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some(PACKAGE_DIR_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_install_root_and_id_to_container() {
        assert_eq!(
            app_container_dir(Path::new("apps"), "ai-studio"),
            PathBuf::from("apps").join("ai-studio")
        );
    }

    #[test]
    fn maps_container_to_package() {
        assert_eq!(
            app_package_dir(Path::new("apps/ai-studio")),
            PathBuf::from("apps/ai-studio").join("package")
        );
    }

    #[test]
    fn maps_package_manifest_dir_to_container() {
        assert_eq!(
            app_container_dir_from_manifest_dir(Path::new("apps/ai-studio/package")).unwrap(),
            PathBuf::from("apps/ai-studio")
        );
    }

    #[test]
    fn keeps_legacy_manifest_dir_as_container() {
        assert_eq!(
            app_container_dir_from_manifest_dir(Path::new("apps/ai-studio")).unwrap(),
            PathBuf::from("apps/ai-studio")
        );
    }
}
