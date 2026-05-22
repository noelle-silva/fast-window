package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/url"
	"os"
	"os/exec"
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

func TestRebuildAllThumbnailsIncludesDocumentsAndSkipsArchives(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensure roots failed: %v", err)
	}

	writeTestPNG(t, filepath.Join(svc.libraryDir, assetsDir, "images", "2026-05", "image-a.png"), 80, 80)
	mustWriteFile(t, filepath.Join(svc.libraryDir, assetsDir, "docs", "2026-05", "doc-a.txt"), "hello document thumbnail")
	mustWriteFile(t, filepath.Join(svc.libraryDir, assetsDir, "docs", "2026-05", "archive-a.zip"), "not a real zip but still unsupported by extension")

	report, err := svc.rebuildAllThumbnails("library", 64, 48)
	if err != nil {
		t.Fatalf("rebuild all failed: %v", err)
	}
	if report.Total != 2 || report.Rebuilt != 2 || report.Skipped != 1 || report.Failed != 0 {
		t.Fatalf("unexpected rebuild report: %+v", report)
	}
	idx := readThumbnailIndexForTest(t, svc)
	if len(idx.Entries) != 2 {
		t.Fatalf("thumbnail index entries = %d, want 2", len(idx.Entries))
	}
}

func TestDocumentThumbnailCacheLifecycle(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensure roots failed: %v", err)
	}

	assetID := "document-asset"
	ext := "txt"
	relPath := filepath.ToSlash(filepath.Join(assetsDir, "docs", "2026-05", assetKey(assetID, ext)))
	mustWriteFile(t, filepath.Join(svc.libraryDir, filepath.FromSlash(relPath)), "Document Title\nThis is a useful document thumbnail preview.")

	first, err := svc.getAssetThumbnail("library", assetID, ext, 320, 180, false)
	if err != nil {
		t.Fatalf("document thumbnail failed: %v", err)
	}
	if first.Cached {
		t.Fatal("first document thumbnail should be generated, not cached")
	}
	if first.MediaKind != "document" || first.Width != 320 || first.Height != 180 {
		t.Fatalf("unexpected document result: %+v", first)
	}
	if !strings.HasPrefix(first.DataURL, "data:image/svg+xml;charset=utf-8,") {
		t.Fatalf("document thumbnail should be svg data url, got %q", first.DataURL[:minIntForTest(len(first.DataURL), 32)])
	}
	assertDataURLContains(t, first.DataURL, "Document Title")

	second, err := svc.getAssetThumbnail("library", assetID, ext, 320, 180, false)
	if err != nil {
		t.Fatalf("second document thumbnail failed: %v", err)
	}
	if !second.Cached {
		t.Fatal("second document thumbnail should hit cache")
	}
}

func TestPDFThumbnailRendersRealFirstPageJPEG(t *testing.T) {
	skipIfNoPDFPageRenderer(t)
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensure roots failed: %v", err)
	}

	assetID := "70223fdd74952ac639e97f00ab111111111111111111111111111111111111"
	ext := "pdf"
	relPath := filepath.ToSlash(filepath.Join(assetsDir, "docs", "2026-05", assetKey(assetID, ext)))
	writeTestPDF(t, filepath.Join(svc.libraryDir, filepath.FromSlash(relPath)))
	idx, err := svc.ensureAssetIndex("library")
	if err != nil {
		t.Fatal(err)
	}
	idx.Assets[assetKey(assetID, ext)] = newAssetMetadata(assetIndexEntry{
		AssetID:    assetID,
		Ext:        ext,
		Path:       relPath,
		Kind:       "document",
		Mime:       "application/pdf",
		Size:       2300 * 1024,
		ModifiedMs: nowMs(),
		SourceName: "Analytical mechanics (Lemoyne).pdf",
	})
	if err := svc.saveAssetIndex("library", idx); err != nil {
		t.Fatal(err)
	}

	thumb, err := svc.getAssetThumbnail("library", assetID, ext, 320, 180, false)
	if err != nil {
		t.Fatalf("thumbnail failed: %v", err)
	}
	assertJPEGDataURLSize(t, thumb.DataURL, 320, 180)
}

