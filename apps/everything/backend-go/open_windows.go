//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

const shellExecuteShowNormal = 1

var shellExecuteW = syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW")

func openFileWithDefaultApp(path string) error {
	return shellExecute("open", path, "", "", shellExecuteShowNormal)
}

func revealFileInExplorer(path string) error {
	return exec.Command("explorer.exe", windowsExplorerSelectArgs(path)...).Start()
}

func windowsExplorerSelectArgs(path string) []string {
	return []string{"/select,", path}
}

func shellExecute(verb string, file string, parameters string, directory string, show int) error {
	verbPtr, err := syscall.UTF16PtrFromString(verb)
	if err != nil {
		return err
	}
	filePtr, err := syscall.UTF16PtrFromString(file)
	if err != nil {
		return err
	}
	parametersPtr, err := syscall.UTF16PtrFromString(parameters)
	if err != nil {
		return err
	}
	directoryPtr, err := syscall.UTF16PtrFromString(directory)
	if err != nil {
		return err
	}

	result, _, callErr := shellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(verbPtr)),
		uintptr(unsafe.Pointer(filePtr)),
		uintptr(unsafe.Pointer(parametersPtr)),
		uintptr(unsafe.Pointer(directoryPtr)),
		uintptr(show),
	)
	if result <= 32 {
		return fmt.Errorf("open file failed: result=%d error=%v", result, callErr)
	}
	return nil
}
