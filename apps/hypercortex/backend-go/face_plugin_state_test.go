package main

import (
	"path/filepath"
	"testing"
)

// P3：仓库激活时按插件声明指纹调和派生索引；指纹一致时不重建。
func TestPluginDataStateRebuildsOnActivateAndSkipsWhenUnchanged(t *testing.T) {
	svc := newTestService(t)
	identity, err := svc.createRepo("测试仓库")
	if err != nil {
		t.Fatalf("createRepo failed: %v", err)
	}
	repoRoot, err := svc.repoRoot(identity.ID)
	if err != nil {
		t.Fatalf("repoRoot failed: %v", err)
	}

	// 预置一条「陈旧」的搜索索引记录（无对应笔记）。
	stale := noteSearchIndex{Version: 1, Notes: map[string]noteSearchEntry{"ghost": {Title: "陈旧"}}}
	if err := writeJSONFile(filepath.Join(repoRoot, searchIndexFile), stale); err != nil {
		t.Fatal(err)
	}

	// 首次激活（无指纹状态）：重建派生索引，陈旧记录被清除，指纹落盘。
	if _, err := svc.activateRepo(identity.ID); err != nil {
		t.Fatalf("activateRepo failed: %v", err)
	}
	idx, err := svc.loadNoteSearchIndex(identity.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := idx.Notes["ghost"]; ok {
		t.Fatal("first activation should rebuild stale search index")
	}
	if !exists(filepath.Join(repoRoot, facePluginsStateFile)) {
		t.Fatal("plugin state file not written")
	}

	// 同目录的新实例（模拟下次启动）：指纹一致时不重建，陈旧记录保持原样。
	if err := writeJSONFile(filepath.Join(repoRoot, searchIndexFile), stale); err != nil {
		t.Fatal(err)
	}
	next := &service{
		dataDir:          svc.dataDir,
		stateDir:         svc.stateDir,
		reposDir:         svc.reposDir,
		repoTrashDir:     svc.repoTrashDir,
		legacyLibraryDir: svc.legacyLibraryDir,
		uploadTasks:      newAssetUploadTaskStore(),
		pluginReadyRepos: map[string]bool{},
	}
	if _, err := next.activateRepo(identity.ID); err != nil {
		t.Fatalf("second activateRepo failed: %v", err)
	}
	idx, err = next.loadNoteSearchIndex(identity.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := idx.Notes["ghost"]; !ok {
		t.Fatal("unchanged fingerprint should not trigger rebuild")
	}
}
