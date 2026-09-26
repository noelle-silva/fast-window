package main

import (
	"os"
	"path/filepath"
	"testing"
)

// P3：插件声明指纹变化时重建派生索引；指纹一致时不重建。
func TestPluginDataStateRebuildsOnFirstRunAndSkipsWhenUnchanged(t *testing.T) {
	svc := newTestService(t)
	// 预置库目录与一条「陈旧」的搜索索引记录（无对应笔记）。
	if err := os.MkdirAll(filepath.Join(svc.libraryDir, notesDir), 0o755); err != nil {
		t.Fatal(err)
	}
	stale := noteSearchIndex{Version: 1, Notes: map[string]noteSearchEntry{"ghost": {Title: "陈旧"}}}
	if err := writeJSONFile(filepath.Join(svc.libraryDir, searchIndexFile), stale); err != nil {
		t.Fatal(err)
	}

	// 首次运行（无指纹状态）：重建派生索引，陈旧记录被清除，指纹落盘。
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	idx, err := svc.loadNoteSearchIndex("library")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := idx.Notes["ghost"]; ok {
		t.Fatal("first run should rebuild stale search index")
	}
	if _, err := os.Stat(filepath.Join(svc.libraryDir, facePluginsStateFile)); err != nil {
		t.Fatalf("plugin state file not written: %v", err)
	}

	// 同目录的新实例（模拟下次启动）：指纹一致时不重建，陈旧记录保持原样。
	if err := writeJSONFile(filepath.Join(svc.libraryDir, searchIndexFile), stale); err != nil {
		t.Fatal(err)
	}
	next := &service{dataDir: svc.dataDir, stateDir: svc.stateDir, libraryDir: svc.libraryDir, uploadTasks: newAssetUploadTaskStore()}
	if err := next.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	idx, err = next.loadNoteSearchIndex("library")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := idx.Notes["ghost"]; !ok {
		t.Fatal("unchanged fingerprint should not trigger rebuild")
	}
}
