use std::path::{Path, PathBuf};

#[cfg(not(target_os = "windows"))]
use tokio::process::{Child, Command};

#[derive(Clone, Copy)]
pub(crate) enum ManagedAppStdout {
    Null,
    Piped,
}

pub(crate) struct ManagedAppCommand {
    executable: PathBuf,
    args: Vec<String>,
    stdout: ManagedAppStdout,
}

impl ManagedAppCommand {
    pub(crate) fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            args: Vec::new(),
            stdout: ManagedAppStdout::Null,
        }
    }

    pub(crate) fn args(mut self, args: Vec<String>) -> Self {
        self.args = args;
        self
    }

    pub(crate) fn stdout(mut self, stdout: ManagedAppStdout) -> Self {
        self.stdout = stdout;
        self
    }

    fn executable(&self) -> &Path {
        &self.executable
    }

    fn args_ref(&self) -> &[String] {
        &self.args
    }
}

pub(crate) struct ManagedAppChild {
    inner: platform::PlatformManagedAppChild,
}

impl ManagedAppChild {
    pub(crate) fn spawn(command: ManagedAppCommand) -> Result<Self, String> {
        platform::spawn(command).map(|inner| Self { inner })
    }

    pub(crate) fn id(&self) -> u32 {
        self.inner.id()
    }

    pub(crate) fn stdout(&mut self) -> Option<tokio::process::ChildStdout> {
        self.inner.stdout()
    }

    pub(crate) fn try_wait(&mut self) -> Result<Option<std::process::ExitStatus>, String> {
        self.inner.try_wait()
    }

    pub(crate) fn start_kill(&mut self) -> Result<(), String> {
        self.inner.start_kill()
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{ManagedAppCommand, ManagedAppStdout};
    use std::ffi::OsStr;
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;
    use std::path::Path;
    use std::process::ExitStatus;

    use tokio::process::ChildStdout;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows::Win32::Security::SECURITY_ATTRIBUTES;
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Pipes::CreatePipe;
    use windows::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
        InitializeProcThreadAttributeList, ResumeThread, UpdateProcThreadAttribute,
        WaitForSingleObject, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
        EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, STARTF_USESTDHANDLES,
        STARTUPINFOEXW,
    };

    pub(super) struct PlatformManagedAppChild {
        pid: u32,
        process_handle: OwnedHandle,
        job_handle: OwnedHandle,
        stdout: Option<ChildStdout>,
    }

    impl PlatformManagedAppChild {
        pub(super) fn id(&self) -> u32 {
            self.pid
        }

        pub(super) fn stdout(&mut self) -> Option<ChildStdout> {
            self.stdout.take()
        }

        pub(super) fn try_wait(&mut self) -> Result<Option<ExitStatus>, String> {
            let wait = unsafe { WaitForSingleObject(self.process_handle.raw(), 0) };
            if wait == WAIT_TIMEOUT {
                return Ok(None);
            }
            if wait != WAIT_OBJECT_0 {
                return Err(format!("等待应用进程失败: {wait:?}"));
            }

            let mut exit_code = 0;
            unsafe { GetExitCodeProcess(self.process_handle.raw(), &mut exit_code) }
                .map_err(|e| format!("读取应用退出码失败: {e}"))?;
            Ok(Some(exit_status_from_code(exit_code)))
        }

        pub(super) fn start_kill(&mut self) -> Result<(), String> {
            unsafe { TerminateJobObject(self.job_handle.raw(), 1) }
                .map_err(|e| format!("停止应用 Job 失败: {e}"))
        }
    }

    pub(super) fn spawn(command: ManagedAppCommand) -> Result<PlatformManagedAppChild, String> {
        let job_handle = create_host_owned_job()?;
        let stdin = open_nul_for_child(FILE_GENERIC_READ.0)?;
        let stdout = create_stdout(command.stdout)?;
        let stderr = open_nul_for_child(FILE_GENERIC_WRITE.0)?;

        let mut inheritable_handles = vec![stdin.raw(), stdout.child_handle(), stderr.raw()];
        let mut attributes = ProcThreadAttributes::new(2)?;
        let mut job_list = [job_handle.raw()];
        attributes.update(
            PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
            job_list.as_mut_ptr().cast(),
            size_of::<HANDLE>(),
        )?;
        attributes.update(
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            inheritable_handles.as_mut_ptr().cast(),
            inheritable_handles.len() * size_of::<HANDLE>(),
        )?;

        let mut startup_info: STARTUPINFOEXW = unsafe { zeroed() };
        startup_info.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup_info.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup_info.StartupInfo.hStdInput = stdin.raw();
        startup_info.StartupInfo.hStdOutput = stdout.child_handle();
        startup_info.StartupInfo.hStdError = stderr.raw();
        startup_info.lpAttributeList = attributes.as_mut_ptr();

        let mut process_info: PROCESS_INFORMATION = unsafe { zeroed() };
        let app_name = wide_null(command.executable().as_os_str());
        let mut command_line = command_line(command.executable(), command.args_ref())?;
        let current_dir = command
            .executable()
            .parent()
            .map(|dir| wide_null(dir.as_os_str()))
            .unwrap_or_else(|| wide_null(OsStr::new(".")));

        unsafe {
            CreateProcessW(
                PCWSTR(app_name.as_ptr()),
                Some(PWSTR(command_line.as_mut_ptr())),
                None,
                None,
                true,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED,
                None,
                PCWSTR(current_dir.as_ptr()),
                (&startup_info.StartupInfo as *const _) as *const _,
                &mut process_info,
            )
        }
        .map_err(|e| format!("启动应用失败: {e}"))?;

        let process_handle = OwnedHandle::new(process_info.hProcess);
        let thread_handle = OwnedHandle::new(process_info.hThread);
        if unsafe { ResumeThread(thread_handle.raw()) } == u32::MAX {
            return Err("恢复应用主线程失败".to_string());
        }

        Ok(PlatformManagedAppChild {
            pid: process_info.dwProcessId,
            process_handle,
            job_handle,
            stdout: stdout.into_parent_stdout()?,
        })
    }

