package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureDataContractRequiresDataDir(t *testing.T) {
	if err := ensureDataContract("  "); err == nil {
		t.Fatal("expected error for empty data dir")
	}
}

func TestEnsureDataContractWritesMetaAndLedger(t *testing.T) {
	dir := t.TempDir()
	if err := ensureDataContract(dir); err != nil {
		t.Fatalf("ensureDataContract failed: %v", err)
	}

	metaPayload, err := os.ReadFile(filepath.Join(dir, dataMetaFile))
	if err != nil {
		t.Fatalf("read meta failed: %v", err)
	}
	var meta dataMetaDoc
	if err := json.Unmarshal(metaPayload, &meta); err != nil {
		t.Fatalf("decode meta failed: %v", err)
	}
	if meta.SchemaVersion != dataSchemaVersion || meta.DataVersion != dataVersion {
		t.Fatalf("unexpected meta versions: %+v", meta)
	}
	if meta.UpdatedAt == "" {
		t.Fatal("meta updatedAt missing")
	}

	ledgerPayload, err := os.ReadFile(filepath.Join(dir, dataMigrationsFile))
	if err != nil {
		t.Fatalf("read migrations ledger failed: %v", err)
	}
	var ledger dataMigrationsLedger
	if err := json.Unmarshal(ledgerPayload, &ledger); err != nil {
		t.Fatalf("decode migrations ledger failed: %v", err)
	}
	if ledger.SchemaVersion != dataSchemaVersion || ledger.DataVersion != dataVersion {
		t.Fatalf("unexpected ledger versions: %+v", ledger)
	}
	if ledger.Applied == nil {
		t.Fatal("ledger applied must be an empty list, not nil")
	}
}

func TestEnsureDataContractRejectsNewerDataVersion(t *testing.T) {
	dir := t.TempDir()
	newer := dataMigrationsLedger{
		SchemaVersion: dataSchemaVersion,
		DataVersion:   dataVersion + 1,
		Applied:       []dataMigrationEntry{},
	}
	payload, err := json.Marshal(newer)
	if err != nil {
		t.Fatalf("marshal ledger failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, dataMigrationsFile), payload, 0o644); err != nil {
		t.Fatalf("write ledger failed: %v", err)
	}

	if err := ensureDataContract(dir); err == nil {
		t.Fatal("expected error for newer data version")
	}
}
