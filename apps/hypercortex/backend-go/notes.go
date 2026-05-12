package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func defaultTextFace() noteFaceManifest {
	face, _ := defaultFaceForKind("markdown", noteFaceManifest{ID: "text"})
	return face
}

func defaultHTMLFace(settings map[string]any) noteFaceManifest {
	face, _ := defaultFaceForKind("html", noteFaceManifest{ID: "html", Settings: settings})
	return face
}

func normalizeManifest(input noteManifest) noteManifest {
	now := nowMs()
	faces := map[string]noteFaceManifest{}
	for id, face := range input.Faces {
		face.ID = nonEmpty(face.ID, id)
		if face.ID == "" || face.Kind == "" {
			continue
		}
		base, err := defaultFaceForKind(face.Kind, face)
		if err == nil {
			faces[base.ID] = base
		}
	}
	if _, ok := faces["text"]; !ok {
		faces["text"] = defaultTextFace()
	}
	primary := input.PrimaryFaceID
	if _, ok := faces[primary]; !ok {
		primary = "text"
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
	push(primary)
	for _, id := range input.FaceOrder {
		push(id)
	}
	for id := range faces {
		push(id)
	}
	created := input.CreatedAtMs
	if created <= 0 {
		created = now
	}
	updated := input.UpdatedAtMs
	if updated <= 0 {
		updated = created
	}
	return noteManifest{SchemaVersion: 2, ID: strings.TrimSpace(input.ID), Title: nonEmpty(input.Title, "未命名"), Description: strings.TrimSpace(input.Description), Tags: uniqueStrings(input.Tags), CreatedAtMs: created, UpdatedAtMs: updated, PrimaryFaceID: primary, FaceOrder: order, Faces: faces, Resources: normalizeResourceRefs(input.Resources)}
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
	title := nonEmpty(asString(input["title"]), "未命名")
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
		faces = map[string]noteFaceManifest{"text": defaultTextFace()}
	}
	created := asFloat(input["createdAtMs"])
	if created <= 0 {
		created = existing.CreatedAtMs
	}
	if created <= 0 {
		created = nowMs()
	}
	updated := nowMs()
	resources := existing.Resources
	if _, ok := input["resources"]; ok {
		resources = normalizeResources(input["resources"])
	}
	if resources == nil {
		resources = existing.Resources
	}
	manifest := normalizeManifest(noteManifest{ID: id, Title: title, Description: description, Tags: tagsOrExisting(input["tags"], existing.Tags), CreatedAtMs: created, UpdatedAtMs: updated, PrimaryFaceID: nonEmpty(existing.PrimaryFaceID, "text"), FaceOrder: existing.FaceOrder, Faces: faces, Resources: resources})

	if input["saveTextFace"] == true {
		textFace := manifest.Faces["text"]
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
	_ = svc.updateRefsForNote(scope, id, body)
	doc := noteDoc{ID: id, PackageDir: desiredDir, Title: title, Description: description, Body: body, Tags: manifest.Tags, CreatedAtMs: created, UpdatedAtMs: updated, SchemaVersion: 2, Resources: manifest.Resources, DisplayHTML: renderMarkdownLite(body)}
	return map[string]any{"meta": meta, "doc": doc}, nil
}

func (svc *service) loadNotePackage(scope string, packageDir string) (noteDoc, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return noteDoc{}, err
	}
	textFace := manifest.Faces["text"]
	if textFace.File == "" {
		textFace = defaultTextFace()
	}
	body := ""
	if raw, err := svc.readText(scope, filepath.ToSlash(filepath.Join(packageDir, textFace.File))); err == nil {
		body = raw
	}
	return noteDoc{ID: manifest.ID, PackageDir: packageDir, Title: manifest.Title, Description: manifest.Description, Body: body, Tags: manifest.Tags, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, SchemaVersion: manifest.SchemaVersion, Resources: manifest.Resources, DisplayHTML: renderMarkdownLite(body)}, nil
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
	} else if face.Kind == "html" {
		if adapter, err := requireFaceAdapter(face.Kind); err == nil {
			content = adapter.EmptyContent(manifest)
		}
	}
	return noteFaceDocFromManifest(manifest, packageDir, face, content, exists), nil
}

