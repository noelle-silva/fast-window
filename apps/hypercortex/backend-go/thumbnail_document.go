package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
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

func renderDocumentThumbnailSVG(model documentThumbnailModel, width int, height int) string {
	if model.CoverDataURL != "" {
		return renderImageCoverThumbnailSVG(model, width, height)
	}
	if model.Layout == "page" {
		return renderDocumentPageThumbnailSVG(model, width, height)
	}

	accent := nonEmpty(model.Accent, "#7c3aed")
	viewW := float64(width)
	viewH := float64(height)
	contentTop := 68.0
	contentLeft := 22.0
	contentWidth := viewW - 44
	var body strings.Builder

	if len(model.Table) > 0 {
		body.WriteString(renderSVGTable(model.Table, contentLeft, contentTop, contentWidth, viewH-contentTop-20))
	} else {
		body.WriteString(renderSVGLines(model.Lines, contentLeft, contentTop, contentWidth, viewH-contentTop-18))
	}

	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" role="img" aria-label="%s 缩略图">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#f8fafc"/>
    </linearGradient>
    <filter id="shadow" x="-20%%" y="-20%%" width="140%%" height="140%%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.16"/>
    </filter>
  </defs>
  <rect width="%d" height="%d" rx="18" fill="#e5e7eb"/>
  <rect x="10" y="8" width="%g" height="%g" rx="14" fill="url(#bg)" filter="url(#shadow)"/>
  <rect x="10" y="8" width="7" height="%g" rx="3.5" fill="%s"/>
  <rect x="22" y="18" width="46" height="24" rx="8" fill="%s" fill-opacity="0.13"/>
  <text x="45" y="34" text-anchor="middle" font-family="Inter, Microsoft YaHei, sans-serif" font-size="11" font-weight="900" fill="%s">%s</text>
  <text x="76" y="28" font-family="Inter, Microsoft YaHei, sans-serif" font-size="14" font-weight="900" fill="#0f172a">%s</text>
  <text x="76" y="45" font-family="Inter, Microsoft YaHei, sans-serif" font-size="10" font-weight="700" fill="#64748b">%s</text>
  %s
</svg>`, width, height, width, height, escapeXML(model.Title), width, height, viewW-20, viewH-16, viewH-16, accent, accent, accent, escapeXML(model.KindLabel), escapeXML(ellipsisRunes(model.Title, 24)), escapeXML(ellipsisRunes(model.Subtitle, 36)), body.String())
}

func renderImageCoverThumbnailSVG(model documentThumbnailModel, width int, height int) string {
	accent := nonEmpty(model.Accent, "#8b5cf6")
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" role="img" aria-label="%s 封面缩略图">
  <defs>
    <clipPath id="coverClip"><rect x="0" y="0" width="%d" height="%d" rx="16"/></clipPath>
    <linearGradient id="coverShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.48"/></linearGradient>
  </defs>
  <rect width="%d" height="%d" rx="16" fill="#111827"/>
  <image x="0" y="0" width="%d" height="%d" preserveAspectRatio="xMidYMid slice" href="%s" clip-path="url(#coverClip)"/>
  <rect width="%d" height="%d" rx="16" fill="url(#coverShade)"/>
  <rect x="12" y="12" width="54" height="24" rx="8" fill="%s" fill-opacity="0.9"/>
  <text x="39" y="29" text-anchor="middle" font-family="Inter, Microsoft YaHei, sans-serif" font-size="11" font-weight="900" fill="#fff">%s</text>
  <text x="16" y="%d" font-family="Inter, Microsoft YaHei, sans-serif" font-size="13" font-weight="900" fill="#fff">%s</text>
</svg>`, width, height, width, height, escapeXML(model.Title), width, height, width, height, width, height, escapeXML(model.CoverDataURL), width, height, accent, escapeXML(model.KindLabel), height-16, escapeXML(ellipsisRunes(model.Title, 30)))
}

