package main

import (
	"encoding/json"
	"errors"
	"fmt"
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
	currentDir := strings.TrimSpace(asString(input["packageDir"]))
	desiredDir, err := notePackageDirForID(id)
	if err != nil {
		return nil, err
	}

	// 归属守卫（先于目录改名）：提交目录内已有笔记时其身份必须与提交 id 一致，清单损坏同样快速失败。
	if currentDir != "" {
		current, err := svc.loadNoteManifest(scope, currentDir)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("读取笔记清单失败：%w", err)
		}
		if current.ID != "" && current.ID != id {
			return nil, fmt.Errorf("笔记目录归属不匹配：%s 属于笔记 %s", currentDir, current.ID)
		}
	}
	if currentDir != "" && filepath.ToSlash(currentDir) != desiredDir {
		if err := svc.renamePackageIfNeeded(scope, currentDir, desiredDir); err != nil {
			return nil, err
		}
	}

	existing, err := svc.loadNoteManifest(scope, desiredDir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("读取笔记清单失败：%w", err)
	}
	if existing.ID != "" && existing.ID != id {
		return nil, fmt.Errorf("笔记目录归属不匹配：%s 属于笔记 %s", desiredDir, existing.ID)
	}
	// 目录改名已发生：立即同步笔记索引目录，缩短「磁盘已改名、索引未更新」的窗口。
	if existing.ID != "" && currentDir != "" && filepath.ToSlash(currentDir) != desiredDir {
		meta := noteMeta{ID: existing.ID, Title: existing.Title, Description: existing.Description, Dir: desiredDir, CreatedAtMs: existing.CreatedAtMs, UpdatedAtMs: existing.UpdatedAtMs}
		if err := svc.upsertNoteMeta(scope, meta); err != nil {
			// 索引更新失败：回滚目录改名，保持索引与磁盘一致。
			_ = svc.renamePackageIfNeeded(scope, desiredDir, currentDir)
			return nil, fmt.Errorf("更新笔记索引失败：%w", err)
		}
	}
	// 面身份守卫：已存在的面不允许改变类型（在产生磁盘副作用之前快速失败）。
	for _, item := range resolved {
		if existingFace, ok := existing.Faces[item.faceID]; ok && strings.TrimSpace(existingFace.Kind) != "" && existingFace.Kind != item.adapter.Kind {
			return nil, fmt.Errorf("面 %s 的类型不匹配：现有 %s，提交 %s", item.faceID, existingFace.Kind, item.adapter.Kind)
		}
	}
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
	// 字段保留语义：缺失则沿用旧值，显式提供（含空串）则采用提交值。
	description := existing.Description
	if raw, ok := input["description"]; ok {
		description = strings.TrimSpace(asString(raw))
	}
	manifest := noteManifest{ID: id, Title: title, Description: description, Tags: tagsOrExisting(input["tags"], existing.Tags), CreatedAtMs: created, UpdatedAtMs: updated, FaceOrder: existing.FaceOrder, Faces: faces, Resources: nil}
	if err := svc.ensureFaceKinds(scope, desiredDir, &manifest, faceKindsFromAny(input["faceKinds"]), len(existing.FaceOrder) == 0, updated); err != nil {
		return nil, err
	}
	if rawTitle == "" && len(manifest.Faces) == 0 {
		return nil, errors.New("无面笔记至少需要一个标题")
	}
	// 资源清单：仅在提交值为合法列表时更新；缺失或类型非法一律保留旧值。
	resources := existing.Resources
	if raw, ok := input["resources"]; ok {
		if _, isList := raw.([]any); isList {
			resources = normalizeResources(raw)
		}
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
	if err := validateUniqueFaceFiles(manifest); err != nil {
		return nil, err
	}

	// 面内容写入为事务：任一失败恢复全部已写文件，清单写入失败同样回滚，不留半更新状态。
	fileWrites := make([]faceFileWrite, 0, len(writes))
	for _, write := range writes {
		fileWrites = append(fileWrites, faceFileWrite{RelPath: filepath.ToSlash(filepath.Join(desiredDir, write.face.File)), Content: write.content})
	}
	tx, err := svc.writeFaceFiles(scope, fileWrites)
	if err != nil {
		return nil, err
	}
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(desiredDir, manifestFile)), manifest); err != nil {
		tx.rollback()
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

// validateUniqueFaceFiles 校验笔记内所有面的落盘文件名唯一，防止两个面互写同一文件。
func validateUniqueFaceFiles(manifest noteManifest) error {
	seen := map[string]string{}
	for faceID, face := range manifest.Faces {
		file := strings.TrimSpace(face.File)
		if file == "" {
			continue
		}
		if owner, exists := seen[file]; exists && owner != faceID {
			return fmt.Errorf("面文件重名：%s 同时被面 %s 与 %s 使用", file, owner, faceID)
		}
		seen[file] = faceID
	}
	return nil
}

// faceFileWrite 描述一次面内容文件的写入意图。
type faceFileWrite struct {
	RelPath string
	Content string
}

// faceFileBackup 记录面文件在事务开始前的原状，用于失败回滚。
type faceFileBackup struct {
	relPath  string
	existed  bool
	original []byte
}

// faceFileTransaction 面内容文件写入事务：写入/删除前记录原状，
// 任一环节失败可整体回滚，避免磁盘上出现「部分面已更新」的中间状态。
type faceFileTransaction struct {
	svc     *service
	scope   string
	backups []faceFileBackup
}

// writeFaceFiles 开启事务并依次写入面内容文件；中途失败时自动回滚已写文件。
func (svc *service) writeFaceFiles(scope string, writes []faceFileWrite) (*faceFileTransaction, error) {
	tx := &faceFileTransaction{svc: svc, scope: scope}
	for _, write := range writes {
		target, err := svc.resolvePath(scope, write.RelPath)
		if err != nil {
			tx.rollback()
			return nil, err
		}
		if err := tx.backup(write.RelPath, target); err != nil {
			tx.rollback()
			return nil, err
		}
		if err := writeFileAtomic(target, []byte(write.Content)); err != nil {
			tx.rollback()
			return nil, err
		}
	}
	return tx, nil
}

// remove 在事务内删除面文件；失败可随事务整体回滚。
func (tx *faceFileTransaction) remove(relPath string) error {
	if strings.TrimSpace(relPath) == "" {
		return nil
	}
	target, err := tx.svc.resolvePath(tx.scope, relPath)
	if err != nil {
		return err
	}
	if err := tx.backup(relPath, target); err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (tx *faceFileTransaction) backup(relPath string, target string) error {
	original, err := os.ReadFile(target)
	switch {
	case err == nil:
		tx.backups = append(tx.backups, faceFileBackup{relPath: relPath, existed: true, original: original})
		return nil
	case errors.Is(err, os.ErrNotExist):
		tx.backups = append(tx.backups, faceFileBackup{relPath: relPath, existed: false})
		return nil
	default:
		return err
	}
}

// rollback 把所有已写/已删文件恢复到事务开始前的状态。
func (tx *faceFileTransaction) rollback() {
	for _, item := range tx.backups {
		target, err := tx.svc.resolvePath(tx.scope, item.relPath)
		if err != nil {
			continue
		}
		if item.existed {
			_ = writeFileAtomic(target, item.original)
			continue
		}
		_ = os.Remove(target)
	}
}
