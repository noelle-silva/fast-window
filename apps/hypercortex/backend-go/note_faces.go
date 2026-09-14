package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var fenceLineHeadRe = regexp.MustCompile(`^[ \t]{0,3}` + "```")
var fenceLineSeekRe = regexp.MustCompile(`\n[ \t]{0,3}` + "```")

const noteFaceSchemaVersion = 2

// htmlFaceDisplayModes 与前端 htmlFaceDisplay.ts 的 isHtmlFaceDisplayMode 保持同一枚举。
var htmlFaceDisplayModes = map[string]bool{
	"natural":    true,
	"fit-window": true,
	"fixed-fit":  true,
}

type noteFaceAdapter struct {
	Kind              string
	Label             string
	DefaultFaceID     string
	DefaultFileName   string
	Capabilities      faceCapabilities
	NormalizeContent  func(string) string
	EmptyContent      func(noteManifest) string
	NormalizeSettings func(map[string]any) map[string]any
	ExtractRefs       func(string) []noteRef
	// SearchText 将该面内容转成交给搜索系统的可搜文本（供匹配与截取摘要）。
	// 为 nil 表示该面类型不提供内容搜索，与 capabilities.Searchable=false 同源。
	SearchText func(string) string
}

var noteFaceAdapters = map[string]noteFaceAdapter{
	"markdown": {
		Kind:              "markdown",
		Label:             "文本",
		DefaultFaceID:     "text",
		DefaultFileName:   "text.md",
		Capabilities:      faceCapabilities{Editable: true, Searchable: true, Previewable: true, Creatable: true, Deletable: false},
		NormalizeContent:  normalizeTextFaceContent,
		EmptyContent:      func(noteManifest) string { return "" },
		NormalizeSettings: normalizePlainSettings,
		ExtractRefs:       extractPlaceholderRefs,
		SearchText:        markdownSearchText,
	},
	"html": {
		Kind:              "html",
		Label:             "HTML",
		DefaultFaceID:     "html",
		DefaultFileName:   "html-view.html",
		Capabilities:      faceCapabilities{Editable: true, Searchable: false, Previewable: true, Creatable: true, Deletable: true},
		NormalizeContent:  normalizeTextFaceContent,
		EmptyContent:      func(manifest noteManifest) string { return emptyHTMLDoc(manifest.ID, manifest.Title) },
		NormalizeSettings: normalizeHTMLSettings,
		ExtractRefs:       extractPlaceholderRefs,
	},
}

func requireFaceAdapter(kind string) (noteFaceAdapter, error) {
	adapter, ok := noteFaceAdapters[strings.TrimSpace(kind)]
	if !ok {
		return noteFaceAdapter{}, errors.New("未知笔记面类型")
	}
	return adapter, nil
}

func defaultFaceForKind(kind string, input noteFaceManifest) (noteFaceManifest, error) {
	adapter, err := requireFaceAdapter(kind)
	if err != nil {
		return noteFaceManifest{}, err
	}
	settings := input.Settings
	if settings == nil {
		settings = map[string]any{}
	}
	return noteFaceManifest{
		ID:           nonEmpty(input.ID, adapter.DefaultFaceID),
		Kind:         adapter.Kind,
		Title:        nonEmpty(input.Title, adapter.Label),
		File:         nonEmpty(input.File, adapter.DefaultFileName),
		Settings:     adapter.NormalizeSettings(settings),
		Capabilities: adapter.Capabilities,
		CreatedAtMs:  input.CreatedAtMs,
		UpdatedAtMs:  input.UpdatedAtMs,
		Extra:        input.Extra,
	}, nil
}

