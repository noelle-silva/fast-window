package main

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// 收藏夹语义写入口：建夹、改夹、放入、移出、挪夹。
// 每个入口都走同一条主路：读取当前文档 → 校验防覆盖保险丝 → 在内存中应用变更 → 经唯一写入点写回。
// 调用者（工具与外部访问）只表达意图，不需要了解整份文档的结构与版本管理细节。

// loadFavoritesForWrite 读取收藏夹文档供写入：文档缺失时按空文档建立初始结构；
// expectedVersion 非零时必须与当前版本一致，否则拒绝写入并回报当前版本。
func (svc *service) loadFavoritesForWrite(scope string, expectedVersion float64) (favoritesDoc, error) {
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		return favoritesDoc{}, err
	}
	if doc.Version != 1 {
		if expectedVersion > 0 {
			return favoritesDoc{}, fmt.Errorf("收藏夹版本不匹配：期望版本 %.0f，但目标收藏夹不存在", expectedVersion)
		}
		return freshFavoritesDoc(nowMs()), nil
	}
	if err := checkVersionConflict("收藏夹", expectedVersion, doc.UpdatedAtMs); err != nil {
		return favoritesDoc{}, err
	}
	return doc, nil
}

// favoriteFolderOrFail 定位收藏夹；缺省标识落到根收藏夹，未知标识快速失败。
func favoriteFolderOrFail(doc favoritesDoc, folderID string) (favoriteFolder, error) {
	id := strings.TrimSpace(folderID)
	if id == "" {
		id = nonEmpty(doc.RootFolderID, "root")
	}
	folder, ok := doc.Folders[id]
	if !ok {
		return favoriteFolder{}, fmt.Errorf("收藏夹不存在：%s", id)
	}
	return folder, nil
}

// favoriteFolderHasRef 判断收藏夹中是否已有同类型同目标的条目。
func favoriteFolderHasRef(doc favoritesDoc, folderID string, kind string, targetID string) bool {
	for _, ref := range doc.RefsByFolderID[folderID] {
		if ref.Kind == kind && strings.TrimSpace(ref.TargetID) == targetID {
			return true
		}
	}
	return false
}

// nextFavoriteLayout 计算新条目的自动布局：接在现有条目下方（与界面侧自动布局同语义）。
func nextFavoriteLayout(doc favoritesDoc, folderID string) favoriteGridLayout {
	base := defaultFavoriteLayout()
	maxBottom := 0
	for _, ref := range doc.RefsByFolderID[folderID] {
		y := ref.Layout.Y
		if y < 0 {
			y = 0
		}
		h := ref.Layout.H
		if h < 1 {
			h = base.H
		}
		if y+h > maxBottom {
			maxBottom = y + h
		}
	}
	base.Y = maxBottom
	return base
}

// favoriteAddRef 把一条收藏条目追加到收藏夹（调用方已完成目标校验与去重）。
func favoriteAddRef(doc favoritesDoc, folderID string, kind string, targetID string) favoriteItemRef {
	now := nowMs()
	ref := favoriteItemRef{
		ID:          newFavoriteRefID(),
		FolderID:    folderID,
		Kind:        kind,
		TargetID:    targetID,
		Layout:      nextFavoriteLayout(doc, folderID),
		CreatedAtMs: now,
		UpdatedAtMs: now,
	}
	doc.RefsByFolderID[folderID] = append(doc.RefsByFolderID[folderID], ref)
	touchFavoriteFolder(&doc, folderID, now)
	return ref
}

// touchFavoriteFolder 刷新收藏夹自身的更新时间。
func touchFavoriteFolder(doc *favoritesDoc, folderID string, now float64) {
	folder, ok := doc.Folders[folderID]
	if !ok {
		return
	}
	folder.UpdatedAtMs = now
	doc.Folders[folderID] = folder
}

// favoriteFolderReachable 判断从 from 出发沿收藏夹引用能否到达 target（含自身）。
func favoriteFolderReachable(doc favoritesDoc, from string, target string) bool {
	if from == target {
		return true
	}
	visited := map[string]bool{}
	queue := []string{from}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current == "" || visited[current] {
			continue
		}
		visited[current] = true
		for _, ref := range doc.RefsByFolderID[current] {
			if ref.Kind != "folder" {
				continue
			}
			next := strings.TrimSpace(ref.TargetID)
			if next == target {
				return true
			}
			if !visited[next] {
				queue = append(queue, next)
			}
		}
	}
	return false
}

// validateFavoriteFolderRef 校验收藏夹引用：不允许自引用，也不允许形成环。
func validateFavoriteFolderRef(doc favoritesDoc, sourceFolderID string, targetFolderID string) error {
	if sourceFolderID == targetFolderID {
		return errors.New("收藏夹不能引用自身")
	}
	if favoriteFolderReachable(doc, targetFolderID, sourceFolderID) {
		return fmt.Errorf("该引用会形成收藏夹环：%s 已在 %s 的引用链上", sourceFolderID, targetFolderID)
	}
	return nil
}

