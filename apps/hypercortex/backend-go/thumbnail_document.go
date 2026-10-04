package main

import (
	"fmt"
	"path/filepath"
	"strings"
)

const (
	documentPreviewReadLimit = 192 * 1024
	pdfPreviewReadLimit      = 2 * 1024 * 1024
	maxDocumentPreviewLines  = 7
	maxDocumentPreviewCells  = 5
)

type documentThumbnailModel struct {
	KindLabel    string
	Accent       string
	Title        string
	Subtitle     string
	Layout       string
	CoverDataURL string
	Lines        []string
	Table        [][]string
}

type epubPackagePreview struct {
	Title        string
	Creator      string
	CoverDataURL string
	Lines        []string
}

type epubManifestItem struct {
	ID         string
	Href       string
	MediaType  string
	Properties string
}

func generateDocumentThumbnailFile(source string, output string, spec thumbnailCacheSpec) error {
	if isDocumentPageRenderExt(spec.Ext) {
		return generateDocumentPageThumbnailFile(source, output, spec)
	}
	model, err := buildDocumentThumbnailModel(source, spec)
	if err != nil {
		return err
	}
	width, height := normalizeThumbnailSize(spec.Width, spec.Height)
	if height <= 0 {
		height = defaultThumbnailHeight
	}
	svg := renderDocumentThumbnailSVG(model, width, height)
	return writeFileAtomic(output, []byte(svg))
}

func buildDocumentThumbnailModel(source string, spec thumbnailCacheSpec) (documentThumbnailModel, error) {
	ext := normalizeAssetFileExt(spec.Ext)
	base := strings.TrimSuffix(filepath.Base(source), filepath.Ext(source))
	model := documentThumbnailModel{
		KindLabel: strings.ToUpper(ext),
		Accent:    documentAccentColor(ext),
		Title:     nonEmpty(spec.DisplayTitle, nonEmpty(cleanHashedAssetTitle(base, spec.AssetID, spec.Ext), documentTypeTitle(ext))),
		Subtitle:  documentSubtitle(ext, spec.Size),
		Layout:    "document",
	}

	switch ext {
	case "pdf":
		model.Layout = "page"
		lines, err := extractPDFPreviewLines(source)
		if err != nil {
			return documentThumbnailModel{}, err
		}
		model.Lines = lines
	case "epub":
		book, err := extractEPUBPreview(source)
		if err != nil {
			return documentThumbnailModel{}, err
		}
		if spec.DisplayTitle == "" {
			model.Title = nonEmpty(book.Title, model.Title)
		}
		model.CoverDataURL = book.CoverDataURL
		model.Lines = book.Lines
	case "docx":
		model.Layout = "page"
		lines, err := extractDOCXPreviewLines(source)
		if err != nil {
			return documentThumbnailModel{}, err
		}
		if len(lines) > 0 {
			model.Lines = usefulDocumentBodyLines(lines, model.Title)
		}
	case "xlsx":
		table, err := extractXLSXPreviewTable(source)
		if err != nil {
			return documentThumbnailModel{}, err
		}
		model.Table = table
	case "pptx":
		lines, err := extractPPTXPreviewLines(source)
		if err != nil {
			return documentThumbnailModel{}, err
		}
		if len(lines) > 0 {
			if spec.DisplayTitle == "" {
				model.Title = nonEmpty(lines[0], model.Title)
			}
			model.Lines = usefulDocumentBodyLines(lines, model.Title)
		}
	case "csv", "tsv":
		table, err := extractDelimitedPreviewTable(source, ext)
		if err != nil {
			return documentThumbnailModel{}, err
		}
		model.Table = table
	default:
		lines, err := extractPlainTextPreviewLines(source)
		if err != nil {
			return documentThumbnailModel{}, err
		}
		model.Lines = lines
	}

	if len(model.Lines) == 0 && len(model.Table) == 0 {
		model.Lines = []string{documentEmptyContentLabel(ext)}
	}
	return model, nil
}

func tailLines(lines []string) []string {
	if len(lines) <= 1 {
		return []string{}
	}
	return lines[1:]
}

func cleanHashedAssetTitle(base string, assetID string, ext string) string {
	base = strings.TrimSpace(base)
	if base == "" || strings.EqualFold(base, strings.TrimSpace(assetID)) || strings.EqualFold(base, assetKey(assetID, ext)) || isHexHashLike(base) {
		return ""
	}
	return trimAssetTitleExt(base, ext)
}

func isHexHashLike(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) < 24 {
		return false
	}
	for _, r := range value {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F') {
			return false
		}
	}
	return true
}

func documentTypeTitle(ext string) string {
	switch normalizeAssetFileExt(ext) {
	case "pdf":
		return "PDF 文档"
	case "docx":
		return "Word 文档"
	case "epub":
		return "EPUB 电子书"
	case "xlsx":
		return "Excel 表格"
	case "pptx":
		return "PowerPoint 演示"
	case "txt":
		return "文本文件"
	default:
		clean := strings.ToUpper(normalizeAssetFileExt(ext))
		if clean == "" {
			return "文档"
		}
		return clean + " 文档"
	}
}

func documentSubtitle(ext string, size int64) string {
	label := map[string]string{
		"pdf": "PDF 文档", "epub": "EPUB 电子书", "docx": "Word 文档", "xlsx": "Excel 表格", "pptx": "PowerPoint 演示",
		"txt": "纯文本文档", "md": "Markdown 文档", "markdown": "Markdown 文档", "csv": "CSV 表格", "tsv": "TSV 表格",
		"json": "JSON 数据", "jsonl": "JSONL 数据", "xml": "XML 文档", "yaml": "YAML 文档", "yml": "YAML 文档", "html": "HTML 文档", "htm": "HTML 文档", "rtf": "RTF 文档",
	}[normalizeAssetFileExt(ext)]
	if label == "" {
		label = strings.ToUpper(normalizeAssetFileExt(ext)) + " 文档"
	}
	return fmt.Sprintf("%s · %s", label, humanFileSize(size))
}

func documentEmptyContentLabel(ext string) string {
	switch normalizeAssetFileExt(ext) {
	case "pdf":
		return "PDF 未暴露可提取文本，已生成文件信息封面"
	case "xlsx", "csv", "tsv":
		return "表格没有可显示的预览单元格"
	default:
		return "文档没有可显示的文本预览"
	}
}

func documentAccentColor(ext string) string {
	switch normalizeAssetFileExt(ext) {
	case "pdf":
		return "#ef4444"
	case "epub":
		return "#8b5cf6"
	case "docx", "doc", "rtf":
		return "#2563eb"
	case "xlsx", "xls", "csv", "tsv":
		return "#16a34a"
	case "pptx", "ppt":
		return "#f97316"
	case "json", "jsonl", "xml", "yaml", "yml":
		return "#0891b2"
	case "html", "htm", "md", "markdown":
		return "#7c3aed"
	default:
		return "#64748b"
	}
}

func humanFileSize(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	}
	if bytes < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(bytes)/1024)
	}
	return fmt.Sprintf("%.1f MB", float64(bytes)/(1024*1024))
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
