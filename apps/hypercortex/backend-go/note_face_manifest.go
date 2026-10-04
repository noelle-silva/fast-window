package main

import (
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

func noteFaceDocFromManifest(manifest noteManifest, packageDir string, face noteFaceManifest, content string, exists bool) noteFaceDoc {
	return noteFaceDoc{ID: face.ID, PackageDir: packageDir, NoteID: manifest.ID, NoteTitle: manifest.Title, NoteDescription: manifest.Description, Face: face, Content: content, Exists: exists, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, SchemaVersion: manifest.SchemaVersion}
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
