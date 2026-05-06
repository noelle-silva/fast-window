package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func (svc *service) ensureAssetIndex(scope string) (assetIndex, error) {
	path, err := svc.resolvePath(scope, assetsIndexFile)
	if err != nil {
		return assetIndex{}, err
	}
	var idx assetIndex
	if err := readJSONFile(path, &idx); err == nil && idx.Version == 1 && idx.Assets != nil {
		return idx, nil
	}
	idx = assetIndex{Version: 1, Assets: map[string]assetIndexEntry{}}
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
	idx.Version = 1
	return writeJSONFile(path, idx)
}

func (svc *service) listAssets(scope string) ([]assetPoolItem, error) {
	idx, _ := svc.ensureAssetIndex(scope)
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
				var size int64
				var modified float64
				if info != nil {
					size = info.Size()
					modified = float64(info.ModTime().UnixMilli())
				}
				out = append(out, assetPoolItem{RelPath: rel, Name: file.Name(), DisplayName: entry.DisplayName, Size: size, ModifiedMs: modified})
				if entry.Path != rel || entry.Size != size || entry.ModifiedMs != modified {
					entry.Path = rel
					entry.Size = size
					entry.ModifiedMs = modified
					idx.Assets[key] = entry
				}
			}
		}
	}
	_ = svc.saveAssetIndex(scope, idx)
	sort.Slice(out, func(i, j int) bool { return out[i].ModifiedMs > out[j].ModifiedMs })
	return out, nil
}

func (svc *service) importFiles(scope string, raw json.RawMessage) ([]resourceRef, error) {
	var inputs []struct {
		Name    string `json:"name"`
		DataURL string `json:"dataUrl"`
	}
	if err := json.Unmarshal(raw, &inputs); err != nil {
		return nil, err
	}
	idx, _ := svc.ensureAssetIndex(scope)
	out := []resourceRef{}
	for _, input := range inputs {
		mimeType, data, err := dataURLParts(input.DataURL)
		if err != nil {
			return nil, err
		}
		assetID := sha256Hex(data)
		ext := extFromMime(mimeType)
		kind := kindFromMime(mimeType)
		month := time.Now().Format("2006-01")
		fileName := assetKey(assetID, ext)
		rel := filepath.ToSlash(filepath.Join(assetsDir, categoryFromKind(kind), month, fileName))
		target, err := svc.resolvePath(scope, rel)
		if err != nil {
			return nil, err
		}
		if err := writeFileAtomic(target, data); err != nil {
			return nil, err
		}
		info, _ := os.Stat(target)
		entry := assetIndexEntry{Path: rel, Kind: kind, DisplayName: strings.TrimSpace(input.Name)}
		if info != nil {
			entry.Size = info.Size()
			entry.ModifiedMs = float64(info.ModTime().UnixMilli())
		}
		idx.Assets[fileName] = entry
		out = append(out, resourceRef{AssetID: assetID, Mime: mimeType, Ext: ext, Kind: kind, Name: strings.TrimSpace(input.Name)})
	}
	if err := svc.saveAssetIndex(scope, idx); err != nil {
		return nil, err
	}
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
	idx, _ := svc.ensureAssetIndex(scope)
	delete(idx.Assets, assetKey(assetID, ext))
	return svc.saveAssetIndex(scope, idx)
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
