package main

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// notifyCapture 捕获后端发出的系统通知，测试环境不弹真实通知。
type notifyCapture struct {
	mu      sync.Mutex
	entries []string
}

func (c *notifyCapture) record(title, body string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = append(c.entries, fmt.Sprintf("%s|%s", title, body))
}

func (c *notifyCapture) snapshot() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.entries...)
}

func (c *notifyCapture) waitFor(t *testing.T, want string) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		for _, entry := range c.snapshot() {
			if entry == want {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("notification %s not received: %v", want, c.snapshot())
}

// assertEmptyAfter 在安静窗口后断言没有产生任何通知。
func (c *notifyCapture) assertEmptyAfter(t *testing.T, window time.Duration) {
	t.Helper()
	time.Sleep(window)
	if entries := c.snapshot(); len(entries) > 0 {
		t.Fatalf("unexpected notifications: %v", entries)
	}
}

func newEmbeddedNotifyCommand(t *testing.T, svc *service, repoID, name, script string, notify bool) command {
	t.Helper()
	cmd, err := svc.createCommand(commandDraft{
		RepoID:           repoID,
		Name:             name,
		Script:           script,
		ShellID:          "cmd",
		CloseMode:        closeModeImmediate,
		RunMode:          runModeEmbedded,
		NotifyOnComplete: notify,
	})
	if err != nil {
		t.Fatal(err)
	}
	return cmd
}

// TestCommandNotifyFieldRoundTrip 验证通知开关字段的创建/更新往返。
func TestCommandNotifyFieldRoundTrip(t *testing.T) {
	svc := newTestService(t)
	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}

	created, err := svc.createCommand(commandDraft{
		RepoID:           repo.ID,
		Name:             "build",
		Script:           "echo build",
		NotifyOnComplete: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !created.NotifyOnComplete {
		t.Fatalf("notify flag not persisted on create: %+v", created)
	}

	updated, err := svc.updateCommand(created.ID, commandDraft{
		RepoID: repo.ID,
		Name:   "build",
		Script: "echo build",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.NotifyOnComplete {
		t.Fatalf("notify flag not cleared on update: %+v", updated)
	}
}

// TestEmbeddedRunNotifiesOnCompletion 验证内置模式自然结束后由后端直接发送完成通知。
func TestEmbeddedRunNotifiesOnCompletion(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	svc := newTestService(t)
	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmd := newEmbeddedNotifyCommand(t, svc, repo.ID, "quick", "echo hi", true)

	capture := &notifyCapture{}
	svc.notify = capture.record

	if _, err := svc.runCommandByMode(cmd.ID); err != nil {
		t.Fatal(err)
	}
	capture.waitFor(t, "「quick」运行完成|demo · 退出码 0")
}

// TestEmbeddedRunNotifiesFailure 验证失败退出码的通知文案。
func TestEmbeddedRunNotifiesFailure(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	svc := newTestService(t)
	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmd := newEmbeddedNotifyCommand(t, svc, repo.ID, "bad", "exit /b 3", true)

	capture := &notifyCapture{}
	svc.notify = capture.record

	if _, err := svc.runCommandByMode(cmd.ID); err != nil {
		t.Fatal(err)
	}
	capture.waitFor(t, "「bad」运行失败|demo · 退出码 3")
}

// TestStoppedRunDoesNotNotify 验证手动停止不产生完成通知。
func TestStoppedRunDoesNotNotify(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	svc := newTestService(t)
	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cmd := newEmbeddedNotifyCommand(t, svc, repo.ID, "long", "ping -n 30 127.0.0.1 >nul", true)

	collector := &runEventCollector{}
	svc.bus.observer = collector.record
	capture := &notifyCapture{}
	svc.notify = capture.record

	first, err := svc.runCommandByMode(cmd.ID)
	if err != nil {
		t.Fatal(err)
	}
	firstRunID, _ := first["runId"].(string)
	collector.waitFor(t, "run.started:"+firstRunID)

	if err := svc.stopRun(firstRunID); err != nil {
		t.Fatal(err)
	}
	collector.waitFor(t, "run.ended:"+firstRunID)
	capture.assertEmptyAfter(t, 300*time.Millisecond)
}

// TestRunWithoutNotifyFlagDoesNotNotify 验证未开启开关的命令不产生通知。
func TestRunWithoutNotifyFlagDoesNotNotify(t *testing.T) {
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
	capture := &notifyCapture{}
	svc.notify = capture.record

	first, err := svc.runCommandByMode(cmd.ID)
	if err != nil {
		t.Fatal(err)
	}
	firstRunID, _ := first["runId"].(string)
	collector.waitFor(t, "run.ended:"+firstRunID)
	capture.assertEmptyAfter(t, 300*time.Millisecond)
}
