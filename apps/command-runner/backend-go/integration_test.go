package main

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// TestEmbeddedRunPristineEnv 端到端验证内置空间运行命令时的环境纯净：
// 通过 runEmbeddedCommand 执行"环境打印"，断言输出不含 App 私有变量。
func TestEmbeddedRunPristineEnv(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	svc := newTestService(t)

	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}

	command, err := svc.createCommand(commandDraft{
		RepoID:    repo.ID,
		Name:      "env-dump",
		Script:    `set`,
		ShellID:   "cmd",
		CloseMode: closeModeImmediate,
		RunMode:   runModeEmbedded,
	})
	if err != nil {
		t.Fatal(err)
	}

	output := []string{}
	emitter := make(chan struct{})
	svc.bus.observer = func(event map[string]any) {
		if event["name"] == "run.output" {
			if text, ok := event["text"].(string); ok {
				output = append(output, text)
			}
		}
		if event["name"] == "run.ended" {
			close(emitter)
		}
	}

	if _, err := svc.runCommandByMode(command.ID); err != nil {
		t.Fatal(err)
	}

	select {
	case <-emitter:
	case <-time.After(15 * time.Second):
		t.Fatal("embedded run did not finish in time")
	}

	joined := strings.Join(output, "\n")
	fmt.Printf("=== embedded env dump (first 60 lines) ===\n%s\n", truncate(joined, 60))

	for _, forbidden := range []string{"FW_APP_", "CR_", "ELECTRON_"} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("embedded env leaked %s pollution:\n%s", forbidden, truncate(joined, 30))
		}
	}
	for _, required := range []string{"SystemRoot=", "TEMP=", "USERNAME="} {
		if !strings.Contains(joined, required) {
			t.Fatalf("embedded env missing %s:\n%s", required, truncate(joined, 30))
		}
	}
}

func truncate(value string, lines int) string {
	all := strings.Split(value, "\n")
	if len(all) <= lines {
		return value
	}
	return strings.Join(all[:lines], "\n") + "\n..."
}