func (svc *service) saveNoteFace(scope string, raw json.RawMessage) (any, error) {
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	if err := svc.ensureRoots(); err != nil {
		return nil, err
	}
	adapter, err := requireFaceAdapter(strings.TrimSpace(asString(input["kind"])))
	if err != nil {
		return nil, err
	}
	id := strings.TrimSpace(asString(input["id"]))
	if id == "" {
		id = noteID()
	}
	title := nonEmpty(asString(input["title"]), "未命名")
	currentDir := strings.TrimSpace(asString(input["packageDir"]))
	desiredDir, err := notePackageDirForID(id)
	if err != nil {
		return nil, err
	}
	if currentDir != "" && filepath.ToSlash(currentDir) != desiredDir {
		if err := svc.renamePackageIfNeeded(scope, currentDir, desiredDir); err != nil {
			return nil, err
		}
	}

	existing, _ := svc.loadNoteManifest(scope, desiredDir)
	faceID := nonEmpty(asString(input["faceId"]), adapter.DefaultFaceID)
	existingFace, faceExists := existing.Faces[faceID]
	settings := mapFromAny(input["settings"])
	if settings == nil {
		settings = existingFace.Settings
	}
	face, err := defaultFaceForKind(adapter.Kind, noteFaceManifest{ID: faceID, Title: existingFace.Title, File: existingFace.File, Settings: settings, Extra: existingFace.Extra})
	if err != nil {
		return nil, err
	}

	created := asFloat(input["createdAtMs"])
	if created <= 0 {
		created = existing.CreatedAtMs
	}
	if created <= 0 {
		created = nowMs()
	}
	updated := nowMs()
	face.CreatedAtMs = nonZeroFloat(existingFace.CreatedAtMs, created)
	if !faceExists {
		face.CreatedAtMs = updated
	}
	face.UpdatedAtMs = updated
	resources := existing.Resources
	if _, ok := input["resources"]; ok {
		resources = normalizeResources(input["resources"])
	}
	if resources == nil {
		resources = existing.Resources
	}
	faces := existing.Faces
	if faces == nil {
		faces = map[string]noteFaceManifest{}
	}
	faces[face.ID] = face
	manifest := noteManifest{ID: id, Title: title, Description: strings.TrimSpace(asString(firstNonNil(input["description"], existing.Description))), Tags: tagsOrExisting(input["tags"], existing.Tags), CreatedAtMs: created, UpdatedAtMs: updated, FaceOrder: existing.FaceOrder, Faces: faces, Resources: resources}
	if err := svc.ensureFaceKinds(scope, desiredDir, &manifest, faceKindsFromAny(input["faceKinds"]), len(existing.FaceOrder) == 0, updated); err != nil {
		return nil, err
	}
	manifest.FaceOrder = appendIfMissing(manifest.FaceOrder, face.ID)
	manifest = normalizeManifest(manifest)

	content := adapter.NormalizeContent(asString(input["content"]))
	if err := svc.writeText(scope, filepath.ToSlash(filepath.Join(desiredDir, manifest.Faces[face.ID].File)), content, true); err != nil {
		return nil, err
	}
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(desiredDir, manifestFile)), manifest); err != nil {
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: desiredDir, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	refs, err := svc.refreshDerivedIndexesForNote(scope, desiredDir, manifest)
	if err != nil {
		return nil, err
	}
	return map[string]any{"meta": meta, "faceDoc": noteFaceDocFromManifest(manifest, desiredDir, manifest.Faces[face.ID], content, true), "manifest": manifest, "refs": refs}, nil
}

// deleteNoteFace 删除笔记中的某个面：
// mode 为 trash 时先移入回收站（可恢复），其余情况直接永久删除文件。
// 两种模式都会同步清理该面发出的引用与搜索索引条目（Q15）。
func (svc *service) deleteNoteFace(scope string, packageDir string, faceID string, mode string) (any, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return nil, err
	}
	id := strings.TrimSpace(faceID)
	face, ok := manifest.Faces[id]
	if !ok {
		return nil, errors.New("笔记面不存在")
	}
	if !face.Capabilities.Deletable {
		return nil, errors.New("该笔记面不可删除")
	}
	if strings.TrimSpace(mode) == "permanent" {
		_ = svc.deleteFile(scope, filepath.ToSlash(filepath.Join(packageDir, face.File)))
	} else if err := svc.moveNoteFaceToTrash(scope, packageDir, manifest, id); err != nil {
		return nil, err
	}
	delete(manifest.Faces, id)
	manifest.FaceOrder = removeString(manifest.FaceOrder, id)
	manifest.UpdatedAtMs = nowMs()
	manifest = normalizeManifest(manifest)
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(packageDir, manifestFile)), manifest); err != nil {
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: filepath.ToSlash(packageDir), CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	refs, err := svc.refreshDerivedIndexesForNote(scope, packageDir, manifest)
	if err != nil {
		return nil, err
	}
	return map[string]any{"meta": meta, "manifest": manifest, "refs": refs}, nil
}