    fn create_host_owned_job() -> Result<OwnedHandle, String> {
        let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
            .map(OwnedHandle::new)
            .map_err(|e| format!("创建应用 Job 失败: {e}"))?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            SetInformationJobObject(
                job.raw(),
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
        .map_err(|e| format!("配置应用 Job 失败: {e}"))?;
        Ok(job)
    }

    struct ProcThreadAttributes {
        buffer: Vec<u8>,
    }

    impl ProcThreadAttributes {
        fn new(count: u32) -> Result<Self, String> {
            let mut size = 0usize;
            let _ = unsafe { InitializeProcThreadAttributeList(None, count, None, &mut size) };
            if size == 0 {
                return Err("计算应用启动属性大小失败".to_string());
            }

            let mut buffer = vec![0u8; size];
            let list = LPPROC_THREAD_ATTRIBUTE_LIST(buffer.as_mut_ptr().cast());
            unsafe { InitializeProcThreadAttributeList(Some(list), count, None, &mut size) }
                .map_err(|e| format!("初始化应用启动属性失败: {e}"))?;
            Ok(Self { buffer })
        }

        fn as_mut_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
            LPPROC_THREAD_ATTRIBUTE_LIST(self.buffer.as_mut_ptr().cast())
        }

        fn update(
            &mut self,
            attribute: usize,
            value: *const core::ffi::c_void,
            size: usize,
        ) -> Result<(), String> {
            unsafe {
                UpdateProcThreadAttribute(
                    self.as_mut_ptr(),
                    0,
                    attribute,
                    Some(value),
                    size,
                    None,
                    None,
                )
            }
            .map_err(|e| format!("配置应用启动属性失败: {e}"))
        }
    }

    impl Drop for ProcThreadAttributes {
        fn drop(&mut self) {
            unsafe {
                DeleteProcThreadAttributeList(self.as_mut_ptr());
            }
        }
    }

    struct OwnedHandle {
        handle: HANDLE,
    }

    // Windows kernel handles are value-like references to kernel objects. This wrapper
    // uniquely owns the handle and only exposes thread-safe OS operations.
    unsafe impl Send for OwnedHandle {}

    impl OwnedHandle {
        fn new(handle: HANDLE) -> Self {
            Self { handle }
        }

        fn raw(&self) -> HANDLE {
            self.handle
        }

