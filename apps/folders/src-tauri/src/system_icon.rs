use std::path::{Path, PathBuf};

#[tauri::command]
pub(crate) fn system_icon_data_url(path: String) -> Result<String, String> {
    let path = PathBuf::from(path.trim());
    if !path.exists() {
        return Err(format!("目标路径不存在: {}", path.display()));
    }
    system_icon_data_url_inner(&path)
}

#[cfg(target_os = "windows")]
fn system_icon_data_url_inner(path: &Path) -> Result<String, String> {
    windows_shell_icon_png_data_url(path, 64, 64)
}

#[cfg(not(target_os = "windows"))]
fn system_icon_data_url_inner(_path: &Path) -> Result<String, String> {
    Err("当前系统不支持读取系统图标".to_string())
}

#[cfg(target_os = "windows")]
fn win_err(prefix: &str, error: windows::core::Error) -> String {
    let code = error.code().0 as u32;
    let message = error.message();
    format!("{prefix} (code=0x{code:08X}) {message}")
}

#[cfg(target_os = "windows")]
fn win_strip_extended_prefix(path: &Path) -> String {
    let raw = path.to_string_lossy().to_string();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = raw.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    raw
}

#[cfg(target_os = "windows")]
fn windows_shell_icon_png_data_url(path: &Path, width: u32, height: u32) -> Result<String, String> {
    let path = path.to_path_buf();
    std::thread::spawn(move || -> Result<String, String> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::SIZE;
        use windows::Win32::Graphics::Gdi::DeleteObject;
        use windows::Win32::System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{
            IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
            SIIGBF_RESIZETOFIT,
        };

        unsafe {
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if hr.is_err() {
                return Err(format!("初始化系统图标读取环境失败: {hr:?}"));
            }

            let result = (|| -> Result<String, String> {
                let stripped = win_strip_extended_prefix(&path);
                let wide: Vec<u16> = OsStr::new(&stripped)
                    .encode_wide()
                    .chain(std::iter::once(0))
                    .collect();

                let factory: IShellItemImageFactory =
                    SHCreateItemFromParsingName(PCWSTR::from_raw(wide.as_ptr()), None).map_err(
                        |e| win_err("获取系统图标失败（SHCreateItemFromParsingName）", e),
                    )?;

                let hbmp = factory
                    .GetImage(
                        SIZE {
                            cx: width as i32,
                            cy: height as i32,
                        },
                        SIIGBF_RESIZETOFIT | SIIGBF_BIGGERSIZEOK,
                    )
                    .map_err(|e| win_err("获取系统图标失败（GetImage）", e))?;

                let data_url = hbitmap_to_png_data_url(hbmp);
                let _ = DeleteObject(hbmp.into());
                data_url
            })();

            CoUninitialize();
            result
        }
    })
    .join()
    .map_err(|_| "系统图标读取线程异常退出".to_string())?
}

#[cfg(target_os = "windows")]
fn hbitmap_to_png_data_url(hbmp: windows::Win32::Graphics::Gdi::HBITMAP) -> Result<String, String> {
    use base64::engine::general_purpose;
    use base64::Engine as _;
    use image::codecs::png::PngEncoder;
    use image::{ColorType, ImageEncoder};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, GetDIBits, GetObjectW, SelectObject, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };

    unsafe {
        let mut bitmap = BITMAP::default();
        let ok = GetObjectW(
            hbmp.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bitmap as *mut _ as *mut _),
        );
        if ok == 0 {
            return Err("读取系统图标位图失败（GetObjectW）".to_string());
        }

        let width = bitmap.bmWidth.max(1) as i32;
        let height = bitmap.bmHeight.max(1) as i32;
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0 as u32,
            ..Default::default()
        };

        let stride = width as usize * 4;
        let mut bgra = vec![0u8; stride * height as usize];
        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            return Err("读取系统图标位图失败（CreateCompatibleDC）".to_string());
        }
        let previous = SelectObject(hdc, hbmp.into());
        let read = GetDIBits(
            hdc,
            hbmp,
            0,
            height as u32,
            Some(bgra.as_mut_ptr() as *mut _),
            &mut info,
            DIB_RGB_COLORS,
        );
        let _ = SelectObject(hdc, previous);
        let _ = DeleteDC(hdc);
        if read == 0 {
            return Err("读取系统图标位图失败（GetDIBits）".to_string());
        }

        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        let mut png = Vec::new();
        PngEncoder::new(&mut png)
            .write_image(&bgra, width as u32, height as u32, ColorType::Rgba8.into())
            .map_err(|e| format!("系统图标 PNG 编码失败: {e}"))?;

        Ok(format!(
            "data:image/png;base64,{}",
            general_purpose::STANDARD.encode(png)
        ))
    }
}
