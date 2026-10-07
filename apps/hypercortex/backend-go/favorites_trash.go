package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 收藏夹回收站：删除的收藏夹以「收藏夹信息 + 页面条目清单」的完整快照暂存在 Trash/folders 下，
// 与笔记、附件、笔记面回收站同级同语义（可恢复、可永久删除、受自动清理约束）。
// 快照恢复时把收藏夹本体与其页面条目原样放回；别处指向它的引用始终留在文档中，
// 目标缺失期间显示为已丢失，随恢复自然复活。
const trashFoldersDirName = "folders"

func folderTrashEntryRel(folderID string) string {
	now := time.Now()
	return filepath.ToSlash(filepath.Join(
		trashDir,
		trashFoldersDirName,
		now.Format("2006-01"),
		sanitizeTrashEntryName(folderID)+"_"+now.Format("150405.000"),
	))
}

// moveFolderToTrash 把收藏夹快照移入回收站：无内容文件，仅写下完整快照元数据。
func (svc *service) moveFolderToTrash(scope string, raw json.RawMessage) (any, error) {
	if err := repoScopeOrError(scope); err != nil {
		return nil, err
	}
	snapshot := trashFolderMeta{}
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return nil, err
	}
	id := strings.TrimSpace(snapshot.Folder.ID)
	if id == "" {
		return nil, errors.New("收藏夹标识为空，无法移入回收站")
	}
	if id == "root" {
		return nil, errors.New("根收藏夹不能删除")
	}
	entryRel := folderTrashEntryRel(id)
	entryDir, err := svc.resolvePath(scope, entryRel)
	if err != nil {
		return nil, err
	}
	if exists(entryDir) {
		return nil, errors.New("目标回收站路径已存在")
	}
	if err := os.MkdirAll(entryDir, 0o755); err != nil {
		return nil, err
	}
	// 图片图标随收藏夹快照一并移入回收站条目目录。
	svc.moveIconFileIntoDir(scope, snapshot.Folder.Icon, entryDir)
	meta := trashMeta{Version: 1, Kind: "folder", DeletedAtMs: nowMs(), Folder: &snapshot}
	if err := writeJSONFile(filepath.Join(entryDir, trashMetaFile), meta); err != nil {
		svc.restoreIconFileFromDir(scope, snapshot.Folder.Icon, entryDir)
		_ = os.RemoveAll(entryDir)
		return nil, err
	}
	return map[string]string{"trashDir": entryRel}, nil
}

