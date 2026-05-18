package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (svc *service) ensureAssetIndex(scope string) (assetIndex, error) {
	path, err := svc.resolvePath(scope, assetsIndexFile)
	if err != nil {
		return assetIndex{}, err
	}
	var idx assetIndex
	if err := readJSONFile(path, &idx); err == nil && idx.Assets != nil {
		migrated, changed := svc.migrateAssetIndex(scope, idx)
		if changed {
			if err := svc.saveAssetIndex(scope, migrated); err != nil {
				return assetIndex{}, err
			}
		}
		return migrated, nil
	}
	idx = assetIndex{Version: assetIndexVersion, Assets: map[string]assetIndexEntry{}}
	_ = writeJSONFile(path, idx)
	return idx, nil
}

func (svc *service) saveAssetIndex(scope string, idx assetIndex) error {
	path, err := svc.resolvePath(scope, assetsIndexFile)
	if err != nil {
		return err
	}
	if idx.Assets == nil {
		idx.Assets = map[string]assetIndexEntry{}
	}
	idx.Version = assetIndexVersion
	return writeJSONFile(path, idx)
}

func (svc *service) migrateAssetIndex(scope string, idx assetIndex) (assetIndex, bool) {
	next := assetIndex{Version: assetIndexVersion, Assets: map[string]assetIndexEntry{}}
	changed := idx.Version != assetIndexVersion
	for key, entry := range idx.Assets {
		cleanKey := strings.TrimSpace(key)
		if cleanKey == "" {
			changed = true
			continue
		}
		info := svc.assetFileInfo(scope, entry.Path)
		migrated := newAssetMetadata(entry)
		if migrated.MetadataVersion != assetMetadataVersion || strings.TrimSpace(migrated.AssetID) == "" || strings.TrimSpace(migrated.Path) == "" {
			migrated = migrateAssetIndexEntry(cleanKey, entry, info)
		}
		if migrated.AssetID == "" || migrated.Path == "" {
			changed = true
			continue
		}
		nextKey := assetKey(migrated.AssetID, migrated.Ext)
		next.Assets[nextKey] = migrated
		if nextKey != cleanKey || !assetIndexEntriesEqual(entry, migrated) {
			changed = true
		}
	}
	return next, changed
}

func (svc *service) assetFileInfo(scope string, relPath string) os.FileInfo {
	if strings.TrimSpace(relPath) == "" {
		return nil
	}
	target, err := svc.resolvePath(scope, relPath)
	if err != nil {
		return nil
	}
	info, err := os.Stat(target)
	if err != nil || info.IsDir() {
		return nil
	}
	return info
}

func assetIndexEntriesEqual(a assetIndexEntry, b assetIndexEntry) bool {
	left, _ := json.Marshal(a)
	right, _ := json.Marshal(b)
	return string(left) == string(right)
}

func (svc *service) listAssets(scope string) ([]assetPoolItem, error) {
	idx, err := svc.ensureAssetIndex(scope)
	if err != nil {
		return nil, err
	}
	out := []assetPoolItem{}
	assetsRoot, err := svc.resolvePath(scope, assetsDir)
	if err != nil {
		return nil, err
	}
	_ = os.MkdirAll(assetsRoot, 0o755)
	for _, cat := range []string{"images", "videos", "docs"} {
		catRoot := filepath.Join(assetsRoot, cat)
		months, _ := os.ReadDir(catRoot)
		for _, month := range months {
			if !month.IsDir() {
				continue
			}
			files, _ := os.ReadDir(filepath.Join(catRoot, month.Name()))
			for _, file := range files {
				if file.IsDir() {
					continue
				}
				info, _ := file.Info()
				rel := filepath.ToSlash(filepath.Join(assetsDir, cat, month.Name(), file.Name()))
				assetID, ext := parseAssetFileName(file.Name())
				key := assetKey(assetID, ext)
				entry := idx.Assets[key]
				mimeType := mimeFromExt(ext)
				kind := kindFromMime(mimeType)
				var size int64
				var modified float64
				if info != nil {
					size = info.Size()
					modified = float64(info.ModTime().UnixMilli())
				}
				nextEntry := newAssetMetadata(assetIndexEntry{
					AssetID:      assetID,
					Ext:          ext,
					Path:         rel,
					Kind:         nonEmpty(entry.Kind, kind),
					Mime:         nonEmpty(entry.Mime, mimeType),
					Size:         size,
					CreatedAtMs:  entry.CreatedAtMs,
					UploadedAtMs: entry.UploadedAtMs,
					UpdatedAtMs:  entry.UpdatedAtMs,
					ModifiedMs:   modified,
					SourceName:   entry.SourceName,
					DisplayName:  entry.DisplayName,
					Remark:       entry.Remark,
					Tags:         entry.Tags,
				})
				out = append(out, assetPoolItemFromMetadata(nextEntry))
				if !assetIndexEntriesEqual(entry, nextEntry) {
					idx.Assets[key] = nextEntry
				}
			}
		}
	}
	_ = svc.saveAssetIndex(scope, idx)
	sort.Slice(out, func(i, j int) bool { return out[i].ModifiedMs > out[j].ModifiedMs })
	return out, nil
}

