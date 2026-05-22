package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const documentPageRenderTimeout = 90 * time.Second

func isDocumentPageRenderExt(ext string) bool {
	switch normalizeAssetFileExt(ext) {
	case "pdf":
		return true
	default:
		return false
	}
}

func generateDocumentPageThumbnailFile(source string, output string, spec thumbnailCacheSpec) error {
	switch normalizeAssetFileExt(spec.Ext) {
	case "pdf":
		return renderPDFPageThumbnail(source, output, spec)
	default:
		return fmt.Errorf(".%s 文档未注册真实页面渲染器", normalizeAssetFileExt(spec.Ext))
	}
}

func renderPDFPageThumbnail(source string, output string, spec thumbnailCacheSpec) error {
	rendered, cleanup, err := renderPDFFirstPageJPEG(source, output+".pdf-page")
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		return err
	}
	return generateImageThumbnailFile(rendered, output, spec.Width, spec.Height)
}

func renderPDFFirstPageJPEG(source string, outputPrefix string) (string, func(), error) {
	cleanPrefix := strings.TrimSuffix(outputPrefix, filepath.Ext(outputPrefix))
	if cleanPrefix == "" {
		return "", nil, errors.New("PDF 页面渲染输出路径为空")
	}
	output := cleanPrefix + ".jpg"
	cleanup := func() { _ = os.Remove(output) }
	_ = os.Remove(output)
	err := runThumbnailCommand(thumbnailCommand{
		Binary: resolvePDFPageRendererBinary(),
		Args: []string{
			"-q",
			"-f", "1",
			"-l", "1",
			"-singlefile",
			"-jpeg",
			"-jpegopt", "quality=90",
			"-r", "144",
			source,
			cleanPrefix,
		},
		DependencyLabel: "PDF 真实页面渲染依赖 pdftoppm ",
		FailureLabel:    "PDF 第一页渲染失败",
		Timeout:         documentPageRenderTimeout,
	})
	if err != nil {
		cleanup()
		return "", nil, err
	}
	if !exists(output) {
		return "", nil, errors.New("PDF 第一页渲染失败：渲染器没有生成图片")
	}
	return output, cleanup, nil
}

func resolvePDFPageRendererBinary() string {
	if configured := strings.TrimSpace(os.Getenv("FW_HYPERCORTEX_PDFTOPPM")); configured != "" {
		return configured
	}
	return "pdftoppm"
}
