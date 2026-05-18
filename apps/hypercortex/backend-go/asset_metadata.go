package main

import (
	"os"
	"path/filepath"
	"strings"
)

const assetIndexVersion = 2
const assetMetadataVersion = 2
const maxAssetTextLength = 2000
const maxAssetDisplayNameLength = 180

type assetUserMetadataInput struct {
	DisplayName string   `json:"displayName"`
	Remark      string   `json:"remark"`
	Tags        []string `json:"tags"`
}

func newAssetMetadata(input assetIndexEntry) assetIndexEntry {
	assetID := strings.TrimSpace(input.AssetID)
	ext := normalizeAssetExt(input.Ext)
	path := filepath.ToSlash(strings.TrimSpace(input.Path))
	mimeType := strings.TrimSpace(input.Mime)
	if mimeType == "" && ext != "" {
		mimeType = mimeFromExt(ext)
	}
	kind := strings.TrimSpace(input.Kind)
	if kind == "" {
		kind = kindFromMime(mimeType)
	}
	createdAt := positiveMs(input.CreatedAtMs)
	uploadedAt := positiveMs(input.UploadedAtMs)
	modifiedAt := positiveMs(input.ModifiedMs)
	if createdAt <= 0 {
		createdAt = uploadedAt
	}
	if createdAt <= 0 {
		createdAt = modifiedAt
	}
	if uploadedAt <= 0 {
		uploadedAt = createdAt
	}
	updatedAt := positiveMs(input.UpdatedAtMs)
	if updatedAt <= 0 {
		updatedAt = createdAt
	}

	return assetIndexEntry{
		MetadataVersion: assetMetadataVersion,
		AssetID:         assetID,
		Ext:             ext,
		Path:            path,
		Kind:            kind,
		Mime:            mimeType,
		Size:            input.Size,
		CreatedAtMs:     createdAt,
		UploadedAtMs:    uploadedAt,
		UpdatedAtMs:     updatedAt,
		ModifiedMs:      modifiedAt,
		SourceName:      normalizeAssetShortText(input.SourceName, maxAssetDisplayNameLength),
		DisplayName:     normalizeAssetShortText(input.DisplayName, maxAssetDisplayNameLength),
		Remark:          normalizeAssetShortText(input.Remark, maxAssetTextLength),
		Tags:            normalizeAssetTags(input.Tags),
	}
}

func migrateAssetIndexEntry(key string, input assetIndexEntry, info os.FileInfo) assetIndexEntry {
	assetID, ext := parseAssetFileName(key)
	if strings.TrimSpace(input.AssetID) != "" {
		assetID = input.AssetID
	}
	if strings.TrimSpace(input.Ext) != "" {
		ext = input.Ext
	}
	modifiedMs := input.ModifiedMs
	if modifiedMs <= 0 && info != nil {
		modifiedMs = float64(info.ModTime().UnixMilli())
	}
	size := input.Size
	if size <= 0 && info != nil {
		size = info.Size()
	}
	name := strings.TrimSpace(input.SourceName)
	if name == "" {
		name = strings.TrimSpace(input.DisplayName)
	}
	return newAssetMetadata(assetIndexEntry{
		AssetID:      assetID,
		Ext:          ext,
		Path:         input.Path,
		Kind:         input.Kind,
		Mime:         input.Mime,
		Size:         size,
		CreatedAtMs:  modifiedMs,
		UploadedAtMs: modifiedMs,
		UpdatedAtMs:  modifiedMs,
		ModifiedMs:   modifiedMs,
		SourceName:   name,
		DisplayName:  input.DisplayName,
		Remark:       input.Remark,
		Tags:         input.Tags,
	})
}

func assetPoolItemFromMetadata(entry assetIndexEntry) assetPoolItem {
	name := assetKey(entry.AssetID, entry.Ext)
	return assetPoolItem{
		RelPath:      entry.Path,
		Name:         name,
		AssetID:      entry.AssetID,
		Ext:          entry.Ext,
		Kind:         entry.Kind,
		Mime:         entry.Mime,
		SourceName:   entry.SourceName,
		DisplayName:  entry.DisplayName,
		Remark:       entry.Remark,
		Tags:         append([]string{}, entry.Tags...),
		Size:         entry.Size,
		CreatedAtMs:  entry.CreatedAtMs,
		UploadedAtMs: entry.UploadedAtMs,
		UpdatedAtMs:  entry.UpdatedAtMs,
		ModifiedMs:   entry.ModifiedMs,
	}
}

func normalizeAssetExt(ext string) string {
	return strings.Trim(strings.ToLower(strings.TrimSpace(ext)), ".")
}

func positiveMs(value float64) float64 {
	if value > 0 {
		return value
	}
	return 0
}

func normalizeAssetShortText(value string, maxLen int) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	if len([]rune(text)) <= maxLen {
		return text
	}
	return string([]rune(text)[:maxLen])
}

func normalizeAssetTags(tags []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, item := range tags {
		tag := normalizeAssetShortText(item, 64)
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	return out
}
