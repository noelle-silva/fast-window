use std::path::Path;

#[cfg(target_os = "windows")]
fn win_err(prefix: &str, e: windows::core::Error) -> String {
    let code = e.code().0 as u32;
    let msg = e.message();
    format!("{prefix} (code=0x{code:08X}) {msg}")
}

#[cfg(target_os = "windows")]
fn win_strip_extended_prefix(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    s
}

#[cfg(target_os = "windows")]
fn win_hbitmap_to_png_data_url(
    hbmp: windows::Win32::Graphics::Gdi::HBITMAP,
) -> Result<String, String> {
    use base64::engine::general_purpose;
    use base64::Engine as _;
    use image::codecs::png::PngEncoder;
    use image::{ColorType, ImageEncoder};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, GetDIBits, GetObjectW, SelectObject, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };

    unsafe {
        let mut bmp = BITMAP::default();
        let ok = GetObjectW(
            hbmp.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut _),
        );
        if ok == 0 {
            return Err("读取缩略图失败（GetObjectW）".to_string());
        }

        let width = bmp.bmWidth.max(1) as i32;
        let height = bmp.bmHeight.max(1) as i32;

        // 32bpp BGRA，top-down（负高度）
        let mut bi = BITMAPINFO::default();
        bi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0 as u32,
            ..Default::default()
        };

        let stride = (width as usize) * 4;
        let mut bgra = vec![0u8; stride * (height as usize)];

        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            return Err("读取缩略图失败（CreateCompatibleDC）".to_string());
        }
        let old = SelectObject(hdc, hbmp.into());

        let got = GetDIBits(
            hdc,
            hbmp,
            0,
            height as u32,
            Some(bgra.as_mut_ptr() as *mut _),
            &mut bi,
            DIB_RGB_COLORS,
        );
        let _ = SelectObject(hdc, old);
        let _ = DeleteDC(hdc);
        if got == 0 {
            return Err("读取缩略图失败（GetDIBits）".to_string());
        }

        // BGRA -> RGBA
        for p in bgra.chunks_exact_mut(4) {
            let b = p[0];
            let r = p[2];
            p[0] = r;
            p[2] = b;
        }

        let mut out = Vec::new();
        let encoder = PngEncoder::new(&mut out);
        encoder
            .write_image(&bgra, width as u32, height as u32, ColorType::Rgba8.into())
            .map_err(|e| format!("PNG 编码失败: {e}"))?;

        let b64 = general_purpose::STANDARD.encode(out);
        Ok(format!("data:image/png;base64,{b64}"))
    }
}

#[cfg(target_os = "windows")]
pub fn file_thumbnail_png_data_url(full_path: &Path, width: u32, height: u32) -> Result<String, String> {
    // Shell 缩略图接口偏爱 STA；Tauri command 线程可能在 MTA/线程池里。
    // 为稳定起见：在专用 STA 线程中生成缩略图。
    let path = full_path.to_path_buf();
    std::thread::spawn(move || -> Result<String, String> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::SIZE;
        use windows::Win32::Graphics::Gdi::DeleteObject;
        use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
        use windows::Win32::UI::Shell::{
            IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_RESIZETOFIT,
        };

        unsafe {
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if hr.is_err() {
                return Err(format!("初始化 COM 失败（STA）: {hr:?}"));
            }

            let stripped = win_strip_extended_prefix(&path);
            let wide: Vec<u16> = OsStr::new(&stripped)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();

            let factory: IShellItemImageFactory =
                SHCreateItemFromParsingName(PCWSTR::from_raw(wide.as_ptr()), None)
                    .map_err(|e| win_err("获取缩略图失败（SHCreateItemFromParsingName）", e))?;

            let size = SIZE { cx: width as i32, cy: height as i32 };
            let hbmp = factory
                .GetImage(size, SIIGBF_RESIZETOFIT | SIIGBF_BIGGERSIZEOK)
                .map_err(|e| win_err("获取缩略图失败（GetImage）", e))?;

            let r = win_hbitmap_to_png_data_url(hbmp);
            let _ = DeleteObject(hbmp.into());
            CoUninitialize();
            r
        }
    })
    .join()
    .map_err(|_| "生成缩略图线程异常退出".to_string())?
}

#[cfg(not(target_os = "windows"))]
pub fn file_thumbnail_png_data_url(_full_path: &Path, _width: u32, _height: u32) -> Result<String, String> {
    Err("当前系统不支持生成缩略图".to_string())
}
