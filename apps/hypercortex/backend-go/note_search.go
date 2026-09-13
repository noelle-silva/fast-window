package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// 笔记内容搜索：搜索索引是与引用索引同级的派生数据。
// 两者统一在"笔记包变化（面内容/元数据）"的刷新点（refreshDerivedIndexesForNote）中更新。
// 查询按笔记聚合返回结果（Q1），面命中带摘要（Q3），面类型能力决定是否参与（Q4/Q5）。

const noteSearchIndexVersion = 1

type noteSearchFaceEntry struct {
	FaceID string `json:"faceId"`
	Kind   string `json:"kind"`
	Title  string `json:"title"`
	Text   string `json:"text"`
}

type noteSearchEntry struct {
	Title       string                `json:"title"`
	Description string                `json:"description"`
	Dir         string                `json:"dir"`
	Tags        []string              `json:"tags"`
	CreatedAtMs float64               `json:"createdAtMs"`
	UpdatedAtMs float64               `json:"updatedAtMs"`
	Faces       []noteSearchFaceEntry `json:"faces"`
}

type noteSearchIndex struct {
	Version int                        `json:"version"`
	Notes   map[string]noteSearchEntry `json:"notes"`
}

type noteSearchFaceKindInfo struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}

type noteSearchFaceHit struct {
	FaceID  string `json:"faceId"`
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
}

type noteSearchHit struct {
	NoteID      string              `json:"noteId"`
	Title       string              `json:"title"`
	Description string              `json:"description"`
	Dir         string              `json:"dir"`
	CreatedAtMs float64             `json:"createdAtMs"`
	UpdatedAtMs float64             `json:"updatedAtMs"`
	NoteFields  []string            `json:"noteFields"`
	FaceHits    []noteSearchFaceHit `json:"faceHits"`
	score       float64
}

type noteSearchResult struct {
	Kinds []noteSearchFaceKindInfo `json:"kinds"`
	Items []noteSearchHit          `json:"items"`
}

const noteSearchMaxItems = 48

func (svc *service) loadNoteSearchIndex(scope string) (noteSearchIndex, error) {
	path, err := svc.resolvePath(scope, searchIndexFile)
	if err != nil {
		return noteSearchIndex{}, err
	}
	idx := noteSearchIndex{Version: noteSearchIndexVersion, Notes: map[string]noteSearchEntry{}}
	if err := readJSONFile(path, &idx); err != nil {
		return noteSearchIndex{Version: noteSearchIndexVersion, Notes: map[string]noteSearchEntry{}}, nil
	}
	if idx.Version <= 0 {
		idx.Version = noteSearchIndexVersion
	}
	if idx.Notes == nil {
		idx.Notes = map[string]noteSearchEntry{}
	}
	return idx, nil
}

func (svc *service) saveNoteSearchIndex(scope string, idx noteSearchIndex) error {
	path, err := svc.resolvePath(scope, searchIndexFile)
	if err != nil {
		return err
	}
	idx.Version = noteSearchIndexVersion
	if idx.Notes == nil {
		idx.Notes = map[string]noteSearchEntry{}
	}
	return writeJSONFile(path, idx)
}

// collectSearchEntryForNote 按面协议收集一个笔记包的可搜内容：
// 笔记级字段（标题/简介/标签，无面笔记仍可被搜到）＋ 各可搜面交出的搜索文本。
func (svc *service) collectSearchEntryForNote(scope string, packageDir string, manifest noteManifest) noteSearchEntry {
	entry := noteSearchEntry{
		Title:       manifest.Title,
		Description: manifest.Description,
		Dir:         filepath.ToSlash(packageDir),
		Tags:        manifest.Tags,
		CreatedAtMs: manifest.CreatedAtMs,
		UpdatedAtMs: manifest.UpdatedAtMs,
	}
	for _, faceID := range manifest.FaceOrder {
		face := manifest.Faces[faceID]
		adapter, ok := noteFaceAdapters[face.Kind]
		if !ok || adapter.SearchText == nil {
			continue
		}
		content, err := svc.readText(scope, filepath.ToSlash(filepath.Join(packageDir, face.File)))
		if err != nil {
			continue
		}
		text := strings.TrimSpace(adapter.SearchText(content))
		if text == "" {
			continue
		}
		title := strings.TrimSpace(face.Title)
		if title == "" {
			title = adapter.Label
		}
		entry.Faces = append(entry.Faces, noteSearchFaceEntry{FaceID: faceID, Kind: face.Kind, Title: title, Text: text})
	}
	return entry
}

