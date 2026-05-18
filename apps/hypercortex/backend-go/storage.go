package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
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
		if !month.IsDir() || month.Name() == "assets" {
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
			out = append(out, trashItem{Kind: "note", ID: manifest.ID, Title: nonEmpty(manifest.Title, "未命名"), Dir: rel, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, DeletedAtMs: deletedAt, OriginalDir: original})
		}
	}
	assets, err := svc.listAssetTrash(scope, trashRoot)
	if err != nil {
		return nil, err
	}
	out = append(out, assets...)
	sort.Slice(out, func(i, j int) bool { return out[i].DeletedAtMs > out[j].DeletedAtMs })
	return out, nil
}

func (svc *service) listAssetTrash(scope string, trashRoot string) ([]trashItem, error) {
	assetTrashRoot := filepath.Join(trashRoot, "assets")
	months, _ := os.ReadDir(assetTrashRoot)
	out := []trashItem{}
	for _, month := range months {
		if !month.IsDir() {
			continue
		}
		assetDirs, _ := os.ReadDir(filepath.Join(assetTrashRoot, month.Name()))
		for _, assetDir := range assetDirs {
			if !assetDir.IsDir() {
				continue
			}
			dir := filepath.Join(assetTrashRoot, month.Name(), assetDir.Name())
			meta := trashMeta{}
			if err := readJSONFile(filepath.Join(dir, trashMetaFile), &meta); err != nil || meta.Kind != "asset" {
				continue
			}
			asset := newAssetMetadata(meta.Asset)
			if strings.TrimSpace(asset.AssetID) == "" || strings.TrimSpace(asset.Path) == "" {
				continue
			}
			info, _ := assetDir.Info()
			deletedAt := meta.DeletedAtMs
			if deletedAt <= 0 && info != nil {
				deletedAt = float64(info.ModTime().UnixMilli())
			}
			key := assetKey(asset.AssetID, asset.Ext)
			title := nonEmpty(asset.DisplayName, nonEmpty(asset.SourceName, key))
			out = append(out, trashItem{
				Kind:        "asset",
				ID:          key,
				Title:       title,
				Dir:         filepath.ToSlash(filepath.Join(trashDir, "assets", month.Name(), assetDir.Name())),
				AssetID:     asset.AssetID,
				Ext:         asset.Ext,
				CreatedAtMs: asset.CreatedAtMs,
				UpdatedAtMs: asset.UpdatedAtMs,
				DeletedAtMs: deletedAt,
				OriginalDir: asset.Path,
			})
		}
	}
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
	_ = writeJSONFile(filepath.Join(to, trashMetaFile), trashMeta{Version: 1, Kind: "note", DeletedAtMs: deletedAt, OriginalDir: filepath.ToSlash(cleanFrom)})
	idx, _ := svc.loadNoteIndex(scope)
	delete(idx.Notes, note.ID)
	if path, err := svc.resolvePath(scope, indexFile); err == nil {
		_ = writeJSONFile(path, idx)
	}
	_ = svc.removeNoteRef(scope, note.ID)
	return map[string]string{"trashDir": toRel}, nil
}

