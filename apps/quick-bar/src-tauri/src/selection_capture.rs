#[derive(Clone, Debug)]
pub(crate) struct SelectionCapture {
    pub(crate) text: String,
    pub(crate) anchor_x: i32,
    pub(crate) anchor_y: i32,
}

#[cfg(target_os = "windows")]
pub(crate) fn capture_current_selection() -> Result<SelectionCapture, String> {
    windows_selection::capture_current_selection()
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn capture_current_selection() -> Result<SelectionCapture, String> {
    Err("Quick Bar 当前只支持 Windows 系统选区读取".to_string())
}

#[cfg(target_os = "windows")]
mod windows_selection {
    use super::SelectionCapture;
    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, S_FALSE, S_OK};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Ole::{
        SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetLBound, SafeArrayGetUBound,
        SafeArrayUnaccessData,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
        IUIAutomationTextRange, IUIAutomationTreeWalker, UIA_TextPatternId, UiaRect,
    };

    const MAX_PARENT_SEARCH_DEPTH: usize = 10;

    pub(super) fn capture_current_selection() -> Result<SelectionCapture, String> {
        unsafe {
            let _com = ComApartment::init()?;
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| format!("创建系统选区读取入口失败: {e}"))?;
            let element = automation
                .GetFocusedElement()
                .map_err(|e| format!("读取当前焦点控件失败: {e}"))?;
            let walker = automation
                .ControlViewWalker()
                .map_err(|e| format!("读取系统控件层级失败: {e}"))?;
            capture_from_focus_tree(&walker, element)
        }
    }

    unsafe fn capture_from_focus_tree(
        walker: &IUIAutomationTreeWalker,
        focused: IUIAutomationElement,
    ) -> Result<SelectionCapture, String> {
        let mut element = Some(focused);
        let mut last_error = None;
        for _ in 0..MAX_PARENT_SEARCH_DEPTH {
            let Some(current) = element else {
                break;
            };
            match capture_from_element(&current) {
                Ok(Some(capture)) => return Ok(capture),
                Ok(None) => {}
                Err(error) => last_error = Some(error),
            }
            element = walker.GetParentElement(&current).ok();
        }
        Err(last_error.unwrap_or_else(|| "当前焦点附近没有找到可读取的文本选区".to_string()))
    }

    unsafe fn capture_from_element(
        element: &IUIAutomationElement,
    ) -> Result<Option<SelectionCapture>, String> {
        let Ok(pattern) =
            element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
        else {
            return Ok(None);
        };
        let ranges = pattern
            .GetSelection()
            .map_err(|e| format!("读取文本选区失败: {e}"))?;
        let range_count = ranges
            .Length()
            .map_err(|e| format!("读取文本选区数量失败: {e}"))?;
        if range_count <= 0 {
            return Ok(None);
        }

        let mut selected_parts = Vec::new();
        let mut anchor = None;
        for index in 0..range_count {
            let range = ranges
                .GetElement(index)
                .map_err(|e| format!("读取第 {} 段文本选区失败: {e}", index + 1))?;
            let text = selected_text_from_range(&range)?;
            if text.trim().is_empty() {
                continue;
            }
            if let Some(rect) = last_visible_rect(&range)? {
                anchor = Some((
                    (rect.left + rect.width).round() as i32,
                    (rect.top + rect.height).round() as i32,
                ));
            }
            selected_parts.push(text);
        }

        let text = selected_parts.join("\n").trim().to_string();
        if text.is_empty() {
            return Ok(None);
        }
        let Some((anchor_x, anchor_y)) = anchor else {
            return Err("当前文本选区没有可用的屏幕位置".to_string());
        };
        Ok(Some(SelectionCapture {
            text,
            anchor_x,
            anchor_y,
        }))
    }

    unsafe fn selected_text_from_range(range: &IUIAutomationTextRange) -> Result<String, String> {
        let value = range
            .GetText(8192)
            .map_err(|e| format!("读取选中文本失败: {e}"))?;
        Ok(String::try_from(&value).unwrap_or_else(|_| value.to_string()))
    }

    unsafe fn last_visible_rect(range: &IUIAutomationTextRange) -> Result<Option<UiaRect>, String> {
        let array = range
            .GetBoundingRectangles()
            .map_err(|e| format!("读取文本选区位置失败: {e}"))?;
        if array.is_null() {
            return Ok(None);
        }

        let guard = SafeArrayGuard::new(array);
        let lower =
            SafeArrayGetLBound(array, 1).map_err(|e| format!("读取文本选区位置下界失败: {e}"))?;
        let upper =
            SafeArrayGetUBound(array, 1).map_err(|e| format!("读取文本选区位置上界失败: {e}"))?;
        if upper < lower {
            return Ok(None);
        }

        let count = (upper - lower + 1) as usize;
        let mut raw = std::ptr::null_mut();
        SafeArrayAccessData(array, &mut raw)
            .map_err(|e| format!("访问文本选区位置数据失败: {e}"))?;
        let access = SafeArrayAccessGuard { array };
        let values = std::slice::from_raw_parts(raw as *const f64, count);
        let rect = values
            .chunks_exact(4)
            .filter_map(|chunk| {
                let rect = UiaRect {
                    left: chunk[0],
                    top: chunk[1],
                    width: chunk[2],
                    height: chunk[3],
                };
                (rect.width > 0.5 && rect.height > 0.5).then_some(rect)
            })
            .last();
        drop(access);
        drop(guard);
        Ok(rect)
    }

    struct SafeArrayGuard {
        array: *mut windows::Win32::System::Com::SAFEARRAY,
    }

    impl SafeArrayGuard {
        fn new(array: *mut windows::Win32::System::Com::SAFEARRAY) -> Self {
            Self { array }
        }
    }

    impl Drop for SafeArrayGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = SafeArrayDestroy(self.array);
            }
        }
    }

    struct SafeArrayAccessGuard {
        array: *mut windows::Win32::System::Com::SAFEARRAY,
    }

    impl Drop for SafeArrayAccessGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = SafeArrayUnaccessData(self.array);
            }
        }
    }

    struct ComApartment {
        should_uninitialize: bool,
    }

    impl ComApartment {
        unsafe fn init() -> Result<Self, String> {
            let result = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if result == S_OK || result == S_FALSE {
                return Ok(Self {
                    should_uninitialize: true,
                });
            }
            if result == RPC_E_CHANGED_MODE {
                return Ok(Self {
                    should_uninitialize: false,
                });
            }
            Err(format!("初始化系统选区读取环境失败: {result:?}"))
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            if self.should_uninitialize {
                unsafe { CoUninitialize() };
            }
        }
    }
}
