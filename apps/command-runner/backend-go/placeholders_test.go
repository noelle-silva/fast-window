package main

import (
	"strings"
	"testing"
	"time"
)

func TestNormalizePlaceholders(t *testing.T) {
	normalized, err := normalizePlaceholders([]placeholder{
		{Name: " app-name ", Values: []string{" alpha ", "beta"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if normalized[0].Name != "app-name" || normalized[0].Values[0] != "alpha" {
		t.Fatalf("unexpected normalized placeholder: %+v", normalized[0])
	}

	cases := []struct {
		name string
		list []placeholder
		want string
	}{
		{"空名称", []placeholder{{Name: "  ", Values: []string{"a"}}}, "名称不能为空"},
		{"名称含花括号", []placeholder{{Name: "a{b", Values: []string{"a"}}}, "不能包含花括号"},
		{"名称重复", []placeholder{{Name: "a", Values: []string{"1"}}, {Name: "a", Values: []string{"2"}}}, "重复注册"},
		{"无候选值", []placeholder{{Name: "a"}}, "至少需要一个候选值"},
		{"候选值为空", []placeholder{{Name: "a", Values: []string{" "}}}, "候选值不能为空"},
		{"候选值重复", []placeholder{{Name: "a", Values: []string{"x", "x"}}}, "候选值重复"},
		{"候选值含换行", []placeholder{{Name: "a", Values: []string{"x\ny"}}}, "候选值不能包含换行"},
	}
	for _, tc := range cases {
		if _, err := normalizePlaceholders(tc.list); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: err = %v, want contains %q", tc.name, err, tc.want)
		}
	}

	empty, err := normalizePlaceholders(nil)
	if err != nil {
		t.Fatal(err)
	}
	if empty == nil || len(empty) != 0 {
		t.Fatalf("empty list should normalize to empty non-nil slice: %#v", empty)
	}
}

func TestNormalizePlaceholderValueModes(t *testing.T) {
	normalized, err := normalizePlaceholders([]placeholder{
		{Name: "env", Values: []string{" dev "}},
		{Name: "note", ValueMode: placeholderValueModeInput, Values: []string{" 草稿 ", "", "line1\nline2"}},
		{Name: "blank", ValueMode: placeholderValueModeInput},
	})
	if err != nil {
		t.Fatal(err)
	}
	// 缺省取值方式按 select 处理，候选值照旧规范化。
	if normalized[0].ValueMode != placeholderValueModeSelect || len(normalized[0].Values) != 1 || normalized[0].Values[0] != "dev" {
		t.Fatalf("default value mode should be select with normalized values: %+v", normalized[0])
	}
	// input 型的候选值只是草稿：原样保留，不 trim、不去重、不限空。
	if normalized[1].ValueMode != placeholderValueModeInput || len(normalized[1].Values) != 3 ||
		normalized[1].Values[0] != " 草稿 " || normalized[1].Values[1] != "" || normalized[1].Values[2] != "line1\nline2" {
		t.Fatalf("input placeholder draft values should stay as-is: %+v", normalized[1])
	}
	// input 型允许没有任何候选值。
	if normalized[2].Values == nil || len(normalized[2].Values) != 0 {
		t.Fatalf("input placeholder without values should normalize to empty slice: %+v", normalized[2])
	}

	if _, err := normalizePlaceholders([]placeholder{{Name: "a", ValueMode: "unknown", Values: []string{"v"}}}); err == nil || !strings.Contains(err.Error(), "未知取值方式") {
		t.Fatalf("unknown value mode should be rejected, got %v", err)
	}
}

func TestApplyDefaultPlaceholderModes(t *testing.T) {
	list := []placeholder{
		{Name: "a"},
		{Name: "b", ValueMode: placeholderValueModeInput},
	}
	applyDefaultPlaceholderModes(list)
	if list[0].ValueMode != placeholderValueModeSelect || list[1].ValueMode != placeholderValueModeInput {
		t.Fatalf("unexpected value modes after defaulting: %+v", list)
	}
}

// TestInputPlaceholderDraftPersistence 验证 input 型的取值方式与草稿候选值落库可回读，
// 切回 select 型前的草稿不会丢失。
func TestInputPlaceholderDraftPersistence(t *testing.T) {
	svc := newTestService(t)
	repo, err := svc.createRepo(repoDraft{
		Name: "A",
		Path: mkTestDir(t, svc, "a"),
		Placeholders: []placeholder{
			{Name: "note", ValueMode: placeholderValueModeInput, Values: []string{"draft", ""}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := svc.findRepo(repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.Placeholders) != 1 {
		t.Fatalf("placeholders not persisted: %+v", reloaded.Placeholders)
	}
	item := reloaded.Placeholders[0]
	if item.ValueMode != placeholderValueModeInput || len(item.Values) != 2 || item.Values[0] != "draft" || item.Values[1] != "" {
		t.Fatalf("input placeholder draft not preserved: %+v", item)
	}
}

func TestApplyPlaceholderValues(t *testing.T) {
	script := "run {{app}} --profile {{env}} {{app}}"
	if got := applyPlaceholderValues(script, map[string]string{"app": "demo", "env": "prod"}); got != "run demo --profile prod demo" {
		t.Fatalf("replace result = %q", got)
	}

	if got := applyPlaceholderValues("echo {{missing}}", nil); got != "echo {{missing}}" {
		t.Fatalf("unregistered reference should stay: %q", got)
	}

	// 前缀名称不互相误伤：{{app}} 的替换不得触碰 {{app-name}}。
	if got := applyPlaceholderValues("{{app}} {{app-name}}", map[string]string{"app": "A", "app-name": "B"}); got != "A B" {
		t.Fatalf("prefix names collided: %q", got)
	}

	// 引用必须与注册名精确一致；带空格的引用不是有效引用。
	if got := applyPlaceholderValues("echo {{ app }}", map[string]string{"app": "A"}); got != "echo {{ app }}" {
		t.Fatalf("spaced reference should stay: %q", got)
	}

	// 单遍替换：候选值里即使出现引用形式也只作为字面量写入，不再参与匹配。
	if got := applyPlaceholderValues("{{a}}", map[string]string{"a": "{{b}}", "b": "X"}); got != "{{b}}" {
		t.Fatalf("replacement should not be re-scanned: %q", got)
	}

	// 临时填写型运行时取值为空字符串：替换为空内容，而不是保留引用。
	if got := applyPlaceholderValues("echo [{{note}}]", map[string]string{"note": ""}); got != "echo []" {
		t.Fatalf("empty input value should replace with empty content: %q", got)
	}

	// 临时填写型支持多行内容：原样写入脚本。
	if got := applyPlaceholderValues("echo {{note}}", map[string]string{"note": "line1\nline2"}); got != "echo line1\nline2" {
		t.Fatalf("multiline input value should be written as-is: %q", got)
	}
}

func TestPlaceholderScopeUniqueness(t *testing.T) {
	svc := newTestService(t)
	repo, err := svc.createRepo(repoDraft{
		Name:         "A",
		Path:         mkTestDir(t, svc, "a"),
		Placeholders: []placeholder{{Name: "env", Values: []string{"dev", "prod"}}},
	})
	if err != nil {
		t.Fatal(err)
	}

	// 命令级与仓库级重名：拒绝
	_, err = svc.createCommand(commandDraft{
		RepoID: repo.ID, Name: "build", Script: "echo {{env}}",
		Placeholders: []placeholder{{Name: "env", Values: []string{"x"}}},
	})
	if err == nil || !strings.Contains(err.Error(), "仓库级占位符") {
		t.Fatalf("expected repo-level conflict, got %v", err)
	}

	cmdA, err := svc.createCommand(commandDraft{
		RepoID: repo.ID, Name: "a", Script: "echo {{app-name}}",
		Placeholders: []placeholder{{Name: "app-name", Values: []string{"alpha", "beta"}}},
	})
	if err != nil {
		t.Fatal(err)
	}

	// 命令之间重名：拒绝
	_, err = svc.createCommand(commandDraft{
		RepoID: repo.ID, Name: "b", Script: "echo {{app-name}}",
		Placeholders: []placeholder{{Name: "app-name", Values: []string{"gamma"}}},
	})
	if err == nil || !strings.Contains(err.Error(), "命令「a」") {
		t.Fatalf("expected command-level conflict, got %v", err)
	}

	// 更新命令保留自身名字：允许
	updated, err := svc.updateCommand(cmdA.ID, commandDraft{
		RepoID: repo.ID, Name: "a", Script: "echo {{app-name}} && echo {{app-name}}",
		Placeholders: []placeholder{{Name: "app-name", Values: []string{"alpha", "beta", "gamma"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Placeholders) != 1 || len(updated.Placeholders[0].Values) != 3 {
		t.Fatalf("unexpected updated placeholders: %+v", updated.Placeholders)
	}

	// 仓库级与命令级重名：拒绝（更新仓库时检查全部命令）
	_, err = svc.updateRepo(repo.ID, repoDraft{
		Name: "A", Path: repo.Path,
		Placeholders: []placeholder{{Name: "app-name", Values: []string{"x"}}},
	})
	if err == nil || !strings.Contains(err.Error(), "命令「a」") {
		t.Fatalf("expected repo update conflict, got %v", err)
	}

	// 仓库级保留自身旧名并新增不冲突项：允许，且落库可回读
	repoUpdated, err := svc.updateRepo(repo.ID, repoDraft{
		Name: "A", Path: repo.Path,
		Placeholders: []placeholder{
			{Name: "env", Values: []string{"dev", "prod", "staging"}},
			{Name: "region", Values: []string{"cn"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(repoUpdated.Placeholders) != 2 {
		t.Fatalf("unexpected repo placeholders: %+v", repoUpdated.Placeholders)
	}
	reloaded, err := svc.findRepo(repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.Placeholders) != 2 || reloaded.Placeholders[0].Name != "env" {
		t.Fatalf("placeholders not persisted: %+v", reloaded.Placeholders)
	}
}

// TestEmbeddedRunAppliesPlaceholderValues 集成验证：内置运行按本次取值替换脚本，
// 未提供取值的引用原样保留。
func TestEmbeddedRunAppliesPlaceholderValues(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	svc := newTestService(t)

	repo, err := svc.createRepo(repoDraft{
		Name:         "demo",
		Path:         svc.dataDir,
		Placeholders: []placeholder{{Name: "greeting", Values: []string{"hello", "hi"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	command, err := svc.createCommand(commandDraft{
		RepoID:    repo.ID,
		Name:      "greet",
		Script:    "echo {{greeting}} {{who}}",
		ShellID:   "cmd",
		CloseMode: closeModeImmediate,
		RunMode:   runModeEmbedded,
	})
	if err != nil {
		t.Fatal(err)
	}

	output := []string{}
	done := make(chan struct{})
	svc.bus.observer = func(event map[string]any) {
		if event["name"] == "run.output" {
			if text, ok := event["text"].(string); ok {
				output = append(output, text)
			}
		}
		if event["name"] == "run.ended" {
			close(done)
		}
	}

	if _, err := svc.runCommandByMode(command.ID, map[string]string{"greeting": "hi"}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("embedded run did not finish in time")
	}

	joined := strings.Join(output, "\n")
	if !strings.Contains(joined, "hi {{who}}") {
		t.Fatalf("expected replaced value with raw unregistered reference, got:\n%s", joined)
	}
}

// TestRunQuickRunPlaceholderValues 集成验证：快捷运行按命令分别套用各自的取值。
func TestRunQuickRunPlaceholderValues(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test skipped in short mode")
	}
	svc := newTestService(t)

	repo, err := svc.createRepo(repoDraft{
		Name: "demo",
		Path: svc.dataDir,
	})
	if err != nil {
		t.Fatal(err)
	}
	cmdA, err := svc.createCommand(commandDraft{
		RepoID: repo.ID, Name: "a", Script: "echo tag={{tag}}",
		ShellID: "cmd", CloseMode: closeModeImmediate, RunMode: runModeEmbedded,
		Placeholders: []placeholder{{Name: "tag", Values: []string{"A1", "A2"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	cmdB, err := svc.createCommand(commandDraft{
		RepoID: repo.ID, Name: "b", Script: "echo tag={{tag-b}}",
		ShellID: "cmd", CloseMode: closeModeImmediate, RunMode: runModeEmbedded,
		Placeholders: []placeholder{{Name: "tag-b", Values: []string{"B1", "B2"}}},
	})
	if err != nil {
		t.Fatal(err)
	}

	item, err := svc.createQuickRun("组合", []string{cmdA.ID, cmdB.ID})
	if err != nil {
		t.Fatal(err)
	}

	output := []string{}
	done := make(chan struct{}, 2)
	svc.bus.observer = func(event map[string]any) {
		if event["name"] == "run.output" {
			if text, ok := event["text"].(string); ok {
				output = append(output, text)
			}
		}
		if event["name"] == "run.ended" {
			done <- struct{}{}
		}
	}

	result, err := svc.runQuickRun(item.ID, map[string]map[string]string{
		cmdA.ID: {"tag": "A2"},
		cmdB.ID: {"tag-b": "B1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if started := result["started"].([]map[string]any); len(started) != 2 {
		t.Fatalf("started = %d, want 2", len(started))
	}
	for i := 0; i < 2; i++ {
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			t.Fatal("embedded runs did not finish in time")
		}
	}

	joined := strings.Join(output, "\n")
	if !strings.Contains(joined, "tag=A2") || !strings.Contains(joined, "tag=B1") {
		t.Fatalf("quick run placeholder values not applied per command:\n%s", joined)
	}
	if strings.Contains(joined, "tag=A1") || strings.Contains(joined, "tag=B2") {
		t.Fatalf("quick run applied wrong placeholder values:\n%s", joined)
	}
}
