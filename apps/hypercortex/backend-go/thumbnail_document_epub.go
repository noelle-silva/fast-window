package main

import (
	"archive/zip"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"path"
	"strings"
)

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
