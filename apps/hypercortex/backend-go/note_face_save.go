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
// expectedVersion 为防覆盖保险丝：非零时必须与笔记当前版本一致才允许写入，不一致说明读取后
// 笔记已被其他修改更新，直接拒绝并回报当前版本；写入成功后结果显式携带新版本标记。
// 提交的面内容全部写盘成功后再写 manifest、更新笔记索引并刷新派生索引，
// 不使用多面逐次保存，避免出现“部分面已保存”的中间状态。
func (svc *service) saveNoteFaces(scope string, raw json.RawMessage, expectedVersion float64) (any, error) {
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	if expectedVersion > 0 {
		packageDir := strings.TrimSpace(asString(input["packageDir"]))
		manifest, err := svc.loadNoteManifest(scope, packageDir)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil, fmt.Errorf("笔记版本不匹配：期望版本 %.0f，但目标笔记不存在", expectedVersion)
			}
			return nil, err
		}
		if err := checkVersionConflict("笔记", expectedVersion, manifest.UpdatedAtMs); err != nil {
			return nil, err
		}
	}
	saved, err := svc.saveNoteFacesInput(scope, input)
	if err != nil {
		return nil, err
	}
	return attachSaveVersion(saved), nil
}

// saveNoteFacesInput 是保存逻辑的结构化入口：接受已解析的输入对象，供 RPC 入口与内部调用共用；
// 字段存在性语义（缺失沿用旧值、显式提供采用提交值）由调用方在输入对象中表达。
func (svc *service) saveNoteFacesInput(scope string, input map[string]any) (any, error) {
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
			return nil, coded(codeUnknownFaceKind, "未知笔记面类型：%s", item.Kind)
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
		meta := noteMeta{ID: existing.ID, Title: existing.Title, Description: existing.Description, Dir: desiredDir, CreatedAtMs: existing.CreatedAtMs, UpdatedAtMs: existing.UpdatedAtMs, Icon: existing.Icon}
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
	manifest := noteManifest{ID: id, Title: title, Description: description, Tags: tagsOrExisting(input["tags"], existing.Tags), CreatedAtMs: created, UpdatedAtMs: updated, FaceOrder: existing.FaceOrder, Faces: faces, Resources: nil, Icon: existing.Icon}
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
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: desiredDir, CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, Icon: manifest.Icon}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	refs, err := svc.refreshDerivedIndexesForNote(scope, desiredDir, manifest)
	if err != nil {
		return nil, err
	}
	return map[string]any{"meta": meta, "manifest": manifest, "refs": refs}, nil
}

// attachSaveVersion 把保存结果中的新版本标记显式附在结果上，供调用者下一次修改时作为期望版本回传。
func attachSaveVersion(saved any) any {
	if record, ok := saved.(map[string]any); ok {
		if manifest, ok := record["manifest"].(noteManifest); ok {
			record["version"] = manifest.UpdatedAtMs
		}
	}
	return saved
}

// patchNoteFace 对笔记某个面的内容做增量替换编辑（Q24 之外的增量通道）：
// oldString 必须存在于面内容中；默认要求唯一（出现多次时需提供更多上下文），replaceAll 时全部替换。
// expectedVersion 与 saveNoteFaces 共用同一防覆盖保险丝语义：不一致时拒绝写入并回报当前版本；
// 写入成功后结果显式携带新版本标记。
// 前端仍使用 saveFaces 的全量覆盖语义，本接口专供工具或其他调用者做安全的增量修改。
func (svc *service) patchNoteFace(scope string, packageDir string, faceID string, oldString string, newString string, replaceAll bool, expectedVersion float64) (any, error) {
	dir := strings.TrimSpace(packageDir)
	face := strings.TrimSpace(faceID)
	if dir == "" || face == "" {
		return nil, errors.New("缺少笔记目录或面标识")
	}
	if oldString == "" {
		return nil, errors.New("待替换的旧文本不能为空")
	}
	doc, err := svc.loadNoteFace(scope, dir, face)
	if err != nil {
		return nil, err
	}
	// 防覆盖保险丝：版本不一致时拒绝写入并回报当前版本。
	if err := checkVersionConflict("笔记", expectedVersion, doc.UpdatedAtMs); err != nil {
		return nil, err
	}
	content := doc.Content
	count := strings.Count(content, oldString)
	if count == 0 {
		return nil, errors.New("未找到要替换的旧文本")
	}
	if count > 1 && !replaceAll {
		return nil, fmt.Errorf("旧文本在面内容中不唯一（出现 %d 次），请提供更多上下文或使用 replaceAll", count)
	}
	next := strings.Replace(content, oldString, newString, 1)
	if replaceAll {
		next = strings.ReplaceAll(content, oldString, newString)
	}
	// 标题显式回填原值：保存接口对缺失标题的语义是归一为「未命名」，patch 必须保持标题不变。
	saved, err := svc.saveNoteFacesInput(scope, map[string]any{
		"id":         doc.NoteID,
		"title":      doc.NoteTitle,
		"packageDir": dir,
		"faces": []any{
			map[string]any{"faceId": nonEmpty(strings.TrimSpace(doc.Face.ID), face), "kind": doc.Face.Kind, "content": next},
		},
	})
	if err != nil {
		return nil, err
	}
	return attachSaveVersion(saved), nil
}

