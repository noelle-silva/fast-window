package main

const noteFaceRefsV2Migration = "2026-09-01-note-face-refs-v2"

func (svc *service) migrateNoteFaceRefsV2() error {
	return svc.rebuildRefsIndex("library")
}
