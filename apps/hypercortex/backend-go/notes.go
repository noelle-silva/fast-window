package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"fast-window-hypercortex-backend/faceplugin"
)

func normalizeFaceManifest(input noteFaceManifest) noteFaceManifest {
	if input.Kind == "" {
		return input
	}
	base, err := defaultFaceForKind(input.Kind, input)
	if err != nil {
		return input
	}
	return base
}

func normalizeManifest(input noteManifest) noteManifest {
	now := nowMs()
	created := input.CreatedAtMs
	if created <= 0 {
		created = now
	}
	updated := input.UpdatedAtMs
	if updated <= 0 {
		updated = created
	}
	faces := map[string]noteFaceManifest{}
	for id, face := range input.Faces {
		face = normalizeFaceManifest(face)
		face.ID = nonEmpty(face.ID, id)
		if face.ID == "" || face.Kind == "" {
			continue
		}
		if face.CreatedAtMs <= 0 {
			face.CreatedAtMs = created
		}
		if face.UpdatedAtMs <= 0 {
			face.UpdatedAtMs = face.CreatedAtMs
		}
		faces[face.ID] = face
	}
	order := []string{}
	seen := map[string]bool{}
	push := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		if _, ok := faces[id]; !ok {
			return
		}
		seen[id] = true
		order = append(order, id)
	}
	for _, id := range input.FaceOrder {
		push(id)
	}
	keys := make([]string, 0, len(faces))
	for id := range faces {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		push(id)
	}
	return noteManifest{SchemaVersion: noteFaceSchemaVersion, ID: strings.TrimSpace(input.ID), Title: nonEmpty(input.Title, "未命名"), Description: strings.TrimSpace(input.Description), Tags: uniqueStrings(input.Tags), CreatedAtMs: created, UpdatedAtMs: updated, FaceOrder: order, Faces: faces, Resources: normalizeResourceRefs(input.Resources)}
}

func (svc *service) loadNoteManifest(scope string, packageDir string) (noteManifest, error) {
	path, err := svc.resolvePath(scope, filepath.ToSlash(filepath.Join(packageDir, manifestFile)))
	if err != nil {
		return noteManifest{}, err
	}
	var manifest noteManifest
	if err := readJSONFile(path, &manifest); err != nil {
		return noteManifest{}, err
	}
	manifest = normalizeManifest(manifest)
	if manifest.ID == "" {
		return noteManifest{}, errors.New("笔记 manifest 缺少 id")
	}
	return manifest, nil
}

// createNote 创建一篇空笔记：按提交的元数据与面类型清单建立笔记包，
// 为每个类型补齐协议默认面并写入空白内容，然后写 manifest、更新笔记索引、刷新派生索引。
// 提交字段：id、title、description、tags、createdAtMs、resources、faceKinds。
// 目标笔记包已存在时快速失败，避免覆盖既有笔记。
func (svc *service) createNote(scope string, raw json.RawMessage) (any, error) {
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	if err := svc.ensureRoots(); err != nil {
		return nil, err
	}
	id := strings.TrimSpace(asString(input["id"]))
	if id == "" {
		id = noteID()
	}
	rawTitle := strings.TrimSpace(asString(input["title"]))
	title := nonEmpty(rawTitle, "未命名")
	description := strings.TrimSpace(asString(input["description"]))
	desiredDir, err := notePackageDirForID(id)
	if err != nil {
		return nil, err
	}
	if _, err := svc.loadNoteManifest(scope, desiredDir); err == nil {
		return nil, fmt.Errorf("笔记已存在：%s", id)
	}

	created := asFloat(input["createdAtMs"])
	if created <= 0 {
		created = nowMs()
	}
	updated := nowMs()
	manifest := noteManifest{
		ID:          id,
		Title:       title,
		Description: description,
		Tags:        normalizeTags(input["tags"]),
		CreatedAtMs: created,
		UpdatedAtMs: updated,
		FaceOrder:   []string{},
		Faces:       map[string]noteFaceManifest{},
	}
	if _, ok := input["resources"]; ok {
		manifest.Resources = normalizeResources(input["resources"])
	}
	if err := svc.ensureFaceKinds(scope, desiredDir, &manifest, faceKindsFromAny(input["faceKinds"]), true, updated); err != nil {
		return nil, err
	}
	if rawTitle == "" && len(manifest.Faces) == 0 {
		return nil, errors.New("无面笔记至少需要一个标题")
	}
	manifest = normalizeManifest(manifest)

	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(desiredDir, manifestFile)), manifest); err != nil {
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: desiredDir, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	if _, err := svc.refreshDerivedIndexesForNote(scope, desiredDir, manifest); err != nil {
		return nil, err
	}
	return map[string]any{"meta": meta, "manifest": manifest}, nil
}

func (svc *service) loadNoteFace(scope string, packageDir string, faceID string) (noteFaceDoc, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return noteFaceDoc{}, err
	}
	face, ok := manifest.Faces[strings.TrimSpace(faceID)]
	if !ok {
		return noteFaceDoc{}, errors.New("笔记面不存在")
	}
	content := ""
	exists := false
	if raw, err := svc.readText(scope, filepath.ToSlash(filepath.Join(packageDir, face.File))); err == nil {
		content = raw
		exists = true
	} else if adapter, err := faceplugin.Require(face.Kind); err == nil {
		content = adapter.EmptyContent(manifest.ID, manifest.Title)
	}
	return noteFaceDocFromManifest(manifest, packageDir, face, content, exists), nil
}

func (svc *service) upsertNoteMeta(scope string, meta noteMeta) error {
	idx, _ := svc.loadNoteIndex(scope)
	if idx.Notes == nil {
		idx.Notes = map[string]noteMeta{}
	}
	idx.Notes[meta.ID] = meta
	return svc.writeJSON(scope, indexFile, idx)
}

func (svc *service) writeText(scope string, rel string, text string, overwrite bool) error {
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return err
	}
	if !overwrite && exists(target) {
		return errors.New("目标文件已存在")
	}
	return writeFileAtomic(target, []byte(text))
}

func (svc *service) readText(scope string, rel string) (string, error) {
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(target)
	return string(raw), err
}

func (svc *service) writeJSON(scope string, rel string, value any) error {
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return err
	}
	return writeJSONFile(target, value)
}

func (svc *service) deleteFile(scope string, rel string) error {
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return err
	}
	return os.Remove(target)
}

func uniqueStrings(list []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, item := range list {
		item = strings.TrimSpace(item)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		out = append(out, item)
	}
	return out
}

func normalizeResourceRefs(list []resourceRef) []resourceRef {
	seen := map[string]bool{}
	out := []resourceRef{}
	for _, item := range list {
		item.AssetID = strings.TrimSpace(item.AssetID)
		if item.AssetID == "" || seen[item.AssetID] {
			continue
		}
		seen[item.AssetID] = true
		out = append(out, item)
	}
	return out
}

func appendIfMissing(list []string, value string) []string {
	for _, item := range list {
		if item == value {
			return list
		}
	}
	return append(list, value)
}

func removeString(list []string, value string) []string {
	out := []string{}
	for _, item := range list {
		if item != value {
			out = append(out, item)
		}
	}
	return out
}