        fn take(&mut self) -> HANDLE {
            let handle = self.handle;
            self.handle = HANDLE::default();
            handle
        }
    }

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            if !self.handle.is_invalid() {
                unsafe {
                    let _ = CloseHandle(self.handle);
                }
            }
        }
    }

    enum ChildStdoutOwner {
        Null {
            child_handle: OwnedHandle,
        },
        Piped {
            child_handle: OwnedHandle,
            parent_handle: OwnedHandle,
        },
    }

    impl ChildStdoutOwner {
        fn child_handle(&self) -> HANDLE {
            match self {
                Self::Null { child_handle } | Self::Piped { child_handle, .. } => {
                    child_handle.raw()
                }
            }
        }

        fn into_parent_stdout(self) -> Result<Option<ChildStdout>, String> {
            match self {
                Self::Piped {
                    mut parent_handle, ..
                } => unsafe {
                    let handle = parent_handle.take();
                    let owned = std::os::windows::io::OwnedHandle::from_raw_handle(handle.0);
                    let stdout = std::process::ChildStdout::from(owned);
                    ChildStdout::from_std(stdout)
                        .map(Some)
                        .map_err(|e| format!("接管应用输出管道失败: {e}"))
                },
                Self::Null { .. } => Ok(None),
            }
        }
    }

    fn create_stdout(stdout: ManagedAppStdout) -> Result<ChildStdoutOwner, String> {
        match stdout {
            ManagedAppStdout::Null => open_nul_for_child(FILE_GENERIC_WRITE.0)
                .map(|child_handle| ChildStdoutOwner::Null { child_handle }),
            ManagedAppStdout::Piped => create_child_stdout_pipe(),
        }
    }

    fn create_child_stdout_pipe() -> Result<ChildStdoutOwner, String> {
        let mut read_handle = HANDLE::default();
        let mut write_handle = HANDLE::default();
        let security = inheritable_security_attributes();
        unsafe { CreatePipe(&mut read_handle, &mut write_handle, Some(&security), 0) }
            .map_err(|e| format!("创建应用输出管道失败: {e}"))?;

        let parent_handle = OwnedHandle::new(read_handle);
        let child_handle = OwnedHandle::new(write_handle);
        unsafe {
            SetHandleInformation(
                parent_handle.raw(),
                HANDLE_FLAG_INHERIT.0,
                HANDLE_FLAGS_NONE,
            )
        }
        .map_err(|e| format!("配置应用输出管道失败: {e}"))?;

        Ok(ChildStdoutOwner::Piped {
            child_handle,
            parent_handle,
        })
    }

    fn open_nul_for_child(access: u32) -> Result<OwnedHandle, String> {
        let name = wide_null(OsStr::new("NUL"));
        let security = inheritable_security_attributes();
        unsafe {
            CreateFileW(
                PCWSTR(name.as_ptr()),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                Some(&security),
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            )
        }
        .map(OwnedHandle::new)
        .map_err(|e| format!("打开空设备失败: {e}"))
    }

    fn inheritable_security_attributes() -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: true.into(),
        }
    }

    fn command_line(executable: &Path, args: &[String]) -> Result<Vec<u16>, String> {
        let exe = executable
            .to_str()
            .ok_or_else(|| "应用路径不是有效 Unicode".to_string())?;
        let mut parts = Vec::with_capacity(args.len() + 1);
        parts.push(quote_windows_arg(exe));
        for arg in args {
            parts.push(quote_windows_arg(arg));
        }
        let wide = wide_null(OsStr::new(&parts.join(" ")));
        if wide.len() <= 1 {
            return Err("应用启动命令为空".to_string());
        }
        Ok(wide)
    }

    fn quote_windows_arg(value: &str) -> String {
        if value.is_empty() {
            return "\"\"".to_string();
        }
        let needs_quotes = value.chars().any(|c| matches!(c, ' ' | '\t' | '\n' | '\"'));
        if !needs_quotes {
            return value.to_string();
        }

        let mut quoted = String::from("\"");
        let mut backslashes = 0usize;
        for ch in value.chars() {
            match ch {
                '\\' => backslashes += 1,
                '\"' => {
                    quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                    quoted.push('\"');
                    backslashes = 0;
                }
                _ => {
                    quoted.push_str(&"\\".repeat(backslashes));
                    backslashes = 0;
                    quoted.push(ch);
                }
            }
        }
        quoted.push_str(&"\\".repeat(backslashes * 2));
        quoted.push('\"');
        quoted
    }

    fn wide_null(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(Some(0)).collect()
    }

    const HANDLE_FLAGS_NONE: windows::Win32::Foundation::HANDLE_FLAGS =
        windows::Win32::Foundation::HANDLE_FLAGS(0);

    fn exit_status_from_code(code: u32) -> ExitStatus {
        use std::os::windows::process::ExitStatusExt;

        ExitStatus::from_raw(code)
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::{Child, Command, ManagedAppCommand, ManagedAppStdout};

    pub(super) struct PlatformManagedAppChild {
        child: Child,
    }

    impl PlatformManagedAppChild {
        pub(super) fn id(&self) -> u32 {
            self.child.id().unwrap_or(0)
        }

        pub(super) fn stdout(&mut self) -> Option<tokio::process::ChildStdout> {
            self.child.stdout.take()
        }

        pub(super) fn try_wait(&mut self) -> Result<Option<std::process::ExitStatus>, String> {
            self.child
                .try_wait()
                .map_err(|e| format!("等待应用进程失败: {e}"))
        }

        pub(super) fn start_kill(&mut self) -> Result<(), String> {
            self.child
                .start_kill()
                .map_err(|e| format!("停止应用失败: {e}"))
        }
    }

    pub(super) fn spawn(command: ManagedAppCommand) -> Result<PlatformManagedAppChild, String> {
        let mut cmd = Command::new(command.executable());
        cmd.args(command.args_ref());
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(stdout_to_stdio(command.stdout));
        cmd.stderr(std::process::Stdio::null());
        #[cfg(unix)]
        cmd.process_group(0);
        let child = cmd.spawn().map_err(|e| format!("启动应用失败: {e}"))?;
        Ok(PlatformManagedAppChild { child })
    }

    fn stdout_to_stdio(stdout: ManagedAppStdout) -> std::process::Stdio {
        match stdout {
            ManagedAppStdout::Null => std::process::Stdio::null(),
            ManagedAppStdout::Piped => std::process::Stdio::piped(),
        }
    }
}