func (svc *service) readAssetDataURL(scope string, assetID string, ext string) (string, error) {
	rel, err := svc.resolveAssetPath(scope, assetID, ext)
	if err != nil {
		return "", err
	}
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return "", err
	}
	return "data:" + mimeFromExt(ext) + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func (svc *service) deleteAsset(scope string, assetID string, ext string) error {
	return svc.permanentlyDeleteAsset(scope, assetID, ext)
}

func (svc *service) removeAssetFromIndex(scope string, assetID string, ext string) error {
	idx, err := svc.ensureAssetIndex(scope)
	if err != nil {
		return err
	}
	delete(idx.Assets, assetKey(assetID, ext))
	return svc.saveAssetIndex(scope, idx)
}

func (svc *service) permanentlyDeleteAsset(scope string, assetID string, ext string) error {
	rel, err := svc.resolveAssetPath(scope, assetID, ext)
	if err != nil {
		return err
	}
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := svc.deleteThumbnailCacheForAsset(scope, assetID, ext); err != nil {
		return err
	}
	return svc.removeAssetFromIndex(scope, assetID, ext)
}

func (svc *service) updateAssetUserMetadata(scope string, assetID string, ext string, raw json.RawMessage) (assetPoolItem, error) {
	key := assetKey(assetID, ext)
	idx, err := svc.ensureAssetIndex(scope)
	if err != nil {
		return assetPoolItem{}, err
	}
	entry, ok := idx.Assets[key]
	if !ok || strings.TrimSpace(entry.Path) == "" {
		return assetPoolItem{}, errors.New("附件档案不存在")
	}
	var input assetUserMetadataInput
	if err := json.Unmarshal(raw, &input); err != nil {
		return assetPoolItem{}, err
	}
	entry.DisplayName = normalizeAssetShortText(input.DisplayName, maxAssetDisplayNameLength)
	entry.Remark = normalizeAssetShortText(input.Remark, maxAssetTextLength)
	entry.Tags = normalizeAssetTags(input.Tags)
	entry.UpdatedAtMs = nowMs()
	entry = newAssetMetadata(entry)
	idx.Assets[key] = entry
	if err := svc.saveAssetIndex(scope, idx); err != nil {
		return assetPoolItem{}, err
	}
	return assetPoolItemFromMetadata(entry), nil
}

func (svc *service) resolveAssetPath(scope string, assetID string, ext string) (string, error) {
	key := assetKey(assetID, ext)
	idx, _ := svc.ensureAssetIndex(scope)
	if entry := idx.Assets[key]; strings.TrimSpace(entry.Path) != "" {
		return entry.Path, nil
	}
	fileName := key
	assetsRoot, err := svc.resolvePath(scope, assetsDir)
	if err != nil {
		return "", err
	}
	for _, cat := range []string{"images", "videos", "docs"} {
		catRoot := filepath.Join(assetsRoot, cat)
		months, _ := os.ReadDir(catRoot)
		for _, month := range months {
			if !month.IsDir() {
				continue
			}
			candidate := filepath.Join(catRoot, month.Name(), fileName)
			if exists(candidate) {
				return filepath.ToSlash(filepath.Join(assetsDir, cat, month.Name(), fileName)), nil
			}
		}
	}
	return "", errors.New("资源文件不存在")
}

func (svc *service) openDir(dir string) error {
	target := strings.TrimSpace(dir)
	if target == "" {
		return errors.New("dir 不能为空")
	}
	abs, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	if !isInside(svc.libraryDir, abs) && !isInside(svc.dataDir, abs) {
		return errors.New("只能打开 HyperCortex library/data 范围内目录")
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return err
	}
	return openSystemDir(abs)
}

func (svc *service) openVaultDir(scope string, dir string) error {
	abs, err := svc.resolvePath(scope, dir)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return errors.New("目录不存在")
		}
		return err
	}
	if !info.IsDir() {
		return errors.New("目标不是目录")
	}
	return openSystemDir(abs)
}
