//go:build !windows

package main

import "fmt"

func openFileWithDefaultApp(string) error {
	return fmt.Errorf("open path is only implemented for Windows")
}

func revealFileInExplorer(string) error {
	return fmt.Errorf("reveal path is only implemented for Windows")
}

func copyPathToClipboard(string) error {
	return fmt.Errorf("copy path is only implemented for Windows")
}

func windowsExplorerSelectArgs(path string) []string {
	return []string{"/select,", path}
}
