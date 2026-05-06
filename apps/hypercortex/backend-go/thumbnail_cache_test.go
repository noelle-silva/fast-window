package main

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImageThumbnailCacheLifecycle(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensure roots failed: %v", err)
	}

	assetID := "image-asset"
	ext := "png"
	relPath := filepath.ToSlash(filepath.Join(assetsDir, "images", "2026-05", assetKey(assetID, ext)))
	writeTestPNG(t, filepath.Join(svc.libraryDir, filepath.FromSlash(relPath)), 96, 64)

	first, err := svc.getAssetThumbnail("library", assetID, ext, 64, 48, false)
	if err != nil {
		t.Fatalf("first thumbnail failed: %v", err)
	}
	if first.Cached {
		t.Fatal("first thumbnail should be generated, not cached")
	}
	if first.MediaKind != "image" || first.Width != 64 || first.Height != 48 {
		t.Fatalf("unexpected first result: %+v", first)
	}
	assertJPEGDataURLSize(t, first.DataURL, 64, 48)

	idx := readThumbnailIndexForTest(t, svc)
	if len(idx.Entries) != 1 {
		t.Fatalf("thumbnail index entries = %d, want 1", len(idx.Entries))
	}
	var cachePath string
	for _, entry := range idx.Entries {
		cachePath = filepath.Join(svc.thumbnailCacheRoot(), filepath.FromSlash(entry.Path))
	}
	mustExist(t, cachePath)

	second, err := svc.getAssetThumbnail("library", assetID, ext, 64, 48, false)
	if err != nil {
		t.Fatalf("second thumbnail failed: %v", err)
	}
	if !second.Cached {
		t.Fatal("second thumbnail should hit cache")
	}

	rebuilt, err := svc.rebuildAssetThumbnail("library", assetID, ext, 64, 48)
	if err != nil {
		t.Fatalf("rebuild thumbnail failed: %v", err)
	}
	if rebuilt.Cached {
		t.Fatal("rebuilt thumbnail should be freshly generated")
	}

	if err := svc.deleteAsset("library", assetID, ext); err != nil {
		t.Fatalf("delete asset failed: %v", err)
	}
	idx = readThumbnailIndexForTest(t, svc)
	if len(idx.Entries) != 0 {
		t.Fatalf("thumbnail index entries after delete = %d, want 0", len(idx.Entries))
	}
	mustNotExist(t, cachePath)
}

func TestRebuildAllThumbnailsReportsImagesAndSkipsDocuments(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensure roots failed: %v", err)
	}

	writeTestPNG(t, filepath.Join(svc.libraryDir, assetsDir, "images", "2026-05", "image-a.png"), 80, 80)
	mustWriteFile(t, filepath.Join(svc.libraryDir, assetsDir, "docs", "2026-05", "doc-a.txt"), "hello")

	report, err := svc.rebuildAllThumbnails("library", 64, 48)
	if err != nil {
		t.Fatalf("rebuild all failed: %v", err)
	}
	if report.Total != 1 || report.Rebuilt != 1 || report.Skipped != 1 || report.Failed != 0 {
		t.Fatalf("unexpected rebuild report: %+v", report)
	}
	idx := readThumbnailIndexForTest(t, svc)
	if len(idx.Entries) != 1 {
		t.Fatalf("thumbnail index entries = %d, want 1", len(idx.Entries))
	}
}

func TestThumbnailTempPathKeepsOutputExtension(t *testing.T) {
	path := filepath.Join("cache", "abc.jpg")
	tmp := thumbnailTempPath(path, "jpg")
	if !strings.HasSuffix(tmp, ".jpg") {
		t.Fatalf("temp path %q should keep .jpg suffix", tmp)
	}
	if !strings.Contains(filepath.Base(tmp), ".tmp-") {
		t.Fatalf("temp path %q should include tmp marker", tmp)
	}
}

func writeTestPNG(t *testing.T, path string, width int, height int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 160, A: 255})
		}
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	encodeErr := png.Encode(file, img)
	closeErr := file.Close()
	if encodeErr != nil {
		t.Fatal(encodeErr)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}
}

func assertJPEGDataURLSize(t *testing.T, dataURL string, width int, height int) {
	t.Helper()
	const prefix = "data:image/jpeg;base64,"
	if !strings.HasPrefix(dataURL, prefix) {
		t.Fatalf("thumbnail data URL prefix mismatch: %q", dataURL[:minIntForTest(len(dataURL), len(prefix))])
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, prefix))
	if err != nil {
		t.Fatal(err)
	}
	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if got := img.Bounds().Dx(); got != width {
		t.Fatalf("thumbnail width = %d, want %d", got, width)
	}
	if got := img.Bounds().Dy(); got != height {
		t.Fatalf("thumbnail height = %d, want %d", got, height)
	}
}

func readThumbnailIndexForTest(t *testing.T, svc *service) thumbnailIndex {
	t.Helper()
	idx, err := svc.readThumbnailIndex()
	if err != nil {
		t.Fatalf("read thumbnail index failed: %v", err)
	}
	return idx
}

func minIntForTest(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