// updateSearchEntryForNote 整体重建单个笔记的搜索索引条目（随派生数据统一刷新点被调用）。
func (svc *service) updateSearchEntryForNote(scope string, packageDir string, manifest noteManifest) error {
	idx, err := svc.loadNoteSearchIndex(scope)
	if err != nil {
		return err
	}
	entry := svc.collectSearchEntryForNote(scope, packageDir, manifest)
	idx.Notes[manifest.ID] = entry
	return svc.saveNoteSearchIndex(scope, idx)
}

func (svc *service) removeSearchEntryForNote(scope string, noteID string) error {
	idx, err := svc.loadNoteSearchIndex(scope)
	if err != nil {
		return err
	}
	delete(idx.Notes, strings.TrimSpace(noteID))
	return svc.saveNoteSearchIndex(scope, idx)
}

func (svc *service) rebuildSearchIndex(scope string) error {
	root, err := svc.resolvePath(scope, notesDir)
	if err != nil {
		return err
	}
	idx := noteSearchIndex{Version: noteSearchIndexVersion, Notes: map[string]noteSearchEntry{}}
	months, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return svc.saveNoteSearchIndex(scope, idx)
	}
	if err != nil {
		return err
	}
	for _, month := range months {
		if !month.IsDir() {
			continue
		}
		monthDir := filepath.Join(root, month.Name())
		packages, err := os.ReadDir(monthDir)
		if err != nil {
			return err
		}
		for _, pkg := range packages {
			if !pkg.IsDir() {
				continue
			}
			rel := filepath.ToSlash(filepath.Join(notesDir, month.Name(), pkg.Name()))
			manifest, err := svc.loadNoteManifest(scope, rel)
			if err != nil || manifest.ID == "" {
				continue
			}
			idx.Notes[manifest.ID] = svc.collectSearchEntryForNote(scope, rel, manifest)
		}
	}
	return svc.saveNoteSearchIndex(scope, idx)
}

func listSearchableFaceKinds() []noteSearchFaceKindInfo {
	out := []noteSearchFaceKindInfo{}
	for _, adapter := range noteFaceAdapters {
		if adapter.SearchText == nil {
			continue
		}
		out = append(out, noteSearchFaceKindInfo{Kind: adapter.Kind, Label: adapter.Label})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Kind < out[j].Kind })
	return out
}

func stringSliceField(raw []byte, key string) []string {
	payload := map[string]any{}
	_ = json.Unmarshal(raw, &payload)
	out := []string{}
	if list, ok := payload[key].([]any); ok {
		for _, item := range list {
			value := strings.TrimSpace(asString(item))
			if value != "" {
				out = append(out, value)
			}
		}
	}
	return out
}

func normalizeSearchTokens(rawQuery string) []string {
	tokens := []string{}
	for _, part := range strings.Fields(rawQuery) {
		token := strings.ToLower(strings.TrimSpace(part))
		if token != "" {
			tokens = append(tokens, token)
		}
	}
	return tokens
}

func textMatchesTokens(haystack string, tokens []string) bool {
	lower := strings.ToLower(haystack)
	for _, token := range tokens {
		if !strings.Contains(lower, strings.ToLower(token)) {
			return false
		}
	}
	return true
}

// makeSearchSnippet 在面交出的搜索文本中，以首个命中关键词为中心截取摘要片段。
// 截断在字符（rune）边界上进行，避免劈开多字节字符（中文等）。
func makeSearchSnippet(text string, tokens []string) string {
	flat := strings.Join(strings.Fields(text), " ")
	if flat == "" {
		return ""
	}
	lower := strings.ToLower(flat)
	pos := -1
	width := 0
	for _, token := range tokens {
		t := strings.ToLower(token)
		if p := strings.Index(lower, t); p >= 0 && (pos < 0 || p < pos) {
			pos = p
			width = len(t)
		}
	}
	if pos < 0 {
		pos = 0
		width = 0
	}
	runes := []rune(flat)
	posRunes := utf8.RuneCountInString(flat[:pos])
	widthRunes := utf8.RuneCountInString(flat[pos : pos+width])
	half := 48
	start := posRunes - half
	if start < 0 {
		start = 0
	}
	end := posRunes + widthRunes + half
	if end > len(runes) {
		end = len(runes)
	}
	out := ""
	if start > 0 {
		out += "…"
	}
	out += string(runes[start:end])
	if end < len(runes) {
		out += "…"
	}
	return out
}