// listFolderTrash 列出收藏夹回收站条目：标题取自快照，删除时间取元数据。
func (svc *service) listFolderTrash(scope string, trashRoot string) ([]trashItem, error) {
	folderTrashRoot := filepath.Join(trashRoot, trashFoldersDirName)
	months, err := os.ReadDir(folderTrashRoot)
	if errors.Is(err, os.ErrNotExist) {
		return []trashItem{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []trashItem{}
	for _, month := range months {
		if !month.IsDir() {
			continue
		}
		entries, err := os.ReadDir(filepath.Join(folderTrashRoot, month.Name()))
		if err != nil {
			// 单个月份目录不可读不应阻断整个收藏夹回收站列表。
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			dir := filepath.Join(folderTrashRoot, month.Name(), entry.Name())
			meta := trashMeta{}
			if err := readJSONFile(filepath.Join(dir, trashMetaFile), &meta); err != nil || meta.Kind != "folder" || meta.Folder == nil {
				continue
			}
			folder := meta.Folder.Folder
			id := strings.TrimSpace(folder.ID)
			if id == "" {
				continue
			}
			info, _ := entry.Info()
			deletedAt := meta.DeletedAtMs
			if deletedAt <= 0 && info != nil {
				deletedAt = float64(info.ModTime().UnixMilli())
			}
			entryDir := filepath.ToSlash(filepath.Join(trashDir, trashFoldersDirName, month.Name(), entry.Name()))
			out = append(out, trashItem{
				Kind:        "folder",
				ID:          id,
				Title:       nonEmpty(folder.Title, "未命名收藏夹"),
				Dir:         entryDir,
				CreatedAtMs: folder.CreatedAtMs,
				UpdatedAtMs: folder.UpdatedAtMs,
				DeletedAtMs: deletedAt,
				Icon:        trashDisplayIconForMovedFile(folder.Icon, entryDir),
			})
		}
	}
	return out, nil
}

// restoreFolderTrashItem 把回收站中的收藏夹放回文档：恢复收藏夹本体与其页面条目清单。
// 别处指向它的引用本就在文档中，恢复后自然复活。
func (svc *service) restoreFolderTrashItem(scope string, item trashItem) (any, error) {
	fromDir, err := svc.resolvePath(scope, item.Dir)
	if err != nil {
		return nil, err
	}
	trash := trashMeta{}
	if err := readJSONFile(filepath.Join(fromDir, trashMetaFile), &trash); err != nil {
		return nil, err
	}
	if trash.Kind != "folder" || trash.Folder == nil {
		return nil, errors.New("回收站条目不是收藏夹")
	}
	snapshot := trash.Folder
	id := strings.TrimSpace(snapshot.Folder.ID)
	if id == "" {
		return nil, errors.New("回收站条目的收藏夹标识为空")
	}
	if id == "root" {
		return nil, errors.New("根收藏夹不能恢复")
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		return nil, err
	}
	if doc.Version != 1 {
		doc = freshFavoritesDoc(nowMs())
	}
	if _, exists := doc.Folders[id]; exists {
		return nil, errors.New("收藏夹已存在，无法恢复")
	}

	now := nowMs()
	folder := snapshot.Folder
	folder.ID = id
	folder.Title = nonEmpty(folder.Title, "未命名收藏夹")
	folder.Description = strings.TrimSpace(folder.Description)
	folder.CreatedAtMs = positiveTimestamp(folder.CreatedAtMs, now)
	folder.UpdatedAtMs = positiveTimestamp(folder.UpdatedAtMs, now)

	refs := make([]favoriteItemRef, 0, len(snapshot.Refs))
	for _, ref := range snapshot.Refs {
		kind := normalizeFavoriteRefKind(ref.Kind)
		target := strings.TrimSpace(ref.TargetID)
		if kind == "" || target == "" {
			continue
		}
		ref.Kind = kind
		ref.TargetID = target
		ref.FolderID = id
		if strings.TrimSpace(ref.ID) == "" {
			ref.ID = stableFavoriteRefID(id, kind, target)
		}
		refs = append(refs, ref)
	}

	doc.Folders[id] = folder
	if doc.RefsByFolderID == nil {
		doc.RefsByFolderID = map[string][]favoriteItemRef{}
	}
	doc.RefsByFolderID[id] = refs
	applyRefsToFavorites(&doc, snapshot.InboundRefs)
	if _, err := svc.saveFavoritesDoc(scope, doc); err != nil {
		return nil, err
	}
	// 图片图标随收藏夹本体一并还原回 Icons/。
	svc.restoreIconFileFromDir(scope, folder.Icon, fromDir)
	if err := os.RemoveAll(fromDir); err != nil {
		return nil, err
	}
	return map[string]any{"favorites": doc}, nil
}

// applyRefsToFavorites 把随本体一并打包的引用原样写回其所在收藏夹：目标收藏夹已不存在或已有同源引用时跳过该条。
// 引用标识、摆放位置与时间戳原样保留，保证恢复后引用重新生效且位置不变。返回文档是否发生变化。
func applyRefsToFavorites(doc *favoritesDoc, refs []favoriteItemRef) bool {
	if len(refs) == 0 {
		return false
	}
	if doc.RefsByFolderID == nil {
		doc.RefsByFolderID = map[string][]favoriteItemRef{}
	}
	now := nowMs()
	changed := false
	for _, ref := range refs {
		folderID := strings.TrimSpace(ref.FolderID)
		kind := normalizeFavoriteRefKind(ref.Kind)
		targetID := strings.TrimSpace(ref.TargetID)
		if folderID == "" || kind == "" || targetID == "" {
			continue
		}
		if _, ok := doc.Folders[folderID]; !ok {
			continue
		}
		if favoriteFolderHasRef(*doc, folderID, kind, targetID) {
			continue
		}
		if strings.TrimSpace(ref.ID) == "" {
			ref.ID = stableFavoriteRefID(folderID, kind, targetID)
		}
		ref.FolderID = folderID
		ref.Kind = kind
		ref.TargetID = targetID
		ref.CreatedAtMs = positiveTimestamp(ref.CreatedAtMs, now)
		ref.UpdatedAtMs = positiveTimestamp(ref.UpdatedAtMs, ref.CreatedAtMs)
		doc.RefsByFolderID[folderID] = append(doc.RefsByFolderID[folderID], ref)
		touchFavoriteFolder(doc, folderID, now)
		changed = true
	}
	return changed
}

// restoreRefsIntoFavorites 读取收藏夹文档并把随本体打包的引用写回；没有可写回的引用时返回 ok=false。
func (svc *service) restoreRefsIntoFavorites(scope string, refs []favoriteItemRef) (favoritesDoc, bool, error) {
	if len(refs) == 0 {
		return favoritesDoc{}, false, nil
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		return favoritesDoc{}, false, err
	}
	if doc.Version != 1 {
		doc = freshFavoritesDoc(nowMs())
	}
	if !applyRefsToFavorites(&doc, refs) {
		return favoritesDoc{}, false, nil
	}
	if _, err := svc.saveFavoritesDoc(scope, doc); err != nil {
		return favoritesDoc{}, false, err
	}
	return doc, true, nil
}
