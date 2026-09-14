package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 面回收站：删除的面以「原面清单 + 内容文件」的完整快照暂存在 Trash/faces 下，
// 与笔记、附件回收站同级同语义（可恢复、可永久删除、受自动清理约束）。
const trashFacesDirName = "faces"

func faceTrashEntryRel(noteID string, faceID string) string {
	now := time.Now()
	return filepath.ToSlash(filepath.Join(
		trashDir,
		trashFacesDirName,
		now.Format("2006-01"),
		sanitizeTrashEntryName(noteID)+"_"+sanitizeTrashEntryName(faceID)+"_"+now.Format("150405.000"),
	))
}

func sanitizeTrashEntryName(value string) string {
	out := make([]rune, 0, len(value))
	for _, r := range strings.TrimSpace(value) {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			out = append(out, r)
			continue
		}
		out = append(out, '_')
	}
	if len(out) == 0 {
		return "face"
	}
	return string(out)
}

// moveNoteFaceToTrash 把面内容文件与其清单快照移入回收站。
// 任一步失败时回滚已移动的内容文件，保持原状。
func (svc *service) moveNoteFaceToTrash(scope string, packageDir string, manifest noteManifest, faceID string) error {
	face, ok := manifest.Faces[faceID]
	if !ok {
		return errors.New("笔记面不存在")
	}
	order := 0
	for index, id := range manifest.FaceOrder {
		if id == faceID {
			order = index
			break
		}
	}
	entryRel := faceTrashEntryRel(manifest.ID, faceID)
	entryDir, err := svc.resolvePath(scope, entryRel)
	if err != nil {
		return err
	}
	if exists(entryDir) {
		return errors.New("目标回收站路径已存在")
	}
	if err := os.MkdirAll(entryDir, 0o755); err != nil {
		return err
	}

	fileName := strings.TrimSpace(face.File)
	from := ""
	to := ""
	moved := false
	if fileName != "" {
		from, err = svc.resolvePath(scope, filepath.ToSlash(filepath.Join(packageDir, fileName)))
		if err != nil {
			_ = os.RemoveAll(entryDir)
			return err
		}
		to = filepath.Join(entryDir, fileName)
		if exists(from) {
			if err := os.Rename(from, to); err != nil {
				_ = os.RemoveAll(entryDir)
				return err
			}
			moved = true
		}
	}

	meta := trashMeta{
		Version:     1,
		Kind:        "face",
		DeletedAtMs: nowMs(),
		OriginalDir: filepath.ToSlash(packageDir),
		Face: &trashFaceMeta{
			NoteID:    manifest.ID,
			NoteTitle: manifest.Title,
			FaceID:    faceID,
			Order:     order,
			Face:      face,
		},
	}
	if err := writeJSONFile(filepath.Join(entryDir, trashMetaFile), meta); err != nil {
		if moved {
			_ = os.Rename(to, from)
		}
		_ = os.RemoveAll(entryDir)
		return err
	}
	return nil
}

func (svc *service) listFaceTrash(scope string, trashRoot string) ([]trashItem, error) {
	faceTrashRoot := filepath.Join(trashRoot, trashFacesDirName)
	months, _ := os.ReadDir(faceTrashRoot)
	out := []trashItem{}
	for _, month := range months {
		if !month.IsDir() {
			continue
		}
		entries, _ := os.ReadDir(filepath.Join(faceTrashRoot, month.Name()))
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			dir := filepath.Join(faceTrashRoot, month.Name(), entry.Name())
			meta := trashMeta{}
			if err := readJSONFile(filepath.Join(dir, trashMetaFile), &meta); err != nil || meta.Kind != "face" || meta.Face == nil {
				continue
			}
			faceMeta := meta.Face
			info, _ := entry.Info()
			deletedAt := meta.DeletedAtMs
			if deletedAt <= 0 && info != nil {
				deletedAt = float64(info.ModTime().UnixMilli())
			}
			faceID := strings.TrimSpace(faceMeta.FaceID)
			faceTitle := nonEmpty(faceMeta.Face.Title, nonEmpty(faceMeta.Face.Kind, faceID))
			out = append(out, trashItem{
				Kind:        "face",
				ID:          strings.TrimSpace(faceMeta.NoteID) + ":" + faceID,
				Title:       nonEmpty(faceMeta.NoteTitle, "未命名") + " · " + faceTitle,
				Dir:         filepath.ToSlash(filepath.Join(trashDir, trashFacesDirName, month.Name(), entry.Name())),
				NoteID:      strings.TrimSpace(faceMeta.NoteID),
				FaceID:      faceID,
				CreatedAtMs: faceMeta.Face.CreatedAtMs,
				UpdatedAtMs: faceMeta.Face.UpdatedAtMs,
				DeletedAtMs: deletedAt,
				OriginalDir: filepath.ToSlash(meta.OriginalDir),
			})
		}
	}
	return out, nil
}