// queryNoteSearch 按笔记聚合返回搜索结果：
// 范围不限时命中笔记字段（标题/简介/标签/ID，无面笔记因此仍可搜）或任意可搜面内容；
// 传入 faceKinds 时仅在该些面类型的内容中搜索（Q5 面类型范围筛选）。
func (svc *service) queryNoteSearch(scope string, rawQuery string, faceKinds []string) (noteSearchResult, error) {
	result := noteSearchResult{Kinds: listSearchableFaceKinds()}
	tokens := normalizeSearchTokens(rawQuery)
	if len(tokens) == 0 {
		result.Items = []noteSearchHit{}
		return result, nil
	}
	idx, err := svc.loadNoteSearchIndex(scope)
	if err != nil {
		return result, err
	}
	kindSet := map[string]bool{}
	for _, kind := range faceKinds {
		kind = strings.TrimSpace(kind)
		if kind != "" {
			kindSet[kind] = true
		}
	}
	filterFaces := len(kindSet) > 0

	hits := []noteSearchHit{}
	for noteID, entry := range idx.Notes {
		hit := noteSearchHit{NoteID: noteID, Title: entry.Title, Description: entry.Description, Dir: entry.Dir, CreatedAtMs: entry.CreatedAtMs, UpdatedAtMs: entry.UpdatedAtMs}
		if !filterFaces {
			if textMatchesTokens(entry.Title, tokens) {
				hit.NoteFields = append(hit.NoteFields, "title")
				hit.score += 12
			}
			if textMatchesTokens(entry.Description, tokens) {
				hit.NoteFields = append(hit.NoteFields, "description")
				hit.score += 6
			}
			if len(entry.Tags) > 0 && textMatchesTokens(strings.Join(entry.Tags, " "), tokens) {
				hit.NoteFields = append(hit.NoteFields, "tags")
				hit.score += 6
			}
			if textMatchesTokens(noteID, tokens) {
				hit.NoteFields = append(hit.NoteFields, "id")
				hit.score += 4
			}
		}
		for _, face := range entry.Faces {
			if filterFaces && !kindSet[face.Kind] {
				continue
			}
			if !textMatchesTokens(face.Text, tokens) {
				continue
			}
			hit.FaceHits = append(hit.FaceHits, noteSearchFaceHit{
				FaceID:  face.FaceID,
				Kind:    face.Kind,
				Title:   face.Title,
				Snippet: makeSearchSnippet(face.Text, tokens),
			})
			hit.score += 8
		}
		if len(hit.NoteFields) == 0 && len(hit.FaceHits) == 0 {
			continue
		}
		hits = append(hits, hit)
	}
	sort.Slice(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		if hits[i].UpdatedAtMs != hits[j].UpdatedAtMs {
			return hits[i].UpdatedAtMs > hits[j].UpdatedAtMs
		}
		return hits[i].NoteID < hits[j].NoteID
	})
	if len(hits) > noteSearchMaxItems {
		hits = hits[:noteSearchMaxItems]
	}
	result.Items = hits
	return result, nil
}

/* ------------------------------------------------------------------ */
/*  面自供搜索文本（markdown）：保留代码区域原文，将正文中的内嵌占位符      */
/*  换成渲染时可见的文本，让搜索命中与摘要贴近用户实际看到的内容。           */
/* ------------------------------------------------------------------ */

var searchNoteRefPattern = regexp.MustCompile(`\[\[([^\]\n]+?)\]\]`)
var searchAssetPattern = regexp.MustCompile(`\{\{asset:[^\}\n]+?\}\}`)

// searchTextSegment 表示一段文本：code=true 表示代码区域（围栏代码块或行内代码），原样保留。
type searchTextSegment struct {
	code  bool
	value string
}

func markdownSearchText(content string) string {
	src := strings.ReplaceAll(content, "\r\n", "\n")
	segments := splitSearchFenceSegments(src)
	var builder strings.Builder
	for _, segment := range segments {
		if segment.code {
			builder.WriteString(segment.value)
			continue
		}
		builder.WriteString(transformSearchPlainText(segment.value))
	}
	return builder.String()
}

