package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	maxWebIconHTMLBytes     = 1024 * 1024
	maxWebIconManifestBytes = 512 * 1024
	maxInlineSVGIconBytes   = 160 * 1024
	maxWebIconCandidates    = 24
	maxWebIconFetchRefs     = 48
	webIconRequestTimeout   = 12 * time.Second
	webIconUserAgent        = "FastWindowFolders/1.0 WebIconDiscovery"
)

type webIconDiscoveryPayload struct {
	URL string `json:"url"`
}

type webIconDiscoveryResult struct {
	URL        string             `json:"url"`
	Candidates []webIconCandidate `json:"candidates"`
	Warnings   []string           `json:"warnings,omitempty"`
}

type webIconCandidate struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Source    string `json:"source"`
	URL       string `json:"url"`
	MediaType string `json:"mediaType"`
	Sizes     string `json:"sizes,omitempty"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	DataURL   string `json:"dataUrl"`
}

type webIconRef struct {
	URL       string
	Label     string
	Source    string
	MediaType string
	Sizes     string
	Priority  int
	Order     int
}

type htmlTag struct {
	Name  string
	Attrs map[string]string
}

func discoverWebIcons(rawURL string) (webIconDiscoveryResult, error) {
	target, err := normalizeCollectionTarget(collectionTarget{Kind: "url", URL: rawURL})
	if err != nil {
		return webIconDiscoveryResult{}, err
	}
	client := webIconHTTPClient()
	htmlPayload, pageURL, err := fetchWebResource(client, target.URL, maxWebIconHTMLBytes, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.6")
	if err != nil {
		return webIconDiscoveryResult{}, fmt.Errorf("fetch web page failed: %w", err)
	}

	refs, warnings := discoverWebIconRefs(client, pageURL, string(htmlPayload))
	refs = append(refs, conventionalWebIconRefs(pageURL, len(refs))...)
	refs = normalizeWebIconRefs(refs)
	candidates, fetchWarnings := fetchWebIconCandidates(client, refs)
	warnings = append(warnings, fetchWarnings...)
	if len(candidates) == 0 {
		if len(warnings) > 0 {
			return webIconDiscoveryResult{}, fmt.Errorf("no usable web icons found: %s", strings.Join(limitStrings(warnings, 4), "; "))
		}
		return webIconDiscoveryResult{}, errors.New("no usable web icons found")
	}
	return webIconDiscoveryResult{URL: pageURL.String(), Candidates: candidates, Warnings: limitStrings(warnings, 8)}, nil
}

func webIconHTTPClient() *http.Client {
	return &http.Client{
		Timeout: webIconRequestTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if req.URL == nil || (req.URL.Scheme != "http" && req.URL.Scheme != "https") {
				return errors.New("redirect target must be http or https")
			}
			return nil
		},
	}
}

func fetchWebResource(client *http.Client, rawURL string, maxBytes int64, accept string) ([]byte, *url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed == nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, nil, errors.New("valid http or https url is required")
	}
	req, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", webIconUserAgent)
	req.Header.Set("Accept", accept)
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, fmt.Errorf("unexpected HTTP status %d", resp.StatusCode)
	}
	if resp.ContentLength > maxBytes {
		return nil, nil, fmt.Errorf("response is too large: max %d bytes", maxBytes)
	}
	payload, err := readLimited(resp.Body, maxBytes)
	if err != nil {
		return nil, nil, err
	}
	return payload, resp.Request.URL, nil
}

func readLimited(reader io.Reader, maxBytes int64) ([]byte, error) {
	payload, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > maxBytes {
		return nil, fmt.Errorf("response is too large: max %d bytes", maxBytes)
	}
	return payload, nil
}

func discoverWebIconRefs(client *http.Client, pageURL *url.URL, html string) ([]webIconRef, []string) {
	refs := []webIconRef{}
	warnings := []string{}
	baseURL := *pageURL
	baseSeen := false
	order := 0
	tags := scanHTMLTags(html)
	for _, tag := range tags {
		switch tag.Name {
		case "base":
			if baseSeen {
				continue
			}
			if href := strings.TrimSpace(tag.Attrs["href"]); href != "" {
				if resolved, ok := resolveWebIconURL(&baseURL, href); ok && !strings.HasPrefix(resolved, "data:") {
					if nextBase, err := url.Parse(resolved); err == nil && nextBase != nil {
						baseURL = *nextBase
						baseSeen = true
					}
				}
			}
		case "link":
			linkRefs, manifestURL := webIconRefsFromLinkTag(&baseURL, tag, order)
			refs = append(refs, linkRefs...)
			order += len(linkRefs)
			if manifestURL != "" {
				manifestRefs, manifestWarnings := discoverWebManifestIconRefs(client, manifestURL, order)
				refs = append(refs, manifestRefs...)
				warnings = append(warnings, manifestWarnings...)
				order += len(manifestRefs)
			}
		case "meta":
			metaRefs := webIconRefsFromMetaTag(&baseURL, tag, order)
			refs = append(refs, metaRefs...)
			order += len(metaRefs)
		case "img", "source":
			imageRefs := webIconRefsFromImageTag(&baseURL, tag, order)
			refs = append(refs, imageRefs...)
			order += len(imageRefs)
		}
	}
	inlineSVGRefs := webIconRefsFromInlineSVG(html, order)
	refs = append(refs, inlineSVGRefs...)
	order += len(inlineSVGRefs)
	refs = append(refs, commonLogoPathRefs(pageURL, order)...)
	return refs, warnings
}

func webIconRefsFromLinkTag(baseURL *url.URL, tag htmlTag, order int) ([]webIconRef, string) {
	rel := strings.ToLower(strings.TrimSpace(tag.Attrs["rel"]))
	href := strings.TrimSpace(tag.Attrs["href"])
	if rel == "" || href == "" {
		return nil, ""
	}
	resolved, ok := resolveWebIconURL(baseURL, href)
	if !ok {
		return nil, ""
	}
	tokens := relTokens(rel)
	if hasRelToken(tokens, "manifest") {
		return nil, resolved
	}
	label, source, priority, isIcon := classifyLinkIconRel(tokens)
	if !isIcon {
		return nil, ""
	}
	return []webIconRef{{URL: resolved, Label: label, Source: source, MediaType: strings.TrimSpace(tag.Attrs["type"]), Sizes: strings.TrimSpace(tag.Attrs["sizes"]), Priority: priority, Order: order}}, ""
}

func webIconRefsFromMetaTag(baseURL *url.URL, tag htmlTag, order int) []webIconRef {
	name := strings.ToLower(strings.TrimSpace(firstNonEmpty(tag.Attrs["name"], tag.Attrs["property"])))
	content := strings.TrimSpace(tag.Attrs["content"])
	if name == "" || content == "" {
		return nil
	}
	resolved, ok := resolveWebIconURL(baseURL, content)
	if !ok {
		return nil
	}
	if strings.HasPrefix(name, "msapplication-") && (strings.Contains(name, "image") || strings.Contains(name, "logo") || strings.Contains(name, "tileimage")) {
		return []webIconRef{{URL: resolved, Label: "Windows 磁贴图标", Source: "meta", Priority: 42, Order: order}}
	}
	switch name {
	case "avatar", "author:image", "profile:image", "profile:avatar", "twitter:creator:image", "twitter:site:image":
		return []webIconRef{{URL: resolved, Label: "作者头像", Source: "avatar", Priority: 13, Order: order}}
	default:
		return nil
	}
}

func webIconRefsFromImageTag(baseURL *url.URL, tag htmlTag, order int) []webIconRef {
	semantic := htmlTagSemanticText(tag)
	label := ""
	source := ""
	priority := 0
	if hasLogoSemantic(semantic) {
		label = "网站 Logo"
		source = "brand-logo"
		priority = 12
	} else if hasAvatarSemantic(semantic) {
		label = "作者头像"
		source = "avatar"
		priority = 13
	} else {
		return nil
	}
	imageURL := imageURLFromTag(tag)
	if imageURL == "" {
		return nil
	}
	resolved, ok := resolveWebIconURL(baseURL, imageURL)
	if !ok {
		return nil
	}
	return []webIconRef{{URL: resolved, Label: label, Source: source, MediaType: strings.TrimSpace(tag.Attrs["type"]), Sizes: imageTagSizes(tag), Priority: priority, Order: order}}
}

func imageTagSizes(tag htmlTag) string {
	if sizes := strings.TrimSpace(tag.Attrs["sizes"]); sizes != "" {
		return sizes
	}
	width := strings.TrimSpace(tag.Attrs["width"])
	height := strings.TrimSpace(tag.Attrs["height"])
	if width == "" || height == "" {
		return ""
	}
	return width + "x" + height
}

func webIconRefsFromInlineSVG(html string, order int) []webIconRef {
	refs := []webIconRef{}
	searchFrom := 0
	for searchFrom < len(html) {
		startOffset := strings.Index(strings.ToLower(html[searchFrom:]), "<svg")
		if startOffset < 0 {
			break
		}
		start := searchFrom + startOffset
		startEnd := htmlTagEnd(html, start+1)
		if startEnd < 0 {
			break
		}
		name, attrs := parseHTMLTagContent(html[start+1 : startEnd])
		if name != "svg" {
			searchFrom = startEnd + 1
			continue
		}
		closeOffset := strings.Index(strings.ToLower(html[startEnd+1:]), "</svg>")
		if closeOffset < 0 {
			searchFrom = startEnd + 1
			continue
		}
		end := startEnd + 1 + closeOffset + len("</svg>")
		markup := html[start:end]
		searchFrom = end
		if len(markup) > maxInlineSVGIconBytes || !hasLogoSemantic(htmlTagSemanticText(htmlTag{Name: "svg", Attrs: attrs})) {
			continue
		}
		dataURL := "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(markup))
		refs = append(refs, webIconRef{URL: dataURL, Label: "内联 SVG Logo", Source: "inline-svg", MediaType: "image/svg+xml", Priority: 11, Order: order + len(refs)})
	}
	return refs
}

func commonLogoPathRefs(pageURL *url.URL, order int) []webIconRef {
	paths := []string{
		"/logo.svg",
		"/logo.png",
		"/brand.svg",
		"/brand.png",
		"/assets/logo.svg",
		"/assets/logo.png",
		"/static/logo.svg",
		"/static/logo.png",
	}
	refs := make([]webIconRef, 0, len(paths))
	for index, path := range paths {
		base := *pageURL
		base.Path = path
		base.RawQuery = ""
		base.Fragment = ""
		refs = append(refs, webIconRef{URL: base.String(), Label: "站点 Logo", Source: "site-logo", Priority: 64 + index, Order: order + index})
	}
	return refs
}

func classifyLinkIconRel(tokens map[string]bool) (label string, source string, priority int, ok bool) {
	switch {
	case hasRelToken(tokens, "apple-touch-icon") || hasRelToken(tokens, "apple-touch-icon-precomposed"):
		return "Apple Touch 图标", "html", 14, true
	case hasRelToken(tokens, "mask-icon"):
		return "Mask SVG 图标", "html", 24, true
	case hasRelToken(tokens, "fluid-icon"):
		return "Fluid 图标", "html", 34, true
	case hasRelToken(tokens, "icon"):
		return "Favicon", "html", 30, true
	default:
		return "", "", 0, false
	}
}

func htmlTagSemanticText(tag htmlTag) string {
	keys := []string{"id", "class", "alt", "title", "aria-label", "itemprop", "property", "name", "role", "src", "srcset", "href", "data-src", "data-lazy-src", "data-original"}
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		if value := strings.TrimSpace(tag.Attrs[key]); value != "" {
			parts = append(parts, value)
		}
	}
	return strings.ToLower(strings.Join(parts, " "))
}

func hasLogoSemantic(text string) bool {
	if text == "" {
		return false
	}
	if containsAny(text, []string{"logo", "brand", "site-logo", "site_logo", "navbar-brand", "header-logo", "masthead", "wordmark"}) {
		return true
	}
	return false
}

func hasAvatarSemantic(text string) bool {
	if text == "" {
		return false
	}
	if containsAny(text, []string{"avatar", "author", "creator", "channel", "profile", "userpic", "user-pic", "headshot", "face"}) {
		return true
	}
	return false
}

func containsAny(text string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(text, needle) {
			return true
		}
	}
	return false
}

func imageURLFromTag(tag htmlTag) string {
	for _, key := range []string{"src", "data-src", "data-lazy-src", "data-original", "data-url"} {
		if value := strings.TrimSpace(tag.Attrs[key]); value != "" {
			return value
		}
	}
	return bestSrcSetURL(firstNonEmpty(tag.Attrs["srcset"], tag.Attrs["data-srcset"]))
}

func bestSrcSetURL(srcset string) string {
	type srcsetCandidate struct {
		url   string
		score float64
	}
	best := srcsetCandidate{}
	for _, rawPart := range strings.Split(srcset, ",") {
		part := strings.TrimSpace(rawPart)
		if part == "" {
			continue
		}
		fields := strings.Fields(part)
		if len(fields) == 0 {
			continue
		}
		score := 1.0
		if len(fields) > 1 {
			descriptor := strings.TrimSpace(fields[1])
			if strings.HasSuffix(descriptor, "w") {
				if width, err := strconv.ParseFloat(strings.TrimSuffix(descriptor, "w"), 64); err == nil {
					score = width
				}
			} else if strings.HasSuffix(descriptor, "x") {
				if density, err := strconv.ParseFloat(strings.TrimSuffix(descriptor, "x"), 64); err == nil {
					score = density * 1000
				}
			}
		}
		if fields[0] != "" && score >= best.score {
			best = srcsetCandidate{url: fields[0], score: score}
		}
	}
	return best.url
}

func discoverWebManifestIconRefs(client *http.Client, manifestURL string, order int) ([]webIconRef, []string) {
	payload, finalURL, err := fetchWebResource(client, manifestURL, maxWebIconManifestBytes, "application/manifest+json,application/json,*/*;q=0.6")
	if err != nil {
		return nil, []string{fmt.Sprintf("manifest %s: %v", manifestURL, err)}
	}
	var manifest struct {
		Icons []struct {
			Src     string `json:"src"`
			Sizes   string `json:"sizes"`
			Type    string `json:"type"`
			Purpose string `json:"purpose"`
		} `json:"icons"`
	}
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return nil, []string{fmt.Sprintf("manifest %s: parse failed: %v", manifestURL, err)}
	}
	refs := make([]webIconRef, 0, len(manifest.Icons))
	for index, icon := range manifest.Icons {
		resolved, ok := resolveWebIconURL(finalURL, icon.Src)
		if !ok {
			continue
		}
		refs = append(refs, webIconRef{URL: resolved, Label: "Manifest 图标", Source: "manifest", MediaType: strings.TrimSpace(icon.Type), Sizes: strings.TrimSpace(icon.Sizes), Priority: manifestIconPriority(icon.Sizes), Order: order + index})
	}
	return refs, nil
}

func manifestIconPriority(sizes string) int {
	maxSize := maxDeclaredIconSize(sizes)
	switch {
	case maxSize >= 512:
		return 8
	case maxSize >= 192:
		return 10
	case maxSize >= 128:
		return 18
	case maxSize >= 64:
		return 26
	default:
		return 36
	}
}

func conventionalWebIconRefs(pageURL *url.URL, order int) []webIconRef {
	paths := []struct {
		path     string
		label    string
		priority int
	}{
		{path: "/favicon.ico", label: "约定 Favicon", priority: 70},
		{path: "/favicon.png", label: "约定 PNG 图标", priority: 72},
		{path: "/apple-touch-icon.png", label: "约定 Apple 图标", priority: 74},
		{path: "/apple-touch-icon-precomposed.png", label: "约定 Apple 图标", priority: 76},
	}
	refs := make([]webIconRef, 0, len(paths))
	for index, item := range paths {
		base := *pageURL
		base.Path = item.path
		base.RawQuery = ""
		base.Fragment = ""
		refs = append(refs, webIconRef{URL: base.String(), Label: item.label, Source: "conventional", Priority: item.priority, Order: order + index})
	}
	return refs
}

func normalizeWebIconRefs(refs []webIconRef) []webIconRef {
	byURL := map[string]webIconRef{}
	for _, ref := range refs {
		ref.URL = strings.TrimSpace(ref.URL)
		if ref.URL == "" {
			continue
		}
		key := normalizedWebIconRefKey(ref.URL)
		if key == "" {
			continue
		}
		if current, exists := byURL[key]; !exists || ref.Priority < current.Priority {
			byURL[key] = ref
		}
	}
	next := make([]webIconRef, 0, len(byURL))
	for _, ref := range byURL {
		next = append(next, ref)
	}
	sort.SliceStable(next, func(i, j int) bool {
		if next[i].Priority != next[j].Priority {
			return next[i].Priority < next[j].Priority
		}
		return next[i].Order < next[j].Order
	})
	if len(next) > maxWebIconFetchRefs {
		next = next[:maxWebIconFetchRefs]
	}
	return next
}

func normalizedWebIconRefKey(rawURL string) string {
	if strings.HasPrefix(strings.ToLower(rawURL), "data:image/") {
		return rawURL
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed == nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	parsed.Fragment = ""
	return parsed.String()
}

func fetchWebIconCandidates(client *http.Client, refs []webIconRef) ([]webIconCandidate, []string) {
	candidates := []webIconCandidate{}
	warnings := []string{}
	seenPayloads := map[string]bool{}
	for _, ref := range refs {
		if len(candidates) >= maxWebIconCandidates {
			break
		}
		candidate, payloadHash, err := fetchWebIconCandidate(client, ref)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", ref.URL, err))
			continue
		}
		if seenPayloads[payloadHash] {
			continue
		}
		seenPayloads[payloadHash] = true
		candidates = append(candidates, candidate)
	}
	return candidates, warnings
}

func fetchWebIconCandidate(client *http.Client, ref webIconRef) (webIconCandidate, string, error) {
	payload, contentType, finalURL, err := fetchWebIconPayload(client, ref.URL)
	if err != nil {
		return webIconCandidate{}, "", err
	}
	ext, mediaType, err := resolveWebIconImageType(ref, contentType, finalURL, payload)
	if err != nil {
		return webIconCandidate{}, "", err
	}
	if int64(len(payload)) > maxIconAssetBytes {
		return webIconCandidate{}, "", fmt.Errorf("web icon is too large: max %d bytes", maxIconAssetBytes)
	}
	if err := validateAssetImageContent(payload, ext); err != nil {
		return webIconCandidate{}, "", err
	}
	width, height := webIconDimensions(payload, ext)
	payloadHash := sha1.Sum(payload)
	idHash := sha1.Sum([]byte(finalURL + ":" + hex.EncodeToString(payloadHash[:])))
	dataURL := "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(payload)
	return webIconCandidate{
		ID:        "web-icon:" + hex.EncodeToString(idHash[:])[:16],
		Label:     webIconCandidateLabel(ref, width, height),
		Source:    ref.Source,
		URL:       publicWebIconURL(finalURL),
		MediaType: mediaType,
		Sizes:     strings.TrimSpace(ref.Sizes),
		Width:     width,
		Height:    height,
		DataURL:   dataURL,
	}, hex.EncodeToString(payloadHash[:]), nil
}

func fetchWebIconPayload(client *http.Client, rawURL string) ([]byte, string, string, error) {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(rawURL)), "data:image/") {
		source, err := dataURLAssetImportSource(rawURL)
		if err != nil {
			return nil, "", "inline:data-url", err
		}
		return source.Bytes, webIconMediaTypeFromExt(source.Ext), "inline:data-url", nil
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", "", err
	}
	req.Header.Set("User-Agent", webIconUserAgent)
	req.Header.Set("Accept", "image/avif,image/webp,image/svg+xml,image/png,image/jpeg,image/gif,image/x-icon,*/*;q=0.6")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", "", fmt.Errorf("unexpected HTTP status %d", resp.StatusCode)
	}
	if resp.ContentLength > maxIconAssetBytes {
		return nil, "", "", fmt.Errorf("web icon is too large: max %d bytes", maxIconAssetBytes)
	}
	payload, err := readLimited(resp.Body, maxIconAssetBytes)
	if err != nil {
		return nil, "", "", err
	}
	return payload, resp.Header.Get("Content-Type"), resp.Request.URL.String(), nil
}

func resolveWebIconImageType(ref webIconRef, contentType string, finalURL string, payload []byte) (string, string, error) {
	if ext, mediaType := webIconMediaTypeExt(ref.MediaType); ext != "" {
		return ext, mediaType, nil
	}
	if ext, mediaType := webIconMediaTypeExt(contentType); ext != "" {
		return ext, mediaType, nil
	}
	if ext := strings.ToLower(filepath.Ext(pathFromURL(finalURL))); isSupportedImageExt(ext) {
		return normalizeImageExt(ext), webIconMediaTypeFromExt(ext), nil
	}
	if ext, mediaType := sniffWebIconImageType(payload); ext != "" {
		return ext, mediaType, nil
	}
	return "", "", errors.New("web icon content type is not supported")
}

func webIconMediaTypeExt(value string) (string, string) {
	mediaType := strings.ToLower(strings.TrimSpace(value))
	if mediaType == "" {
		return "", ""
	}
	if parsed, _, err := mime.ParseMediaType(mediaType); err == nil {
		mediaType = parsed
	}
	switch mediaType {
	case "image/png":
		return ".png", "image/png"
	case "image/jpeg", "image/jpg":
		return ".jpg", "image/jpeg"
	case "image/webp":
		return ".webp", "image/webp"
	case "image/gif":
		return ".gif", "image/gif"
	case "image/x-icon", "image/vnd.microsoft.icon", "image/ico":
		return ".ico", "image/x-icon"
	case "image/svg+xml":
		return ".svg", "image/svg+xml"
	default:
		return "", ""
	}
}

func webIconMediaTypeFromExt(ext string) string {
	switch normalizeImageExt(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".ico":
		return "image/x-icon"
	case ".svg":
		return "image/svg+xml"
	default:
		return "application/octet-stream"
	}
}

func normalizeImageExt(ext string) string {
	ext = strings.ToLower(strings.TrimSpace(ext))
	if ext == ".jpeg" {
		return ".jpg"
	}
	return ext
}

func sniffWebIconImageType(payload []byte) (string, string) {
	trimmed := bytes.TrimSpace(payload)
	lowerTrimmed := bytes.ToLower(trimmed)
	switch {
	case bytes.HasPrefix(payload, []byte("\x89PNG\r\n\x1a\n")):
		return ".png", "image/png"
	case bytes.HasPrefix(payload, []byte("\xff\xd8\xff")):
		return ".jpg", "image/jpeg"
	case bytes.HasPrefix(payload, []byte("GIF87a")) || bytes.HasPrefix(payload, []byte("GIF89a")):
		return ".gif", "image/gif"
	case len(payload) >= 12 && string(payload[:4]) == "RIFF" && string(payload[8:12]) == "WEBP":
		return ".webp", "image/webp"
	case len(payload) >= 4 && payload[0] == 0 && payload[1] == 0 && payload[2] == 1 && payload[3] == 0:
		return ".ico", "image/x-icon"
	case bytes.HasPrefix(lowerTrimmed, []byte("<svg")) || bytes.Contains(lowerTrimmed[:minInt(len(lowerTrimmed), 256)], []byte("<svg")):
		return ".svg", "image/svg+xml"
	default:
		return "", ""
	}
}

func webIconDimensions(payload []byte, ext string) (int, int) {
	switch normalizeImageExt(ext) {
	case ".png", ".jpg", ".gif":
		config, _, err := image.DecodeConfig(bytes.NewReader(payload))
		if err == nil {
			return config.Width, config.Height
		}
	case ".ico":
		return icoLargestDimensions(payload)
	case ".svg":
		return svgDimensions(payload)
	case ".webp":
		return webpDimensions(payload)
	}
	return 0, 0
}

func icoLargestDimensions(payload []byte) (int, int) {
	if len(payload) < 22 {
		return 0, 0
	}
	count := int(payload[4]) | int(payload[5])<<8
	if count <= 0 || len(payload) < 6+count*16 {
		return 0, 0
	}
	bestWidth, bestHeight := 0, 0
	for index := 0; index < count; index++ {
		entry := 6 + index*16
		width := int(payload[entry])
		height := int(payload[entry+1])
		if width == 0 {
			width = 256
		}
		if height == 0 {
			height = 256
		}
		if width*height > bestWidth*bestHeight {
			bestWidth, bestHeight = width, height
		}
	}
	return bestWidth, bestHeight
}

func svgDimensions(payload []byte) (int, int) {
	decoder := xml.NewDecoder(bytes.NewReader(payload))
	for {
		token, err := decoder.Token()
		if err != nil {
			return 0, 0
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		if strings.ToLower(start.Name.Local) != "svg" {
			return 0, 0
		}
		attrs := map[string]string{}
		for _, attr := range start.Attr {
			attrs[strings.ToLower(attr.Name.Local)] = attr.Value
		}
		width := parseSVGLength(attrs["width"])
		height := parseSVGLength(attrs["height"])
		if width > 0 && height > 0 {
			return width, height
		}
		return parseSVGViewBox(attrs["viewbox"])
	}
}

func parseSVGLength(value string) int {
	value = strings.TrimSpace(value)
	value = strings.TrimSuffix(value, "px")
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed <= 0 {
		return 0
	}
	return int(parsed + 0.5)
}

func parseSVGViewBox(value string) (int, int) {
	parts := strings.Fields(strings.ReplaceAll(strings.TrimSpace(value), ",", " "))
	if len(parts) != 4 {
		return 0, 0
	}
	width, widthErr := strconv.ParseFloat(parts[2], 64)
	height, heightErr := strconv.ParseFloat(parts[3], 64)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return 0, 0
	}
	return int(width + 0.5), int(height + 0.5)
}

func webpDimensions(payload []byte) (int, int) {
	if len(payload) >= 30 && string(payload[:4]) == "RIFF" && string(payload[8:12]) == "WEBP" && string(payload[12:16]) == "VP8X" {
		width := 1 + int(payload[24]) + int(payload[25])<<8 + int(payload[26])<<16
		height := 1 + int(payload[27]) + int(payload[28])<<8 + int(payload[29])<<16
		return width, height
	}
	return 0, 0
}

func webIconCandidateLabel(ref webIconRef, width int, height int) string {
	sizeText := strings.TrimSpace(ref.Sizes)
	if sizeText == "" && width > 0 && height > 0 {
		sizeText = fmt.Sprintf("%dx%d", width, height)
	}
	if sizeText == "" {
		return ref.Label
	}
	return fmt.Sprintf("%s %s", ref.Label, sizeText)
}

func publicWebIconURL(rawURL string) string {
	if strings.HasPrefix(strings.ToLower(rawURL), "data:") {
		return "inline:data-url"
	}
	return rawURL
}

func pathFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed == nil {
		return rawURL
	}
	return parsed.Path
}

func resolveWebIconURL(baseURL *url.URL, value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	if strings.HasPrefix(strings.ToLower(value), "data:image/") {
		return value, true
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", false
	}
	resolved := baseURL.ResolveReference(parsed)
	if resolved == nil || (resolved.Scheme != "http" && resolved.Scheme != "https") || resolved.Host == "" {
		return "", false
	}
	return resolved.String(), true
}

func relTokens(rel string) map[string]bool {
	tokens := map[string]bool{}
	for _, token := range strings.Fields(strings.ToLower(rel)) {
		tokens[token] = true
	}
	return tokens
}

func hasRelToken(tokens map[string]bool, token string) bool {
	return tokens[strings.ToLower(token)]
}

func maxDeclaredIconSize(sizes string) int {
	maxSize := 0
	for _, field := range strings.Fields(strings.ToLower(sizes)) {
		left, right, ok := strings.Cut(field, "x")
		if !ok {
			continue
		}
		width, widthErr := strconv.Atoi(left)
		height, heightErr := strconv.Atoi(right)
		if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
			continue
		}
		if width > maxSize {
			maxSize = width
		}
		if height > maxSize {
			maxSize = height
		}
	}
	return maxSize
}

func scanHTMLTags(html string) []htmlTag {
	tags := []htmlTag{}
	for index := 0; index < len(html); index++ {
		if html[index] != '<' {
			continue
		}
		if strings.HasPrefix(html[index:], "<!--") {
			if end := strings.Index(html[index+4:], "-->"); end >= 0 {
				index += 4 + end + 2
			}
			continue
		}
		end := htmlTagEnd(html, index+1)
		if end < 0 {
			break
		}
		content := strings.TrimSpace(html[index+1 : end])
		index = end
		if content == "" || strings.HasPrefix(content, "/") || strings.HasPrefix(content, "!") || strings.HasPrefix(content, "?") {
			continue
		}
		name, attrs := parseHTMLTagContent(content)
		if name == "" {
			continue
		}
		tags = append(tags, htmlTag{Name: name, Attrs: attrs})
	}
	return tags
}

func htmlTagEnd(html string, start int) int {
	quote := byte(0)
	for index := start; index < len(html); index++ {
		ch := html[index]
		if quote != 0 {
			if ch == quote {
				quote = 0
			}
			continue
		}
		if ch == '\'' || ch == '"' {
			quote = ch
			continue
		}
		if ch == '>' {
			return index
		}
	}
	return -1
}

func parseHTMLTagContent(content string) (string, map[string]string) {
	content = strings.TrimSuffix(strings.TrimSpace(content), "/")
	nameEnd := 0
	for nameEnd < len(content) && !isHTMLSpace(content[nameEnd]) {
		nameEnd++
	}
	name := strings.ToLower(strings.TrimSpace(content[:nameEnd]))
	attrs := parseHTMLAttrs(content[nameEnd:])
	return name, attrs
}

func parseHTMLAttrs(input string) map[string]string {
	attrs := map[string]string{}
	index := 0
	for index < len(input) {
		for index < len(input) && isHTMLSpace(input[index]) {
			index++
		}
		if index >= len(input) {
			break
		}
		nameStart := index
		for index < len(input) && !isHTMLSpace(input[index]) && input[index] != '=' {
			index++
		}
		name := strings.ToLower(strings.TrimSpace(input[nameStart:index]))
		for index < len(input) && isHTMLSpace(input[index]) {
			index++
		}
		value := ""
		if index < len(input) && input[index] == '=' {
			index++
			for index < len(input) && isHTMLSpace(input[index]) {
				index++
			}
			if index < len(input) && (input[index] == '\'' || input[index] == '"') {
				quote := input[index]
				index++
				valueStart := index
				for index < len(input) && input[index] != quote {
					index++
				}
				value = input[valueStart:index]
				if index < len(input) {
					index++
				}
			} else {
				valueStart := index
				for index < len(input) && !isHTMLSpace(input[index]) {
					index++
				}
				value = input[valueStart:index]
			}
		}
		if name != "" {
			attrs[name] = htmlUnescape(strings.TrimSpace(value))
		}
	}
	return attrs
}

func isHTMLSpace(ch byte) bool {
	switch ch {
	case ' ', '\n', '\r', '\t', '\f':
		return true
	default:
		return false
	}
}

func htmlUnescape(value string) string {
	replacer := strings.NewReplacer("&amp;", "&", "&#38;", "&", "&quot;", "\"", "&#34;", "\"", "&#39;", "'", "&apos;", "'", "&lt;", "<", "&gt;", ">")
	return replacer.Replace(value)
}

func limitStrings(values []string, max int) []string {
	if len(values) <= max {
		return values
	}
	return values[:max]
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
