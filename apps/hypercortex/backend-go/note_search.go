package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"fast-window-hypercortex-backend/faceplugin"
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
		adapter, ok := faceplugin.Get(face.Kind)
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
	for _, adapter := range faceplugin.List() {
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
