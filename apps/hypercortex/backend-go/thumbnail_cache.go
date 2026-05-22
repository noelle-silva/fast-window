package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	thumbnailCacheVersion  = 1
	thumbnailCacheDir      = "cache"
	thumbnailCacheSubdir   = "thumbnails"
	thumbnailIndexFile     = "_index.json"
	thumbnailJPEGMime      = "image/jpeg"
	thumbnailSVGMime       = "image/svg+xml"
	thumbnailJPEGExtension = "jpg"
	thumbnailSVGExtension  = "svg"
)

type thumbnailResult struct {
	DataURL   string `json:"dataUrl"`
	Cached    bool   `json:"cached"`
	MediaKind string `json:"mediaKind"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

type thumbnailCacheSpec struct {
	Version      int    `json:"version"`
	GeneratorID  string `json:"generatorId"`
	Scope        string `json:"scope"`
	AssetID      string `json:"assetId"`
	Ext          string `json:"ext"`
	RelPath      string `json:"relPath"`
	DisplayTitle string `json:"displayTitle"`
	MediaKind    string `json:"mediaKind"`
	Size         int64  `json:"size"`
	ModifiedMs   int64  `json:"modifiedMs"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
}

type thumbnailIndex struct {
	Version   int                            `json:"version"`
	UpdatedMs float64                        `json:"updatedMs"`
	Entries   map[string]thumbnailIndexEntry `json:"entries"`
}

