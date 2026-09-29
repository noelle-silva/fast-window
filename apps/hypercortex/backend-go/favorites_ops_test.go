package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 收藏夹语义入口：建夹返回标识与父夹，写入后文档版本递增。
func TestCreateFavoriteFolderCreatesFolderAndRef(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	result, err := svc.createFavoriteFolder(scope, "", "读书笔记", "读书记录", 0)
	if err != nil {
		t.Fatalf("createFavoriteFolder failed: %v", err)
	}
	payload := result.(map[string]any)
	folderID := payload["folderId"].(string)
	if folderID == "" || payload["parentId"] != "root" {
		t.Fatalf("payload = %#v", payload)
	}
	if version := payload["version"].(float64); version <= 0 {
		t.Fatalf("version = %v", version)
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	folder, ok := doc.Folders[folderID]
	if !ok || folder.Title != "读书笔记" || folder.Description != "读书记录" {
		t.Fatalf("folder = %#v", folder)
	}
	refs := doc.RefsByFolderID["root"]
	if len(refs) != 1 || refs[0].Kind != "folder" || refs[0].TargetID != folderID {
		t.Fatalf("root refs = %#v", refs)
	}
}

// 建夹：标题为空与父夹不存在时快速失败。
func TestCreateFavoriteFolderRejectsInvalidInput(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	if _, err := svc.createFavoriteFolder(scope, "", "   ", "", 0); err == nil || !strings.Contains(err.Error(), "标题不能为空") {
		t.Fatalf("empty title err = %v", err)
	}
	if _, err := svc.createFavoriteFolder(scope, "ghost", "子夹", "", 0); err == nil || !strings.Contains(err.Error(), "收藏夹不存在") {
		t.Fatalf("missing parent err = %v", err)
	}
}

// 改夹：只提交的字段生效，未提交字段沿用旧值；无实际变化时不落盘。
func TestUpdateFavoriteFolderPatchesFields(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.createFavoriteFolder(scope, "", "旧标题", "旧说明", 0)
	if err != nil {
		t.Fatal(err)
	}
	folderID := created.(map[string]any)["folderId"].(string)

	result, err := svc.updateFavoriteFolder(scope, folderID, json.RawMessage(`{"title":"新标题"}`), 0)
	if err != nil {
		t.Fatalf("updateFavoriteFolder failed: %v", err)
	}
	if result.(map[string]any)["changed"] != true {
		t.Fatalf("changed = %#v", result)
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	folder := doc.Folders[folderID]
	if folder.Title != "新标题" || folder.Description != "旧说明" {
		t.Fatalf("folder = %#v", folder)
	}

	unchanged, err := svc.updateFavoriteFolder(scope, folderID, json.RawMessage(`{"title":"新标题"}`), 0)
	if err != nil {
		t.Fatalf("idempotent update failed: %v", err)
	}
	if unchanged.(map[string]any)["changed"] != false {
		t.Fatalf("unchanged = %#v", unchanged)
	}
	if _, err := svc.updateFavoriteFolder(scope, folderID, json.RawMessage(`{}`), 0); err == nil || !strings.Contains(err.Error(), "至少提供") {
		t.Fatalf("empty patch err = %v", err)
	}
}

// 放入：笔记/附件/子收藏夹三类目标校验真实存在，重复放入被拒。
func TestAddFavoriteItemValidatesTargetsAndDuplicates(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{"title": "被收藏的笔记"}))
	if err != nil {
		t.Fatal(err)
	}
	noteID := created.(map[string]any)["meta"].(noteMeta).ID

	if _, err := svc.addFavoriteItem(scope, "", "note", noteID, 0); err != nil {
		t.Fatalf("add note failed: %v", err)
	}
	if _, err := svc.addFavoriteItem(scope, "", "note", noteID, 0); err == nil || !strings.Contains(err.Error(), "已存在") {
		t.Fatalf("duplicate add err = %v", err)
	}
	if _, err := svc.addFavoriteItem(scope, "", "note", "ghost-note", 0); err == nil || !strings.Contains(err.Error(), "笔记不存在") {
		t.Fatalf("missing note err = %v", err)
	}
	if _, err := svc.addFavoriteItem(scope, "", "asset", "ghost.txt", 0); err == nil || !strings.Contains(err.Error(), "附件不存在") {
		t.Fatalf("missing asset err = %v", err)
	}
	if _, err := svc.addFavoriteItem(scope, "", "folder", "root", 0); err == nil || !strings.Contains(err.Error(), "自身") {
		t.Fatalf("self folder err = %v", err)
	}
	if _, err := svc.addFavoriteItem(scope, "", "weird", "x", 0); err == nil || !strings.Contains(err.Error(), "未知收藏条目类型") {
		t.Fatalf("unknown kind err = %v", err)
	}
}

