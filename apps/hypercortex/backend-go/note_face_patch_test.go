package main

import (
	"encoding/json"
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
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "目标文本", "替换后", false); err != nil {
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
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "不存在的文本", "x", false); err == nil {
		t.Fatal("missing oldString must be rejected")
	}
	// 空旧文本快速失败。
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "", "x", false); err == nil {
		t.Fatal("blank oldString must be rejected")
	}
	// 面不存在快速失败。
	if _, err := svc.patchNoteFace(scope, packageDir, "missing", "替换后", "x", false); err == nil {
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
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "重复", "唯一", false); err == nil {
		t.Fatal("ambiguous oldString must be rejected")
	}
	// replaceAll：全部替换。
	if _, err := svc.patchNoteFace(scope, packageDir, "text", "重复", "唯一", true); err != nil {
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
