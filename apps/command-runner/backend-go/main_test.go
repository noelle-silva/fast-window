package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestService(t *testing.T) *service {
	t.Helper()
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	return svc
}

func TestServiceCreatesDataFiles(t *testing.T) {
	svc := newTestService(t)

	for _, name := range []string{settingsFile, reposFile, commandsFile, metaFile, migrationsFile} {
		if _, err := os.Stat(filepath.Join(svc.dataDir, name)); err != nil {
			t.Fatalf("expected %s to exist: %v", name, err)
		}
	}

	settings, err := svc.readSettings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.DefaultShellID != defaultShellID {
		t.Fatalf("default shell = %q, want %q", settings.DefaultShellID, defaultShellID)
	}
	if settings.DefaultCloseMode != defaultCloseMode {
		t.Fatalf("default close mode = %q, want %q", settings.DefaultCloseMode, defaultCloseMode)
	}
}

func TestRepoAndCommandRoundTrip(t *testing.T) {
	svc := newTestService(t)

	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}

	created, err := svc.createCommand(commandDraft{
		RepoID:           repo.ID,
		Name:             "build",
		Script:           "go build ./...",
		Note:             "编译项目",
		ConfirmBeforeRun: true,
		CloseMode:        closeModeCountdown,
		CountdownSeconds: 15,
	})
	if err != nil {
		t.Fatal(err)
	}

	loaded, err := svc.listCommands(repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	items := loaded["commands"].([]command)
	if len(items) != 1 || items[0].ID != created.ID {
		t.Fatalf("unexpected commands: %+v", items)
	}
	if items[0].Note != "编译项目" || items[0].CountdownSeconds != 15 {
		t.Fatalf("unexpected command fields: %+v", items[0])
	}

	updated, err := svc.updateCommand(created.ID, commandDraft{
		RepoID:    repo.ID,
		Name:      "build",
		Script:    "go vet ./...",
		CloseMode: closeModeImmediate,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Script != "go vet ./..." || updated.Note != "" {
		t.Fatalf("unexpected updated command: %+v", updated)
	}

	if err := svc.deleteCommand(created.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.deleteRepo(repo.ID); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.loadRepos()
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Repos) != 0 {
		t.Fatalf("repos not empty: %+v", doc.Repos)
	}
}

func TestCreateRepoRejectsMissingDir(t *testing.T) {
	svc := newTestService(t)
	missing := filepath.Join(svc.dataDir, "not-exist")
	if _, err := svc.createRepo("missing", missing, "", 0, "", ""); err == nil {
		t.Fatal("expected error for missing directory")
	}
}

func TestCustomShellAddRemove(t *testing.T) {
	svc := newTestService(t)

	if _, err := svc.addCustomShell("nushell", filepath.Join(svc.dataDir, "missing.exe"), "{command}"); err == nil {
		t.Fatal("expected error for missing exe")
	}

	fakeExe := filepath.Join(svc.dataDir, "fake-shell.exe")
	if err := os.WriteFile(fakeExe, []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}

	settings, err := svc.addCustomShell("Fake Shell", fakeExe, `-NoLogo -Command "{command}"`)
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.CustomShells) != 1 {
		t.Fatalf("custom shells = %+v", settings.CustomShells)
	}
	if settings.CustomShells[0].ID == "" || !strings.HasPrefix(settings.CustomShells[0].ID, "custom-") {
		t.Fatalf("custom shell id = %q", settings.CustomShells[0].ID)
	}

	resolved, err := svc.resolveShell(settings.CustomShells[0].ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if resolved.exePath != fakeExe {
		t.Fatalf("resolved exe = %q, want %q", resolved.exePath, fakeExe)
	}

	removedID := settings.CustomShells[0].ID
	if _, err := svc.removeCustomShell(removedID); err != nil {
		t.Fatal(err)
	}
	fallback, err := svc.resolveShell(removedID, "")
	if err != nil {
		t.Fatal(err)
	}
	if fallback.exePath == fakeExe {
		t.Fatal("removed custom shell should not resolve anymore")
	}
}

func TestBuildWrapperScript(t *testing.T) {
	svc := newTestService(t)
	repo, err := svc.createRepo("demo", svc.dataDir, "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}

	command, err := svc.createCommand(commandDraft{
		RepoID:    repo.ID,
		Name:      "build",
		Script:    "go build ./...",
		CloseMode: closeModeCountdown,
	})
	if err != nil {
		t.Fatal(err)
	}

	shell, err := svc.resolveShell("", "")
	if err != nil {
		t.Fatal(err)
	}
	if !shell.available {
		t.Skip("cmd shell unavailable in test environment")
	}

	plan, err := svc.resolveRunPlan(command, repo)
	if err != nil {
		t.Fatal(err)
	}
	// 模拟 launchInNewConsole 的启动前序：写入脚本文件后回填到 plan。
	scriptPath, err := svc.writeScriptFile(command, plan.shell)
	if err != nil {
		t.Fatal(err)
	}
	plan.scriptPath = scriptPath

	wrapper := svc.buildWrapperScript(plan, repo.Path)
	if !strings.Contains(wrapper, "call "+inlineCmdLiteral(scriptPath)) {
		t.Fatalf("wrapper missing script call line: %q", wrapper)
	}
	if !strings.Contains(wrapper, `cd /d "`+strings.ReplaceAll(repo.Path, `\`, `\`)) {
		t.Fatalf("wrapper missing work dir: %q", wrapper)
	}
	if !strings.Contains(wrapper, "timeout /t 10 >nul") {
		t.Fatalf("wrapper missing countdown line: %q", wrapper)
	}
	if !strings.Contains(wrapper, "chcp 65001 >nul") {
		t.Fatalf("wrapper missing chcp line: %q", wrapper)
	}
}

func TestWrapperShellLinePerShell(t *testing.T) {
	script := `E:\tmp\run-1.cmd`
	work := `E:\tmp\work`

	cmdLine := buildWrapperShellLineWithWorkDir(shellDef{id: "cmd"}, script, work)
	if !strings.Contains(cmdLine, `call "E:\tmp\run-1.cmd"`) {
		t.Fatalf("cmd line = %q", cmdLine)
	}

	psLine := buildWrapperShellLineWithWorkDir(shellDef{id: "powershell", exePath: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`}, script, work)
	if !strings.Contains(psLine, `-ExecutionPolicy Bypass -File "E:\tmp\run-1.cmd"`) {
		t.Fatalf("powershell line = %q", psLine)
	}

	wslLine := buildWrapperShellLineWithWorkDir(shellDef{id: "wsl"}, script, work)
	if !strings.Contains(wslLine, `wsl.exe --cd "E:\tmp\work" bash "E:\tmp\run-1.cmd"`) {
		t.Fatalf("wsl line = %q", wslLine)
	}

	customLine := buildWrapperShellLineWithWorkDir(shellDef{id: "custom-x", exePath: `E:\custom\x.exe`, argsTemplate: `-NoLogo {command}`}, script, work)
	if !strings.Contains(customLine, `"E:\custom\x.exe" -NoLogo "E:\tmp\run-1.cmd"`) {
		t.Fatalf("custom line = %q", customLine)
	}

	// % 转义: 路径含 % 时应双写
	escaped := inlineCmdLiteral(`E:\tmp\100%file.cmd`)
	if !strings.Contains(escaped, `100%%file.cmd`) {
		t.Fatalf("escaped literal = %q", escaped)
	}
}

func TestResolveProcessOwnership(t *testing.T) {
	if got := resolveProcessOwnership("", "", ""); got != ownershipDetached {
		t.Fatalf("empty chain = %q, want detached", got)
	}
	if got := resolveProcessOwnership("", "attached", ""); got != ownershipAttached {
		t.Fatalf("repo override = %q, want attached", got)
	}
	if got := resolveProcessOwnership("detached", "attached", ""); got != ownershipDetached {
		t.Fatalf("command override = %q, want detached", got)
	}
	if got := resolveProcessOwnership("", "", "attached"); got != ownershipAttached {
		t.Fatalf("global = %q, want attached", got)
	}
	if got := resolveProcessOwnership("bogus", "", "attached"); got != ownershipAttached {
		t.Fatalf("invalid command falls through = %q, want attached", got)
	}
}

func TestResolveRunMode(t *testing.T) {
	if got := resolveRunMode("", "", ""); got != runModeConsole {
		t.Fatalf("empty chain = %q, want console", got)
	}
	if got := resolveRunMode("", runModeEmbedded, ""); got != runModeEmbedded {
		t.Fatalf("repo override = %q, want embedded", got)
	}
	if got := resolveRunMode(runModeConsole, runModeEmbedded, ""); got != runModeConsole {
		t.Fatalf("command override = %q, want console", got)
	}
	if got := resolveRunMode("", "", runModeEmbedded); got != runModeEmbedded {
		t.Fatalf("global = %q, want embedded", got)
	}
	if got := resolveRunMode("bogus", runModeEmbedded, ""); got != runModeEmbedded {
		t.Fatalf("invalid command falls through = %q, want embedded", got)
	}
}

func TestSettingsSaveValidation(t *testing.T) {
	svc := newTestService(t)

	if _, err := svc.saveGlobalSettings("unknown-shell", "", 0, "", ""); err == nil {
		t.Fatal("expected unknown shell error")
	}
	if _, err := svc.saveGlobalSettings("", "bogus-mode", 0, "", ""); err == nil {
		t.Fatal("expected invalid close mode error")
	}
	if _, err := svc.saveGlobalSettings("", "", 99999, "", ""); err == nil {
		t.Fatal("expected countdown range error")
	}

	settings, err := svc.saveGlobalSettings("pwsh", closeModeCountdown, 30, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if settings.DefaultShellID != "pwsh" || settings.DefaultCloseMode != closeModeCountdown || settings.DefaultCountdownSeconds != 30 {
		t.Fatalf("unexpected settings: %+v", settings)
	}
}

func TestBuildEmbeddedArgsPerShell(t *testing.T) {
	script := `E:\tmp\run-1.cmd`
	work := `E:\tmp\work`

	cmdArgs := buildEmbeddedArgs(shellDef{id: "cmd"}, script, work)
	if len(cmdArgs) != 4 || cmdArgs[0] != "/d" || cmdArgs[3] != script {
		t.Fatalf("cmd args = %v", cmdArgs)
	}

	psArgs := buildEmbeddedArgs(shellDef{id: "powershell"}, script, work)
	if len(psArgs) != 5 || psArgs[1] != "-ExecutionPolicy" || psArgs[4] != script {
		t.Fatalf("powershell args = %v", psArgs)
	}

	bashArgs := buildEmbeddedArgs(shellDef{id: "git-bash"}, script, work)
	if len(bashArgs) != 1 || bashArgs[0] != script {
		t.Fatalf("git-bash args = %v", bashArgs)
	}

	wslArgs := buildEmbeddedArgs(shellDef{id: "wsl"}, script, work)
	if len(wslArgs) != 4 || wslArgs[0] != "--cd" || wslArgs[1] != work || wslArgs[2] != "bash" || wslArgs[3] != script {
		t.Fatalf("wsl args = %v", wslArgs)
	}

	customArgs := buildEmbeddedArgs(shellDef{id: "custom-x", argsTemplate: `-NoLogo {command}`}, script, work)
	if len(customArgs) != 2 || customArgs[0] != "-NoLogo" || customArgs[1] != script {
		t.Fatalf("custom args = %v", customArgs)
	}
}

func TestReorderReposAndCommands(t *testing.T) {
	svc := newTestService(t)

	mkRepoDir := func(name string) string {
		dir := filepath.Join(svc.dataDir, name)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		return dir
	}

	repoA, err := svc.createRepo("A", mkRepoDir("a"), "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	repoB, err := svc.createRepo("B", mkRepoDir("b"), "", 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	repoC, err := svc.createRepo("C", mkRepoDir("c"), "", 0, "", "")
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

	// 正常重排
	if err := svc.reorderRepos([]string{repoC.ID, repoA.ID, repoB.ID}); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.loadRepos()
	if err != nil {
		t.Fatal(err)
	}
	if doc.Repos[0].ID != repoC.ID || doc.Repos[2].ID != repoB.ID {
		t.Fatalf("unexpected repo order: %+v", doc.Repos)
	}

	if err := svc.reorderCommands([]string{cmdB.ID, cmdA.ID}); err != nil {
		t.Fatal(err)
	}
	commandsDoc, err := svc.loadCommands()
	if err != nil {
		t.Fatal(err)
	}
	if commandsDoc.Commands[0].ID != cmdB.ID {
		t.Fatalf("unexpected command order: %+v", commandsDoc.Commands)
	}

	// ID 缺失拒绝
	if err := svc.reorderRepos([]string{repoC.ID, repoA.ID}); err == nil {
		t.Fatal("expected error for missing id")
	}
	// 未知 ID 拒绝
	if err := svc.reorderRepos([]string{repoC.ID, repoA.ID, repoB.ID, "repo-nope"}); err == nil {
		t.Fatal("expected error for unknown id")
	}
	// 重复 ID 拒绝
	if err := svc.reorderCommands([]string{cmdA.ID, cmdA.ID}); err == nil {
		t.Fatal("expected error for duplicate id")
	}
}