type thumbnailIndexEntry struct {
	CacheKey   string  `json:"cacheKey"`
	AssetKey   string  `json:"assetKey"`
	Scope      string  `json:"scope"`
	RelPath    string  `json:"relPath"`
	MediaKind  string  `json:"mediaKind"`
	Mime       string  `json:"mime"`
	Path       string  `json:"path"`
	Size       int64   `json:"size"`
	ModifiedMs int64   `json:"modifiedMs"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	CreatedMs  float64 `json:"createdMs"`
}

type thumbnailRebuildReport struct {
	Total       int                       `json:"total"`
	Rebuilt     int                       `json:"rebuilt"`
	Skipped     int                       `json:"skipped"`
	Failed      int                       `json:"failed"`
	Failures    []thumbnailRebuildFailure `json:"failures"`
	Width       int                       `json:"width"`
	Height      int                       `json:"height"`
	StartedMs   float64                   `json:"startedMs"`
	CompletedMs float64                   `json:"completedMs"`
}

type thumbnailRebuildFailure struct {
	Asset string `json:"asset"`
	Path  string `json:"path"`
	Error string `json:"error"`
}

func (svc *service) getAssetThumbnail(scope string, assetID string, ext string, width int, height int, force bool) (thumbnailResult, error) {
	relPath, err := svc.resolveAssetPath(scope, assetID, ext)
	if err != nil {
		return thumbnailResult{}, err
	}
	return svc.getAssetThumbnailByRelPath(scope, relPath, width, height, force)
}

func (svc *service) getAssetThumbnailByRelPath(scope string, relPath string, width int, height int, force bool) (thumbnailResult, error) {
	cleanRel, err := cleanRelPath(relPath)
	if err != nil {
		return thumbnailResult{}, err
	}
	name := filepath.Base(cleanRel)
	assetID, ext := parseAssetFileName(name)
	if strings.TrimSpace(assetID) == "" {
		return thumbnailResult{}, errors.New("附件资源 ID 为空")
	}
	source, err := svc.resolvePath(scope, cleanRel)
	if err != nil {
		return thumbnailResult{}, err
	}
	info, err := os.Stat(source)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return thumbnailResult{}, errors.New("资源文件不存在")
		}
		return thumbnailResult{}, err
	}
	if info.IsDir() {
		return thumbnailResult{}, errors.New("资源路径不是文件")
	}
	width, height = normalizeThumbnailSize(width, height)
	mediaKind := kindFromMime(mimeFromExt(ext))
	profile, ok := thumbnailProfileFor(ext, mediaKind)
	if !ok {
		return thumbnailResult{}, unsupportedThumbnailError(ext, mediaKind)
	}
	modifiedMs := info.ModTime().UnixMilli()
	spec := thumbnailCacheSpec{
		Version:      thumbnailCacheVersion,
		GeneratorID:  profile.ID,
		Scope:        scope,
		AssetID:      strings.TrimSpace(assetID),
		Ext:          strings.Trim(strings.ToLower(strings.TrimSpace(ext)), "."),
		RelPath:      filepath.ToSlash(cleanRel),
		DisplayTitle: svc.assetThumbnailDisplayTitle(scope, assetID, ext, cleanRel),
		MediaKind:    mediaKind,
		Size:         info.Size(),
		ModifiedMs:   modifiedMs,
		Width:        width,
		Height:       height,
	}
	cacheKey, err := thumbnailCacheKey(spec)
	if err != nil {
		return thumbnailResult{}, err
	}
	cacheExt, mimeType := thumbnailOutputFormat(spec)
	relCachePath := thumbnailCacheRelPath(cacheKey, cacheExt)
	cachePath := filepath.Join(svc.thumbnailCacheRoot(), filepath.FromSlash(relCachePath))

	if force {
		if err := svc.deleteThumbnailCacheForAsset(scope, assetID, ext); err != nil {
			return thumbnailResult{}, err
		}
	} else if exists(cachePath) {
		dataURL, err := readThumbnailDataURL(cachePath, mimeType)
		if err != nil {
			return thumbnailResult{}, err
		}
		return thumbnailResult{DataURL: dataURL, Cached: true, MediaKind: mediaKind, Width: width, Height: height}, nil
	}

	if err := svc.generateThumbnailCache(source, cachePath, spec, cacheExt); err != nil {
		return thumbnailResult{}, err
	}
	if err := svc.recordThumbnailCache(cacheKey, relCachePath, mimeType, spec); err != nil {
		return thumbnailResult{}, err
	}
	dataURL, err := readThumbnailDataURL(cachePath, mimeType)
	if err != nil {
		return thumbnailResult{}, err
	}
	return thumbnailResult{DataURL: dataURL, Cached: false, MediaKind: mediaKind, Width: width, Height: height}, nil
}

func (svc *service) rebuildAssetThumbnail(scope string, assetID string, ext string, width int, height int) (thumbnailResult, error) {
	return svc.getAssetThumbnail(scope, assetID, ext, width, height, true)
}

func (svc *service) assetThumbnailDisplayTitle(scope string, assetID string, ext string, relPath string) string {
	key := assetKey(assetID, ext)
	if idx, err := svc.ensureAssetIndex(scope); err == nil {
		if entry, ok := idx.Assets[key]; ok {
			if title := assetDisplayTitleFromMetadata(entry); title != "" {
				return title
			}
		}
	}
	base := strings.TrimSpace(filepath.Base(relPath))
	if base == "" || base == key || isHexHashLike(strings.TrimSuffix(base, filepath.Ext(base))) {
		return ""
	}
	return trimAssetTitleExt(base, ext)
}

func assetDisplayTitleFromMetadata(entry assetIndexEntry) string {
	if title := strings.TrimSpace(entry.DisplayName); title != "" {
		return trimAssetTitleExt(title, entry.Ext)
	}
	if title := strings.TrimSpace(entry.SourceName); title != "" {
		return trimAssetTitleExt(title, entry.Ext)
	}
	return ""
}

func trimAssetTitleExt(title string, ext string) string {
	title = strings.TrimSpace(title)
	ext = normalizeAssetFileExt(ext)
	if title == "" || ext == "" {
		return title
	}
	suffix := "." + ext
	if strings.EqualFold(filepath.Ext(title), suffix) {
		return strings.TrimSpace(strings.TrimSuffix(title, filepath.Ext(title)))
	}
	return title
}

func (svc *service) rebuildAllThumbnails(scope string, width int, height int) (thumbnailRebuildReport, error) {
	width, height = normalizeThumbnailSize(width, height)
	assets, err := svc.listAssets(scope)
	if err != nil {
		return thumbnailRebuildReport{}, err
	}
	report := thumbnailRebuildReport{
		Width:     width,
		Height:    height,
		StartedMs: nowMs(),
		Failures:  []thumbnailRebuildFailure{},
	}
	for _, asset := range assets {
		assetID, ext := parseAssetFileName(asset.Name)
		kind := kindFromMime(mimeFromExt(ext))
		if _, ok := thumbnailProfileFor(ext, kind); !ok {
			report.Skipped++
			continue
		}
		report.Total++
		if _, err := svc.rebuildAssetThumbnail(scope, assetID, ext, width, height); err != nil {
			report.Failed++
			report.Failures = append(report.Failures, thumbnailRebuildFailure{
				Asset: assetKey(assetID, ext),
				Path:  asset.RelPath,
				Error: err.Error(),
			})
			continue
		}
		report.Rebuilt++
	}
	report.CompletedMs = nowMs()
	return report, nil
}

func (svc *service) generateThumbnailCache(source string, cachePath string, spec thumbnailCacheSpec, cacheExt string) error {
	if err := ensureParent(cachePath); err != nil {
		return err
	}
	tmp := thumbnailTempPath(cachePath, cacheExt)
	defer os.Remove(tmp)

	switch spec.MediaKind {
	case "image":
		if cacheExt == thumbnailSVGExtension {
			if err := copyFile(source, tmp); err != nil {
				return err
			}
		} else if err := generateImageThumbnailFile(source, tmp, spec.Width, spec.Height); err != nil {
			return err
		}
	case "video":
		if err := generateVideoThumbnailFile(source, tmp, spec.Width, spec.Height); err != nil {
			return err
		}
	case "document":
		if err := generateDocumentThumbnailFile(source, tmp, spec); err != nil {
			return err
		}
	default:
		return errors.New("不支持的缩略图媒体类型")
	}

	if err := os.Rename(tmp, cachePath); err != nil {
		_ = os.Remove(cachePath)
		return os.Rename(tmp, cachePath)
	}
	return nil
}

func (svc *service) thumbnailCacheRoot() string {
	return filepath.Join(svc.stateDir, thumbnailCacheDir, thumbnailCacheSubdir)
}

func (svc *service) readThumbnailIndex() (thumbnailIndex, error) {
	idx := thumbnailIndex{Version: thumbnailCacheVersion, Entries: map[string]thumbnailIndexEntry{}}
	path := filepath.Join(svc.thumbnailCacheRoot(), thumbnailIndexFile)
	if err := readJSONFile(path, &idx); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return thumbnailIndex{Version: thumbnailCacheVersion, Entries: map[string]thumbnailIndexEntry{}}, nil
		}
		return thumbnailIndex{}, err
	}
	if idx.Version <= 0 {
		idx.Version = thumbnailCacheVersion
	}
	if idx.Entries == nil {
		idx.Entries = map[string]thumbnailIndexEntry{}
	}
	return idx, nil
}

func (svc *service) writeThumbnailIndex(idx thumbnailIndex) error {
	idx.Version = thumbnailCacheVersion
	idx.UpdatedMs = nowMs()
	if idx.Entries == nil {
		idx.Entries = map[string]thumbnailIndexEntry{}
	}
	return writeJSONFile(filepath.Join(svc.thumbnailCacheRoot(), thumbnailIndexFile), idx)
}

func (svc *service) recordThumbnailCache(cacheKey string, relCachePath string, mimeType string, spec thumbnailCacheSpec) error {
	idx, err := svc.readThumbnailIndex()
	if err != nil {
		return err
	}
	assetKeyValue := assetKey(spec.AssetID, spec.Ext)
	for key, entry := range idx.Entries {
		if entry.Scope == spec.Scope && entry.AssetKey == assetKeyValue && entry.Width == spec.Width && entry.Height == spec.Height && key != cacheKey {
			_ = os.Remove(filepath.Join(svc.thumbnailCacheRoot(), filepath.FromSlash(entry.Path)))
			delete(idx.Entries, key)
		}
	}
	idx.Entries[cacheKey] = thumbnailIndexEntry{
		CacheKey:   cacheKey,
		AssetKey:   assetKeyValue,
		Scope:      spec.Scope,
		RelPath:    spec.RelPath,
		MediaKind:  spec.MediaKind,
		Mime:       mimeType,
		Path:       relCachePath,
		Size:       spec.Size,
		ModifiedMs: spec.ModifiedMs,
		Width:      spec.Width,
		Height:     spec.Height,
		CreatedMs:  nowMs(),
	}
	return svc.writeThumbnailIndex(idx)
}

func (svc *service) deleteThumbnailCacheForAsset(scope string, assetID string, ext string) error {
	idx, err := svc.readThumbnailIndex()
	if err != nil {
		return err
	}
	assetKeyValue := assetKey(assetID, ext)
	changed := false
	for key, entry := range idx.Entries {
		if entry.Scope == scope && entry.AssetKey == assetKeyValue {
			_ = os.Remove(filepath.Join(svc.thumbnailCacheRoot(), filepath.FromSlash(entry.Path)))
			delete(idx.Entries, key)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return svc.writeThumbnailIndex(idx)
}

func thumbnailCacheKey(spec thumbnailCacheSpec) (string, error) {
	payload, err := json.Marshal(spec)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func thumbnailCacheRelPath(cacheKey string, ext string) string {
	prefix := "00"
	if len(cacheKey) >= 2 {
		prefix = cacheKey[:2]
	}
	return filepath.ToSlash(filepath.Join("v1", prefix, cacheKey+"."+ext))
}

func thumbnailTempPath(cachePath string, ext string) string {
	cleanExt := strings.Trim(strings.ToLower(strings.TrimSpace(ext)), ".")
	if cleanExt == "" {
		return fmt.Sprintf("%s.tmp-%d", cachePath, nowUnixNano())
	}
	base := strings.TrimSuffix(cachePath, "."+cleanExt)
	return fmt.Sprintf("%s.tmp-%d.%s", base, nowUnixNano(), cleanExt)
}

func thumbnailOutputFormat(spec thumbnailCacheSpec) (string, string) {
	if spec.MediaKind == "image" && strings.EqualFold(spec.Ext, thumbnailSVGExtension) {
		return thumbnailSVGExtension, thumbnailSVGMime
	}
	if spec.MediaKind == "document" && isDocumentPageRenderExt(spec.Ext) {
		return thumbnailJPEGExtension, thumbnailJPEGMime
	}
	if spec.MediaKind == "document" {
		return thumbnailSVGExtension, thumbnailSVGMime
	}
	return thumbnailJPEGExtension, thumbnailJPEGMime
}

func readThumbnailDataURL(path string, mimeType string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if mimeType == thumbnailSVGMime {
		return "data:" + mimeType + ";charset=utf-8," + url.PathEscape(string(data)), nil
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func copyFile(from string, to string) error {
	data, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	return os.WriteFile(to, data, 0o644)
}

func nowUnixNano() int64 {
	return time.Now().UnixNano()
}
