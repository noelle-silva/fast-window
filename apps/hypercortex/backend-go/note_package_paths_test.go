package main

import "testing"

func TestNotePackageDirForIDUsesIDOnly(t *testing.T) {
	dir, err := notePackageDirForID("202605130101")
	if err != nil {
		t.Fatalf("notePackageDirForID failed: %v", err)
	}
	if dir != "Notes/2026-05/202605130101" {
		t.Fatalf("dir = %q, want Notes/2026-05/202605130101", dir)
	}
}

func TestNotePackagePathHelpersRejectNonPackagePaths(t *testing.T) {
	if _, err := trashPackageDirForNoteDir("Notes/2026-05"); err == nil {
		t.Fatal("expected short note dir to be rejected")
	}
	if _, err := canonicalOriginalDirForTrashPackage("Trash/2026-05/old/extra", "", "202605130102"); err == nil {
		t.Fatal("expected nested trash dir to be rejected")
	}
}

func TestCanonicalOriginalDirForTrashPackageUsesIDOnly(t *testing.T) {
	dir, err := canonicalOriginalDirForTrashPackage("Trash/2026-05/Old_202605130103", "Notes/2026-05/Old_202605130103", "202605130103")
	if err != nil {
		t.Fatalf("canonicalOriginalDirForTrashPackage failed: %v", err)
	}
	if dir != "Notes/2026-05/202605130103" {
		t.Fatalf("dir = %q, want Notes/2026-05/202605130103", dir)
	}
}