func (svc *service) loadHTMLFace(scope string, packageDir string) (htmlFaceDoc, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return htmlFaceDoc{}, err
	}
	face, ok := manifest.Faces["html"]
	if !ok {
		return htmlFaceFromParts(manifest, packageDir, emptyHTMLDoc(manifest.ID, manifest.Title), false, nil), nil
	}
	content := ""
	exists := false
	if raw, err := svc.readText(scope, filepath.ToSlash(filepath.Join(packageDir, face.File))); err == nil {
		content = raw
		exists = true
	} else {
		content = emptyHTMLDoc(manifest.ID, manifest.Title)
	}
	return htmlFaceFromParts(manifest, packageDir, content, exists, fixedScaleFromSettings(face.Settings)), nil
}

func (svc *service) saveHTMLFace(scope string, raw json.RawMessage) (any, error) {
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	input["faceId"] = "html"
	input["kind"] = "html"
	input["content"] = asString(input["html"])
	nextRaw, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	result, err := svc.saveNoteFace(scope, nextRaw)
	if err != nil {
		return nil, err
	}
	resultMap, ok := result.(map[string]any)
	if !ok {
		return nil, errors.New("保存 HTML 面返回值无效")
	}
	meta, ok := resultMap["meta"].(noteMeta)
	if !ok {
		return nil, errors.New("保存 HTML 面缺少 meta")
	}
	faceDoc, ok := resultMap["faceDoc"].(noteFaceDoc)
	if !ok {
		return nil, errors.New("保存 HTML 面缺少 faceDoc")
	}
	return map[string]any{"meta": meta, "htmlFace": htmlFaceDocFromFaceDoc(faceDoc)}, nil
}

func (svc *service) deleteHTMLFace(scope string, packageDir string) (htmlFaceDoc, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return htmlFaceDoc{}, err
	}
	if face, ok := manifest.Faces["html"]; ok {
		manifest, err = svc.deleteNoteFace(scope, packageDir, face.ID)
		if err != nil {
			return htmlFaceDoc{}, err
		}
	}
	return htmlFaceFromParts(manifest, packageDir, emptyHTMLDoc(manifest.ID, manifest.Title), false, nil), nil
}

func (svc *service) saveHTMLFaceFixedScale(scope string, packageDir string, raw json.RawMessage) error {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return err
	}
	face, ok := manifest.Faces["html"]
	if !ok {
		return nil
	}
	if face.Settings == nil {
		face.Settings = map[string]any{}
	}
	if len(raw) == 0 || string(raw) == "null" {
		delete(face.Settings, "fixedScale")
	} else {
		var scale float64
		if err := json.Unmarshal(raw, &scale); err != nil {
			return err
		}
		if scale >= 0.25 && scale <= 2 {
			face.Settings["fixedScale"] = scale
		}
	}
	manifest.Faces["html"] = face
	return svc.writeJSON(scope, filepath.ToSlash(filepath.Join(packageDir, manifestFile)), normalizeManifest(manifest))
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

func htmlFaceFromParts(manifest noteManifest, packageDir string, content string, exists bool, fixedScale *float64) htmlFaceDoc {
	return htmlFaceDoc{ID: manifest.ID, PackageDir: packageDir, Title: manifest.Title, Description: manifest.Description, HTML: content, Exists: exists, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, SchemaVersion: manifest.SchemaVersion, FixedScale: fixedScale}
}

func htmlFaceDocFromFaceDoc(doc noteFaceDoc) htmlFaceDoc {
	return htmlFaceDoc{ID: doc.NoteID, PackageDir: doc.PackageDir, Title: doc.NoteTitle, Description: doc.NoteDescription, HTML: doc.Content, Exists: doc.Exists, CreatedAtMs: doc.CreatedAtMs, UpdatedAtMs: doc.UpdatedAtMs, SchemaVersion: doc.SchemaVersion, FixedScale: fixedScaleFromSettings(doc.Face.Settings)}
}

func emptyHTMLDoc(id string, title string) string {
	return "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <meta name=\"hypercortex-note-id\" content=\"" + htmlEscape(strings.TrimSpace(id)) + "\" />\n    <meta name=\"hypercortex-note-schema-version\" content=\"2\" />\n    <title>" + htmlEscape(nonEmpty(title, "未命名")) + "</title>\n  </head>\n  <body>\n    <div id=\"hypercortex-content\"></div>\n  </body>\n</html>"
}

func fixedScaleFromSettings(settings map[string]any) *float64 {
	if settings == nil {
		return nil
	}
	value := asFloat(settings["fixedScale"])
	if value < 0.25 || value > 2 {
		return nil
	}
	return &value
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
