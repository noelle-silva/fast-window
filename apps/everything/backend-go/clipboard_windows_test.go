//go:build windows

package main

import (
	"encoding/binary"
	"testing"
	"unsafe"
)

func TestWindowsDropFilesPayloadUsesWideCFHDrop(t *testing.T) {
	path := `D:\Projects\demo.txt`
	payload := windowsDropFilesPayload([]string{path})
	headerSize := int(unsafe.Sizeof(dropFilesHeader{}))
	if len(payload) <= headerSize {
		t.Fatalf("drop files payload is too small: %d", len(payload))
	}
	if got := binary.LittleEndian.Uint32(payload[0:4]); got != uint32(headerSize) {
		t.Fatalf("pFiles = %d, want %d", got, headerSize)
	}
	if got := binary.LittleEndian.Uint32(payload[16:20]); got != 1 {
		t.Fatalf("fWide = %d, want 1", got)
	}
	encodedPaths := payload[headerSize:]
	if len(encodedPaths) != (len([]rune(path))+2)*2 {
		t.Fatalf("encoded paths byte count = %d", len(encodedPaths))
	}
	if got := binary.LittleEndian.Uint16(payload[len(payload)-4:]); got != 0 {
		t.Fatalf("path must end with NUL terminator, got %d", got)
	}
	if got := binary.LittleEndian.Uint16(payload[len(payload)-2:]); got != 0 {
		t.Fatalf("payload must end with double NUL terminator, got %d", got)
	}
}

func TestWindowsDropEffectPayloadUsesCopyAction(t *testing.T) {
	payload := windowsDropEffectPayload(dropEffectCopy)
	if got := binary.LittleEndian.Uint32(payload); got != dropEffectCopy {
		t.Fatalf("drop effect = %d, want copy", got)
	}
}