func noteFaceDocFromManifest(manifest noteManifest, packageDir string, face noteFaceManifest, content string, exists bool) noteFaceDoc {
	return noteFaceDoc{ID: face.ID, PackageDir: packageDir, NoteID: manifest.ID, NoteTitle: manifest.Title, NoteDescription: manifest.Description, Face: face, Content: content, Exists: exists, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, SchemaVersion: manifest.SchemaVersion}
}

func (svc *service) renamePackageIfNeeded(scope string, currentDir string, desiredDir string) error {
	from, err := svc.resolvePath(scope, currentDir)
	if err != nil {
		return err
	}
	to, err := svc.resolvePath(scope, desiredDir)
	if err != nil {
		return err
	}
	if exists(to) {
		return errors.New("目标笔记目录已存在")
	}
	if err := ensureParent(to); err != nil {
		return err
	}
	if exists(from) {
		return os.Rename(from, to)
	}
	return nil
}

func normalizeTextFaceContent(value string) string {
	return strings.ReplaceAll(value, "\r\n", "\n")
}

// maskFencedCodeBlocks 与前端 noteRefs.ts 保持一致：遮蔽 ``` 围栏代码块（含闭合行换行）
func maskFencedCodeBlocks(content string) string {
	buf := []byte(content)
	pos := 0
	for {
		openAt, ok := nextFenceOpenIndex(content, pos)
		if !ok {
			break
		}
		end := len(content)
		if closeAt, found := nextFenceOpenIndex(content, openAt+3); found {
			if lineEnd := strings.IndexByte(content[closeAt+3:], '\n'); lineEnd >= 0 {
				end = closeAt + 3 + lineEnd + 1
			}
		}
		for i := openAt; i < end; i++ {
			buf[i] = ' '
		}
		pos = end
	}
	return string(buf)
}

// nextFenceOpenIndex 等价前端 noteRefs.ts openRe.exec 语义：^ 仅匹配文本头，其余围栏必须出现在行首 \n 之后
func nextFenceOpenIndex(src string, pos int) (openAt int, ok bool) {
	if pos == 0 {
		if loc := fenceLineHeadRe.FindStringIndex(src); loc != nil && loc[0] == 0 {
			return 0, true
		}
	}
	loc := fenceLineSeekRe.FindStringIndex(src[pos:])
	if loc == nil {
		return 0, false
	}
	return pos + loc[1] - 3, true
}

// maskInlineCodeSpans 与前端 noteRefs.ts 保持一致：遮蔽行内代码双反引号/单反引号区间（含两端标记）
func maskInlineCodeSpans(content string) string {
	buf := []byte(content)
	i := 0
	for i < len(content) {
		if content[i] != '`' {
			i++
			continue
		}
		j := i
		for j < len(content) && content[j] == '`' {
			j++
		}
		fence := content[i:j]
		closeAt := strings.Index(content[j:], fence)
		if closeAt < 0 {
			i = j
			continue
		}
		closeAt += j
		end := closeAt + len(fence)
		for p := i; p < end; p++ {
			buf[p] = ' '
		}
		i = end
	}
	return string(buf)
}

func maskCode(content string) string {
	return maskInlineCodeSpans(maskFencedCodeBlocks(content))
}

