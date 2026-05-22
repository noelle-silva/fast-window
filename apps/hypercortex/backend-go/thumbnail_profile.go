package main

import (
	"fmt"
	"strings"
)

type thumbnailProfile struct {
	ID        string
	MediaKind string
	Exts      map[string]bool
}

var thumbnailProfiles = []thumbnailProfile{
	{
		ID:        "image-raster-v1",
		MediaKind: "image",
		Exts:      extSet("jpg", "jpeg", "png", "webp", "gif", "svg"),
	},
	{
		ID:        "video-ffmpeg-v1",
		MediaKind: "video",
		Exts:      extSet("mp4", "m4v", "webm", "mov", "ogv", "mkv", "avi"),
	},
	{
		ID:        "document-page-render-v1",
		MediaKind: "document",
		Exts:      extSet("pdf"),
	},
	{
		ID:        "document-cover-v3",
		MediaKind: "document",
		Exts: extSet(
			"epub", "xlsx", "pptx",
			"txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml", "html", "htm", "rtf",
		),
	},
}

func thumbnailProfileFor(ext string, mediaKind string) (thumbnailProfile, bool) {
	normalizedExt := normalizeAssetFileExt(ext)
	normalizedKind := strings.TrimSpace(mediaKind)
	for _, profile := range thumbnailProfiles {
		if profile.MediaKind == normalizedKind && profile.Exts[normalizedExt] {
			return profile, true
		}
	}
	return thumbnailProfile{}, false
}

func unsupportedThumbnailError(ext string, mediaKind string) error {
	cleanExt := normalizeAssetFileExt(ext)
	cleanKind := strings.TrimSpace(mediaKind)
	if cleanExt == "" {
		return fmt.Errorf("%s 类型附件未注册缩略图能力", nonEmpty(cleanKind, "未知"))
	}
	return fmt.Errorf(".%s 类型附件未注册缩略图能力", cleanExt)
}

func extSet(exts ...string) map[string]bool {
	out := map[string]bool{}
	for _, ext := range exts {
		clean := normalizeAssetFileExt(ext)
		if clean != "" {
			out[clean] = true
		}
	}
	return out
}
