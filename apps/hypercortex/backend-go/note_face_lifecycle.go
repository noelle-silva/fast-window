package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"fast-window-hypercortex-backend/faceplugin"
)

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
		if err := svc.deleteFile(scope, filepath.ToSlash(filepath.Join(packageDir, face.File))); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("删除面文件失败：%w", err)
		}
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

// ensureFaceKinds 确保 kinds 中每个类型的面都存在（缺失时补齐默认面并写入空内容文件）。
// resetOrder 为 true（新建笔记）时按 kinds 顺序建立 FaceOrder；
// 否则只把新补齐的面追加到既有 FaceOrder 末尾，不改动笔记级面顺序。
// 任何未知面类型都在产生磁盘副作用之前快速失败，绝不静默丢弃。
func (svc *service) ensureFaceKinds(scope string, packageDir string, manifest *noteManifest, kinds []string, resetOrder bool, now float64) error {
	if len(kinds) == 0 {
		return nil
	}
	if manifest.Faces == nil {
		manifest.Faces = map[string]noteFaceManifest{}
	}
	// 先解析全部面类型：未知类型在写任何文件之前快速失败。
	resolved := make([]faceplugin.Plugin, 0, len(kinds))
	for _, kind := range kinds {
		adapter, err := faceplugin.Require(kind)
		if err != nil {
			return coded(codeUnknownFaceKind, "未知笔记面类型：%s", kind)
		}
		resolved = append(resolved, adapter)
	}
	created := []string{}
	for _, adapter := range resolved {
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
		for _, adapter := range resolved {
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