func renderDocumentPageThumbnailSVG(model documentThumbnailModel, width int, height int) string {
	accent := nonEmpty(model.Accent, "#2563eb")
	viewW := float64(width)
	viewH := float64(height)
	pageX := viewW * 0.17
	pageY := 13.0
	pageW := viewW * 0.66
	pageH := viewH - 26
	if pageW < 120 {
		pageX = 16
		pageW = viewW - 32
	}
	lineY := pageY + 54
	visible := normalizePreviewLines(model.Lines, 5)
	var lines strings.Builder
	for i, line := range visible {
		y := lineY + float64(i)*16
		if y > pageY+pageH-20 {
			break
		}
		w := pageW - 42 - float64(i%2)*24
		if line != "" {
			lines.WriteString(fmt.Sprintf(`<rect x="%g" y="%g" width="%g" height="5" rx="2.5" fill="#cbd5e1"/>`, pageX+22, y, w))
		}
	}
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" role="img" aria-label="%s 文档封面缩略图">
  <defs>
    <filter id="paperShadow" x="-20%%" y="-20%%" width="140%%" height="140%%"><feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.18"/></filter>
  </defs>
  <rect width="%d" height="%d" rx="18" fill="#e7e5df"/>
  <rect x="%g" y="%g" width="%g" height="%g" rx="8" fill="#fffdf8" filter="url(#paperShadow)"/>
  <rect x="%g" y="%g" width="%g" height="6" rx="3" fill="%s"/>
  <text x="%g" y="%g" font-family="Inter, Microsoft YaHei, sans-serif" font-size="15" font-weight="900" fill="#111827">%s</text>
  <text x="%g" y="%g" font-family="Inter, Microsoft YaHei, sans-serif" font-size="9" font-weight="800" fill="#64748b">%s</text>
  %s
  <rect x="%g" y="%g" width="%g" height="18" rx="6" fill="%s" fill-opacity="0.12"/>
  <text x="%g" y="%g" font-family="Inter, Microsoft YaHei, sans-serif" font-size="9" font-weight="900" fill="%s">%s</text>
</svg>`, width, height, width, height, escapeXML(model.Title), width, height, pageX, pageY, pageW, pageH, pageX+22, pageY+22, pageW-44, accent, pageX+22, pageY+42, escapeXML(ellipsisRunes(model.Title, 22)), pageX+22, pageY+56, escapeXML(ellipsisRunes(model.Subtitle, 30)), lines.String(), pageX+22, pageY+pageH-32, 52.0, accent, pageX+32, pageY+pageH-19, accent, escapeXML(model.KindLabel))
}

func renderSVGLines(lines []string, x float64, y float64, width float64, height float64) string {
	visible := normalizePreviewLines(lines, maxDocumentPreviewLines)
	var b strings.Builder
	lineHeight := 15.0
	for i, line := range visible {
		cy := y + float64(i)*lineHeight
		if cy > y+height-8 {
			break
		}
		text := ellipsisRunes(line, maxInt(18, int(width/7)))
		b.WriteString(fmt.Sprintf(`<text x="%g" y="%g" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, Microsoft YaHei, monospace" font-size="10.5" font-weight="700" fill="#334155">%s</text>`, x, cy, escapeXML(text)))
		b.WriteByte('\n')
	}
	return b.String()
}

func renderSVGTable(table [][]string, x float64, y float64, width float64, height float64) string {
	rows := table
	if len(rows) > maxDocumentPreviewLines {
		rows = rows[:maxDocumentPreviewLines]
	}
	if len(rows) == 0 {
		return renderSVGLines([]string{"表格没有可显示的预览行"}, x, y, width, height)
	}
	cols := 0
	for _, row := range rows {
		if len(row) > cols {
			cols = len(row)
		}
	}
	cols = maxInt(1, minInt(cols, maxDocumentPreviewCells))
	cellW := width / float64(cols)
	cellH := minFloat(18, height/float64(maxInt(1, len(rows))))
	var b strings.Builder
	for r, row := range rows {
		for c := 0; c < cols; c++ {
			cx := x + float64(c)*cellW
			cy := y + float64(r)*cellH
			fill := "#ffffff"
			if r == 0 {
				fill = "#eef2ff"
			} else if r%2 == 0 {
				fill = "#f8fafc"
			}
			value := ""
			if c < len(row) {
				value = row[c]
			}
			b.WriteString(fmt.Sprintf(`<rect x="%g" y="%g" width="%g" height="%g" rx="3" fill="%s" stroke="#e2e8f0"/>`, cx, cy, cellW-2, cellH-2, fill))
			b.WriteString(fmt.Sprintf(`<text x="%g" y="%g" font-family="Inter, Microsoft YaHei, sans-serif" font-size="9" font-weight="800" fill="#334155">%s</text>`, cx+5, cy+12, escapeXML(ellipsisRunes(value, maxInt(4, int(cellW/7))))))
		}
	}
	return b.String()
}

