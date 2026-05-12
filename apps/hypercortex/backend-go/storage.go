package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (svc *service) ensureFavorites() (any, error) {
	existing, err := svc.tryLoadJSON("data", favoritesFile)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	now := nowMs()
	fresh := map[string]any{
		"version":      1,
		"rootFolderId": "root",
		"folders": map[string]any{
			"root": map[string]any{
				"id":          "root",
				"title":       "根目录",
				"description": "",
				"createdAtMs": now,
				"updatedAtMs": now,
			},
		},
		"refsByFolderId": map[string]any{"root": []any{}},
	}
	target, err := svc.resolvePath("data", favoritesFile)
	if err != nil {
		return nil, err
	}
	if err := writeJSONFile(target, fresh); err != nil {
		return nil, err
	}
	return fresh, nil
}

func (svc *service) loadNoteIndex(scope string) (noteIndex, error) {
	path, err := svc.resolvePath(scope, indexFile)
	if err != nil {
		return noteIndex{}, err
	}
	var idx noteIndex
	if err := readJSONFile(path, &idx); err == nil && idx.Version == 1 && idx.Notes != nil {
		return idx, nil
	}
	idx = noteIndex{Version: 1, Notes: map[string]noteMeta{}}
	return svc.rebuildNoteIndexInto(scope, idx)
}

func (svc *service) rebuildNoteIndex(scope string) (noteIndex, error) {
	return svc.rebuildNoteIndexInto(scope, noteIndex{Version: 1, Notes: map[string]noteMeta{}})
}

func (svc *service) rebuildNoteIndexInto(scope string, idx noteIndex) (noteIndex, error) {
	root, err := svc.resolvePath(scope, notesDir)
	if err != nil {
		return noteIndex{}, err
	}
	_ = os.MkdirAll(root, 0o755)
	notes := map[string]noteMeta{}
	months, _ := os.ReadDir(root)
	for _, month := range months {
		if !month.IsDir() {
			continue
		}
		monthDir := filepath.Join(root, month.Name())
		packages, _ := os.ReadDir(monthDir)
		for _, pkg := range packages {
			if !pkg.IsDir() {
				continue
			}
			rel := filepath.ToSlash(filepath.Join(notesDir, month.Name(), pkg.Name()))
			manifest, err := svc.loadNoteManifest(scope, rel)
			if err != nil || manifest.ID == "" {
				continue
			}
			info, _ := pkg.Info()
			modified := nowMs()
			if info != nil {
				modified = float64(info.ModTime().UnixMilli())
			}
			created := manifest.CreatedAtMs
			if created <= 0 {
				created = modified
			}
			updated := manifest.UpdatedAtMs
			if updated <= 0 {
				updated = modified
			}
			notes[manifest.ID] = noteMeta{ID: manifest.ID, Title: nonEmpty(manifest.Title, "未命名"), Description: manifest.Description, Dir: rel, CreatedAtMs: created, UpdatedAtMs: updated}
		}
	}
	idx.Notes = notes
	path, err := svc.resolvePath(scope, indexFile)
	if err != nil {
		return noteIndex{}, err
	}
	_ = writeJSONFile(path, idx)
	return idx, nil
}

func (svc *service) loadRefIndex(scope string) (map[string][]string, error) {
	path, err := svc.resolvePath(scope, refsIndexFile)
	if err != nil {
		return nil, err
	}
	idx := map[string][]string{}
	if err := readJSONFile(path, &idx); err != nil {
		return map[string][]string{}, nil
	}
	out := map[string][]string{}
	for noteID, refs := range idx {
		noteID = strings.TrimSpace(noteID)
		if noteID == "" {
			continue
		}
		seen := map[string]bool{}
		for _, ref := range refs {
			ref = strings.TrimSpace(ref)
			if ref == "" || seen[ref] {
				continue
			}
			seen[ref] = true
			out[noteID] = append(out[noteID], ref)
		}
	}
	return out, nil
}

func (svc *service) saveRefIndex(scope string, idx map[string][]string) error {
	path, err := svc.resolvePath(scope, refsIndexFile)
	if err != nil {
		return err
	}
	return writeJSONFile(path, idx)
}

func (svc *service) updateRefsForNote(scope string, noteID string, body string) error {
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return nil
	}
	idx, err := svc.loadRefIndex(scope)
	if err != nil {
		return err
	}
	refs := extractNoteRefs(body)
	if len(refs) > 0 {
		idx[noteID] = refs
	} else {
		delete(idx, noteID)
	}
	return svc.saveRefIndex(scope, idx)
}

func (svc *service) removeNoteRef(scope string, noteID string) error {
	idx, err := svc.loadRefIndex(scope)
	if err != nil {
		return err
	}
	delete(idx, strings.TrimSpace(noteID))
	return svc.saveRefIndex(scope, idx)
}