// restoreFaceTrashItem 把回收站中的面放回其所属笔记（按删除前的先后位置），
// 并随统一刷新点重建该笔记的引用与搜索派生数据。
func (svc *service) restoreFaceTrashItem(scope string, item trashItem) (any, error) {
	fromDir, err := svc.resolvePath(scope, item.Dir)
	if err != nil {
		return nil, err
	}
	trash := trashMeta{}
	if err := readJSONFile(filepath.Join(fromDir, trashMetaFile), &trash); err != nil {
		return nil, err
	}
	if trash.Kind != "face" || trash.Face == nil {
		return nil, errors.New("回收站条目不是笔记面")
	}
	faceMeta := trash.Face
	noteID := nonEmpty(faceMeta.NoteID, item.NoteID)
	if noteID == "" {
		return nil, errors.New("回收站条目的面缺少所属笔记")
	}
	idx, err := svc.loadNoteIndex(scope)
	if err != nil {
		return nil, err
	}
	note, ok := idx.Notes[noteID]
	if !ok || strings.TrimSpace(note.Dir) == "" {
		return nil, errors.New("所属笔记不存在，无法恢复该面")
	}
	manifest, err := svc.loadNoteManifest(scope, note.Dir)
	if err != nil {
		return nil, err
	}
	faceID := nonEmpty(faceMeta.FaceID, item.FaceID)
	if faceID == "" {
		return nil, errors.New("回收站条目的面 ID 无效")
	}
	if _, ok := manifest.Faces[faceID]; ok {
		return nil, errors.New("笔记中已存在同 ID 的面")
	}
	face := normalizeFaceManifest(faceMeta.Face)
	face.ID = nonEmpty(face.ID, faceID)
	if face.ID != faceID {
		return nil, errors.New("回收站条目的面身份不匹配")
	}
	fileName := strings.TrimSpace(face.File)

	from := ""
	to := ""
	moved := false
	if fileName != "" {
		from = filepath.Join(fromDir, fileName)
		if exists(from) {
			to, err = svc.resolvePath(scope, filepath.ToSlash(filepath.Join(note.Dir, fileName)))
			if err != nil {
				return nil, err
			}
			if exists(to) {
				return nil, errors.New("恢复目标已存在")
			}
			if err := ensureParent(to); err != nil {
				return nil, err
			}
			if err := os.Rename(from, to); err != nil {
				return nil, err
			}
			moved = true
		}
	}

	updated := nowMs()
	face.UpdatedAtMs = updated
	manifest.Faces[faceID] = face
	order := faceMeta.Order
	if order < 0 {
		order = 0
	}
	if order > len(manifest.FaceOrder) {
		order = len(manifest.FaceOrder)
	}
	nextOrder := make([]string, 0, len(manifest.FaceOrder)+1)
	nextOrder = append(nextOrder, manifest.FaceOrder[:order]...)
	nextOrder = append(nextOrder, faceID)
	nextOrder = append(nextOrder, manifest.FaceOrder[order:]...)
	manifest.FaceOrder = nextOrder
	manifest.UpdatedAtMs = updated
	manifest = normalizeManifest(manifest)
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(note.Dir, manifestFile)), manifest); err != nil {
		if moved {
			_ = os.Rename(to, from)
		}
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: note.Dir, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	if _, err := svc.refreshDerivedIndexesForNote(scope, note.Dir, manifest); err != nil {
		return nil, err
	}
	if err := os.RemoveAll(fromDir); err != nil {
		return nil, err
	}
	return map[string]any{"meta": meta}, nil
}