func extractPlainTextPreviewLines(source string) ([]string, error) {
	data, err := readFilePrefix(source, documentPreviewReadLimit)
	if err != nil {
		return nil, err
	}
	return normalizePreviewLines(splitReadableText(data), maxDocumentPreviewLines), nil
}

func extractDelimitedPreviewTable(source string, ext string) ([][]string, error) {
	data, err := readFilePrefix(source, documentPreviewReadLimit)
	if err != nil {
		return nil, err
	}
	r := csv.NewReader(strings.NewReader(string(bytes.ToValidUTF8(data, []byte(" ")))))
	r.FieldsPerRecord = -1
	if ext == "tsv" {
		r.Comma = '\t'
	}
	rows := [][]string{}
	for len(rows) < maxDocumentPreviewLines {
		record, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		rows = append(rows, normalizeTableRow(record))
	}
	return rows, nil
}

func extractPDFPreviewLines(source string) ([]string, error) {
	data, err := readFilePrefix(source, pdfPreviewReadLimit)
	if err != nil {
		return nil, err
	}
	text := extractPDFLiteralText(string(bytes.ToValidUTF8(data, []byte(" "))))
	return normalizePreviewLines(strings.FieldsFunc(text, func(r rune) bool { return r == '\n' || r == '\r' }), maxDocumentPreviewLines), nil
}

func extractEPUBPreview(source string) (documentThumbnailModel, error) {
	archive, err := zip.OpenReader(source)
	if err != nil {
		return documentThumbnailModel{}, err
	}
	defer archive.Close()
	opfPath := findEPUBPackagePath(&archive.Reader)
	if opfPath != "" {
		preview, err := extractEPUBPackagePreview(&archive.Reader, opfPath)
		if err != nil {
			return documentThumbnailModel{}, err
		}
		return documentThumbnailModel{Title: preview.Title, CoverDataURL: preview.CoverDataURL, Lines: append(nonEmptySlice(preview.Creator), preview.Lines...)}, nil
	}

	model := documentThumbnailModel{}
	for _, file := range archive.File {
		name := strings.ToLower(file.Name)
		if strings.HasSuffix(name, ".opf") {
			text, err := readZipText(file, documentPreviewReadLimit)
			if err != nil {
				return documentThumbnailModel{}, err
			}
			model.Title = firstXMLTextByLocalName(text, "title")
			if creator := firstXMLTextByLocalName(text, "creator"); creator != "" {
				model.Lines = append(model.Lines, creator)
			}
			break
		}
	}
	for _, file := range archive.File {
		name := strings.ToLower(file.Name)
		if strings.HasSuffix(name, ".xhtml") || strings.HasSuffix(name, ".html") || strings.HasSuffix(name, ".htm") {
			text, err := readZipText(file, documentPreviewReadLimit)
			if err != nil {
				return documentThumbnailModel{}, err
			}
			model.Lines = append(model.Lines, normalizePreviewLines(splitReadableText([]byte(stripXMLTags(text))), maxDocumentPreviewLines)...)
			break
		}
	}
	return model, nil
}

func findEPUBPackagePath(archive *zip.Reader) string {
	container, err := readZipEntryFromOpenArchive(archive, "META-INF/container.xml", documentPreviewReadLimit)
	if err == nil {
		decoder := xml.NewDecoder(strings.NewReader(container))
		for {
			tok, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}
			if start, ok := tok.(xml.StartElement); ok && start.Name.Local == "rootfile" {
				for _, attr := range start.Attr {
					if attr.Name.Local == "full-path" && strings.TrimSpace(attr.Value) != "" {
						return strings.TrimSpace(attr.Value)
					}
				}
			}
		}
	}
	for _, file := range archive.File {
		if strings.HasSuffix(strings.ToLower(file.Name), ".opf") {
			return file.Name
		}
	}
	return ""
}

