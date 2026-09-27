package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadExternalAccessReturnsEmptyDocAndDoesNotWrite(t *testing.T) {
	svc := newTestService(t)
	doc, err := svc.loadExternalAccess()
	if err != nil {
		t.Fatalf("loadExternalAccess failed: %v", err)
	}
	if doc.Version != 1 || doc.Port != 0 || len(doc.Keys) != 0 {
		t.Fatalf("fresh access doc = %#v", doc)
	}
	mustNotExist(t, filepath.Join(svc.stateDir, accessFile))
}

func TestCreateExternalAccessKeyPersistsWithIdentity(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	repoID := testRepoID(t, svc)

	doc, err := svc.createExternalAccessKey(repoID, " 主力密钥 ")
	if err != nil {
		t.Fatalf("createExternalAccessKey failed: %v", err)
	}
	if len(doc.Keys) != 1 {
		t.Fatalf("keys = %#v", doc.Keys)
	}
	entry := doc.Keys[0]
	if entry.Name != "主力密钥" {
		t.Fatalf("name = %q, want 主力密钥", entry.Name)
	}
	if len(entry.Key) != 64 || strings.Trim(entry.Key, "0123456789abcdef") != "" {
		t.Fatalf("key format = %q, want 64-hex", entry.Key)
	}
	if entry.RepoID != repoID || entry.CreatedAtMs <= 0 {
		t.Fatalf("entry = %#v", entry)
	}

	reloaded, err := svc.loadExternalAccess()
	if err != nil {
		t.Fatalf("reload failed: %v", err)
	}
	if len(reloaded.Keys) != 1 || reloaded.Keys[0].Key != entry.Key || reloaded.Keys[0].Name != "主力密钥" {
		t.Fatalf("reloaded keys = %#v, want %#v", reloaded.Keys, entry)
	}
	mustExist(t, filepath.Join(svc.stateDir, accessFile))

	second, err := svc.createExternalAccessKey(repoID, "备用密钥")
	if err != nil {
		t.Fatalf("second create failed: %v", err)
	}
	if len(second.Keys) != 2 || second.Keys[0].Key == second.Keys[1].Key {
		t.Fatalf("second create keys = %#v", second.Keys)
	}
}

func TestCreateExternalAccessKeyRejectsInvalidInput(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	repoID := testRepoID(t, svc)
	if _, err := svc.createExternalAccessKey(strings.Repeat("a", 32), "密钥"); err == nil {
		t.Fatal("unknown repo must be rejected")
	}
	if _, err := svc.createExternalAccessKey("not-a-repo-id", "密钥"); err == nil {
		t.Fatal("invalid repo id must be rejected")
	}
	if _, err := svc.createExternalAccessKey(repoID, "   "); err == nil {
		t.Fatal("blank name must be rejected")
	}
}

func TestUpdateExternalAccessKeyChangesNameAndRepoOnly(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	firstRepo := testRepoID(t, svc)
	secondRepo, err := svc.createRepo("第二仓库")
	if err != nil {
		t.Fatalf("createRepo failed: %v", err)
	}
	created, err := svc.createExternalAccessKey(firstRepo, "原名称")
	if err != nil {
		t.Fatalf("createExternalAccessKey failed: %v", err)
	}
	before := created.Keys[0]

	doc, err := svc.updateExternalAccessKey(before.Key, secondRepo.ID, "新名称")
	if err != nil {
		t.Fatalf("updateExternalAccessKey failed: %v", err)
	}
	if len(doc.Keys) != 1 {
		t.Fatalf("keys = %#v", doc.Keys)
	}
	after := doc.Keys[0]
	if after.Name != "新名称" || after.RepoID != secondRepo.ID {
		t.Fatalf("updated entry = %#v", after)
	}
	if after.Key != before.Key || after.CreatedAtMs != before.CreatedAtMs {
		t.Fatalf("key/createdAt must stay unchanged: before=%#v after=%#v", before, after)
	}

	if _, err := svc.updateExternalAccessKey(strings.Repeat("f", 64), secondRepo.ID, "新名称"); err == nil {
		t.Fatal("missing key must be rejected")
	}
	if _, err := svc.updateExternalAccessKey(before.Key, secondRepo.ID, "  "); err == nil {
		t.Fatal("blank name must be rejected")
	}
	if _, err := svc.updateExternalAccessKey(before.Key, strings.Repeat("a", 32), "新名称"); err == nil {
		t.Fatal("unknown repo must be rejected")
	}
}

func TestDeleteExternalAccessKeyRemovesEntryAndPersists(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	repoID := testRepoID(t, svc)
	first, err := svc.createExternalAccessKey(repoID, "甲")
	if err != nil {
		t.Fatalf("create first failed: %v", err)
	}
	second, err := svc.createExternalAccessKey(repoID, "乙")
	if err != nil {
		t.Fatalf("create second failed: %v", err)
	}

	doc, err := svc.deleteExternalAccessKey(first.Keys[0].Key)
	if err != nil {
		t.Fatalf("deleteExternalAccessKey failed: %v", err)
	}
	if len(doc.Keys) != 1 || doc.Keys[0].Key != second.Keys[1].Key || doc.Keys[0].Name != "乙" {
		t.Fatalf("keys after delete = %#v", doc.Keys)
	}
	reloaded, err := svc.loadExternalAccess()
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.Keys) != 1 || reloaded.Keys[0].Name != "乙" {
		t.Fatalf("reloaded keys = %#v", reloaded.Keys)
	}
	if _, err := svc.deleteExternalAccessKey(first.Keys[0].Key); err == nil {
		t.Fatal("deleting a missing key must fail")
	}
}

func TestSaveExternalAccessPortValidatesRange(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	doc, err := svc.saveExternalAccessPort(8765)
	if err != nil {
		t.Fatalf("saveExternalAccessPort failed: %v", err)
	}
	if doc.Port != 8765 {
		t.Fatalf("port = %d, want 8765", doc.Port)
	}
	for _, bad := range []float64{0, -1, 65536, 80.5} {
		if _, err := svc.saveExternalAccessPort(bad); err == nil {
			t.Fatalf("port %v must be rejected", bad)
		}
	}
	persisted, err := svc.loadExternalAccess()
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Port != 8765 {
		t.Fatalf("persisted port = %d, want 8765", persisted.Port)
	}
}
