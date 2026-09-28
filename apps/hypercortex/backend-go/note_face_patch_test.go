package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestPatchNoteFaceReplacesTextIncrementally(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.saveNoteFaces(scope, json.RawMessage(`{"title":"补丁目标","faces":[{"kind":"markdown","content":"第一段\n目标文本\n第三段"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	meta, ok := created.(map[string]any)["meta"].(noteMeta)
	if !ok {
		t.Fatalf("created meta = %#v", created)
	}
	packageDir := meta.Dir

	// 精准替换：只有目标文本被替换，其余内容保持原样。
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "目标文本", "替换后", false, 0); err != nil {
		t.Fatalf("patchNoteFace failed: %v", err)
	}
	doc, err := svc.loadNoteFace(scope, packageDir, "text")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Content != "第一段\n替换后\n第三段" {
		t.Fatalf("content = %q, want 第一段\\n替换后\\n第三段", doc.Content)
	}
	// 标题必须保持不变（保存接口对缺失标题的语义是归一为「未命名」，patch 需显式回填）。
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Title != "补丁目标" {
		t.Fatalf("title = %q, want 补丁目标（patch 不得改动标题）", manifest.Title)
	}

	// 未找到旧文本快速失败。
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "不存在的文本", "x", false, 0); err == nil {
		t.Fatal("missing oldString must be rejected")
	}
	// 空旧文本快速失败。
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "", "x", false, 0); err == nil {
		t.Fatal("blank oldString must be rejected")
	}
	// 面不存在快速失败。
	if _, err := svc.patchNoteFace(scope, packageDir, "missing", "替换后", "x", false, 0); err == nil {
		t.Fatal("missing face must be rejected")
	}
}

func TestPatchNoteFaceUniquenessAndReplaceAll(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.saveNoteFaces(scope, json.RawMessage(`{"title":"补丁目标","faces":[{"kind":"markdown","content":"重复 重复 保留"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	meta, ok := created.(map[string]any)["meta"].(noteMeta)
	if !ok {
		t.Fatalf("created meta = %#v", created)
	}
	packageDir := meta.Dir

	// 不唯一且未开启 replaceAll：快速失败。
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "重复", "唯一", false, 0); err == nil {
		t.Fatal("ambiguous oldString must be rejected")
	}
	// replaceAll：全部替换。
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "重复", "唯一", true, 0); err != nil {
		t.Fatalf("replaceAll patch failed: %v", err)
	}
	doc, err := svc.loadNoteFace(scope, packageDir, "text")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Content != "唯一 唯一 保留" {
		t.Fatalf("content = %q, want 唯一 唯一 保留", doc.Content)
	}
}

// patchNoteFace 的防覆盖保险丝：期望版本不一致时拒绝写入并回报当前版本；
// 一致时写入成功且结果携带新版本，可闭环用于下一次写入。
func TestPatchNoteFaceExpectedVersionGuard(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.saveNoteFaces(scope, json.RawMessage(`{"title":"保险丝","faces":[{"kind":"markdown","content":"原始内容"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	meta, ok := created.(map[string]any)["meta"].(noteMeta)
	if !ok {
		t.Fatalf("created meta = %#v", created)
	}
	packageDir := meta.Dir
	version := meta.UpdatedAtMs

	// 期望版本不一致：拒绝写入，内容与版本保持不变，错误回报当前版本。
	_, err = svc.patchNoteFace(scope, packageDir, "text", "原始内容", "被拒绝的修改", false, version+1000)
	if err == nil {
		t.Fatal("mismatching expectedVersion must be rejected")
	}
	if !strings.Contains(err.Error(), fmt.Sprintf("%.0f", version)) {
		t.Fatalf("rejection must report current version %.0f: %v", version, err)
	}
	doc, err := svc.loadNoteFace(scope, packageDir, "text")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Content != "原始内容" || doc.UpdatedAtMs != version {
		t.Fatalf("rejected patch must not write: content = %q, version = %.0f", doc.Content, doc.UpdatedAtMs)
	}

	// 期望版本一致：写入成功，结果携带写入后的新版本。
	result, err := svc.patchNoteFace(scope, packageDir, "text", "原始内容", "第一次修改", false, version)
	if err != nil {
		t.Fatalf("matching expectedVersion must be accepted: %v", err)
	}
	nextVersion, ok := result.(map[string]any)["version"].(float64)
	if !ok {
		t.Fatalf("patch result must carry new version: %#v", result)
	}
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.UpdatedAtMs != nextVersion {
		t.Fatalf("reported version %.0f != manifest version %.0f", nextVersion, manifest.UpdatedAtMs)
	}

	// 闭环：用返回的新版本继续修改被接受。
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "第一次修改", "第二次修改", false, nextVersion); err != nil {
		t.Fatalf("closed-loop patch with returned version failed: %v", err)
	}
}

// RPC 入口必须把 expectedVersion 参数交给防覆盖保险丝，且不传该参数时保持原有语义。
func TestPatchFaceDispatchHonorsExpectedVersion(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.saveNoteFaces(scope, json.RawMessage(`{"title":"RPC 保险丝","faces":[{"kind":"markdown","content":"RPC 内容"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	meta, ok := created.(map[string]any)["meta"].(noteMeta)
	if !ok {
		t.Fatalf("created meta = %#v", created)
	}
	packageDir := meta.Dir
	version := meta.UpdatedAtMs

	// 期望版本不一致：RPC 调用被拒绝。
	if _, err := svc.dispatch("hypercortex.notes.patchFace", mustJSONRaw(t, map[string]any{
		"scope":           scope,
		"packageDir":      packageDir,
		"faceId":          "text",
		"oldString":       "RPC 内容",
		"newString":       "RPC 修改",
		"expectedVersion": version + 1000,
	})); err == nil {
		t.Fatal("dispatch must reject mismatching expectedVersion")
	}

	// 期望版本一致：写入成功，结果携带新版本。
	result, err := svc.dispatch("hypercortex.notes.patchFace", mustJSONRaw(t, map[string]any{
		"scope":           scope,
		"packageDir":      packageDir,
		"faceId":          "text",
		"oldString":       "RPC 内容",
		"newString":       "RPC 修改",
		"expectedVersion": version,
	}))
	if err != nil {
		t.Fatalf("dispatch with matching expectedVersion failed: %v", err)
	}
	if _, ok := result.(map[string]any)["version"].(float64); !ok {
		t.Fatalf("dispatch result must carry new version: %#v", result)
	}

	// 不提供 expectedVersion：保险丝关闭，写入照常成功。
	if _, err := svc.dispatch("hypercortex.notes.patchFace", mustJSONRaw(t, map[string]any{
		"scope":      scope,
		"packageDir": packageDir,
		"faceId":     "text",
		"oldString":  "RPC 修改",
		"newString":  "RPC 再修改",
	})); err != nil {
		t.Fatalf("patch without expectedVersion must keep working: %v", err)
	}
	doc, err := svc.loadNoteFace(scope, packageDir, "text")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Content != "RPC 再修改" {
		t.Fatalf("content = %q, want RPC 再修改", doc.Content)
	}
}
