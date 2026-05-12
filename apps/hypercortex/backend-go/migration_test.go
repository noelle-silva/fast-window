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
	mustWriteFile(t, filepath.Join(svc.dataDir, indexFile), `{"version":1,"notes":{"note-1":{"id":"note-1","title":"Note","description":"","dir":"Notes/2026-05/Note_note-1","createdAtMs":1,"updatedAtMs":2}}}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, refsIndexFile), `{}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, assetsIndexFile), `{"version":1,"assets":{}}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, notesDir, "2026-05", "Note_note-1", manifestFile), `{"schemaVersion":2,"id":"note-1","title":"Note"}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, assetsDir, "images", "asset.txt"), `asset`)
	mustWriteFile(t, filepath.Join(svc.dataDir, trashDir, "2026-05", "Trash_note-2", manifestFile), `{"schemaVersion":2,"id":"note-2","title":"Trash"}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, trashDir, "2026-05", "Trash_note-2", trashMetaFile), `{"version":1,"deletedAtMs":3,"originalDir":"Notes/2026-05/Trash_note-2"}`)

	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}

	mustExist(t, filepath.Join(svc.stateDir, metadataFile))
	mustExist(t, filepath.Join(svc.stateDir, favoritesFile))
	mustExist(t, filepath.Join(svc.libraryDir, indexFile))
	mustExist(t, filepath.Join(svc.libraryDir, refsIndexFile))
	mustExist(t, filepath.Join(svc.libraryDir, assetsIndexFile))
	mustExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "note-1", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "Note_note-1"))
	mustExist(t, filepath.Join(svc.libraryDir, assetsDir, "images", "asset.txt"))
	mustExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "note-2", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "Trash_note-2"))
	mustNotExist(t, filepath.Join(svc.dataDir, metadataFile))
	mustNotExist(t, filepath.Join(svc.dataDir, notesDir))

	var idx noteIndex
	if err := readJSONFile(filepath.Join(svc.libraryDir, indexFile), &idx); err != nil {
		t.Fatalf("read index failed: %v", err)
	}
	if got := idx.Notes["note-1"].Dir; got != "Notes/2026-05/note-1" {
		t.Fatalf("note dir = %q, want Notes/2026-05/note-1", got)
	}

	var trash trashMeta
	if err := readJSONFile(filepath.Join(svc.libraryDir, trashDir, "2026-05", "note-2", trashMetaFile), &trash); err != nil {
		t.Fatalf("read trash meta failed: %v", err)
	}
	if got := trash.OriginalDir; got != "Notes/2026-05/note-2" {
		t.Fatalf("trash originalDir = %q, want Notes/2026-05/note-2", got)
	}

	ledger := readLedger(t, svc)
	if ledger.DataVersion != currentDataVersion {
		t.Fatalf("dataVersion = %d, want %d", ledger.DataVersion, currentDataVersion)
	}
	if len(ledger.Applied) != 2 {
		t.Fatalf("applied count = %d, want 2", len(ledger.Applied))
	}
	if ledger.Applied[0].ID != stateLibraryLayoutMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[0].ID, stateLibraryLayoutMigration)
	}
	if ledger.Applied[1].ID != noteIDPackageDirMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[1].ID, noteIDPackageDirMigration)
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
	if len(ledger.Applied) != 2 {
		t.Fatalf("applied count = %d, want 2", len(ledger.Applied))
	}
}

func TestMigrateNotePackageDirsToIDsRenamesPackagesAndReferences(t *testing.T) {
	svc := newTestService(t)
	mustWriteFile(t, filepath.Join(svc.libraryDir, indexFile), `{"version":1,"notes":{"202605130001":{"id":"202605130001","title":"Named","description":"","dir":"Notes/2026-05/Named_202605130001","createdAtMs":1,"updatedAtMs":2}}}`)
	mustWriteFile(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "Named_202605130001", manifestFile), `{"schemaVersion":2,"id":"202605130001","title":"Named"}`)
	mustWriteFile(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "Deleted_202605130002", manifestFile), `{"schemaVersion":2,"id":"202605130002","title":"Deleted"}`)
	mustWriteFile(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "Deleted_202605130002", trashMetaFile), `{"version":1,"deletedAtMs":3,"originalDir":"Notes/2026-05/Deleted_202605130002"}`)

	if err := svc.migrateNotePackageDirsToIDs(); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	mustExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "202605130001", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "Named_202605130001"))
	mustExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "202605130002", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "Deleted_202605130002"))

	var idx noteIndex
	if err := readJSONFile(filepath.Join(svc.libraryDir, indexFile), &idx); err != nil {
		t.Fatalf("read index failed: %v", err)
	}
	if got := idx.Notes["202605130001"].Dir; got != "Notes/2026-05/202605130001" {
		t.Fatalf("note dir = %q, want Notes/2026-05/202605130001", got)
	}

	var trash trashMeta
	if err := readJSONFile(filepath.Join(svc.libraryDir, trashDir, "2026-05", "202605130002", trashMetaFile), &trash); err != nil {
		t.Fatalf("read trash meta failed: %v", err)
	}
	if got := trash.OriginalDir; got != "Notes/2026-05/202605130002" {
		t.Fatalf("trash originalDir = %q, want Notes/2026-05/202605130002", got)
	}
}

func TestImportLegacyDataNormalizesImportedNotePackageDirs(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	source := t.TempDir()
	mustWriteFile(t, filepath.Join(source, indexFile), `{"version":1,"notes":{"202605130003":{"id":"202605130003","title":"Imported","description":"","dir":"Notes/2026-05/Imported_202605130003","createdAtMs":1,"updatedAtMs":2}}}`)
	mustWriteFile(t, filepath.Join(source, notesDir, "2026-05", "Imported_202605130003", manifestFile), `{"schemaVersion":2,"id":"202605130003","title":"Imported"}`)
	mustWriteFile(t, filepath.Join(source, trashDir, "2026-05", "ImportedTrash_202605130004", manifestFile), `{"schemaVersion":2,"id":"202605130004","title":"ImportedTrash"}`)
	mustWriteFile(t, filepath.Join(source, trashDir, "2026-05", "ImportedTrash_202605130004", trashMetaFile), `{"version":1,"deletedAtMs":3,"originalDir":"Notes/2026-05/ImportedTrash_202605130004"}`)

	if _, err := svc.importLegacyData(source); err != nil {
		t.Fatalf("import failed: %v", err)
	}

	mustExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "202605130003", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "Imported_202605130003"))
	mustExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "202605130004", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "ImportedTrash_202605130004"))

	var idx noteIndex
	if err := readJSONFile(filepath.Join(svc.libraryDir, indexFile), &idx); err != nil {
		t.Fatalf("read index failed: %v", err)
	}
	if got := idx.Notes["202605130003"].Dir; got != "Notes/2026-05/202605130003" {
		t.Fatalf("note dir = %q, want Notes/2026-05/202605130003", got)
	}

	var trash trashMeta
	if err := readJSONFile(filepath.Join(svc.libraryDir, trashDir, "2026-05", "202605130004", trashMetaFile), &trash); err != nil {
		t.Fatalf("read trash meta failed: %v", err)
	}
	if got := trash.OriginalDir; got != "Notes/2026-05/202605130004" {
		t.Fatalf("trash originalDir = %q, want Notes/2026-05/202605130004", got)
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