func extractEPUBPackagePreview(archive *zip.Reader, opfPath string) (epubPackagePreview, error) {
	opfText, err := readZipEntryFromOpenArchive(archive, opfPath, 512*1024)
	if err != nil {
		return epubPackagePreview{}, err
	}
	preview := epubPackagePreview{}
	manifest := []epubManifestItem{}
	coverID := ""
	decoder := xml.NewDecoder(strings.NewReader(opfText))
	for {
		tok, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		switch start := tok.(type) {
		case xml.StartElement:
			switch start.Name.Local {
			case "title":
				preview.Title = firstElementCharData(decoder)
			case "creator":
				preview.Creator = firstElementCharData(decoder)
			case "meta":
				var nameValue string
				var contentValue string
				for _, attr := range start.Attr {
					if attr.Name.Local == "name" {
						nameValue = strings.TrimSpace(attr.Value)
					}
					if attr.Name.Local == "content" {
						contentValue = strings.TrimSpace(attr.Value)
					}
				}
				if strings.EqualFold(nameValue, "cover") && contentValue != "" {
					coverID = contentValue
				}
			case "item":
				item := epubManifestItem{}
				for _, attr := range start.Attr {
					switch attr.Name.Local {
					case "id":
						item.ID = strings.TrimSpace(attr.Value)
					case "href":
						item.Href = strings.TrimSpace(attr.Value)
					case "media-type":
						item.MediaType = strings.TrimSpace(attr.Value)
					case "properties":
						item.Properties = strings.TrimSpace(attr.Value)
					}
				}
				manifest = append(manifest, item)
			}
		}
	}
	if coverPath := resolveEPUBCoverPath(opfPath, coverID, manifest); coverPath != "" {
		if dataURL, err := readZipImageDataURL(archive, coverPath); err == nil {
			preview.CoverDataURL = dataURL
		}
	}
	if preview.CoverDataURL == "" {
		preview.Lines = extractEPUBFirstContentLines(archive)
	}
	return preview, nil
}

func firstElementCharData(decoder *xml.Decoder) string {
	for {
		tok, err := decoder.Token()
		if err != nil {
			return ""
		}
		switch t := tok.(type) {
		case xml.CharData:
			return normalizeWhitespace(string(t))
		case xml.EndElement:
			return ""
		}
	}
}

func resolveEPUBCoverPath(opfPath string, coverID string, manifest []epubManifestItem) string {
	baseDir := path.Dir(strings.ReplaceAll(opfPath, "\\", "/"))
	if baseDir == "." {
		baseDir = ""
	}
	for _, item := range manifest {
		if item.Href == "" {
			continue
		}
		if coverID != "" && item.ID == coverID {
			return cleanZipRelPath(path.Join(baseDir, item.Href))
		}
	}
	for _, item := range manifest {
		if item.Href == "" {
			continue
		}
		if strings.Contains(item.Properties, "cover-image") || strings.Contains(strings.ToLower(item.ID), "cover") {
			if strings.HasPrefix(strings.ToLower(item.MediaType), "image/") || isEPUBImagePath(item.Href) {
				return cleanZipRelPath(path.Join(baseDir, item.Href))
			}
		}
	}
	for _, item := range manifest {
		if item.Href != "" && isEPUBImagePath(item.Href) && strings.Contains(strings.ToLower(item.Href), "cover") {
			return cleanZipRelPath(path.Join(baseDir, item.Href))
		}
	}
	return ""
}

func readZipImageDataURL(archive *zip.Reader, entryName string) (string, error) {
	clean := cleanZipRelPath(entryName)
	for _, file := range archive.File {
		if cleanZipRelPath(file.Name) != clean {
			continue
		}
		r, err := file.Open()
		if err != nil {
			return "", err
		}
		defer r.Close()
		data, err := io.ReadAll(io.LimitReader(r, 8*1024*1024))
		if err != nil {
			return "", err
		}
		mimeType := imageMimeFromExt(path.Ext(file.Name))
		if mimeType == "" {
			return "", fmt.Errorf("EPUB 封面图片类型不支持：%s", file.Name)
		}
		return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
	}
	return "", fmt.Errorf("EPUB 封面图片不存在：%s", entryName)
}

func extractEPUBFirstContentLines(archive *zip.Reader) []string {
	for _, file := range archive.File {
		name := strings.ToLower(file.Name)
		if strings.HasSuffix(name, ".xhtml") || strings.HasSuffix(name, ".html") || strings.HasSuffix(name, ".htm") {
			text, err := readZipText(file, documentPreviewReadLimit)
			if err != nil {
				return []string{}
			}
			return normalizePreviewLines(splitReadableText([]byte(stripXMLTags(text))), maxDocumentPreviewLines)
		}
	}
	return []string{}
}

func nonEmptySlice(value string) []string {
	value = normalizeWhitespace(value)
	if value == "" {
		return []string{}
	}
	return []string{value}
}