// validateFavoriteTarget 校验收藏目标真实存在；收藏夹类型额外做环校验。
func (svc *service) validateFavoriteTarget(scope string, doc favoritesDoc, sourceFolderID string, kind string, targetID string) error {
	switch kind {
	case "note":
		idx, err := svc.loadNoteIndex(scope)
		if err != nil {
			return err
		}
		if _, ok := idx.Notes[targetID]; !ok {
			return fmt.Errorf("笔记不存在：%s", targetID)
		}
	case "asset":
		idx, err := svc.ensureAssetIndex(scope)
		if err != nil {
			return err
		}
		if _, ok := idx.Assets[targetID]; !ok {
			return fmt.Errorf("附件不存在：%s", targetID)
		}
	case "folder":
		if _, err := favoriteFolderOrFail(doc, targetID); err != nil {
			return err
		}
		if err := validateFavoriteFolderRef(doc, sourceFolderID, targetID); err != nil {
			return err
		}
	}
	return nil
}

// normalizeFavoriteItemKind 归一收藏条目类型；未知类型快速失败。
func normalizeFavoriteItemKind(kind string) (string, error) {
	normalized := normalizeFavoriteRefKind(kind)
	if normalized == "" {
		return "", fmt.Errorf("未知收藏条目类型：%s（可选 note/asset/folder）", strings.TrimSpace(kind))
	}
	return normalized, nil
}

// createFavoriteFolder 建夹：在指定收藏夹下新建一个子收藏夹并建立引用。
func (svc *service) createFavoriteFolder(scope string, parentID string, title string, description string, expectedVersion float64) (any, error) {
	name := strings.TrimSpace(title)
	if name == "" {
		return nil, errors.New("收藏夹标题不能为空")
	}
	doc, err := svc.loadFavoritesForWrite(scope, expectedVersion)
	if err != nil {
		return nil, err
	}
	parent, err := favoriteFolderOrFail(doc, parentID)
	if err != nil {
		return nil, err
	}
	now := nowMs()
	id := newFavoriteFolderID()
	doc.Folders[id] = favoriteFolder{ID: id, Title: name, Description: strings.TrimSpace(description), CreatedAtMs: now, UpdatedAtMs: now}
	if doc.RefsByFolderID[id] == nil {
		doc.RefsByFolderID[id] = []favoriteItemRef{}
	}
	favoriteAddRef(doc, parent.ID, "folder", id)
	version, err := svc.saveFavoritesDoc(scope, doc)
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": version, "folderId": id, "parentId": parent.ID}, nil
}

// updateFavoriteFolder 改夹：增量更新收藏夹的标题与说明（缺失字段沿用旧值）。
func (svc *service) updateFavoriteFolder(scope string, folderID string, raw json.RawMessage, expectedVersion float64) (any, error) {
	doc, err := svc.loadFavoritesForWrite(scope, expectedVersion)
	if err != nil {
		return nil, err
	}
	folder, err := favoriteFolderOrFail(doc, folderID)
	if err != nil {
		return nil, err
	}
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	rawTitle, hasTitle := input["title"]
	rawDescription, hasDescription := input["description"]
	if !hasTitle && !hasDescription {
		return nil, errors.New("至少提供 title 或 description 之一")
	}
	changed := false
	if hasTitle {
		title := strings.TrimSpace(asString(rawTitle))
		if title == "" {
			return nil, errors.New("收藏夹标题不能为空")
		}
		if title != folder.Title {
			folder.Title = title
			changed = true
		}
	}
	if hasDescription {
		description := strings.TrimSpace(asString(rawDescription))
		if description != folder.Description {
			folder.Description = description
			changed = true
		}
	}
	if !changed {
		return map[string]any{"version": doc.UpdatedAtMs, "folderId": folder.ID, "changed": false}, nil
	}
	folder.UpdatedAtMs = nowMs()
	doc.Folders[folder.ID] = folder
	version, err := svc.saveFavoritesDoc(scope, doc)
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": version, "folderId": folder.ID, "changed": true}, nil
}

// addFavoriteItem 放入：把笔记、附件或子收藏夹收进指定收藏夹。
func (svc *service) addFavoriteItem(scope string, folderID string, kind string, targetID string, expectedVersion float64) (any, error) {
	doc, err := svc.loadFavoritesForWrite(scope, expectedVersion)
	if err != nil {
		return nil, err
	}
	folder, err := favoriteFolderOrFail(doc, folderID)
	if err != nil {
		return nil, err
	}
	itemKind, err := normalizeFavoriteItemKind(kind)
	if err != nil {
		return nil, err
	}
	target := strings.TrimSpace(targetID)
	if target == "" {
		return nil, errors.New("收藏目标标识不能为空")
	}
	if favoriteFolderHasRef(doc, folder.ID, itemKind, target) {
		return nil, fmt.Errorf("收藏夹中已存在该条目：%s %s", itemKind, target)
	}
	if err := svc.validateFavoriteTarget(scope, doc, folder.ID, itemKind, target); err != nil {
		return nil, err
	}
	ref := favoriteAddRef(doc, folder.ID, itemKind, target)
	version, err := svc.saveFavoritesDoc(scope, doc)
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": version, "refId": ref.ID, "folderId": folder.ID}, nil
}

