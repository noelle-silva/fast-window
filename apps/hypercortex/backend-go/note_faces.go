package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type noteFaceAdapter struct {
	Kind              string
	Label             string
	DefaultFaceID     string
	DefaultFileName   string
	DefaultRole       string
	Capabilities      faceCapabilities
	NormalizeContent  func(string) string
	EmptyContent      func(noteManifest) string
	NormalizeSettings func(map[string]any) map[string]any
}

var noteFaceAdapters = map[string]noteFaceAdapter{
	"markdown": {
		Kind:              "markdown",
		Label:             "文本",
		DefaultFaceID:     "text",
		DefaultFileName:   "text.md",
		DefaultRole:       "primary",
		Capabilities:      faceCapabilities{Editable: true, Searchable: true, Previewable: true, Linkable: true, Creatable: true, Deletable: false},
		NormalizeContent:  normalizeTextFaceContent,
		EmptyContent:      func(noteManifest) string { return "" },
		NormalizeSettings: normalizePlainSettings,
	},
	"html": {
		Kind:              "html",
		Label:             "HTML",
		DefaultFaceID:     "html",
		DefaultFileName:   "html-view.html",
		DefaultRole:       "alternate",
		Capabilities:      faceCapabilities{Editable: true, Searchable: false, Previewable: true, Linkable: false, Creatable: true, Deletable: true},
		NormalizeContent:  normalizeTextFaceContent,
		EmptyContent:      func(manifest noteManifest) string { return emptyHTMLDoc(manifest.ID, manifest.Title) },
		NormalizeSettings: normalizeHTMLSettings,
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
		Role:         normalizeFaceRole(nonEmpty(input.Role, adapter.DefaultRole), adapter.DefaultRole),
		Settings:     adapter.NormalizeSettings(settings),
		Capabilities: adapter.Capabilities,
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
	existingFace := existing.Faces[faceID]
	settings := mapFromAny(input["settings"])
	if settings == nil {
		settings = existingFace.Settings
	}
	face, err := defaultFaceForKind(adapter.Kind, noteFaceManifest{ID: faceID, Title: existingFace.Title, File: existingFace.File, Role: existingFace.Role, Settings: settings})
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
	resources := existing.Resources
	if _, ok := input["resources"]; ok {
		resources = normalizeResources(input["resources"])
	}
	if resources == nil {
		resources = existing.Resources
	}
	faces := existing.Faces
	if faces == nil {
		faces = map[string]noteFaceManifest{"text": defaultTextFace()}
	}
	faces[face.ID] = face
	manifest := normalizeManifest(noteManifest{ID: id, Title: title, Description: strings.TrimSpace(asString(firstNonNil(input["description"], existing.Description))), Tags: tagsOrExisting(input["tags"], existing.Tags), CreatedAtMs: created, UpdatedAtMs: updated, PrimaryFaceID: nonEmpty(existing.PrimaryFaceID, "text"), FaceOrder: existing.FaceOrder, Faces: faces, Resources: resources})
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
	if face.Kind == "markdown" {
		_ = svc.updateRefsForNote(scope, manifest.ID, content)
	}
	return map[string]any{"meta": meta, "faceDoc": noteFaceDocFromManifest(manifest, desiredDir, manifest.Faces[face.ID], content, true), "manifest": manifest}, nil
}

func (svc *service) deleteNoteFace(scope string, packageDir string, faceID string) (noteManifest, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return noteManifest{}, err
	}
	id := strings.TrimSpace(faceID)
	face, ok := manifest.Faces[id]
	if !ok {
		return manifest, nil
	}
	if !face.Capabilities.Deletable {
		return noteManifest{}, errors.New("该笔记面不可删除")
	}
	_ = svc.deleteFile(scope, filepath.ToSlash(filepath.Join(packageDir, face.File)))
	delete(manifest.Faces, id)
	manifest.FaceOrder = removeString(manifest.FaceOrder, id)
	if manifest.PrimaryFaceID == id {
		manifest.PrimaryFaceID = "text"
	}
	manifest.UpdatedAtMs = nowMs()
	manifest = normalizeManifest(manifest)
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(packageDir, manifestFile)), manifest); err != nil {
		return noteManifest{}, err
	}
	return manifest, nil
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
	scale := asFloat(value["fixedScale"])
	if scale < 0.25 || scale > 2 {
		return map[string]any{}
	}
	return map[string]any{"fixedScale": scale}
}

func normalizeFaceRole(role string, fallback string) string {
	switch strings.TrimSpace(role) {
	case "primary", "alternate", "derived", "attachment":
		return strings.TrimSpace(role)
	default:
		return fallback
	}
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
