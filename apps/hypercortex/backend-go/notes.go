package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"fast-window-hypercortex-backend/faceplugin"
)

func defaultTextFace() noteFaceManifest {
	face, _ := defaultFaceForKind("markdown", noteFaceManifest{ID: "text"})
	return face
}

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

func (svc *service) saveNotePackage(scope string, raw json.RawMessage) (any, error) {
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
	body := strings.ReplaceAll(asString(input["body"]), "\r\n", "\n")
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
	saveTextFace := input["saveTextFace"] == true
	if saveTextFace {
		if _, ok := manifest.Faces["text"]; !ok {
			textFace := defaultTextFace()
			textFace.CreatedAtMs = updated
			textFace.UpdatedAtMs = updated
			manifest.Faces["text"] = textFace
		}
	}
	resources := existing.Resources
	if _, ok := input["resources"]; ok {
		resources = normalizeResources(input["resources"])
	}
	if resources == nil {
		resources = existing.Resources
	}
	manifest.Resources = resources
	manifest = normalizeManifest(manifest)

	if saveTextFace {
		textFace := manifest.Faces["text"]
		textFace.UpdatedAtMs = updated
		manifest.Faces["text"] = textFace
		if err := svc.writeText(scope, filepath.ToSlash(filepath.Join(desiredDir, textFace.File)), body, true); err != nil {
			return nil, err
		}
	}
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(desiredDir, manifestFile)), manifest); err != nil {
		return nil, err
	}
	meta := noteMeta{ID: id, Title: title, Description: description, Dir: desiredDir, CreatedAtMs: created, UpdatedAtMs: updated}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	refs, err := svc.refreshDerivedIndexesForNote(scope, desiredDir, manifest)
	if err != nil {
		return nil, err
	}
	doc := noteDoc{ID: id, PackageDir: desiredDir, Title: title, Description: description, Body: body, Tags: manifest.Tags, CreatedAtMs: created, UpdatedAtMs: updated, SchemaVersion: 2, Resources: manifest.Resources, DisplayHTML: renderMarkdownLite(body)}
	return map[string]any{"meta": meta, "doc": doc, "manifest": manifest, "refs": refs}, nil
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
