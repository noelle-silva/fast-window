//go:build !windows

package main

// notifySystem 在非 Windows 平台不做任何事（系统通知能力目前仅随 Windows 后端提供）。
func notifySystem(title, body string) {}