func TestEPUBThumbnailUsesManifestCoverImage(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensure roots failed: %v", err)
	}

	assetID := "book-asset"
	ext := "epub"
	relPath := filepath.ToSlash(filepath.Join(assetsDir, "docs", "2026-05", assetKey(assetID, ext)))
	writeTestEPUBWithCover(t, filepath.Join(svc.libraryDir, filepath.FromSlash(relPath)))

	thumb, err := svc.getAssetThumbnail("library", assetID, ext, 320, 180, false)
	if err != nil {
		t.Fatalf("epub thumbnail failed: %v", err)
	}
	assertDataURLContains(t, thumb.DataURL, "data:image/png;base64")
	assertDataURLContains(t, thumb.DataURL, "Test Book")
}

func TestZipThumbnailIsNotRegistered(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensure roots failed: %v", err)
	}

	assetID := "archive-asset"
	ext := "zip"
	relPath := filepath.ToSlash(filepath.Join(assetsDir, "docs", "2026-05", assetKey(assetID, ext)))
	mustWriteFile(t, filepath.Join(svc.libraryDir, filepath.FromSlash(relPath)), "zip content")

	if _, err := svc.getAssetThumbnail("library", assetID, ext, 64, 48, false); err == nil || !strings.Contains(err.Error(), "未注册缩略图能力") {
		t.Fatalf("zip thumbnail error = %v, want explicit unsupported capability error", err)
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

func assertDataURLContains(t *testing.T, dataURL string, want string) {
	t.Helper()
	text := decodedDataURLPayload(t, dataURL)
	if !strings.Contains(text, want) {
		t.Fatalf("thumbnail payload does not contain %q: %s", want, text)
	}
}

func assertDataURLNotContains(t *testing.T, dataURL string, unwanted string) {
	t.Helper()
	text := decodedDataURLPayload(t, dataURL)
	if strings.Contains(text, unwanted) {
		t.Fatalf("thumbnail payload unexpectedly contains %q: %s", unwanted, text)
	}
}

func decodedDataURLPayload(t *testing.T, dataURL string) string {
	t.Helper()
	idx := strings.Index(dataURL, ",")
	if idx < 0 {
		t.Fatalf("invalid data url: %q", dataURL[:minIntForTest(len(dataURL), 32)])
	}
	payload := dataURL[idx+1:]
	if strings.Contains(dataURL[:idx], ";base64") {
		data, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	decoded, err := url.PathUnescape(payload)
	if err != nil {
		t.Fatal(err)
	}
	return decoded
}

func writeTestEPUBWithCover(t *testing.T, target string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(target)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	mustWriteZipEntry(t, archive, "META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`)
	mustWriteZipEntry(t, archive, "OPS/package.opf", `<?xml version="1.0"?><package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Test Book</dc:title><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Author</dc:creator><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest></package>`)
	mustWriteZipEntry(t, archive, "OPS/chapter.xhtml", `<html><body><p>This content must not replace the cover.</p></body></html>`)
	mustWriteZipEntryBytes(t, archive, "OPS/images/cover.png", testPNGBytes(t, 24, 32))
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func writeTestPDF(t *testing.T, target string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	content := `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 77 >>
stream
BT
/F1 28 Tf
72 720 Td
(Analytical mechanics first page) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000311 00000 n 
trailer
<< /Root 1 0 R /Size 6 >>
startxref
438
%%EOF
`
	mustWriteFile(t, target, content)
}

func skipIfNoPDFPageRenderer(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath(resolvePDFPageRendererBinary()); err != nil {
		t.Skipf("skip PDF real page render test: %v", err)
	}
}

func mustWriteZipEntry(t *testing.T, archive *zip.Writer, name string, content string) {
	t.Helper()
	mustWriteZipEntryBytes(t, archive, name, []byte(content))
}

func mustWriteZipEntryBytes(t *testing.T, archive *zip.Writer, name string, content []byte) {
	t.Helper()
	w, err := archive.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(content); err != nil {
		t.Fatal(err)
	}
}

func testPNGBytes(t *testing.T, width int, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 120, G: uint8(120 + y%80), B: uint8(200 + x%40), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
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
