package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed shared/asset_file_types.json
var assetFileTypesJSON []byte

type assetFileType struct {
	Ext         string   `json:"ext"`
	Mime        string   `json:"mime"`
	Kind        string   `json:"kind"`
	MimeAliases []string `json:"mimeAliases"`
}

var assetFileTypes = mustLoadAssetFileTypes()

var assetFileTypeByExt = buildAssetFileTypeByExt(assetFileTypes)
var assetKindByMime = buildAssetKindByMime(assetFileTypes)

func isAllowedAssetExt(ext string) bool {
	_, ok := assetFileTypeByExt[normalizeAssetFileExt(ext)]
	return ok
}

func assetFileMimeFromExt(ext string) string {
	if item, ok := assetFileTypeByExt[normalizeAssetFileExt(ext)]; ok {
		return item.Mime
	}
	return ""
}

func assetFileKindFromMime(mimeType string) string {
	return assetKindByMime[normalizeAssetMime(mimeType)]
}

func buildAssetFileTypeByExt(items []assetFileType) map[string]assetFileType {
	out := map[string]assetFileType{}
	for _, item := range items {
		out[normalizeAssetFileExt(item.Ext)] = item
	}
	return out
}

func buildAssetKindByMime(items []assetFileType) map[string]string {
	out := map[string]string{}
	for _, item := range items {
		kind := strings.TrimSpace(item.Kind)
		setPreferredAssetMimeKind(out, item.Mime, kind)
		for _, alias := range item.MimeAliases {
			setPreferredAssetMimeKind(out, alias, kind)
		}
	}
	return out
}

func mustLoadAssetFileTypes() []assetFileType {
	var items []assetFileType
	if err := json.Unmarshal(assetFileTypesJSON, &items); err != nil {
		panic(fmt.Sprintf("load asset file types: %v", err))
	}
	if len(items) == 0 {
		panic("asset file types cannot be empty")
	}
	seenExts := map[string]bool{}
	for _, item := range items {
		ext := normalizeAssetFileExt(item.Ext)
		mimeType := normalizeAssetMime(item.Mime)
		kind := strings.TrimSpace(item.Kind)
		if ext == "" || mimeType == "" || kind == "" {
			panic(fmt.Sprintf("invalid asset file type: %#v", item))
		}
		if seenExts[ext] {
			panic(fmt.Sprintf("duplicate asset file extension: %s", ext))
		}
		seenExts[ext] = true
	}
	return items
}

func setPreferredAssetMimeKind(target map[string]string, mimeType string, kind string) {
	normalizedMime := normalizeAssetMime(mimeType)
	if normalizedMime == "" || strings.TrimSpace(kind) == "" {
		return
	}
	if _, exists := target[normalizedMime]; exists {
		return
	}
	target[normalizedMime] = strings.TrimSpace(kind)
}

func normalizeAssetFileExt(ext string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(ext)), ".")
}

func normalizeAssetMime(mimeType string) string {
	return strings.TrimSpace(strings.Split(strings.ToLower(strings.TrimSpace(mimeType)), ";")[0])
}
