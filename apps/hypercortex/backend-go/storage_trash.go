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
		if !month.IsDir() || month.Name() == "assets" || month.Name() == trashFacesDirName || month.Name() == trashFoldersDirName {
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
			out = append(out, trashItem{Kind: "note", ID: manifest.ID, Title: nonEmpty(manifest.Title, "未命名"), Dir: rel, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, DeletedAtMs: deletedAt, OriginalDir: original, Icon: trashDisplayIconForPackage(manifest.Icon, rel)})
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
	folders, err := svc.listFolderTrash(scope, trashRoot)
	if err != nil {
		return nil, err
	}
	out = append(out, folders...)
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
			entryDir := filepath.ToSlash(filepath.Join(trashDir, "assets", month.Name(), assetDir.Name()))
			out = append(out, trashItem{
				Kind:        "asset",
				ID:          key,
				Title:       title,
				Dir:         entryDir,
				AssetID:     asset.AssetID,
				Ext:         asset.Ext,
				CreatedAtMs: asset.CreatedAtMs,
				UpdatedAtMs: asset.UpdatedAtMs,
				DeletedAtMs: deletedAt,
				OriginalDir: asset.Path,
				Icon:        trashDisplayIconForMovedFile(asset.Icon, entryDir),
			})
		}
	}
	return out, nil
}

func (svc *service) moveNoteToTrash(scope string, raw json.RawMessage, refsRaw json.RawMessage) (any, error) {
	if err := repoScopeOrError(scope); err != nil {
		return nil, err
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
	_ = writeJSONFile(filepath.Join(to, trashMetaFile), trashMeta{Version: 1, Kind: "note", DeletedAtMs: deletedAt, OriginalDir: filepath.ToSlash(cleanFrom), Refs: parseTrashRefs(refsRaw)})
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

func (svc *service) moveAssetToTrash(scope string, assetID string, ext string, refsRaw json.RawMessage) (any, error) {
	if err := repoScopeOrError(scope); err != nil {
		return nil, err
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
		Icon:         entry.Icon,
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
	// 图片图标随附件本体一并移入回收站条目目录。
	svc.moveIconFileIntoDir(scope, entry.Icon, trashEntryDir)
	deletedAt := nowMs()
	if err := writeJSONFile(filepath.Join(trashEntryDir, trashMetaFile), trashMeta{Version: 1, Kind: "asset", DeletedAtMs: deletedAt, OriginalDir: filepath.ToSlash(rel), Asset: entry, Refs: parseTrashRefs(refsRaw)}); err != nil {
		_ = os.Rename(trashPath, from)
		svc.restoreIconFileFromDir(scope, entry.Icon, trashEntryDir)
		_ = os.RemoveAll(trashEntryDir)
		return nil, err
	}
	if err := svc.removeAssetFromIndex(scope, assetID, ext); err != nil {
		_ = os.Rename(trashPath, from)
		svc.restoreIconFileFromDir(scope, entry.Icon, trashEntryDir)
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
	if err := repoScopeOrError(scope); err != nil {
		return nil, err
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
	if item.Kind == "folder" {
		return svc.restoreFolderTrashItem(scope, item)
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
	trash := trashMeta{}
	_ = readJSONFile(filepath.Join(to, trashMetaFile), &trash)
	_ = os.Remove(filepath.Join(to, trashMetaFile))
	manifest, err := svc.loadNoteManifest(scope, desired)
	if err != nil {
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: filepath.ToSlash(desired), CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, Icon: manifest.Icon}
	idx, _ := svc.loadNoteIndex(scope)
	idx.Notes[meta.ID] = meta
	if path, err := svc.resolvePath(scope, indexFile); err == nil {
		_ = writeJSONFile(path, idx)
	}
	if _, err := svc.refreshDerivedIndexesForNote(scope, filepath.ToSlash(desired), manifest); err != nil {
		return nil, err
	}
	result := map[string]any{"meta": meta}
	if favorites, ok, err := svc.restoreRefsIntoFavorites(scope, trash.Refs); err != nil {
		return nil, err
	} else if ok {
		result["favorites"] = favorites
	}
	return result, nil
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
	// 图片图标随附件本体一并还原回 Icons/。
	svc.restoreIconFileFromDir(scope, entry.Icon, fromDir)
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
	result := map[string]any{"asset": assetPoolItemFromMetadata(idx.Assets[key])}
	if favorites, ok, err := svc.restoreRefsIntoFavorites(scope, meta.Refs); err != nil {
		return nil, err
	} else if ok {
		result["favorites"] = favorites
	}
	return result, nil
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
	if item.Kind == "folder" {
		clean, err := cleanRelPath(item.Dir)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(filepath.ToSlash(clean)+"/", trashDir+"/"+trashFoldersDirName+"/") {
			return errors.New("收藏夹回收站目录无效")
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
	if repoScopeOrError(scope) != nil || days <= 0 {
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

// parseTrashRefs 解析随本体一并打包的收藏引用清单；空载荷或非法载荷返回空清单。
func parseTrashRefs(raw json.RawMessage) []favoriteItemRef {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil
	}
	var refs []favoriteItemRef
	if err := json.Unmarshal(raw, &refs); err != nil {
		return nil
	}
	return refs
}
