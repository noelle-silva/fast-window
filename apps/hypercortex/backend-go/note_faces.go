package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"fast-window-hypercortex-backend/faceplugin"
)

const noteFaceSchemaVersion = 2

func defaultFaceForKind(kind string, input noteFaceManifest) (noteFaceManifest, error) {
	adapter, err := faceplugin.Require(kind)
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

// maskFencedCodeBlocks 等引用语法工具已迁入协议包 faceplugin（见 faceplugin/refs.go）。

func tagsOrExisting(value any, existing []string) []string {
	if _, ok := value.([]any); ok {
		return normalizeTags(value)
	}
	return existing
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
		adapter, err := faceplugin.Require(kind)
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
			adapter, err := faceplugin.Require(kind)
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
	adapter, err := faceplugin.Require(face.Kind)
	if err != nil {
		return nil
	}
	content := ""
	if adapter.EmptyContent != nil {
		content = adapter.EmptyContent(manifest.ID, manifest.Title)
	}
	return svc.writeText(scope, rel, content, false)
}

// noteFaceContentInput 是批量保存时提交的单个面内容。
type noteFaceContentInput struct {
	FaceID  string
	Kind    string
	Content string
}

// faceContentsFromAny 解析批量保存的提交面清单；结构非法或缺少面类型时快速失败，
// 避免静默丢弃用户明确要求保存的内容。
func faceContentsFromAny(value any) ([]noteFaceContentInput, error) {
	if value == nil {
		return nil, nil
	}
	list, ok := value.([]any)
	if !ok {
		return nil, errors.New("faces 必须是数组")
	}
	out := make([]noteFaceContentInput, 0, len(list))
	for _, item := range list {
		rec, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("faces 条目必须是对象")
		}
		kind := strings.TrimSpace(asString(rec["kind"]))
		if kind == "" {
			return nil, errors.New("faces 条目缺少面类型")
		}
		out = append(out, noteFaceContentInput{FaceID: strings.TrimSpace(asString(rec["faceId"])), Kind: kind, Content: asString(rec["content"])})
	}
	return out, nil
}

// saveNoteFaces 一次保存整篇笔记的所有面内容与笔记级元数据（Q24）。
// 提交的面内容全部写盘成功后再写 manifest、更新笔记索引并刷新派生索引，
// 不使用多面逐次保存，避免出现“部分面已保存”的中间状态。
func (svc *service) saveNoteFaces(scope string, raw json.RawMessage) (any, error) {
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	if err := svc.ensureRoots(); err != nil {
		return nil, err
	}
	submitted, err := faceContentsFromAny(input["faces"])
	if err != nil {
		return nil, err
	}
	// 先解析全部提交面的协议输入：任何未知面类型都在产生磁盘副作用之前快速失败。
	type resolvedFaceInput struct {
		adapter faceplugin.Plugin
		faceID  string
		content string
	}
	resolved := make([]resolvedFaceInput, 0, len(submitted))
	for _, item := range submitted {
		adapter, err := faceplugin.Require(item.Kind)
		if err != nil {
			return nil, err
		}
		resolved = append(resolved, resolvedFaceInput{adapter: adapter, faceID: nonEmpty(item.FaceID, adapter.DefaultFaceID), content: adapter.NormalizeContent(item.Content)})
	}

	id := strings.TrimSpace(asString(input["id"]))
	if id == "" {
		id = noteID()
	}
	rawTitle := strings.TrimSpace(asString(input["title"]))
	title := nonEmpty(rawTitle, "未命名")
	description := strings.TrimSpace(asString(input["description"]))
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
	faces := existing.Faces
	if faces == nil {
		faces = map[string]noteFaceManifest{}
	}
	created := asFloat(input["createdAtMs"])
	if created <= 0 {
		created = existing.CreatedAtMs
	}
	if created <= 0 {
		created = nowMs()
	}
	updated := nowMs()
	manifest := noteManifest{ID: id, Title: title, Description: description, Tags: tagsOrExisting(input["tags"], existing.Tags), CreatedAtMs: created, UpdatedAtMs: updated, FaceOrder: existing.FaceOrder, Faces: faces, Resources: nil}
	if err := svc.ensureFaceKinds(scope, desiredDir, &manifest, faceKindsFromAny(input["faceKinds"]), len(existing.FaceOrder) == 0, updated); err != nil {
		return nil, err
	}
	if rawTitle == "" && len(manifest.Faces) == 0 {
		return nil, errors.New("无面笔记至少需要一个标题")
	}
	resources := existing.Resources
	if _, ok := input["resources"]; ok {
		resources = normalizeResources(input["resources"])
	}
	if resources == nil {
		resources = existing.Resources
	}
	manifest.Resources = resources

	// 面被写回即面更新（Q30）：提交的面按协议规范化内容，并在落盘后刷新面级时间戳。
	type pendingFaceWrite struct {
		face    noteFaceManifest
		content string
	}
	writes := make([]pendingFaceWrite, 0, len(resolved))
	for _, item := range resolved {
		existingFace := manifest.Faces[item.faceID]
		face, err := defaultFaceForKind(item.adapter.Kind, noteFaceManifest{ID: item.faceID, Title: existingFace.Title, File: existingFace.File, Settings: existingFace.Settings, Extra: existingFace.Extra})
		if err != nil {
			return nil, err
		}
		face.CreatedAtMs = nonZeroFloat(existingFace.CreatedAtMs, updated)
		face.UpdatedAtMs = updated
		manifest.Faces[face.ID] = face
		manifest.FaceOrder = appendIfMissing(manifest.FaceOrder, face.ID)
		writes = append(writes, pendingFaceWrite{face: face, content: item.content})
	}
	manifest = normalizeManifest(manifest)

	for _, write := range writes {
		if err := svc.writeText(scope, filepath.ToSlash(filepath.Join(desiredDir, write.face.File)), write.content, true); err != nil {
			return nil, err
		}
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
	return map[string]any{"meta": meta, "manifest": manifest, "refs": refs}, nil
}

// saveNoteFaceOrder 保存笔记级面顺序（Q35 统一优先级机制的笔记级覆盖）。
// 只接受笔记内已存在的面，未列出的面由规范化逻辑补齐，任何面都不会因排序而丢失。
func (svc *service) saveNoteFaceOrder(scope string, packageDir string, faceOrder []string) (any, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return nil, err
	}
	manifest.FaceOrder = faceOrder
	manifest.UpdatedAtMs = nowMs()
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
	adapter, err := faceplugin.Require(face.Kind)
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
