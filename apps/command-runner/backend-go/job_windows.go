//go:build windows

package main

import (
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

// attachJobObject 把子进程加入"父死子亡"的 Job：sidecar 无论正常退出还是被杀，
// 关闭 Job 句柄时整个进程树都会被系统终结，杜绝无窗口进程残留。
// 采用 Extended 信息类设置 KILL_ON_JOB_CLOSE（Basic 信息类在部分 Windows 版本被拒绝）。
func attachJobObject(cmd *exec.Cmd) (cleanup func(), err error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return func() {}, err
	}
	failure := func(cause error) (func(), error) {
		_ = windows.CloseHandle(job)
		return func() {}, cause
	}

	limitInfo := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limitInfo.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limitInfo)),
		uint32(unsafe.Sizeof(limitInfo)),
	); err != nil {
		return failure(err)
	}

	procHandle, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		return failure(err)
	}
	defer func() { _ = windows.CloseHandle(procHandle) }()

	if err := windows.AssignProcessToJobObject(job, procHandle); err != nil {
		return failure(err)
	}
	return func() { _ = windows.CloseHandle(job) }, nil
}