// 移出：只摘引用；目标不存在时快速失败。
func TestRemoveFavoriteItemDetachesRefOnly(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{"title": "笔记"}))
	if err != nil {
		t.Fatal(err)
	}
	noteID := created.(map[string]any)["meta"].(noteMeta).ID
	if _, err := svc.addFavoriteItem(scope, "", "note", noteID, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.removeFavoriteItem(scope, "", "note", noteID, 0); err != nil {
		t.Fatalf("removeFavoriteItem failed: %v", err)
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.RefsByFolderID["root"]) != 0 {
		t.Fatalf("refs = %#v", doc.RefsByFolderID["root"])
	}
	// 笔记本身仍存在（只摘引用，不动对象）。
	if _, err := svc.loadNoteManifest(scope, created.(map[string]any)["meta"].(noteMeta).Dir); err != nil {
		t.Fatalf("note removed unexpectedly: %v", err)
	}
	if _, err := svc.removeFavoriteItem(scope, "", "note", noteID, 0); err == nil || !strings.Contains(err.Error(), "没有该条目") {
		t.Fatalf("missing ref err = %v", err)
	}
}

// 挪夹：源夹移除、目标夹新增，条目身份保留；目标已有同条目时拒绝。
func TestMoveFavoriteItemTransfersBetweenFolders(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	createdFolder, err := svc.createFavoriteFolder(scope, "", "目标夹", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	targetFolder := createdFolder.(map[string]any)["folderId"].(string)
	createdNote, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{"title": "笔记"}))
	if err != nil {
		t.Fatal(err)
	}
	noteID := createdNote.(map[string]any)["meta"].(noteMeta).ID
	if _, err := svc.addFavoriteItem(scope, "root", "note", noteID, 0); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.moveFavoriteItem(scope, "root", targetFolder, "note", noteID, 0); err != nil {
		t.Fatalf("moveFavoriteItem failed: %v", err)
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	for _, ref := range doc.RefsByFolderID["root"] {
		if ref.Kind == "note" {
			t.Fatalf("source still holds note ref: %#v", ref)
		}
	}
	refs := doc.RefsByFolderID[targetFolder]
	if len(refs) != 1 || refs[0].TargetID != noteID {
		t.Fatalf("target refs = %#v", refs)
	}
	if _, err := svc.moveFavoriteItem(scope, targetFolder, "root", "note", noteID, 0); err != nil {
		t.Fatalf("move back failed: %v", err)
	}
	if _, err := svc.moveFavoriteItem(scope, "root", "root", "note", noteID, 0); err == nil || !strings.Contains(err.Error(), "相同") {
		t.Fatalf("same folder err = %v", err)
	}
}