// removeFavoriteItem 移出：把条目从收藏夹中移除（只摘引用，不动被收藏的对象本身）。
func (svc *service) removeFavoriteItem(scope string, folderID string, kind string, targetID string, expectedVersion float64) (any, error) {
	doc, err := svc.loadFavoritesForWrite(scope, expectedVersion)
	if err != nil {
		return nil, err
	}
	folder, err := favoriteFolderOrFail(doc, folderID)
	if err != nil {
		return nil, err
	}
	itemKind, err := normalizeFavoriteItemKind(kind)
	if err != nil {
		return nil, err
	}
	target := strings.TrimSpace(targetID)
	if target == "" {
		return nil, errors.New("收藏目标标识不能为空")
	}
	refs := doc.RefsByFolderID[folder.ID]
	next := make([]favoriteItemRef, 0, len(refs))
	removed := false
	for _, ref := range refs {
		if ref.Kind == itemKind && strings.TrimSpace(ref.TargetID) == target {
			removed = true
			continue
		}
		next = append(next, ref)
	}
	if !removed {
		return nil, fmt.Errorf("收藏夹中没有该条目：%s %s", itemKind, target)
	}
	doc.RefsByFolderID[folder.ID] = next
	touchFavoriteFolder(&doc, folder.ID, nowMs())
	version, err := svc.saveFavoritesDoc(scope, doc)
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": version, "folderId": folder.ID}, nil
}

// moveFavoriteItem 挪夹：把条目从一个收藏夹移到另一个收藏夹。
func (svc *service) moveFavoriteItem(scope string, fromFolderID string, toFolderID string, kind string, targetID string, expectedVersion float64) (any, error) {
	doc, err := svc.loadFavoritesForWrite(scope, expectedVersion)
	if err != nil {
		return nil, err
	}
	from, err := favoriteFolderOrFail(doc, fromFolderID)
	if err != nil {
		return nil, err
	}
	to, err := favoriteFolderOrFail(doc, toFolderID)
	if err != nil {
		return nil, err
	}
	if from.ID == to.ID {
		return nil, errors.New("源收藏夹与目标收藏夹相同")
	}
	itemKind, err := normalizeFavoriteItemKind(kind)
	if err != nil {
		return nil, err
	}
	target := strings.TrimSpace(targetID)
	if target == "" {
		return nil, errors.New("收藏目标标识不能为空")
	}
	refs := doc.RefsByFolderID[from.ID]
	next := make([]favoriteItemRef, 0, len(refs))
	removed := false
	for _, ref := range refs {
		if ref.Kind == itemKind && strings.TrimSpace(ref.TargetID) == target {
			removed = true
			continue
		}
		next = append(next, ref)
	}
	if !removed {
		return nil, fmt.Errorf("源收藏夹中没有该条目：%s %s", itemKind, target)
	}
	doc.RefsByFolderID[from.ID] = next
	if favoriteFolderHasRef(doc, to.ID, itemKind, target) {
		return nil, fmt.Errorf("目标收藏夹中已存在该条目：%s %s", itemKind, target)
	}
	// 目标校验基于移除后的文档：环判定不受源引用影响。
	if err := svc.validateFavoriteTarget(scope, doc, to.ID, itemKind, target); err != nil {
		return nil, err
	}
	ref := favoriteAddRef(doc, to.ID, itemKind, target)
	touchFavoriteFolder(&doc, from.ID, nowMs())
	version, err := svc.saveFavoritesDoc(scope, doc)
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": version, "refId": ref.ID, "fromFolderId": from.ID, "toFolderId": to.ID}, nil
}

// newFavoriteFolderID 生成收藏夹标识；与界面侧 nowId 同格式（36 进制毫秒 + 随机后缀），
// 两套入口产生的标识形态一致，避免存量与新建并存两套格式。
func newFavoriteFolderID() string {
	return newFavoriteID()
}

// newFavoriteRefID 生成收藏条目标识；与界面侧 nowId 同格式。
func newFavoriteRefID() string {
	return newFavoriteID()
}

// newFavoriteID 生成与界面侧一致的标识：36 进制毫秒时间前缀保证有序，随机后缀保证唯一。
func newFavoriteID() string {
	return strconv.FormatInt(time.Now().UnixMilli(), 36) + "_" + randomBase36Token(6)
}

// randomBase36Token 生成指定长度的 36 进制随机串；随机源失败时退回时间戳尾段。
func randomBase36Token(length int) string {
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		fallback := strconv.FormatInt(time.Now().UnixNano(), 36)
		if len(fallback) > length {
			fallback = fallback[len(fallback)-length:]
		}
		return fallback
	}
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	out := make([]byte, length)
	for index, value := range buf {
		out[index] = alphabet[int(value)%len(alphabet)]
	}
	return string(out)
}