// saveNoteFaceOrder 保存笔记级面顺序（Q35 统一优先级机制的笔记级覆盖）。
// 只接受笔记内已存在的面，未列出的面由规范化逻辑补齐，任何面都不会因排序而丢失。
// expectedVersion 与保存接口共用同一防覆盖保险丝语义：不一致时拒绝写入并回报当前版本；
// 写入成功后结果显式携带新版本标记。
func (svc *service) saveNoteFaceOrder(scope string, packageDir string, faceOrder []string, expectedVersion float64) (any, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return nil, err
	}
	if err := checkVersionConflict("笔记", expectedVersion, manifest.UpdatedAtMs); err != nil {
		return nil, err
	}
	manifest.FaceOrder = faceOrder
	manifest.UpdatedAtMs = nowMs()
	manifest = normalizeManifest(manifest)
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(packageDir, manifestFile)), manifest); err != nil {
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: filepath.ToSlash(packageDir), CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, Icon: manifest.Icon}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	return attachSaveVersion(map[string]any{"meta": meta, "manifest": manifest}), nil
}

// saveNoteFaceSettings 以补丁语义更新笔记级面设置：
// 补丁中值为 null 表示删除该字段，其余字段与既有设置合并后按面协议规范化。
// 这是笔记包内面设置的唯一写入通道，优先级解析由前端统一机制负责。
// expectedVersion 与保存接口共用同一防覆盖保险丝语义：不一致时拒绝写入并回报当前版本；
// 写入成功后结果显式携带新版本标记。
func (svc *service) saveNoteFaceSettings(scope string, packageDir string, faceID string, rawSettings json.RawMessage, expectedVersion float64) (any, error) {
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		return nil, err
	}
	if err := checkVersionConflict("笔记", expectedVersion, manifest.UpdatedAtMs); err != nil {
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
		return nil, coded(codeUnknownFaceKind, "未知笔记面类型：%s", face.Kind)
	}
	normalized := adapter.NormalizeSettings(settings)
	// 未生效校验：补丁里显式提供的非空设置项必须被面协议接受；
	// 被协议静默丢弃的键快速失败，绝不留下「写了但没生效」的假成功。
	for key, value := range patch {
		key = strings.TrimSpace(key)
		if key == "" || value == nil {
			continue
		}
		if _, ok := normalized[key]; !ok {
			return nil, fmt.Errorf("面设置项 %s 不被 %s 面支持（可用设置项见该面类型的设置声明）", key, face.Kind)
		}
	}
	// 空操作短路：规范化结果与现有设置一致时不写盘、不推进版本，
	// 让空补丁与重复提交成为真无副作用；设置回显照常给出，可用于探读当前设置。
	if faceSettingsEqual(face.Settings, normalized) {
		meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: filepath.ToSlash(packageDir), CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, Icon: manifest.Icon}
		return map[string]any{"meta": meta, "manifest": manifest, "version": manifest.UpdatedAtMs, "changed": false}, nil
	}
	updated := nowMs()
	face.Settings = normalized
	face.UpdatedAtMs = updated
	face.CreatedAtMs = nonZeroFloat(face.CreatedAtMs, manifest.CreatedAtMs)
	manifest.Faces[id] = face
	manifest.UpdatedAtMs = updated
	manifest = normalizeManifest(manifest)
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(packageDir, manifestFile)), manifest); err != nil {
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: filepath.ToSlash(packageDir), CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs, Icon: manifest.Icon}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	return attachSaveVersion(map[string]any{"meta": meta, "manifest": manifest, "changed": true}), nil
}

// faceSettingsEqual 判断两份面设置是否逐项相等：map 经 JSON 序列化后比较（键有序）。
func faceSettingsEqual(left map[string]any, right map[string]any) bool {
	if len(left) == 0 && len(right) == 0 {
		return true
	}
	if len(left) != len(right) {
		return false
	}
	leftRaw, err := json.Marshal(left)
	if err != nil {
		return false
	}
	rightRaw, err := json.Marshal(right)
	if err != nil {
		return false
	}
	return string(leftRaw) == string(rightRaw)
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
