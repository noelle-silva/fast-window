package main

const noteFaceSearchIndexMigration = "2026-09-09-note-face-search-index-v1"

func (svc *service) migrateNoteFaceSearchIndex() error {
	return svc.rebuildSearchIndex("library")
}
