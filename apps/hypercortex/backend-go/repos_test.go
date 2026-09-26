package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureRootsCreatesDefaultRepoOnFreshDataDir(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}

	repos, err := svc.listRepos()
	if err != nil {
		t.Fatalf("listRepos failed: %v", err)
	}
	if len(repos) != 1 || repos[0].Title != "默认仓库" {
		t.Fatalf("fresh pool = %#v, want single 默认仓库", repos)
	}
	root, err := svc.repoRoot(repos[0].ID)
	if err != nil {
		t.Fatalf("repoRoot failed: %v", err)
	}
	mustExist(t, filepath.Join(root, repoIdentityFile))
	mustExist(t, filepath.Join(root, notesDir))
	mustExist(t, filepath.Join(root, assetsDir, "images"))
	mustExist(t, filepath.Join(root, trashDir))

	// 幂等：再次 ensureRoots 不新增仓库。
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("second ensureRoots failed: %v", err)
	}
	repos, err = svc.listRepos()
	if err != nil {
		t.Fatal(err)
	}
	if len(repos) != 1 {
		t.Fatalf("ensureRoots not idempotent: %#v", repos)
	}
}

func TestCreateRepoPublishesCompleteIdentityAndLeavesNoTempDir(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}

	created, err := svc.createRepo("资料库")
	if err != nil {
		t.Fatalf("createRepo failed: %v", err)
	}
	if !isRepoID(created.ID) || created.Title != "资料库" || created.CreatedAtMs <= 0 {
		t.Fatalf("created identity = %#v", created)
	}
	root, err := svc.repoRoot(created.ID)
	if err != nil {
		t.Fatalf("repoRoot failed: %v", err)
	}
	var identity repoIdentity
	if err := readJSONFile(filepath.Join(root, repoIdentityFile), &identity); err != nil {
		t.Fatalf("read identity failed: %v", err)
	}
	if identity.ID != created.ID || identity.Title != "资料库" || identity.Version != 1 {
		t.Fatalf("persisted identity = %#v, want %#v", identity, created)
	}
	mustExist(t, filepath.Join(root, notesDir))

	repos, err := svc.listRepos()
	if err != nil {
		t.Fatal(err)
	}
	if len(repos) != 2 || repos[1].ID != created.ID {
		t.Fatalf("pool after create = %#v", repos)
	}
	entries, err := os.ReadDir(svc.reposDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".creating-") {
			t.Fatalf("temporary repo directory left behind: %s", entry.Name())
		}
	}
}

func TestRepoRootRejectsInvalidOrMissingRepo(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	for _, bad := range []string{"", "../escape", "not-a-repo-id", strings.Repeat("g", 32)} {
		if _, err := svc.repoRoot(bad); err == nil {
			t.Fatalf("repoRoot(%q) should fail", bad)
		}
	}
	if _, err := svc.repoRoot(strings.Repeat("a", 32)); err == nil {
		t.Fatal("repoRoot on missing repo should fail")
	}
}

func TestScopeRootResolvesRepoAndKeepsLegacyInternalOnly(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	repoID := testRepoID(t, svc)

	root, err := svc.scopeRoot(repoID)
	if err != nil {
		t.Fatalf("scopeRoot repo failed: %v", err)
	}
	if root != testRepoRoot(t, svc) {
		t.Fatalf("scopeRoot repo = %q, want %q", root, testRepoRoot(t, svc))
	}
	if legacyRoot, err := svc.scopeRoot(legacyLibraryName); err != nil || legacyRoot != svc.legacyLibraryDir {
		t.Fatalf("legacy scope = %q err=%v, want %q", legacyRoot, err, svc.legacyLibraryDir)
	}

	// 客户端作用域只接受 data 与仓库 ID，历史库别名必须被拒绝。
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("requireScope(legacy) must panic")
			}
		}()
		requireScope(json.RawMessage(`{"scope":"library"}`))
	}()
	if got := requireScope(json.RawMessage(`{"scope":"` + repoID + `"}`)); got != repoID {
		t.Fatalf("requireScope repo = %q, want %q", got, repoID)
	}
	if got := requireScope(json.RawMessage(`{"scope":"data"}`)); got != "data" {
		t.Fatalf("requireScope data = %q", got)
	}
}

func TestListReposSkipsDirectoriesWithoutIdentity(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(svc.reposDir, ".creating-orphan"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(svc.reposDir, "malformed"), 0o755); err != nil {
		t.Fatal(err)
	}
	repos, err := svc.listRepos()
	if err != nil {
		t.Fatalf("listRepos failed: %v", err)
	}
	if len(repos) != 1 {
		t.Fatalf("listRepos = %#v, want only the default repo", repos)
	}
}

func TestMigrateRepoPoolLayoutReusesLegacyIdentityOnRetry(t *testing.T) {
	svc := newTestService(t)
	if err := svc.writeMigrationsLedger(migrationsLedger{SchemaVersion: 1, DataVersion: 8, Applied: []migrationEntry{}}); err != nil {
		t.Fatalf("write ledger failed: %v", err)
	}
	fixedID := "0000000000000000000000000000000a"
	mustWriteFile(t, filepath.Join(svc.legacyLibraryDir, repoIdentityFile), `{"version":1,"id":"`+fixedID+`","title":"默认仓库","createdAtMs":123}`)
	mustWriteFile(t, filepath.Join(svc.legacyLibraryDir, notesDir, "2026-09", "note-1", manifestFile), `{"schemaVersion":2,"id":"note-1","title":"Note"}`)

	if err := svc.runDataMigrations(); err != nil {
		t.Fatalf("runDataMigrations failed: %v", err)
	}

	mustNotExist(t, svc.legacyLibraryDir)
	root, err := svc.repoRoot(fixedID)
	if err != nil {
		t.Fatalf("migrated repo missing: %v", err)
	}
	mustExist(t, filepath.Join(root, notesDir, "2026-09", "note-1", manifestFile))
	identity, err := svc.readRepoIdentity(root)
	if err != nil {
		t.Fatal(err)
	}
	if identity.ID != fixedID || identity.Title != "默认仓库" || identity.CreatedAtMs != 123 {
		t.Fatalf("identity after migration = %#v", identity)
	}
}

func TestActivateRepoReconcilesPluginStatePerRepo(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	first := testRepoID(t, svc)
	second, err := svc.createRepo("第二仓库")
	if err != nil {
		t.Fatalf("createRepo failed: %v", err)
	}

	if _, err := svc.activateRepo(first); err != nil {
		t.Fatalf("activate first failed: %v", err)
	}
	if _, err := svc.activateRepo(second.ID); err != nil {
		t.Fatalf("activate second failed: %v", err)
	}
	secondRoot, err := svc.repoRoot(second.ID)
	if err != nil {
		t.Fatal(err)
	}
	mustExist(t, filepath.Join(secondRoot, facePluginsStateFile))

	// 缺身份的仓库不可激活。
	if _, err := svc.activateRepo(strings.Repeat("b", 32)); err == nil {
		t.Fatal("activate missing repo should fail")
	}
}
