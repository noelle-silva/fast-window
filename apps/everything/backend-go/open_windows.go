//go:build windows

package main

import (
	"encoding/binary"
	"fmt"
	"os/exec"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

const (
	shellExecuteShowNormal = 1
	cfHDrop                = 15
	dropEffectCopy         = 1
	gmemMoveable           = 0x0002
	gmemZeroInit           = 0x0040
)

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	user32                   = syscall.NewLazyDLL("user32.dll")
	shell32                  = syscall.NewLazyDLL("shell32.dll")
	globalAlloc              = kernel32.NewProc("GlobalAlloc")
	globalFree               = kernel32.NewProc("GlobalFree")
	globalLock               = kernel32.NewProc("GlobalLock")
	globalUnlock             = kernel32.NewProc("GlobalUnlock")
	openClipboard            = user32.NewProc("OpenClipboard")
	closeClipboard           = user32.NewProc("CloseClipboard")
	emptyClipboard           = user32.NewProc("EmptyClipboard")
	registerClipboardFormatW = user32.NewProc("RegisterClipboardFormatW")
	setClipboardData         = user32.NewProc("SetClipboardData")
	shellExecuteW            = shell32.NewProc("ShellExecuteW")
)

type dropPoint struct {
	X int32
	Y int32
}

type dropFilesHeader struct {
	PFiles uint32
	Point  dropPoint
	FNC    int32
	FWide  int32
}

func openFileWithDefaultApp(path string) error {
	return shellExecute("open", path, "", "", shellExecuteShowNormal)
}

func revealFileInExplorer(path string) error {
	return exec.Command("explorer.exe", windowsExplorerSelectArgs(path)...).Start()
}

func copyPathToClipboard(path string) error {
	path, err := normalizeClipboardPath(path)
	if err != nil {
		return err
	}
	preferredDropEffectFormat, err := registeredClipboardFormat("Preferred DropEffect")
	if err != nil {
		return err
	}
	dropMemory, err := globalMemory(windowsDropFilesPayload([]string{path}))
	if err != nil {
		return err
	}
	defer freeGlobalMemoryIfOwned(&dropMemory)
	effectMemory, err := globalMemory(windowsDropEffectPayload(dropEffectCopy))
	if err != nil {
		return err
	}
	defer freeGlobalMemoryIfOwned(&effectMemory)

	if err := openSystemClipboard(); err != nil {
		return err
	}
	defer closeSystemClipboard()
	if err := emptySystemClipboard(); err != nil {
		return err
	}
	if err := setSystemClipboardData(cfHDrop, dropMemory); err != nil {
		return err
	}
	dropMemory = 0
	if err := setSystemClipboardData(preferredDropEffectFormat, effectMemory); err != nil {
		return err
	}
	effectMemory = 0
	return nil
}

func windowsExplorerSelectArgs(path string) []string {
	return []string{"/select,", path}
}

func normalizeClipboardPath(path string) (string, error) {
	return normalizeExistingLocalPath(path, "clipboard path", false)
}

func windowsDropFilesPayload(paths []string) []byte {
	encoded := encodeClipboardPaths(paths)
	headerSize := int(unsafe.Sizeof(dropFilesHeader{}))
	payload := make([]byte, headerSize+len(encoded)*2)
	header := dropFilesHeader{PFiles: uint32(headerSize), FWide: 1}
	copy(payload, unsafe.Slice((*byte)(unsafe.Pointer(&header)), headerSize))
	for index, value := range encoded {
		binary.LittleEndian.PutUint16(payload[headerSize+index*2:], value)
	}
	return payload
}

func windowsDropEffectPayload(effect uint32) []byte {
	payload := make([]byte, 4)
	binary.LittleEndian.PutUint32(payload, effect)
	return payload
}

func encodeClipboardPaths(paths []string) []uint16 {
	out := make([]uint16, 0)
	for _, path := range paths {
		out = append(out, utf16.Encode([]rune(path))...)
		out = append(out, 0)
	}
	return append(out, 0)
}

func registeredClipboardFormat(name string) (uintptr, error) {
	namePtr, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	format, _, callErr := registerClipboardFormatW.Call(uintptr(unsafe.Pointer(namePtr)))
	if format == 0 {
		return 0, win32CallError("register clipboard format failed", callErr)
	}
	return format, nil
}

func globalMemory(payload []byte) (uintptr, error) {
	if len(payload) == 0 {
		return 0, fmt.Errorf("clipboard payload is empty")
	}
	handle, _, callErr := globalAlloc.Call(gmemMoveable|gmemZeroInit, uintptr(len(payload)))
	if handle == 0 {
		return 0, win32CallError("allocate clipboard memory failed", callErr)
	}
	ptr, _, callErr := globalLock.Call(handle)
	if ptr == 0 {
		freeGlobalMemory(handle)
		return 0, win32CallError("lock clipboard memory failed", callErr)
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(ptr)), len(payload)), payload)
	globalUnlock.Call(handle)
	return handle, nil
}

func freeGlobalMemoryIfOwned(handle *uintptr) {
	if handle == nil || *handle == 0 {
		return
	}
	freeGlobalMemory(*handle)
	*handle = 0
}

func freeGlobalMemory(handle uintptr) {
	globalFree.Call(handle)
}

func openSystemClipboard() error {
	ok, _, callErr := openClipboard.Call(0)
	if ok == 0 {
		return win32CallError("open clipboard failed", callErr)
	}
	return nil
}

func closeSystemClipboard() {
	closeClipboard.Call()
}

func emptySystemClipboard() error {
	ok, _, callErr := emptyClipboard.Call()
	if ok == 0 {
		return win32CallError("empty clipboard failed", callErr)
	}
	return nil
}

func setSystemClipboardData(format uintptr, handle uintptr) error {
	ok, _, callErr := setClipboardData.Call(format, handle)
	if ok == 0 {
		return win32CallError("set clipboard data failed", callErr)
	}
	return nil
}

func win32CallError(message string, callErr error) error {
	if errno, ok := callErr.(syscall.Errno); ok && errno == 0 {
		return fmt.Errorf("%s", message)
	}
	return fmt.Errorf("%s: %v", message, callErr)
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