// splitSearchFenceSegments 将源码按 ``` 围栏代码块切成段落，语义与前端渲染 tokenizeFences 一致。
func splitSearchFenceSegments(src string) []searchTextSegment {
	lines := strings.Split(src, "\n")
	out := []searchTextSegment{}
	textBuf := []string{}
	flushText := func() {
		if len(textBuf) == 0 {
			return
		}
		out = append(out, searchTextSegment{value: strings.Join(textBuf, "")})
		textBuf = textBuf[:0]
	}
	inFence := false
	fenceIndent := ""
	fenceMarker := ""
	fenceLines := []string{}
	openRe := regexp.MustCompile(`^(\s*)(` + "`" + `{3,})(.*)$`)
	closeRe := regexp.MustCompile(`^(\s*)(` + "`" + `{3,})\s*$`)
	for idx, line := range lines {
		withNl := line
		if idx < len(lines)-1 {
			withNl += "\n"
		}
		if !inFence {
			m := openRe.FindStringSubmatch(line)
			if m == nil {
				textBuf = append(textBuf, withNl)
				continue
			}
			flushText()
			inFence = true
			fenceIndent = m[1]
			fenceMarker = m[2]
			fenceLines = []string{withNl}
			continue
		}
		m := closeRe.FindStringSubmatch(line)
		if m != nil && m[1] == fenceIndent && m[2] == fenceMarker {
			fenceLines = append(fenceLines, withNl)
			out = append(out, searchTextSegment{code: true, value: strings.Join(fenceLines, "")})
			inFence = false
			fenceIndent = ""
			fenceMarker = ""
			fenceLines = nil
			continue
		}
		fenceLines = append(fenceLines, withNl)
	}
	if inFence {
		out = append(out, searchTextSegment{code: true, value: strings.Join(fenceLines, "")})
	} else {
		flushText()
	}
	return out
}

// transformSearchPlainText 处理非代码正文：引用占位符换成渲染可见文本、附件占位符清掉。
// 行内代码区域原样保留（与前端渲染仅在行外替换占位符的语义一致）。
func transformSearchPlainText(segment string) string {
	parts := splitSearchInlineCodeSegments(segment)
	var builder strings.Builder
	for _, part := range parts {
		if part.code {
			builder.WriteString(part.value)
			continue
		}
		value := searchNoteRefPattern.ReplaceAllStringFunc(part.value, func(m string) string {
			return searchNoteRefDisplayText(m)
		})
		value = searchAssetPattern.ReplaceAllString(value, " ")
		builder.WriteString(value)
	}
	return builder.String()
}

func splitSearchInlineCodeSegments(src string) []searchTextSegment {
	out := []searchTextSegment{}
	i := 0
	last := 0
	for i < len(src) {
		if src[i] != '`' {
			i++
			continue
		}
		j := i
		for j < len(src) && src[j] == '`' {
			j++
		}
		marker := src[i:j]
		closeAt := strings.Index(src[j:], marker)
		if closeAt < 0 {
			break
		}
		closeAt += j
		end := closeAt + len(marker)
		if i > last {
			out = append(out, searchTextSegment{value: src[last:i]})
		}
		out = append(out, searchTextSegment{code: true, value: src[i:end]})
		i = end
		last = i
	}
	if last < len(src) {
		out = append(out, searchTextSegment{value: src[last:]})
	}
	return out
}

// searchNoteRefDisplayText 引用占位符在渲染时展示 title（无 title 用 remarks）；
// 两者都没有时该占位符不产生可见文字，移除。
func searchNoteRefDisplayText(placeholder string) string {
	inner := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(placeholder, "[["), "]]"))
	noteID := ""
	title := ""
	remarks := ""
	for _, part := range strings.Split(inner, "|") {
		seg := strings.TrimSpace(part)
		if seg == "" {
			continue
		}
		eq := strings.Index(seg, "=")
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(seg[:eq])
		value := seg[eq+1:]
		switch key {
		case "note_id":
			noteID = strings.TrimSpace(value)
		case "title":
			title = value
		case "remarks":
			remarks = value
		}
	}
	if noteID == "" {
		return placeholder
	}
	display := strings.TrimSpace(title)
	if display == "" {
		display = strings.TrimSpace(remarks)
	}
	if display == "" {
		return ""
	}
	return display
}