func cleanZipRelPath(value string) string {
	return strings.TrimPrefix(path.Clean(strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")), "./")
}

func isEPUBImagePath(value string) bool {
	return imageMimeFromExt(path.Ext(value)) != ""
}

func imageMimeFromExt(ext string) string {
	switch normalizeAssetFileExt(ext) {
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	case "gif":
		return "image/gif"
	case "svg":
		return "image/svg+xml"
	default:
		return ""
	}
}

func extractDOCXPreviewLines(source string) ([]string, error) {
	text, err := readZipEntry(source, "word/document.xml", 512*1024)
	if err != nil {
		return nil, err
	}
	return normalizePreviewLines(extractXMLTexts(text), maxDocumentPreviewLines+1), nil
}

func extractPPTXPreviewLines(source string) ([]string, error) {
	archive, err := zip.OpenReader(source)
	if err != nil {
		return nil, err
	}
	defer archive.Close()
	files := []*zip.File{}
	for _, file := range archive.File {
		name := strings.ToLower(file.Name)
		if strings.HasPrefix(name, "ppt/slides/slide") && strings.HasSuffix(name, ".xml") {
			files = append(files, file)
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	for _, file := range files {
		text, err := readZipText(file, 512*1024)
		if err != nil {
			return nil, err
		}
		lines := normalizePreviewLines(extractXMLTexts(text), maxDocumentPreviewLines+1)
		if len(lines) > 0 {
			return lines, nil
		}
	}
	return []string{}, nil
}

func extractXLSXPreviewTable(source string) ([][]string, error) {
	archive, err := zip.OpenReader(source)
	if err != nil {
		return nil, err
	}
	defer archive.Close()
	sharedStrings := []string{}
	if text, err := readZipEntryFromOpenArchive(&archive.Reader, "xl/sharedStrings.xml", 2*1024*1024); err == nil {
		sharedStrings = extractXMLTexts(text)
	}
	sheetName := firstExistingZipEntry(&archive.Reader, []string{"xl/worksheets/sheet1.xml"})
	if sheetName == "" {
		for _, file := range archive.File {
			if strings.HasPrefix(strings.ToLower(file.Name), "xl/worksheets/") && strings.HasSuffix(strings.ToLower(file.Name), ".xml") {
				sheetName = file.Name
				break
			}
		}
	}
	if sheetName == "" {
		return [][]string{}, nil
	}
	text, err := readZipEntryFromOpenArchive(&archive.Reader, sheetName, 2*1024*1024)
	if err != nil {
		return nil, err
	}
	return parseXLSXSheetPreview(text, sharedStrings), nil
}

func parseXLSXSheetPreview(sheetXML string, sharedStrings []string) [][]string {
	decoder := xml.NewDecoder(strings.NewReader(sheetXML))
	rows := [][]string{}
	var currentRow []string
	var inCell bool
	var cellType string
	var cellValue strings.Builder
	for {
		tok, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				currentRow = []string{}
			case "c":
				inCell = true
				cellType = ""
				cellValue.Reset()
				for _, attr := range t.Attr {
					if attr.Name.Local == "t" {
						cellType = attr.Value
					}
				}
			}
		case xml.CharData:
			if inCell {
				cellValue.Write([]byte(t))
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "c":
				value := strings.TrimSpace(cellValue.String())
				if cellType == "s" {
					if idx, err := strconv.Atoi(value); err == nil && idx >= 0 && idx < len(sharedStrings) {
						value = sharedStrings[idx]
					}
				}
				currentRow = append(currentRow, value)
				inCell = false
			case "row":
				if len(currentRow) > 0 {
					rows = append(rows, normalizeTableRow(currentRow))
				}
				if len(rows) >= maxDocumentPreviewLines {
					return rows
				}
			}
		}
	}
	return rows
}

func readFilePrefix(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, limit))
}

func readZipEntry(source string, entryName string, limit int64) (string, error) {
	archive, err := zip.OpenReader(source)
	if err != nil {
		return "", err
	}
	defer archive.Close()
	return readZipEntryFromOpenArchive(&archive.Reader, entryName, limit)
}

func readZipEntryFromOpenArchive(archive *zip.Reader, entryName string, limit int64) (string, error) {
	for _, file := range archive.File {
		if file.Name == entryName {
			return readZipText(file, limit)
		}
	}
	return "", fmt.Errorf("压缩文档缺少 %s", entryName)
}

func readZipText(file *zip.File, limit int64) (string, error) {
	r, err := file.Open()
	if err != nil {
		return "", err
	}
	defer r.Close()
	data, err := io.ReadAll(io.LimitReader(r, limit))
	if err != nil {
		return "", err
	}
	return string(bytes.ToValidUTF8(data, []byte(" "))), nil
}

