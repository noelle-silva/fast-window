package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const noteVersionIndexVersion = 1

type noteVersionSummary struct {
	VersionID   string   `json:"versionId"`
	CommitName  string   `json:"commitName"`
	CreatedAtMs float64  `json:"createdAtMs"`
	ContentHash string   `json:"contentHash"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	FaceIDs     []string `json:"faceIds"`
}

type noteVersionIndex struct {
	Version  int                  `json:"version"`
	NoteID   string               `json:"noteId"`
	Versions []noteVersionSummary `json:"versions"`
}

type noteVersionFaceSnapshot struct {
	Manifest noteFaceManifest `json:"manifest"`
	Content  string           `json:"content"`
}

type noteVersionSnapshot struct {
	SchemaVersion int                                `json:"schemaVersion"`
	VersionID     string                             `json:"versionId"`
	NoteID        string                             `json:"noteId"`
	PackageDir    string                             `json:"packageDir"`
	CommitName    string                             `json:"commitName"`
	CreatedAtMs   float64                            `json:"createdAtMs"`
	ContentHash   string                             `json:"contentHash"`
	Manifest      noteManifest                       `json:"manifest"`
	Faces         map[string]noteVersionFaceSnapshot `json:"faces"`
}

func noteVersionsRel(packageDir string, parts ...string) string {
	items := append([]string{packageDir, versionsDirName}, parts...)
	return filepath.ToSlash(filepath.Join(items...))
}

func cleanNoteVersionID(input string) (string, error) {
	id := strings.TrimSpace(input)
	if id == "" {
		return "", errors.New("版本 ID 为空")
	}
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return "", errors.New("版本 ID 包含非法字符")
	}
	return id, nil
}

func faceIDsForVersion(manifest noteManifest) []string {
	out := []string{}
	seen := map[string]bool{}
	push := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		if _, ok := manifest.Faces[id]; !ok {
			return
		}
		seen[id] = true
		out = append(out, id)
	}
	for _, id := range manifest.FaceOrder {
		push(id)
	}
	keys := make([]string, 0, len(manifest.Faces))
	for id := range manifest.Faces {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		push(id)
	}
	return out
}

func normalizeNoteVersionIndex(idx noteVersionIndex, noteID string) (noteVersionIndex, error) {
	if idx.Version != noteVersionIndexVersion {
		return noteVersionIndex{}, errors.New("笔记版本索引版本无效")
	}
	idx.NoteID = strings.TrimSpace(idx.NoteID)
	if idx.NoteID == "" {
		idx.NoteID = noteID
	}
	if idx.NoteID != noteID {
		return noteVersionIndex{}, errors.New("笔记版本索引归属不匹配")
	}
	seen := map[string]bool{}
	out := []noteVersionSummary{}
	for _, item := range idx.Versions {
		versionID, err := cleanNoteVersionID(item.VersionID)
		if err != nil {
			return noteVersionIndex{}, err
		}
		if seen[versionID] {
			return noteVersionIndex{}, errors.New("笔记版本索引存在重复版本")
		}
		seen[versionID] = true
		item.VersionID = versionID
		item.CommitName = strings.TrimSpace(item.CommitName)
		item.ContentHash = strings.TrimSpace(item.ContentHash)
		item.Title = nonEmpty(item.Title, "未命名")
		item.Description = strings.TrimSpace(item.Description)
		item.FaceIDs = uniqueStrings(item.FaceIDs)
		if item.CommitName == "" || item.ContentHash == "" || item.CreatedAtMs <= 0 {
			return noteVersionIndex{}, errors.New("笔记版本索引条目无效")
		}
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAtMs > out[j].CreatedAtMs })
	return noteVersionIndex{Version: noteVersionIndexVersion, NoteID: noteID, Versions: out}, nil
}

func (svc *service) loadNoteVersionIndex(scope string, packageDir string, noteID string) (noteVersionIndex, error) {
	target, err := svc.resolvePath(scope, noteVersionsRel(packageDir, versionsIndexFile))
	if err != nil {
		return noteVersionIndex{}, err
	}
	var idx noteVersionIndex
	if err := readJSONFile(target, &idx); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return noteVersionIndex{Version: noteVersionIndexVersion, NoteID: noteID, Versions: []noteVersionSummary{}}, nil
		}
		return noteVersionIndex{}, err
	}
	return normalizeNoteVersionIndex(idx, noteID)
}

func (svc *service) saveNoteVersionIndex(scope string, packageDir string, idx noteVersionIndex) error {
	return svc.writeJSON(scope, noteVersionsRel(packageDir, versionsIndexFile), idx)
}

func collectNoteVersionFaces(svc *service, scope string, packageDir string, manifest noteManifest) (map[string]noteVersionFaceSnapshot, error) {
	faces := map[string]noteVersionFaceSnapshot{}
	for _, id := range faceIDsForVersion(manifest) {
		face := manifest.Faces[id]
		if strings.TrimSpace(face.File) == "" {
			return nil, fmt.Errorf("笔记面 %s 缺少文件路径", id)
		}
		content, err := svc.readText(scope, filepath.ToSlash(filepath.Join(packageDir, face.File)))
		if err != nil {
			return nil, fmt.Errorf("读取笔记面 %s 失败: %w", id, err)
		}
		adapter, err := requireFaceAdapter(face.Kind)
		if err != nil {
			return nil, err
		}
		faces[id] = noteVersionFaceSnapshot{Manifest: face, Content: adapter.NormalizeContent(content)}
	}
	return faces, nil
}

func noteVersionContentHash(manifest noteManifest, faces map[string]noteVersionFaceSnapshot) (string, error) {
	contentManifest := manifest
	contentManifest.CreatedAtMs = 0
	contentManifest.UpdatedAtMs = 0
	payload := struct {
		Manifest noteManifest                       `json:"manifest"`
		Faces    map[string]noteVersionFaceSnapshot `json:"faces"`
	}{Manifest: contentManifest, Faces: faces}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func (svc *service) publishNoteVersion(scope string, packageDir string, commitName string) (noteVersionSummary, error) {
	commitName = strings.TrimSpace(commitName)
	if commitName == "" {
		return noteVersionSummary{}, errors.New("提交名不能为空")
	}
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return noteVersionSummary{}, err
	}
	faces, err := collectNoteVersionFaces(svc, scope, packageDir, manifest)
	if err != nil {
		return noteVersionSummary{}, err
	}
	contentHash, err := noteVersionContentHash(manifest, faces)
	if err != nil {
		return noteVersionSummary{}, err
	}
	idx, err := svc.loadNoteVersionIndex(scope, packageDir, manifest.ID)
	if err != nil {
		return noteVersionSummary{}, err
	}
	if len(idx.Versions) > 0 && idx.Versions[0].ContentHash == contentHash {
		return noteVersionSummary{}, errors.New("当前内容与最新发布版本一致，无需重复发布")
	}
	now := time.Now().UTC()
	createdAtMs := float64(now.UnixMilli())
	shortHash := contentHash
	if len(shortHash) > 8 {
		shortHash = shortHash[:8]
	}
	versionID := fmt.Sprintf("v_%s_%s", now.Format("20060102_150405_000"), shortHash)
	summary := noteVersionSummary{VersionID: versionID, CommitName: commitName, CreatedAtMs: createdAtMs, ContentHash: contentHash, Title: manifest.Title, Description: manifest.Description, FaceIDs: faceIDsForVersion(manifest)}
	snapshot := noteVersionSnapshot{SchemaVersion: noteVersionIndexVersion, VersionID: versionID, NoteID: manifest.ID, PackageDir: packageDir, CommitName: commitName, CreatedAtMs: createdAtMs, ContentHash: contentHash, Manifest: manifest, Faces: faces}
	if err := svc.writeJSON(scope, noteVersionsRel(packageDir, versionID, versionSnapshotFile), snapshot); err != nil {
		return noteVersionSummary{}, err
	}
	idx.Versions = append([]noteVersionSummary{summary}, idx.Versions...)
	idx, err = normalizeNoteVersionIndex(idx, manifest.ID)
	if err != nil {
		return noteVersionSummary{}, err
	}
	if err := svc.saveNoteVersionIndex(scope, packageDir, idx); err != nil {
		return noteVersionSummary{}, err
	}
	return summary, nil
}

func (svc *service) listNoteVersions(scope string, packageDir string) ([]noteVersionSummary, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return nil, err
	}
	idx, err := svc.loadNoteVersionIndex(scope, packageDir, manifest.ID)
	if err != nil {
		return nil, err
	}
	return idx.Versions, nil
}

func (svc *service) loadNoteVersion(scope string, packageDir string, versionID string) (noteVersionSnapshot, error) {
	versionID, err := cleanNoteVersionID(versionID)
	if err != nil {
		return noteVersionSnapshot{}, err
	}
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return noteVersionSnapshot{}, err
	}
	target, err := svc.resolvePath(scope, noteVersionsRel(packageDir, versionID, versionSnapshotFile))
	if err != nil {
		return noteVersionSnapshot{}, err
	}
	var snapshot noteVersionSnapshot
	if err := readJSONFile(target, &snapshot); err != nil {
		return noteVersionSnapshot{}, err
	}
	if snapshot.SchemaVersion != noteVersionIndexVersion || snapshot.VersionID != versionID || snapshot.NoteID != manifest.ID {
		return noteVersionSnapshot{}, errors.New("笔记版本快照无效")
	}
	snapshot.Manifest = normalizeManifest(snapshot.Manifest)
	if snapshot.Manifest.ID != manifest.ID {
		return noteVersionSnapshot{}, errors.New("笔记版本快照归属不匹配")
	}
	contentHash, err := noteVersionContentHash(snapshot.Manifest, snapshot.Faces)
	if err != nil {
		return noteVersionSnapshot{}, err
	}
	if contentHash != strings.TrimSpace(snapshot.ContentHash) {
		return noteVersionSnapshot{}, errors.New("笔记版本快照内容校验失败")
	}
	return snapshot, nil
}

func (svc *service) deleteFaceContentIfPresent(scope string, packageDir string, face noteFaceManifest) error {
	if strings.TrimSpace(face.File) == "" {
		return nil
	}
	target, err := svc.resolvePath(scope, filepath.ToSlash(filepath.Join(packageDir, face.File)))
	if err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (svc *service) restoreNoteVersion(scope string, packageDir string, versionID string) (any, error) {
	current, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return nil, err
	}
	snapshot, err := svc.loadNoteVersion(scope, packageDir, versionID)
	if err != nil {
		return nil, err
	}
	manifest := normalizeManifest(snapshot.Manifest)
	manifest.CreatedAtMs = current.CreatedAtMs
	manifest.UpdatedAtMs = nowMs()
	for faceID, face := range manifest.Faces {
		saved, ok := snapshot.Faces[faceID]
		if !ok {
			return nil, fmt.Errorf("版本快照缺少笔记面 %s", faceID)
		}
		adapter, err := requireFaceAdapter(face.Kind)
		if err != nil {
			return nil, err
		}
		if err := svc.writeText(scope, filepath.ToSlash(filepath.Join(packageDir, face.File)), adapter.NormalizeContent(saved.Content), true); err != nil {
			return nil, err
		}
	}
	for faceID, face := range current.Faces {
		if _, ok := manifest.Faces[faceID]; ok {
			continue
		}
		if err := svc.deleteFaceContentIfPresent(scope, packageDir, face); err != nil {
			return nil, err
		}
	}
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(packageDir, manifestFile)), manifest); err != nil {
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: packageDir, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	textContent := ""
	if textFace, ok := manifest.Faces["text"]; ok {
		if saved, ok := snapshot.Faces[textFace.ID]; ok {
			textContent = saved.Content
		}
	}
	if err := svc.updateRefsForNote(scope, manifest.ID, textContent); err != nil {
		return nil, err
	}
	doc, err := svc.loadNotePackage(scope, packageDir)
	if err != nil {
		return nil, err
	}
	return map[string]any{"meta": meta, "doc": doc, "manifest": manifest}, nil
}