// 收藏夹环：把夹移进自己的子夹必须被拒绝。
func TestAddFavoriteFolderRejectsCycle(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	parent, err := svc.createFavoriteFolder(scope, "root", "父夹", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	parentID := parent.(map[string]any)["folderId"].(string)
	child, err := svc.createFavoriteFolder(scope, parentID, "子夹", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	childID := child.(map[string]any)["folderId"].(string)
	// 把父夹放进子夹：形成环，必须拒绝。
	if _, err := svc.addFavoriteItem(scope, childID, "folder", parentID, 0); err == nil || !strings.Contains(err.Error(), "环") {
		t.Fatalf("cycle err = %v", err)
	}
}

// 收藏夹防覆盖保险丝：版本不匹配拒绝写入并回报当前版本。
func TestFavoriteOpsRespectExpectedVersion(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.createFavoriteFolder(scope, "", "夹", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	folderID := created.(map[string]any)["folderId"].(string)
	staleVersion := created.(map[string]any)["version"].(float64)

	// 第一次改夹让版本前进。
	if _, err := svc.updateFavoriteFolder(scope, folderID, json.RawMessage(`{"title":"改名"}`), staleVersion); err != nil {
		t.Fatalf("first update failed: %v", err)
	}
	// 用旧版本再写：拒绝并回报当前版本。
	_, err = svc.updateFavoriteFolder(scope, folderID, json.RawMessage(`{"title":"再改"}`), staleVersion)
	if err == nil || !strings.Contains(err.Error(), "版本不匹配") {
		t.Fatalf("stale update err = %v", err)
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Folders[folderID].Title != "改名" {
		t.Fatalf("stale write applied: %#v", doc.Folders[folderID])
	}
}

// 建夹、放入、移出、挪夹全部经唯一写入点刷新版本。
func TestFavoriteOpsBumpVersionEachWrite(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	note, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{"title": "笔记"}))
	if err != nil {
		t.Fatal(err)
	}
	noteID := note.(map[string]any)["meta"].(noteMeta).ID

	first, err := svc.createFavoriteFolder(scope, "", "夹", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	folderID := first.(map[string]any)["folderId"].(string)
	version1 := first.(map[string]any)["version"].(float64)

	second, err := svc.addFavoriteItem(scope, folderID, "note", noteID, version1)
	if err != nil {
		t.Fatalf("add with matching version failed: %v", err)
	}
	version2 := second.(map[string]any)["version"].(float64)
	if version2 == version1 {
		t.Fatalf("version not bumped: %v", version2)
	}

	third, err := svc.moveFavoriteItem(scope, folderID, "root", "note", noteID, version2)
	if err != nil {
		t.Fatalf("move with matching version failed: %v", err)
	}
	version3 := third.(map[string]any)["version"].(float64)
	if version3 == version2 {
		t.Fatalf("version not bumped on move: %v", version3)
	}
}

// 笔记元数据增量入口：只改提交字段、缺失沿用旧值、版本保险丝生效。
func TestUpdateNoteMetadataPatchesFieldsAndGuardsVersion(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{
		"title":       "旧标题",
		"description": "旧简介",
		"tags":        []string{"旧标签"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	dir := created.(map[string]any)["meta"].(noteMeta).Dir
	version := created.(map[string]any)["manifest"].(noteManifest).UpdatedAtMs

	// 只改标题：简介与标签保留。
	result, err := svc.updateNoteMetadata(scope, dir, json.RawMessage(`{"title":"新标题"}`), version)
	if err != nil {
		t.Fatalf("updateNoteMetadata failed: %v", err)
	}
	if result.(map[string]any)["changed"] != true {
		t.Fatalf("changed = %#v", result)
	}
	manifest, err := svc.loadNoteManifest(scope, dir)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Title != "新标题" || manifest.Description != "旧简介" || len(manifest.Tags) != 1 || manifest.Tags[0] != "旧标签" {
		t.Fatalf("manifest = %#v", manifest)
	}
	newVersion := result.(map[string]any)["version"].(float64)
	if newVersion == version {
		t.Fatalf("version not bumped: %v", newVersion)
	}

	// 显式空简介：清空生效。
	if _, err := svc.updateNoteMetadata(scope, dir, json.RawMessage(`{"description":""}`), newVersion); err != nil {
		t.Fatalf("clear description failed: %v", err)
	}
	manifest, err = svc.loadNoteManifest(scope, dir)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Description != "" {
		t.Fatalf("description not cleared: %q", manifest.Description)
	}

	// 旧版本写入：拒绝并回报当前版本。
	if _, err := svc.updateNoteMetadata(scope, dir, json.RawMessage(`{"title":"越权"}`), version); err == nil || !strings.Contains(err.Error(), "版本不匹配") {
		t.Fatalf("stale write err = %v", err)
	}
	if _, err := svc.updateNoteMetadata(scope, dir, json.RawMessage(`{}`), 0); err == nil || !strings.Contains(err.Error(), "至少提供") {
		t.Fatalf("empty patch err = %v", err)
	}
	if _, err := svc.updateNoteMetadata(scope, dir, json.RawMessage(`{"tags":"not-a-list"}`), 0); err == nil || !strings.Contains(err.Error(), "数组") {
		t.Fatalf("bad tags err = %v", err)
	}
}

// 面顺序与面设置保险丝：版本不匹配拒绝写入，成功回传新版本标记。
func TestFaceOrderAndSettingsRespectExpectedVersion(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.saveNoteFaces(scope, mustJSONRaw(t, map[string]any{
		"id":        "face-guard-1",
		"title":     "保险丝",
		"faceKinds": []string{"markdown", "html"},
	}), 0)
	if err != nil {
		t.Fatal(err)
	}
	dir := created.(map[string]any)["meta"].(noteMeta).Dir
	version := created.(map[string]any)["version"].(float64)
	if version <= 0 {
		t.Fatalf("save result must carry version, got %v", version)
	}

	saved, err := svc.saveNoteFaceOrder(scope, dir, []string{"html", "text"}, version)
	if err != nil {
		t.Fatalf("saveNoteFaceOrder failed: %v", err)
	}
	if saved.(map[string]any)["version"].(float64) == version {
		t.Fatalf("face order version not bumped")
	}
	if _, err := svc.saveNoteFaceOrder(scope, dir, []string{"text"}, version); err == nil || !strings.Contains(err.Error(), "版本不匹配") {
		t.Fatalf("stale face order err = %v", err)
	}

	current, err := svc.loadNoteManifest(scope, dir)
	if err != nil {
		t.Fatal(err)
	}
	settings, err := svc.saveNoteFaceSettings(scope, dir, "html", json.RawMessage(`{"displayMode":"natural"}`), current.UpdatedAtMs)
	if err != nil {
		t.Fatalf("saveNoteFaceSettings failed: %v", err)
	}
	if settings.(map[string]any)["version"].(float64) == current.UpdatedAtMs {
		t.Fatalf("face settings version not bumped")
	}
	if _, err := svc.saveNoteFaceSettings(scope, dir, "html", json.RawMessage(`{"displayMode":"fit-window"}`), current.UpdatedAtMs); err == nil || !strings.Contains(err.Error(), "版本不匹配") {
		t.Fatalf("stale face settings err = %v", err)
	}
}

// 附件同步上传：一次调用等待传完，返回附件编号与引用标记，不产生任务记录。
func TestUploadAssetsSyncReturnsResourcesAndSkipsTaskRecords(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	source := filepath.Join(t.TempDir(), "同步上传.txt")
	if err := os.WriteFile(source, []byte("sync upload body"), 0o644); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal([]assetUploadFileInput{{Path: source, DisplayName: "同步附件"}})
	if err != nil {
		t.Fatal(err)
	}

	result, err := svc.uploadAssetsSync(scope, raw)
	if err != nil {
		t.Fatalf("uploadAssetsSync failed: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("result = %#v", result)
	}
	ref := result[0]
	if ref.AssetID == "" || ref.Ext != "txt" || ref.Marker != "{{asset:"+ref.AssetID+".txt}}" {
		t.Fatalf("resource = %#v", ref)
	}
	if ref.Name != "同步附件" {
		t.Fatalf("displayName = %q", ref.Name)
	}
	if tasks := svc.listAssetUploadTasks(); len(tasks) != 0 {
		t.Fatalf("sync upload must not create task records: %#v", tasks)
	}
	if _, err := svc.uploadAssetsSync(scope, json.RawMessage(`[]`)); err == nil || !strings.Contains(err.Error(), "没有选择任何附件") {
		t.Fatalf("empty files err = %v", err)
	}
}

// 收藏夹语义入口对非法类型与缺失目标的组合快速失败，且不产生落盘副作用。
func TestFavoriteOpsLeaveNoSideEffectsOnFailure(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.createFavoriteFolder(scope, "", "夹", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	folderID := created.(map[string]any)["folderId"].(string)
	version := created.(map[string]any)["version"].(float64)

	if _, err := svc.addFavoriteItem(scope, folderID, "note", "ghost", version); err == nil {
		t.Fatal("expected missing note rejection")
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	if doc.UpdatedAtMs != version {
		t.Fatalf("version changed on failed write: %v -> %v", version, doc.UpdatedAtMs)
	}
	if len(doc.RefsByFolderID[folderID]) != 0 {
		t.Fatalf("refs added on failed write: %#v", doc.RefsByFolderID[folderID])
	}
}
