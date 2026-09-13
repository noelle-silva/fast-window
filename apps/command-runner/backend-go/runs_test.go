package main

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// runEventCollector 在线程安全的前提下收集启动/结束事件，供重启时序断言使用。
type runEventCollector struct {
	mu     sync.Mutex
	events []string
}

func (c *runEventCollector) record(event map[string]any) {
	name, _ := event["name"].(string)
	if name != "run.started" && name != "run.ended" {
		return
	}
	runID, _ := event["runId"].(string)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, fmt.Sprintf("%s:%s", name, runID))
}

func (c *runEventCollector) snapshot() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.events...)
}

func (c *runEventCollector) waitFor(t *testing.T, want string) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		for _, event := range c.snapshot() {
			if event == want {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("event %s not received: %v", want, c.snapshot())
}

func newEmbeddedTestCommand(t *testing.T, svc *service, repoID, name, script string) command {
	t.Helper()
	cmd, err := svc.createCommand(commandDraft{
		RepoID:    repoID,
		Name:      name,
		Script:    script,
		ShellID:   "cmd",
		CloseMode: closeModeImmediate,
		RunMode:   runModeEmbedded,
	})
	if err != nil {
		t.Fatal(err)
	}
	return cmd
}

// TestRestartRunReplacesRunningInstance 验证运行中重启：旧实例彻底结束（注册表移除）后新实例才启动，runId 更替。
func TestRestartRunReplacesRunningInstance(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	svc := newTestService(t)
	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmd := newEmbeddedTestCommand(t, svc, repo.ID, "long", "ping -n 30 127.0.0.1 >nul")

	collector := &runEventCollector{}
	svc.bus.observer = collector.record

	first, err := svc.runCommandByMode(cmd.ID)
	if err != nil {
		t.Fatal(err)
	}
	firstRunID, _ := first["runId"].(string)
	if firstRunID == "" {
		t.Fatalf("first run missing runId: %+v", first)
	}
	collector.waitFor(t, "run.started:"+firstRunID)

	result, err := svc.restartRun(firstRunID, cmd.ID)
	if err != nil {
		t.Fatal(err)
	}
	newRunID, _ := result["runId"].(string)
	if newRunID == "" || newRunID == firstRunID {
		t.Fatalf("new runId = %q, first = %q", newRunID, firstRunID)
	}

	// 新实例启动时，旧实例已从注册表移除（= 真正结束）。
	if _, ok := svc.runs.get(firstRunID); ok {
		t.Fatal("old run still registered after restart")
	}
	if _, ok := svc.runs.get(newRunID); !ok {
		t.Fatal("new run not registered after restart")
	}
	collector.waitFor(t, "run.ended:"+firstRunID)

	// 清理新实例，避免测试进程残留长命令。
	if err := svc.stopRun(newRunID); err != nil {
		t.Fatal(err)
	}
	collector.waitFor(t, "run.ended:"+newRunID)
}

// TestRestartRunEndedInstanceStartsFresh 验证已结束实例的重启：不需要再停止，直接启动新实例。
func TestRestartRunEndedInstanceStartsFresh(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	svc := newTestService(t)
	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmd := newEmbeddedTestCommand(t, svc, repo.ID, "quick", "echo hi")

	collector := &runEventCollector{}
	svc.bus.observer = collector.record

	first, err := svc.runCommandByMode(cmd.ID)
	if err != nil {
		t.Fatal(err)
	}
	firstRunID, _ := first["runId"].(string)
	collector.waitFor(t, "run.ended:"+firstRunID)
	if _, ok := svc.runs.get(firstRunID); ok {
		t.Fatal("run should be unregistered after ending")
	}

	result, err := svc.restartRun(firstRunID, cmd.ID)
	if err != nil {
		t.Fatal(err)
	}
	newRunID, _ := result["runId"].(string)
	if newRunID == "" || newRunID == firstRunID {
		t.Fatalf("new runId = %q, first = %q", newRunID, firstRunID)
	}
	collector.waitFor(t, "run.ended:"+newRunID)
}

// TestRestartRunRejectsMismatchedCommand 验证运行中实例与 commandId 不匹配时拒绝重启，且旧实例不被停止。
func TestRestartRunRejectsMismatchedCommand(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	svc := newTestService(t)
	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmdA := newEmbeddedTestCommand(t, svc, repo.ID, "a", "ping -n 30 127.0.0.1 >nul")
	cmdB := newEmbeddedTestCommand(t, svc, repo.ID, "b", "echo b")

	collector := &runEventCollector{}
	svc.bus.observer = collector.record

	first, err := svc.runCommandByMode(cmdA.ID)
	if err != nil {
		t.Fatal(err)
	}
	firstRunID, _ := first["runId"].(string)
	collector.waitFor(t, "run.started:"+firstRunID)

	if _, err := svc.restartRun(firstRunID, cmdB.ID); err == nil {
		t.Fatal("expected mismatch error")
	}
	if _, ok := svc.runs.get(firstRunID); !ok {
		t.Fatal("mismatched restart must not stop the running instance")
	}

	if err := svc.stopRun(firstRunID); err != nil {
		t.Fatal(err)
	}
	collector.waitFor(t, "run.ended:"+firstRunID)
}

func TestRestartRunValidation(t *testing.T) {
	svc := newTestService(t)

	if _, err := svc.restartRun("", ""); err == nil {
		t.Fatal("expected error for empty runId")
	}
	if _, err := svc.restartRun("run-ghost", ""); err == nil {
		t.Fatal("expected error when command cannot be located")
	}
	if _, err := svc.restartRun("run-ghost", "cmd-ghost"); err == nil {
		t.Fatal("expected error for unknown command")
	}
}
