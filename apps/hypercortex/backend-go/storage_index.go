package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"fast-window-hypercortex-backend/faceplugin"
)

func (svc *service) loadNoteIndex(scope string) (noteIndex, error) {
	path, err := svc.resolvePath(scope, indexFile)
	if err != nil {
		return noteIndex{}, err
	}
	var idx noteIndex
	if err := readJSONFile(path, &idx); err == nil && idx.Version == 1 && idx.Notes != nil {
		return idx, nil
	}
	idx = noteIndex{Version: 1, Notes: map[string]noteMeta{}}
	return svc.rebuildNoteIndexInto(scope, idx)
}

func (svc *service) rebuildNoteIndex(scope string) (noteIndex, error) {
	return svc.rebuildNoteIndexInto(scope, noteIndex{Version: 1, Notes: map[string]noteMeta{}})
}

func (svc *service) rebuildNoteIndexInto(scope string, idx noteIndex) (noteIndex, error) {
	root, err := svc.resolvePath(scope, notesDir)
	if err != nil {
		return noteIndex{}, err
	}
	_ = os.MkdirAll(root, 0o755)
	notes := map[string]noteMeta{}
	months, _ := os.ReadDir(root)
	for _, month := range months {
		if !month.IsDir() {
			continue
		}
		monthDir := filepath.Join(root, month.Name())
		packages, _ := os.ReadDir(monthDir)
		for _, pkg := range packages {
			if !pkg.IsDir() {
				continue
			}
			rel := filepath.ToSlash(filepath.Join(notesDir, month.Name(), pkg.Name()))
			manifest, err := svc.loadNoteManifest(scope, rel)
			if err != nil || manifest.ID == "" {
				continue
			}
			info, _ := pkg.Info()
			modified := nowMs()
			if info != nil {
				modified = float64(info.ModTime().UnixMilli())
			}
			created := manifest.CreatedAtMs
			if created <= 0 {
				created = modified
			}
			updated := manifest.UpdatedAtMs
			if updated <= 0 {
				updated = modified
			}
			notes[manifest.ID] = noteMeta{ID: manifest.ID, Title: nonEmpty(manifest.Title, "未命名"), Description: manifest.Description, Dir: rel, CreatedAtMs: created, UpdatedAtMs: updated, Icon: manifest.Icon}
		}
	}
	idx.Notes = notes
	path, err := svc.resolvePath(scope, indexFile)
	if err != nil {
		return noteIndex{}, err
	}
	_ = writeJSONFile(path, idx)
	return idx, nil
}

func (svc *service) loadRefIndex(scope string) (noteRefIndex, error) {
	path, err := svc.resolvePath(scope, refsIndexFile)
	if err != nil {
		return nil, err
	}
	idx := noteRefIndex{}
	if err := readJSONFile(path, &idx); err != nil {
		return noteRefIndex{}, nil
	}
	return normalizeRefIndex(idx), nil
}

func normalizeRefIndex(idx noteRefIndex) noteRefIndex {
	out := noteRefIndex{}
	for noteID, faces := range idx {
		noteID = strings.TrimSpace(noteID)
		if noteID == "" {
			continue
		}
		for faceID, refs := range faces {
			faceID = strings.TrimSpace(faceID)
			unique := faceplugin.UniqueRefs(refs)
			if len(unique) == 0 {
				continue
			}
			if out[noteID] == nil {
				out[noteID] = map[string][]noteRef{}
			}
			out[noteID][faceID] = unique
		}
	}
	return out
}

func (svc *service) saveRefIndex(scope string, idx noteRefIndex) error {
	path, err := svc.resolvePath(scope, refsIndexFile)
	if err != nil {
		return err
	}
	return writeJSONFile(path, normalizeRefIndex(idx))
}

// collectRefsForNote 按面协议提取笔记全部面内容中的引用，返回 面→refs 映射
func (svc *service) collectRefsForNote(scope string, manifest noteManifest, packageDir string) map[string][]noteRef {
	out := map[string][]noteRef{}
	for _, faceID := range manifest.FaceOrder {
		faceManifest := manifest.Faces[faceID]
		adapter, ok := faceplugin.Get(faceManifest.Kind)
		if !ok || adapter.ExtractRefs == nil {
			continue
		}
		content, err := svc.readText(scope, filepath.ToSlash(filepath.Join(packageDir, faceManifest.File)))
		if err != nil {
			continue
		}
		refs := faceplugin.UniqueRefs(adapter.ExtractRefs(content))
		if len(refs) == 0 {
			continue
		}
		out[faceID] = refs
	}
	return out
}

// refreshDerivedIndexesForNote 笔记包（面内容/笔记级字段）变化时统一刷新该笔记的全部派生索引：
// 引用索引 + 搜索索引共用同一个触发点，避免两份索引各自更新而失步。
// 返回该笔记的面级引用，供调用方增量同步。
func (svc *service) refreshDerivedIndexesForNote(scope string, packageDir string, manifest noteManifest) (map[string][]noteRef, error) {
	refs := svc.collectRefsForNote(scope, manifest, packageDir)
	idx, err := svc.loadRefIndex(scope)
	if err != nil {
		return nil, err
	}
	if len(refs) > 0 {
		idx[manifest.ID] = refs
	} else {
		delete(idx, manifest.ID)
	}
	if err := svc.saveRefIndex(scope, idx); err != nil {
		return nil, err
	}
	if err := svc.updateSearchEntryForNote(scope, packageDir, manifest); err != nil {
		return nil, err
	}
	return refs, nil
}

func (svc *service) rebuildRefsIndex(scope string) error {
	root, err := svc.resolvePath(scope, notesDir)
	if err != nil {
		return err
	}
	idx := noteRefIndex{}
	months, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return svc.saveRefIndex(scope, idx)
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
			refs := svc.collectRefsForNote(scope, manifest, rel)
			if len(refs) == 0 {
				continue
			}
			idx[manifest.ID] = refs
		}
	}
	return svc.saveRefIndex(scope, idx)
}

func (svc *service) removeNoteRef(scope string, noteID string) error {
	idx, err := svc.loadRefIndex(scope)
	if err != nil {
		return err
	}
	delete(idx, strings.TrimSpace(noteID))
	return svc.saveRefIndex(scope, idx)
}

// removeNoteDerivedIndexes 删除笔记时同步清理引用索引与搜索索引条目
func (svc *service) removeNoteDerivedIndexes(scope string, noteID string) error {
	if err := svc.removeNoteRef(scope, noteID); err != nil {
		return err
	}
	return svc.removeSearchEntryForNote(scope, noteID)
}