func firstExistingZipEntry(archive *zip.Reader, names []string) string {
	for _, name := range names {
		for _, file := range archive.File {
			if file.Name == name {
				return name
			}
		}
	}
	return ""
}

func extractXMLTexts(raw string) []string {
	decoder := xml.NewDecoder(strings.NewReader(raw))
	texts := []string{}
	for {
		tok, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		if data, ok := tok.(xml.CharData); ok {
			text := normalizeWhitespace(string(data))
			if text != "" {
				texts = append(texts, text)
			}
		}
	}
	return compactPreviewTexts(texts)
}

func firstXMLTextByLocalName(raw string, localName string) string {
	decoder := xml.NewDecoder(strings.NewReader(raw))
	inTarget := false
	for {
		tok, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			inTarget = t.Name.Local == localName
		case xml.CharData:
			if inTarget {
				return normalizeWhitespace(string(t))
			}
		case xml.EndElement:
			if t.Name.Local == localName {
				inTarget = false
			}
		}
	}
	return ""
}

func splitReadableText(data []byte) []string {
	text := string(bytes.ToValidUTF8(data, []byte(" ")))
	text = stripXMLTags(text)
	parts := strings.FieldsFunc(text, func(r rune) bool { return r == '\n' || r == '\r' })
	return compactPreviewTexts(parts)
}

func stripXMLTags(value string) string {
	re := regexp.MustCompile(`<[^>]+>`)
	return html.UnescapeString(re.ReplaceAllString(value, " "))
}

func extractPDFLiteralText(raw string) string {
	re := regexp.MustCompile(`\((?:\\.|[^\\()])*\)`)
	matches := re.FindAllString(raw, 300)
	parts := []string{}
	for _, match := range matches {
		text := strings.TrimSuffix(strings.TrimPrefix(match, "("), ")")
		text = strings.ReplaceAll(text, `\\`, `\`)
		text = strings.ReplaceAll(text, `\(`, `(`)
		text = strings.ReplaceAll(text, `\)`, `)`)
		text = normalizeWhitespace(text)
		if looksReadableText(text) {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n")
}

func normalizePreviewLines(lines []string, maxLines int) []string {
	compact := compactPreviewTexts(lines)
	return compact[:minInt(len(compact), maxLines)]
}

func compactPreviewTexts(values []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		text := normalizeWhitespace(value)
		if text == "" || seen[text] || !looksReadableText(text) {
			continue
		}
		seen[text] = true
		out = append(out, text)
	}
	return out
}

func normalizeTableRow(values []string) []string {
	out := []string{}
	for _, value := range values {
		out = append(out, normalizeWhitespace(value))
		if len(out) >= maxDocumentPreviewCells {
			break
		}
	}
	return out
}

func normalizeWhitespace(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func looksReadableText(value string) bool {
	if strings.TrimSpace(value) == "" || !utf8.ValidString(value) {
		return false
	}
	readable := 0
	total := 0
	for _, r := range value {
		total++
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsPunct(r) || unicode.IsSpace(r) || unicode.IsSymbol(r) || unicode.Is(unicode.Han, r) {
			readable++
		}
	}
	return total > 0 && float64(readable)/float64(total) >= 0.72
}

func tailLines(lines []string) []string {
	if len(lines) <= 1 {
		return []string{}
	}
	return lines[1:]
}

func usefulDocumentBodyLines(lines []string, title string) []string {
	if len(lines) == 0 {
		return []string{}
	}
	out := []string{}
	normalizedTitle := normalizeWhitespace(title)
	for _, line := range lines {
		text := normalizeWhitespace(line)
		if text == "" || strings.EqualFold(text, normalizedTitle) || isLikelyDocxStyleNoise(text) {
			continue
		}
		out = append(out, text)
	}
	return normalizePreviewLines(out, maxDocumentPreviewLines)
}

func isLikelyDocxStyleNoise(value string) bool {
	text := normalizeWhitespace(value)
	if text == "" {
		return true
	}
	if len([]rune(text)) <= 1 && !unicode.IsNumber([]rune(text)[0]) {
		return true
	}
	return false
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

func escapeXML(value string) string {
	return html.EscapeString(value)
}

func ellipsisRunes(value string, maxRunes int) string {
	runes := []rune(strings.TrimSpace(value))
	if maxRunes <= 0 || len(runes) <= maxRunes {
		return string(runes)
	}
	if maxRunes <= 1 {
		return "…"
	}
	return string(runes[:maxRunes-1]) + "…"
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