func extractNoteRefs(body string) []string {
	out := []string{}
	seen := map[string]bool{}
	text := strings.ReplaceAll(body, "\r\n", "\n")
	for {
		start := strings.Index(text, "[[")
		if start < 0 {
			break
		}
		text = text[start+2:]
		end := strings.Index(text, "]]")
		if end < 0 {
			break
		}
		inner := text[:end]
		text = text[end+2:]
		for _, part := range strings.Split(inner, "|") {
			part = strings.TrimSpace(part)
			if !strings.HasPrefix(part, "note_id=") {
				continue
			}
			id := strings.TrimSpace(strings.TrimPrefix(part, "note_id="))
			if id != "" && !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	return out
}

func (svc *service) listTrash(scope string) ([]trashItem, error) {
	trashRoot, err := svc.resolvePath(scope, trashDir)
	if err != nil {
		return nil, err
	}
	_ = os.MkdirAll(trashRoot, 0o755)
	out := []trashItem{}
	months, _ := os.ReadDir(trashRoot)
	for _, month := range months {
		if !month.IsDir() {
			continue
		}
		packages, _ := os.ReadDir(filepath.Join(trashRoot, month.Name()))
		for _, pkg := range packages {
			if !pkg.IsDir() {
				continue
			}
			rel := filepath.ToSlash(filepath.Join(trashDir, month.Name(), pkg.Name()))
			manifest, err := svc.loadNoteManifest(scope, rel)
			if err != nil {
				continue
			}
			meta := trashMeta{}
			_ = readJSONFile(filepath.Join(trashRoot, month.Name(), pkg.Name(), trashMetaFile), &meta)
			info, _ := pkg.Info()
			deletedAt := meta.DeletedAtMs
			if deletedAt <= 0 && info != nil {
				deletedAt = float64(info.ModTime().UnixMilli())
			}
			original, err := canonicalOriginalDirForTrashPackage(rel, meta.OriginalDir, manifest.ID)
			if err != nil {
				return nil, err
			}
			out = append(out, trashItem{ID: manifest.ID, Title: nonEmpty(manifest.Title, "未命名"), Dir: rel, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, DeletedAtMs: deletedAt, OriginalDir: original})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DeletedAtMs > out[j].DeletedAtMs })
	return out, nil
}

func (svc *service) moveNoteToTrash(scope string, raw json.RawMessage) (any, error) {
	if scope != "library" {
		return nil, errors.New("回收站仅支持 library scope")
	}
	var note noteMeta
	if err := json.Unmarshal(raw, &note); err != nil {
		return nil, err
	}
	fromRel := strings.TrimSpace(note.Dir)
	if fromRel == "" {
		return nil, errors.New("笔记目录为空，无法移入回收站")
	}
	cleanFrom, err := cleanRelPath(fromRel)
	if err != nil {
		return nil, err
	}
	toRel, err := trashPackageDirForNoteDir(cleanFrom)
	if err != nil {
		return nil, err
	}
	from, err := svc.resolvePath(scope, fromRel)
	if err != nil {
		return nil, err
	}
	to, err := svc.resolvePath(scope, toRel)
	if err != nil {
		return nil, err
	}
	if exists(to) {
		return nil, errors.New("目标回收站路径已存在")
	}
	if err := ensureParent(to); err != nil {
		return nil, err
	}
	if err := os.Rename(from, to); err != nil {
		return nil, err
	}
	deletedAt := nowMs()
	_ = writeJSONFile(filepath.Join(to, trashMetaFile), trashMeta{Version: 1, DeletedAtMs: deletedAt, OriginalDir: filepath.ToSlash(cleanFrom)})
	idx, _ := svc.loadNoteIndex(scope)
	delete(idx.Notes, note.ID)
	if path, err := svc.resolvePath(scope, indexFile); err == nil {
		_ = writeJSONFile(path, idx)
	}
	_ = svc.removeNoteRef(scope, note.ID)
	return map[string]string{"trashDir": toRel}, nil
}

func (svc *service) permanentlyDeleteNoteDir(scope string, noteID string, dir string) error {
	clean, err := cleanRelPath(dir)
	if err != nil {
		return err
	}
	if clean == "" || clean == notesDir || clean == assetsDir || clean == trashDir {
		return errors.New("禁止删除根目录")
	}
	target, err := svc.resolvePath(scope, clean)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(target); err != nil {
		return err
	}
	idx, _ := svc.loadNoteIndex(scope)
	delete(idx.Notes, strings.TrimSpace(noteID))
	if path, err := svc.resolvePath(scope, indexFile); err == nil {
		_ = writeJSONFile(path, idx)
	}
	_ = svc.removeNoteRef(scope, noteID)
	return nil
}

func (svc *service) restoreTrashItem(scope string, raw json.RawMessage) (any, error) {
	if scope != "library" {
		return nil, errors.New("回收站仅支持 library scope")
	}
	var item trashItem
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	from, err := svc.resolvePath(scope, item.Dir)
	if err != nil {
		return nil, err
	}
	desired, err := canonicalOriginalDirForTrashPackage(item.Dir, item.OriginalDir, item.ID)
	if err != nil {
		return nil, err
	}
	to, err := svc.resolvePath(scope, desired)
	if err != nil {
		return nil, err
	}
	if exists(to) {
		return nil, errors.New("恢复目标已存在")
	}
	if err := ensureParent(to); err != nil {
		return nil, err
	}
	if err := os.Rename(from, to); err != nil {
		return nil, err
	}
	_ = os.Remove(filepath.Join(to, trashMetaFile))
	manifest, err := svc.loadNoteManifest(scope, desired)
	if err != nil {
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: filepath.ToSlash(desired), CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs}
	idx, _ := svc.loadNoteIndex(scope)
	idx.Notes[meta.ID] = meta
	if path, err := svc.resolvePath(scope, indexFile); err == nil {
		_ = writeJSONFile(path, idx)
	}
	return map[string]any{"meta": meta}, nil
}

func (svc *service) maybeAutoCleanupTrash(scope string, days float64) (any, error) {
	if scope != "library" || days <= 0 {
		return map[string]int{"deletedCount": 0}, nil
	}
	items, err := svc.listTrash(scope)
	if err != nil {
		return nil, err
	}
	cutoff := nowMs() - days*24*60*60*1000
	deleted := 0
	for _, item := range items {
		if item.DeletedAtMs > 0 && item.DeletedAtMs <= cutoff {
			if err := svc.permanentlyDeleteNoteDir(scope, item.ID, item.Dir); err == nil {
				deleted++
			}
		}
	}
	return map[string]int{"deletedCount": deleted}, nil
}

func nonEmpty(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
