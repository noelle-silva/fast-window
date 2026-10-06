package main

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

// 未知面类型必须在产生任何磁盘副作用之前快速失败：不建笔记、不写文件。
func TestCreateNoteRejectsUnknownFaceKindWithoutSideEffects(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	_, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{
		"id":        "reject-unknown-kind-1",
		"title":     "未知面类型",
		"faceKinds": []string{"markdown", "bogus-kind"},
	}))
	if err == nil || !strings.Contains(err.Error(), "未知笔记面类型") {
		t.Fatalf("expected unknown face kind rejection, got %v", err)
	}
	idx, err := svc.loadNoteIndex(scope)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := idx.Notes["reject-unknown-kind-1"]; ok {
		t.Fatalf("note created despite unknown face kind: %#v", idx.Notes["reject-unknown-kind-1"])
	}
	rel, err := notePackageDirForID("reject-unknown-kind-1")
	if err != nil {
		t.Fatal(err)
	}
	dir, err := svc.resolvePath(scope, rel)
	if err != nil {
		t.Fatal(err)
	}
	if exists(dir) {
		t.Fatalf("note package created despite unknown face kind: %s", rel)
	}
}

// 保存接口同样拒绝未知面类型，且不产生半截写入。
func TestSaveNoteFacesRejectsUnknownFaceKind(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.saveNoteFaces(scope, mustJSONRaw(t, map[string]any{
		"id":        "reject-unknown-kind-2",
		"title":     "未知面类型保存",
		"faceKinds": []string{"markdown"},
	}), 0)
	if err != nil {
		t.Fatal(err)
	}
	dir := created.(map[string]any)["meta"].(noteMeta).Dir
	before, err := svc.loadNoteManifest(scope, dir)
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.saveNoteFaces(scope, mustJSONRaw(t, map[string]any{
		"id":         "reject-unknown-kind-2",
		"packageDir": dir,
		"title":      "未知面类型保存",
		"faceKinds":  []string{"bogus-kind"},
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "changed"},
		},
	}), 0)
	if err == nil || !strings.Contains(err.Error(), "未知笔记面类型") {
		t.Fatalf("expected unknown face kind rejection, got %v", err)
	}
	after, err := svc.loadNoteManifest(scope, dir)
	if err != nil {
		t.Fatal(err)
	}
	if after.UpdatedAtMs != before.UpdatedAtMs {
		t.Fatalf("manifest mutated on rejected save: %v -> %v", before.UpdatedAtMs, after.UpdatedAtMs)
	}
	doc, err := svc.loadNoteFace(scope, dir, "text")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Content != "" {
		t.Fatalf("face content mutated on rejected save: %q", doc.Content)
	}
}

// 上传源文件缺失时报错明示「源文件不存在」，不误报为附件不存在。
func TestUploadAssetsSyncReportsMissingSourceFile(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	missing := filepath.Join(t.TempDir(), "does-not-exist.txt")
	raw, err := json.Marshal([]assetUploadFileInput{{Path: missing}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.uploadAssetsSync(scope, raw)
	if err == nil || !strings.Contains(err.Error(), "源文件不存在") {
		t.Fatalf("expected missing source error, got %v", err)
	}
}

// 收藏夹标识与界面侧同格式：36 进制毫秒前缀 + 下划线 + 36 进制随机后缀。
func TestFavoriteIDsFollowFrontendFormat(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.createFavoriteFolder(scope, "", "格式夹", "")
	if err != nil {
		t.Fatal(err)
	}
	folderID := created.(map[string]any)["folderId"].(string)
	assertFavoriteIDFormat(t, folderID)

	added, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{"title": "格式笔记"}))
	if err != nil {
		t.Fatal(err)
	}
	noteID := added.(map[string]any)["meta"].(noteMeta).ID
	refResult, err := svc.addFavoriteItem(scope, "root", "note", noteID)
	if err != nil {
		t.Fatal(err)
	}
	refID := refResult.(map[string]any)["refId"].(string)
	assertFavoriteIDFormat(t, refID)
}

// assertFavoriteIDFormat 校验标识形如 <36 进制时间>_<36 进制随机>，两段均为小写字母或数字。
func assertFavoriteIDFormat(t *testing.T, id string) {
	t.Helper()
	parts := strings.Split(id, "_")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		t.Fatalf("id %q does not match frontend format", id)
	}
	for _, part := range parts {
		for _, r := range part {
			if (r < '0' || r > '9') && (r < 'a' || r > 'z') {
				t.Fatalf("id %q contains invalid character %q", id, r)
			}
		}
	}
}
