package main

import (
	"os"
	"testing"
)

func TestLoadExternalAccessReturnsEmptyDocAndDoesNotWrite(t *testing.T) {
	svc := testService(t)
	doc, err := svc.loadExternalAccess()
	if err != nil {
		t.Fatal(err)
	}
	if doc.Version != 1 || doc.Port != 0 || len(doc.Keys) != 0 {
		t.Fatalf("empty doc = %#v", doc)
	}
	if _, err := os.Stat(svc.externalAccessPath()); !os.IsNotExist(err) {
		t.Fatalf("loading a missing config must not write it, stat err = %v", err)
	}
}

func TestCreateExternalAccessKeyPersistsWithIdentity(t *testing.T) {
	svc := testService(t)
	doc, err := svc.createExternalAccessKey("  测试密钥  ")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Keys) != 1 {
		t.Fatalf("keys = %#v", doc.Keys)
	}
	entry := doc.Keys[0]
	if entry.Name != "测试密钥" || len(entry.Key) != 64 || entry.CreatedAtMs <= 0 {
		t.Fatalf("entry = %#v", entry)
	}
	second, err := svc.createExternalAccessKey("第二把")
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Keys) != 2 || second.Keys[0].Key == second.Keys[1].Key {
		t.Fatalf("keys must be unique: %#v", second.Keys)
	}
	reloaded, err := svc.loadExternalAccess()
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.Keys) != 2 || reloaded.Keys[0].Key != entry.Key {
		t.Fatalf("reloaded = %#v", reloaded)
	}
}

func TestCreateExternalAccessKeyRejectsBlankName(t *testing.T) {
	svc := testService(t)
	if _, err := svc.createExternalAccessKey("   "); err == nil {
		t.Fatal("blank name must be rejected")
	}
}

func TestUpdateExternalAccessKeyChangesNameOnly(t *testing.T) {
	svc := testService(t)
	created, err := svc.createExternalAccessKey("原名")
	if err != nil {
		t.Fatal(err)
	}
	target := created.Keys[0]
	updated, err := svc.updateExternalAccessKey(target.Key, "新名")
	if err != nil {
		t.Fatal(err)
	}
	entry := updated.Keys[0]
	if entry.Name != "新名" || entry.Key != target.Key || entry.CreatedAtMs != target.CreatedAtMs {
		t.Fatalf("updated entry = %#v", entry)
	}
	if _, err := svc.updateExternalAccessKey("missing", "新名"); err == nil {
		t.Fatal("missing key must be rejected")
	}
	if _, err := svc.updateExternalAccessKey(target.Key, "  "); err == nil {
		t.Fatal("blank name must be rejected")
	}
}

func TestDeleteExternalAccessKeyRemovesEntryAndPersists(t *testing.T) {
	svc := testService(t)
	first, err := svc.createExternalAccessKey("一")
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.createExternalAccessKey("二")
	if err != nil {
		t.Fatal(err)
	}
	removed, err := svc.deleteExternalAccessKey(first.Keys[0].Key)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed.Keys) != 1 || removed.Keys[0].Key != second.Keys[1].Key {
		t.Fatalf("removed = %#v", removed.Keys)
	}
	if _, err := svc.deleteExternalAccessKey("missing"); err == nil {
		t.Fatal("deleting a missing key must fail")
	}
}

func TestSaveExternalAccessPortValidatesRange(t *testing.T) {
	svc := testService(t)
	for _, invalid := range []float64{0, -1, 65536, 80.5} {
		if _, err := svc.saveExternalAccessPort(invalid); err == nil {
			t.Fatalf("port %v must be rejected", invalid)
		}
	}
}

func TestSaveExternalAccessPortStartsListening(t *testing.T) {
	svc := testService(t)
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := svc.saveExternalAccessPort(float64(port))
	if err != nil {
		t.Fatal(err)
	}
	if doc.Port != port {
		t.Fatalf("saved port = %d, want %d", doc.Port, port)
	}
	reloaded, err := svc.loadExternalAccess()
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Port != port {
		t.Fatalf("reloaded port = %d, want %d", reloaded.Port, port)
	}
}
