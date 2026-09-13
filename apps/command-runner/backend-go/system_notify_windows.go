//go:build windows

package main

import (
	"fmt"
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// 系统通知（Windows）：通过系统托盘通知接口（隐藏图标）发送气泡通知。
// 这是后端自治提醒能力的根：不依赖前端 WebView、宿主进程或外部程序，
// 在「前端不运行、后端运行」的场景下依然可用；发送失败一律静默。

const (
	nimAdd    = 0x00000000
	nimModify = 0x00000001

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004
	nifInfo    = 0x00000010

	// nisHidden 让通知图标不占用系统托盘区域，仅作为气泡通知的载体。
	nisHidden = 0x00000001

	niifInfo = 0x00000001

	notifyCallbackMessage = 0x8000 + 1 // WM_APP + 1
	notifyDefaultIcon     = 32512      // IDI_APPLICATION
)

// hwndMessage 即 Win32 的 HWND_MESSAGE (-3)：仅消息窗口的父句柄。
const hwndMessage = ^uintptr(2)

var (
	notifyUser32   = windows.NewLazySystemDLL("user32.dll")
	notifyShell32  = windows.NewLazySystemDLL("shell32.dll")
	notifyKernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procCreateWindowExW  = notifyUser32.NewProc("CreateWindowExW")
	procLoadIconW        = notifyUser32.NewProc("LoadIconW")
	procGetMessageW      = notifyUser32.NewProc("GetMessageW")
	procTranslateMessage = notifyUser32.NewProc("TranslateMessage")
	procDispatchMessageW = notifyUser32.NewProc("DispatchMessageW")
	procGetModuleHandle  = notifyKernel32.NewProc("GetModuleHandleW")
	procShellNotifyIcon  = notifyShell32.NewProc("Shell_NotifyIconW")
)

// notifyIconDataW 对应 Win32 NOTIFYICONDATAW（Vista+ 完整结构）。
type notifyIconDataW struct {
	cbSize           uint32
	hWnd             windows.HWND
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            windows.Handle
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uVersion         uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         windows.GUID
	hBalloonIcon     windows.Handle
}

type notifyMessageW struct {
	hwnd    windows.HWND
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
}

type notifyIconState struct {
	hwnd windows.HWND
	data notifyIconDataW
}

var (
	notifyInitOnce sync.Once
	notifyInitErr  error

	notifyMu    sync.Mutex
	notifyState notifyIconState
)

// notifySystem 发送一条系统通知；失败静默（提醒不可用不阻塞命令运行）。
func notifySystem(title, body string) {
	notifyInitOnce.Do(func() {
		notifyInitErr = startNotifyIcon()
	})
	if notifyInitErr != nil {
		return
	}
	notifyMu.Lock()
	defer notifyMu.Unlock()
	data := notifyState.data
	data.uFlags = nifInfo
	copyUTF16(data.szInfoTitle[:], title)
	copyUTF16(data.szInfo[:], body)
	data.dwInfoFlags = niifInfo
	_, _, _ = procShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&data)))
}

// startNotifyIcon 惰性创建通知窗口并注册隐藏图标；窗口与消息循环固定在同一 OS 线程上。
func startNotifyIcon() error {
	ready := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		hwnd, err := createNotifyWindow()
		if err != nil {
			ready <- err
			return
		}
		var data notifyIconDataW
		data.cbSize = uint32(unsafe.Sizeof(data))
		data.hWnd = hwnd
		data.uID = 1
		data.uCallbackMessage = notifyCallbackMessage
		icon, _, _ := procLoadIconW.Call(0, notifyDefaultIcon)
		data.hIcon = windows.Handle(icon)
		copyUTF16(data.szTip[:], "Command Runner")
		data.uFlags = nifMessage | nifIcon | nifTip | nisHidden
		ret, _, callErr := procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&data)))
		if ret == 0 {
			ready <- fmt.Errorf("Shell_NotifyIcon 注册失败: %v", callErr)
			return
		}
		notifyState = notifyIconState{hwnd: hwnd, data: data}
		ready <- nil
		runNotifyMessageLoop()
	}()
	return <-ready
}

func createNotifyWindow() (windows.HWND, error) {
	className, err := windows.UTF16FromString("STATIC")
	if err != nil {
		return 0, err
	}
	hInstance, _, _ := procGetModuleHandle.Call(0)
	hwnd, _, callErr := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(&className[0])),
		0,
		0,
		0, 0, 0, 0,
		hwndMessage,
		0,
		hInstance,
		0,
	)
	if hwnd == 0 {
		return 0, fmt.Errorf("创建通知窗口失败: %v", callErr)
	}
	return windows.HWND(hwnd), nil
}

func runNotifyMessageLoop() {
	var msg notifyMessageW
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(ret) <= 0 {
			return
		}
		_, _, _ = procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		_, _, _ = procDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

func copyUTF16(dst []uint16, value string) {
	encoded, err := windows.UTF16FromString(value)
	if err != nil {
		return
	}
	if len(encoded) > len(dst) {
		encoded = encoded[:len(dst)-1]
	}
	copy(dst, encoded)
	dst[len(dst)-1] = 0
}