func extractPlaceholderRefs(content string) []noteRef {
	refs := []noteRef{}
	seen := map[string]bool{}
	text := maskCode(strings.ReplaceAll(content, "\r\n", "\n"))
	for {
		start := strings.Index(text, "[[")
		if start < 0 {
			break
		}
		text = text[start+2:]
		end := strings.Index(text, "]]")
		if end < 0 {
			break
		}
		inner := text[:end]
		text = text[end+2:]
		// 与前端 noteRefs.ts 单行约束保持一致：占位符内容出现换行不算有效引用，不提取
		if strings.Contains(inner, "\n") {
			continue
		}
		// 与前端 noteRefs.ts 正则 [^\]\n] 语义保持一致：占位符内容出现单个 ] 视为无效占位符，不提取
		if strings.Contains(inner, "]") {
			continue
		}
		ref, ok := parseNoteRefPlaceholder(inner)
		if !ok {
			continue
		}
		key := ref.NoteID + "\x00" + ref.FaceID
		if !seen[key] {
			seen[key] = true
			refs = append(refs, ref)
		}
	}
	return refs
}

func parseNoteRefPlaceholder(inner string) (noteRef, bool) {
	noteID := ""
	faceID := ""
	for _, part := range strings.Split(inner, "|") {
		part = strings.TrimSpace(part)
		eq := strings.Index(part, "=")
		if eq < 0 {
			continue
		}
		value := strings.TrimSpace(part[eq+1:])
		// 与前端 parseNotePlaceholderBody 保持一致：重复键后写覆盖（含写空）
		switch strings.TrimSpace(part[:eq]) {
		case "note_id":
			noteID = value
		case "face":
			faceID = value
		}
	}
	if noteID == "" {
		return noteRef{}, false
	}
	return noteRef{NoteID: noteID, FaceID: faceID}, true
}

func uniqueNoteRefs(refs []noteRef) []noteRef {
	seen := map[string]bool{}
	out := []noteRef{}
	for _, ref := range refs {
		ref.NoteID = strings.TrimSpace(ref.NoteID)
		ref.FaceID = strings.TrimSpace(ref.FaceID)
		if ref.NoteID == "" {
			continue
		}
		key := ref.NoteID + "\x00" + ref.FaceID
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, ref)
	}
	return out
}

func normalizePlainSettings(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	out := map[string]any{}
	for k, v := range value {
		key := strings.TrimSpace(k)
		if key != "" {
			out[key] = v
		}
	}
	return out
}

func normalizeHTMLSettings(value map[string]any) map[string]any {
	out := map[string]any{}
	if value == nil {
		return out
	}
	if scale := asFloat(value["fixedScale"]); scale >= 0.25 && scale <= 2 {
		out["fixedScale"] = scale
	}
	if mode := strings.TrimSpace(asString(value["displayMode"])); htmlFaceDisplayModes[mode] {
		out["displayMode"] = mode
	}
	return out
}

func mapFromAny(value any) map[string]any {
	if value == nil {
		return nil
	}
	rec, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return rec
}

func tagsOrExisting(value any, existing []string) []string {
	if _, ok := value.([]any); ok {
		return normalizeTags(value)
	}
	return existing
}

func firstNonNil(value any, fallback any) any {
	if value == nil {
		return fallback
	}
	return value
}

func faceKindsFromAny(value any) []string {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	seen := map[string]bool{}
	for _, item := range list {
		kind := strings.TrimSpace(asString(item))
		if kind == "" || seen[kind] {
			continue
		}
		seen[kind] = true
		out = append(out, kind)
	}
	return out
}

func faceKindExists(faces map[string]noteFaceManifest, kind string) bool {
	return faceIDForKind(faces, kind) != ""
}

func faceIDForKind(faces map[string]noteFaceManifest, kind string) string {
	for id, face := range faces {
		if face.Kind == kind {
			return id
		}
	}
	return ""
}

