package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"fast-window-hypercortex-backend/faceplugin"
)

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

func (svc *service) loadRefIndex(scope string) (noteRefIndex, error) {
	path, err := svc.resolvePath(scope, refsIndexFile)
	if err != nil {
		return nil, err
	}
	idx := noteRefIndex{}
	if err := readJSONFile(path, &idx); err != nil {
		return noteRefIndex{}, nil
	}
	return normalizeRefIndex(idx), nil
}

func normalizeRefIndex(idx noteRefIndex) noteRefIndex {
	out := noteRefIndex{}
	for noteID, faces := range idx {
		noteID = strings.TrimSpace(noteID)
		if noteID == "" {
			continue
		}
		for faceID, refs := range faces {
			faceID = strings.TrimSpace(faceID)
			unique := faceplugin.UniqueRefs(refs)
			if len(unique) == 0 {
				continue
			}
			if out[noteID] == nil {
				out[noteID] = map[string][]noteRef{}
			}
			out[noteID][faceID] = unique
		}
	}
	return out
}

func (svc *service) saveRefIndex(scope string, idx noteRefIndex) error {
	path, err := svc.resolvePath(scope, refsIndexFile)
	if err != nil {
		return err
	}
	return writeJSONFile(path, normalizeRefIndex(idx))
}

// collectRefsForNote 按面协议提取笔记全部面内容中的引用，返回 面→refs 映射
func (svc *service) collectRefsForNote(scope string, manifest noteManifest, packageDir string) map[string][]noteRef {
	out := map[string][]noteRef{}
	for _, faceID := range manifest.FaceOrder {
		faceManifest := manifest.Faces[faceID]
		adapter, ok := faceplugin.Get(faceManifest.Kind)
		if !ok || adapter.ExtractRefs == nil {
			continue
		}
		content, err := svc.readText(scope, filepath.ToSlash(filepath.Join(packageDir, faceManifest.File)))
		if err != nil {
			continue
		}
		refs := faceplugin.UniqueRefs(adapter.ExtractRefs(content))
		if len(refs) == 0 {
			continue
		}
		out[faceID] = refs
	}
	return out
}

// refreshDerivedIndexesForNote 笔记包（面内容/笔记级字段）变化时统一刷新该笔记的全部派生索引：
// 引用索引 + 搜索索引共用同一个触发点，避免两份索引各自更新而失步。
// 返回该笔记的面级引用，供调用方增量同步。
func (svc *service) refreshDerivedIndexesForNote(scope string, packageDir string, manifest noteManifest) (map[string][]noteRef, error) {
	refs := svc.collectRefsForNote(scope, manifest, packageDir)
	idx, err := svc.loadRefIndex(scope)
	if err != nil {
		return nil, err
	}
	if len(refs) > 0 {
		idx[manifest.ID] = refs
	} else {
		delete(idx, manifest.ID)
	}
	if err := svc.saveRefIndex(scope, idx); err != nil {
		return nil, err
	}
	if err := svc.updateSearchEntryForNote(scope, packageDir, manifest); err != nil {
		return nil, err
	}
	return refs, nil
}

func (svc *service) rebuildRefsIndex(scope string) error {
	root, err := svc.resolvePath(scope, notesDir)
	if err != nil {
		return err
	}
	idx := noteRefIndex{}
	months, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return svc.saveRefIndex(scope, idx)
	}
	if err != nil {
		return err
	}
	for _, month := range months {
		if !month.IsDir() {
			continue
		}
		monthDir := filepath.Join(root, month.Name())
		packages, err := os.ReadDir(monthDir)
		if err != nil {
			return err
		}
		for _, pkg := range packages {
			if !pkg.IsDir() {
				continue
			}
			rel := filepath.ToSlash(filepath.Join(notesDir, month.Name(), pkg.Name()))
			manifest, err := svc.loadNoteManifest(scope, rel)
			if err != nil || manifest.ID == "" {
				continue
			}
			refs := svc.collectRefsForNote(scope, manifest, rel)
			if len(refs) == 0 {
				continue
			}
			idx[manifest.ID] = refs
		}
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

// removeNoteDerivedIndexes 删除笔记时同步清理引用索引与搜索索引条目
func (svc *service) removeNoteDerivedIndexes(scope string, noteID string) error {
	if err := svc.removeNoteRef(scope, noteID); err != nil {
		return err
	}
	return svc.removeSearchEntryForNote(scope, noteID)
}

func (svc *service) listTrash(scope string) ([]trashItem, error) {
	trashRoot, err := svc.resolvePath(scope, trashDir)
	if err != nil {
		return nil, err
	}
	_ = os.MkdirAll(trashRoot, 0o755)
	out := []trashItem{}
	months, err := os.ReadDir(trashRoot)
	if err != nil {
		return nil, err
	}
	for _, month := range months {
		if !month.IsDir() || month.Name() == "assets" || month.Name() == trashFacesDirName {
			continue
		}
		packages, err := os.ReadDir(filepath.Join(trashRoot, month.Name()))
		if err != nil {
			// 单个月份目录不可读不应阻断整个回收站列表。
			continue
		}
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
	faces, err := svc.listFaceTrash(scope, trashRoot)
	if err != nil {
		return nil, err
	}
	out = append(out, faces...)
	sort.Slice(out, func(i, j int) bool { return out[i].DeletedAtMs > out[j].DeletedAtMs })
	return out, nil
}

func (svc *service) listAssetTrash(scope string, trashRoot string) ([]trashItem, error) {
	assetTrashRoot := filepath.Join(trashRoot, "assets")
	months, err := os.ReadDir(assetTrashRoot)
	if errors.Is(err, os.ErrNotExist) {
		return []trashItem{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []trashItem{}
	for _, month := range months {
		if !month.IsDir() {
			continue
		}
		assetDirs, err := os.ReadDir(filepath.Join(assetTrashRoot, month.Name()))
		if err != nil {
			// 单个月份目录不可读不应阻断整个附件回收站列表。
			continue
		}
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
	if err := svc.removeNoteDerivedIndexes(scope, note.ID); err != nil {
		return nil, err
	}
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
	return svc.removeNoteDerivedIndexes(scope, noteID)
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
	if item.Kind == "face" {
		return svc.restoreFaceTrashItem(scope, item)
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
	if _, err := svc.refreshDerivedIndexesForNote(scope, filepath.ToSlash(desired), manifest); err != nil {
		return nil, err
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
	if item.Kind == "face" {
		clean, err := cleanRelPath(item.Dir)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(filepath.ToSlash(clean)+"/", trashDir+"/"+trashFacesDirName+"/") {
			return errors.New("面回收站目录无效")
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
