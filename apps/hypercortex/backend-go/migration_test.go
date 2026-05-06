package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func newTestService(t *testing.T) *service {
	t.Helper()
	dataDir := t.TempDir()
	return &service{
		dataDir:    dataDir,
		stateDir:   filepath.Join(dataDir, stateDirName),
		libraryDir: filepath.Join(dataDir, libraryDirName),
	}
}

func TestRunDataMigrationsMovesLegacyLayoutAndWritesLedger(t *testing.T) {
	svc := newTestService(t)
	mustWriteFile(t, filepath.Join(svc.dataDir, metadataFile), `{"version":1}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, favoritesFile), `{"version":1}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, indexFile), `{"version":1,"notes":{}}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, refsIndexFile), `{}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, assetsIndexFile), `{"version":1,"assets":{}}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, notesDir, "2026-05", "note-1", manifestFile), `{"schemaVersion":2,"id":"note-1","title":"Note"}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, assetsDir, "images", "asset.txt"), `asset`)
	mustWriteFile(t, filepath.Join(svc.dataDir, trashDir, "2026-05", "note-2", manifestFile), `{"schemaVersion":2,"id":"note-2","title":"Trash"}`)

	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}

	mustExist(t, filepath.Join(svc.stateDir, metadataFile))
	mustExist(t, filepath.Join(svc.stateDir, favoritesFile))
	mustExist(t, filepath.Join(svc.libraryDir, indexFile))
	mustExist(t, filepath.Join(svc.libraryDir, refsIndexFile))
	mustExist(t, filepath.Join(svc.libraryDir, assetsIndexFile))
	mustExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "note-1", manifestFile))
	mustExist(t, filepath.Join(svc.libraryDir, assetsDir, "images", "asset.txt"))
	mustExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "note-2", manifestFile))
	mustNotExist(t, filepath.Join(svc.dataDir, metadataFile))
	mustNotExist(t, filepath.Join(svc.dataDir, notesDir))

	ledger := readLedger(t, svc)
	if ledger.DataVersion != currentDataVersion {
		t.Fatalf("dataVersion = %d, want %d", ledger.DataVersion, currentDataVersion)
	}
	if len(ledger.Applied) != 1 {
		t.Fatalf("applied count = %d, want 1", len(ledger.Applied))
	}
	if ledger.Applied[0].ID != stateLibraryLayoutMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[0].ID, stateLibraryLayoutMigration)
	}
}

func TestRunDataMigrationsIsIdempotentAfterLedgerExists(t *testing.T) {
	svc := newTestService(t)

	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("first ensureRoots failed: %v", err)
	}
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("second ensureRoots failed: %v", err)
	}

	ledger := readLedger(t, svc)
	if ledger.DataVersion != currentDataVersion {
		t.Fatalf("dataVersion = %d, want %d", ledger.DataVersion, currentDataVersion)
	}
	if len(ledger.Applied) != 1 {
		t.Fatalf("applied count = %d, want 1", len(ledger.Applied))
	}
}

func TestRunMigrationsWritesRecoveryOnFailure(t *testing.T) {
	svc := newTestService(t)
	if err := os.MkdirAll(svc.dataDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := svc.runMigrations([]dataMigration{
		{
			ID:          "failing-migration",
			FromVersion: 0,
			ToVersion:   1,
			Run: func(*service) error {
				return errors.New("boom")
			},
		},
	})
	if err == nil {
		t.Fatal("expected migration failure")
	}

	var recovery migrationRecoveryDoc
	if readErr := readJSONFile(filepath.Join(svc.dataDir, migrationRecoveryDir, migrationRecoveryFile), &recovery); readErr != nil {
		t.Fatalf("read recovery failed: %v", readErr)
	}
	if recovery.MigrationID != "failing-migration" {
		t.Fatalf("migration id = %q, want failing-migration", recovery.MigrationID)
	}
	if recovery.Error != "boom" {
		t.Fatalf("error = %q, want boom", recovery.Error)
	}
}

func mustWriteFile(t *testing.T, path string, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustExist(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected %s to exist: %v", path, err)
	}
}

func mustNotExist(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected %s to be absent, err=%v", path, err)
	}
}

func readLedger(t *testing.T, svc *service) migrationsLedger {
	t.Helper()
	var ledger migrationsLedger
	if err := readJSONFile(filepath.Join(svc.dataDir, migrationsLedgerFile), &ledger); err != nil {
		t.Fatalf("read ledger failed: %v", err)
	}
	return ledger
}