// ensureFaceKinds 确保 kinds 中每个类型的面都存在（缺失时补齐默认面并写入空内容文件）。
// resetOrder 为 true（新建笔记）时按 kinds 顺序建立 FaceOrder；
// 否则只把新补齐的面追加到既有 FaceOrder 末尾，不改动笔记级面顺序。
func (svc *service) ensureFaceKinds(scope string, packageDir string, manifest *noteManifest, kinds []string, resetOrder bool, now float64) error {
	if len(kinds) == 0 {
		return nil
	}
	if manifest.Faces == nil {
		manifest.Faces = map[string]noteFaceManifest{}
	}
	created := []string{}
	for _, kind := range kinds {
		adapter, err := requireFaceAdapter(kind)
		if err != nil {
			continue
		}
		if faceKindExists(manifest.Faces, adapter.Kind) {
			continue
		}
		face, err := defaultFaceForKind(adapter.Kind, noteFaceManifest{CreatedAtMs: now, UpdatedAtMs: now})
		if err != nil {
			return err
		}
		manifest.Faces[face.ID] = face
		created = append(created, face.ID)
		if err := svc.writeFaceEmptyContentIfMissing(scope, packageDir, face, *manifest); err != nil {
			return err
		}
	}
	if resetOrder {
		order := []string{}
		for _, kind := range kinds {
			adapter, err := requireFaceAdapter(kind)
			if err != nil {
				continue
			}
			id := faceIDForKind(manifest.Faces, adapter.Kind)
			if id == "" {
				id = adapter.DefaultFaceID
			}
			if _, ok := manifest.Faces[id]; ok {
				order = appendIfMissing(order, id)
			}
		}
		manifest.FaceOrder = order
		return nil
	}
	for _, id := range created {
		manifest.FaceOrder = appendIfMissing(manifest.FaceOrder, id)
	}
	return nil
}

// writeFaceEmptyContentIfMissing 为新建面补上协议默认的空内容文件；已存在文件不覆盖。
func (svc *service) writeFaceEmptyContentIfMissing(scope string, packageDir string, face noteFaceManifest, manifest noteManifest) error {
	rel := filepath.ToSlash(filepath.Join(packageDir, face.File))
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return err
	}
	if exists(target) {
		return nil
	}
	adapter, err := requireFaceAdapter(face.Kind)
	if err != nil {
		return nil
	}
	content := ""
	if adapter.EmptyContent != nil {
		content = adapter.EmptyContent(manifest)
	}
	return svc.writeText(scope, rel, content, false)
}

// saveNoteFaceSettings 以补丁语义更新笔记级面设置：
// 补丁中值为 null 表示删除该字段，其余字段与既有设置合并后按面协议规范化。
// 这是笔记包内面设置的唯一写入通道，优先级解析由前端统一机制负责。
func (svc *service) saveNoteFaceSettings(scope string, packageDir string, faceID string, rawSettings json.RawMessage) (any, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return nil, err
	}
	id := strings.TrimSpace(faceID)
	face, ok := manifest.Faces[id]
	if !ok {
		return nil, errors.New("笔记面不存在")
	}
	patch := map[string]any{}
	if len(rawSettings) > 0 && string(rawSettings) != "null" {
		if err := json.Unmarshal(rawSettings, &patch); err != nil {
			return nil, err
		}
	}
	settings := map[string]any{}
	for key, value := range face.Settings {
		settings[key] = value
	}
	for key, value := range patch {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if value == nil {
			delete(settings, key)
			continue
		}
		settings[key] = value
	}
	adapter, err := requireFaceAdapter(face.Kind)
	if err != nil {
		return nil, err
	}
	updated := nowMs()
	face.Settings = adapter.NormalizeSettings(settings)
	face.UpdatedAtMs = updated
	face.CreatedAtMs = nonZeroFloat(face.CreatedAtMs, manifest.CreatedAtMs)
	manifest.Faces[id] = face
	manifest.UpdatedAtMs = updated
	manifest = normalizeManifest(manifest)
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(packageDir, manifestFile)), manifest); err != nil {
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: filepath.ToSlash(packageDir), CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	return map[string]any{"meta": meta, "manifest": manifest}, nil
}
