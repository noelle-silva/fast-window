package main

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

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
