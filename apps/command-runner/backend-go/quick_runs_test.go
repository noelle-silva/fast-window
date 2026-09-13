package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func mkTestDir(t *testing.T, svc *service, name string) string {
	t.Helper()
	dir := filepath.Join(svc.dataDir, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func quickRunItems(t *testing.T, svc *service) []quickRun {
	t.Helper()
	loaded, err := svc.listQuickRuns()
	if err != nil {
		t.Fatal(err)
	}
	return loaded["quickRuns"].([]quickRun)
}

func TestQuickRunCRUD(t *testing.T) {
	svc := newTestService(t)

	repoA, err := svc.createRepo("A", mkTestDir(t, svc, "a"), "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	repoB, err := svc.createRepo("B", mkTestDir(t, svc, "b"), "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmdA, err := svc.createCommand(commandDraft{RepoID: repoA.ID, Name: "a", Script: "echo a"})
	if err != nil {
		t.Fatal(err)
	}
	cmdB, err := svc.createCommand(commandDraft{RepoID: repoA.ID, Name: "b", Script: "echo b"})
	if err != nil {
		t.Fatal(err)
	}
	cmdC, err := svc.createCommand(commandDraft{RepoID: repoB.ID, Name: "c", Script: "echo c"})
	if err != nil {
		t.Fatal(err)
	}

	// 创建跨仓库条目
	created, err := svc.createQuickRun("开工", []string{cmdA.ID, cmdC.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(created.ID, "quickrun-") {
		t.Fatalf("quick run id = %q", created.ID)
	}
	if strings.Join(created.CommandIDs, ",") != strings.Join([]string{cmdA.ID, cmdC.ID}, ",") {
		t.Fatalf("created refs = %v", created.CommandIDs)
	}

	items := quickRunItems(t, svc)
	if len(items) != 1 || items[0].ID != created.ID {
		t.Fatalf("unexpected quick runs: %+v", items)
	}

	// 更新：改名并重排引用顺序
	updated, err := svc.updateQuickRun(created.ID, "收工", []string{cmdC.ID, cmdA.ID, cmdB.ID})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "收工" || len(updated.CommandIDs) != 3 || updated.CommandIDs[0] != cmdC.ID {
		t.Fatalf("unexpected updated quick run: %+v", updated)
	}

	// 校验拒绝
	if _, err := svc.createQuickRun("   ", []string{cmdA.ID}); err == nil {
		t.Fatal("expected error for empty name")
	}
	if _, err := svc.createQuickRun("x", nil); err == nil {
		t.Fatal("expected error for empty command list")
	}
	if _, err := svc.createQuickRun("x", []string{cmdA.ID, cmdA.ID}); err == nil {
		t.Fatal("expected error for duplicated command")
	}
	if _, err := svc.createQuickRun("x", []string{"cmd-ghost"}); err == nil {
		t.Fatal("expected error for unknown command")
	}
	if _, err := svc.updateQuickRun("quickrun-ghost", "x", []string{cmdA.ID}); err == nil {
		t.Fatal("expected error for unknown quick run")
	}

	// 删除
	if err := svc.deleteQuickRun(created.ID); err != nil {
		t.Fatal(err)
	}
	if len(quickRunItems(t, svc)) != 0 {
		t.Fatalf("quick runs not empty after delete")
	}
	if err := svc.deleteQuickRun(created.ID); err == nil {
		t.Fatal("expected error deleting missing quick run")
	}
}

func TestQuickRunReferenceCleanup(t *testing.T) {
	svc := newTestService(t)

	repoA, err := svc.createRepo("A", mkTestDir(t, svc, "a"), "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	repoB, err := svc.createRepo("B", mkTestDir(t, svc, "b"), "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmdA, err := svc.createCommand(commandDraft{RepoID: repoA.ID, Name: "a", Script: "echo a"})
	if err != nil {
		t.Fatal(err)
	}
	cmdB, err := svc.createCommand(commandDraft{RepoID: repoA.ID, Name: "b", Script: "echo b"})
	if err != nil {
		t.Fatal(err)
	}
	cmdC, err := svc.createCommand(commandDraft{RepoID: repoB.ID, Name: "c", Script: "echo c"})
	if err != nil {
		t.Fatal(err)
	}

	groupA, err := svc.createQuickRun("A组", []string{cmdA.ID, cmdC.ID})
	if err != nil {
		t.Fatal(err)
	}
	groupB, err := svc.createQuickRun("B组", []string{cmdB.ID, cmdC.ID})
	if err != nil {
		t.Fatal(err)
	}

	// 删除单条命令：仅清理该引用，其余保持
	if err := svc.deleteCommand(cmdA.ID); err != nil {
		t.Fatal(err)
	}
	items := quickRunItems(t, svc)
	if len(items) != 2 {
		t.Fatalf("quick runs changed unexpectedly: %+v", items)
	}
	if len(items[0].CommandIDs) != 1 || items[0].CommandIDs[0] != cmdC.ID {
		t.Fatalf("groupA refs = %v", items[0].CommandIDs)
	}
	if len(items[1].CommandIDs) != 2 {
		t.Fatalf("groupB refs = %v", items[1].CommandIDs)
	}

	// 删除仓库：其名下全部命令的引用被批量清理
	if err := svc.deleteRepo(repoB.ID); err != nil {
		t.Fatal(err)
	}
	items = quickRunItems(t, svc)
	if len(items[0].CommandIDs) != 0 {
		t.Fatalf("groupA should be empty, got %v", items[0].CommandIDs)
	}
	if len(items[1].CommandIDs) != 1 || items[1].CommandIDs[0] != cmdB.ID {
		t.Fatalf("groupB refs = %v", items[1].CommandIDs)
	}
	if items[0].ID != groupA.ID || items[1].ID != groupB.ID {
		t.Fatalf("empty group should be kept: %+v", items)
	}
}

func TestEnsureQuickRuns(t *testing.T) {
	svc := newTestService(t)

	repo, err := svc.createRepo("A", mkTestDir(t, svc, "a"), "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmdA, err := svc.createCommand(commandDraft{RepoID: repo.ID, Name: "a", Script: "echo a"})
	if err != nil {
		t.Fatal(err)
	}

	// 人为破坏数据：悬空引用、重复引用、空条目
	doc, err := svc.loadQuickRuns()
	if err != nil {
		t.Fatal(err)
	}
	doc.QuickRuns = []quickRun{
		{ID: "quickrun-broken", Name: "组合", CommandIDs: []string{cmdA.ID, "cmd-ghost", cmdA.ID}},
		{ID: "quickrun-empty", Name: "空组合", CommandIDs: []string{}},
	}
	if err := svc.writeQuickRuns(doc); err != nil {
		t.Fatal(err)
	}

	if err := svc.ensureQuickRuns(); err != nil {
		t.Fatal(err)
	}
	items := quickRunItems(t, svc)
	if len(items) != 2 {
		t.Fatalf("unexpected quick runs: %+v", items)
	}
	if len(items[0].CommandIDs) != 1 || items[0].CommandIDs[0] != cmdA.ID {
		t.Fatalf("broken refs not normalized: %v", items[0].CommandIDs)
	}
	if len(items[1].CommandIDs) != 0 || items[1].Name != "空组合" {
		t.Fatalf("empty quick run should be kept: %+v", items[1])
	}
}

func TestRunQuickRunValidation(t *testing.T) {
	svc := newTestService(t)

	if _, err := svc.runQuickRun("quickrun-ghost"); err == nil {
		t.Fatal("expected error for unknown quick run")
	}

	doc, err := svc.loadQuickRuns()
	if err != nil {
		t.Fatal(err)
	}
	doc.QuickRuns = []quickRun{{ID: "quickrun-empty", Name: "空组合", CommandIDs: []string{}}}
	if err := svc.writeQuickRuns(doc); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.runQuickRun("quickrun-empty"); err == nil {
		t.Fatal("expected error for empty quick run")
	}
}

// TestRunQuickRunEmbedded 集成验证：条目内全部命令批量启动、失败不中断、启动结果可回执。
func TestRunQuickRunEmbedded(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	svc := newTestService(t)

	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmdA, err := svc.createCommand(commandDraft{
		RepoID: repo.ID, Name: "a", Script: "echo a", ShellID: "cmd",
		CloseMode: closeModeImmediate, RunMode: runModeEmbedded,
	})
	if err != nil {
		t.Fatal(err)
	}
	cmdB, err := svc.createCommand(commandDraft{
		RepoID: repo.ID, Name: "b", Script: "echo b", ShellID: "cmd",
		CloseMode: closeModeImmediate, RunMode: runModeEmbedded,
	})
	if err != nil {
		t.Fatal(err)
	}

	// cmdC 所在仓库目录被移除：启动时失败，验证不阻塞其他命令
	repoMissing, err := svc.createRepo("missing", mkTestDir(t, svc, "missing"), "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmdC, err := svc.createCommand(commandDraft{
		RepoID: repoMissing.ID, Name: "c", Script: "echo c", ShellID: "cmd",
		CloseMode: closeModeImmediate, RunMode: runModeEmbedded,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(repoMissing.Path); err != nil {
		t.Fatal(err)
	}

	item, err := svc.createQuickRun("组合", []string{cmdA.ID, cmdC.ID, cmdB.ID})
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{}, 2)
	svc.bus.observer = func(event map[string]any) {
		if event["name"] == "run.ended" {
			done <- struct{}{}
		}
	}

	result, err := svc.runQuickRun(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	started := result["started"].([]map[string]any)
	failures := result["failures"].([]map[string]any)
	if len(started) != 2 || len(failures) != 1 {
		t.Fatalf("started=%d failures=%d, want 2/1: %+v %+v", len(started), len(failures), started, failures)
	}
	if failures[0]["commandId"] != cmdC.ID || !strings.Contains(failures[0]["error"].(string), "仓库目录不存在") {
		t.Fatalf("unexpected failure entry: %+v", failures[0])
	}
	for _, entry := range started {
		if runID, ok := entry["runId"].(string); !ok || runID == "" {
			t.Fatalf("started entry missing runId: %+v", entry)
		}
	}

	for i := 0; i < 2; i++ {
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			t.Fatal("embedded runs did not finish in time")
		}
	}
}