func (svc *service) moveAssetToTrash(scope string, assetID string, ext string) (any, error) {
	if scope != "library" {
		return nil, errors.New("回收站仅支持 library scope")
	}
	assetID = strings.TrimSpace(assetID)
	ext = normalizeAssetExt(ext)
	if assetID == "" {
		return nil, errors.New("附件 ID 不能为空")
	}
	rel, err := svc.resolveAssetPath(scope, assetID, ext)
	if err != nil {
		return nil, err
	}
	from, err := svc.resolvePath(scope, rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(from)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, errors.New("附件路径不是文件")
	}

	idx, err := svc.ensureAssetIndex(scope)
	if err != nil {
		return nil, err
	}
	key := assetKey(assetID, ext)
	entry := idx.Assets[key]
	entry = newAssetMetadata(assetIndexEntry{
		AssetID:      nonEmpty(entry.AssetID, assetID),
		Ext:          nonEmpty(entry.Ext, ext),
		Path:         nonEmpty(entry.Path, rel),
		Kind:         entry.Kind,
		Mime:         entry.Mime,
		Size:         nonZeroInt64(entry.Size, info.Size()),
		CreatedAtMs:  entry.CreatedAtMs,
		UploadedAtMs: entry.UploadedAtMs,
		UpdatedAtMs:  entry.UpdatedAtMs,
		ModifiedMs:   nonZeroFloat(entry.ModifiedMs, float64(info.ModTime().UnixMilli())),
		SourceName:   entry.SourceName,
		DisplayName:  entry.DisplayName,
		Remark:       entry.Remark,
		Tags:         entry.Tags,
	})

	trashRel := filepath.ToSlash(filepath.Join(trashDir, "assets", time.Now().Format("2006-01"), key))
	trashFileRel := filepath.ToSlash(filepath.Join(trashRel, key))
	trashPath, err := svc.resolvePath(scope, trashFileRel)
	if err != nil {
		return nil, err
	}
	trashEntryDir := filepath.Dir(trashPath)
	if exists(trashEntryDir) {
		return nil, errors.New("目标回收站路径已存在")
	}
	if err := ensureParent(trashPath); err != nil {
		return nil, err
	}
	if err := svc.deleteThumbnailCacheForAsset(scope, assetID, ext); err != nil {
		return nil, err
	}
	if err := os.Rename(from, trashPath); err != nil {
		return nil, err
	}
	deletedAt := nowMs()
	if err := writeJSONFile(filepath.Join(trashEntryDir, trashMetaFile), trashMeta{Version: 1, Kind: "asset", DeletedAtMs: deletedAt, OriginalDir: filepath.ToSlash(rel), Asset: entry}); err != nil {
		_ = os.Rename(trashPath, from)
		_ = os.RemoveAll(trashEntryDir)
		return nil, err
	}
	if err := svc.removeAssetFromIndex(scope, assetID, ext); err != nil {
		_ = os.Rename(trashPath, from)
		_ = os.RemoveAll(trashEntryDir)
		return nil, err
	}
	return map[string]string{"trashDir": trashRel}, nil
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
	if item.Kind == "asset" {
		return svc.restoreAssetTrashItem(scope, item)
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

func (svc *service) restoreAssetTrashItem(scope string, item trashItem) (any, error) {
	fromDir, err := svc.resolvePath(scope, item.Dir)
	if err != nil {
		return nil, err
	}
	meta := trashMeta{}
	if err := readJSONFile(filepath.Join(fromDir, trashMetaFile), &meta); err != nil {
		return nil, err
	}
	if meta.Kind != "asset" {
		return nil, errors.New("回收站条目不是附件")
	}
	entry := newAssetMetadata(meta.Asset)
	if strings.TrimSpace(entry.AssetID) == "" || strings.TrimSpace(entry.Path) == "" {
		return nil, errors.New("附件回收站元数据无效")
	}
	key := assetKey(entry.AssetID, entry.Ext)
	from := filepath.Join(fromDir, key)
	toRel := nonEmpty(meta.OriginalDir, entry.Path)
	to, err := svc.resolvePath(scope, toRel)
	if err != nil {
		return nil, err
	}
	cleanTo, err := cleanRelPath(toRel)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(filepath.ToSlash(cleanTo)+"/", assetsDir+"/") {
		return nil, errors.New("附件恢复目标必须在 Assets 下")
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
	_ = os.RemoveAll(fromDir)
	if info, err := os.Stat(to); err == nil && !info.IsDir() {
		entry.Size = info.Size()
		entry.ModifiedMs = float64(info.ModTime().UnixMilli())
	}
	entry.Path = filepath.ToSlash(cleanTo)
	idx, err := svc.ensureAssetIndex(scope)
	if err != nil {
		return nil, err
	}
	idx.Assets[key] = newAssetMetadata(entry)
	if err := svc.saveAssetIndex(scope, idx); err != nil {
		return nil, err
	}
	return map[string]any{"asset": assetPoolItemFromMetadata(idx.Assets[key])}, nil
}

func (svc *service) permanentlyDeleteTrashItem(scope string, raw json.RawMessage) error {
	var item trashItem
	if err := json.Unmarshal(raw, &item); err != nil {
		return err
	}
	return svc.permanentlyDeleteTrashItemByValue(scope, item)
}

func (svc *service) permanentlyDeleteTrashItemByValue(scope string, item trashItem) error {
	if item.Kind == "asset" {
		clean, err := cleanRelPath(item.Dir)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(filepath.ToSlash(clean)+"/", trashDir+"/assets/") {
			return errors.New("附件回收站目录无效")
		}
		target, err := svc.resolvePath(scope, clean)
		if err != nil {
			return err
		}
		return os.RemoveAll(target)
	}
	return svc.permanentlyDeleteNoteDir(scope, item.ID, item.Dir)
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
			if err := svc.permanentlyDeleteTrashItemByValue(scope, item); err == nil {
				deleted++
			}
		}
	}
	return map[string]int{"deletedCount": deleted}, nil
}

func nonZeroFloat(value float64, fallback float64) float64 {
	if value > 0 {
		return value
	}
	return fallback
}

func nonZeroInt64(value int64, fallback int64) int64 {
	if value > 0 {
		return value
	}
	return fallback
}

func nonEmpty(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
