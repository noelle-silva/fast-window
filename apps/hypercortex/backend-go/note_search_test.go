package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"

	markdown "fast-window-hypercortex-backend/faceplugins/markdown"
)

func TestMarkdownSearchTextKeepsCodeAndReplacesPlaceholders(t *testing.T) {
	content := "# 标题\n\n正文提到 **项目A** 和 [[note_id=target-b|face=html|title=项目B]]。\n\n`[[note_id=inline-code]]` 不应被替换。\n\n```js\n[[note_id=in-fence]]\n```\n\n末尾 {{asset:abc.png||300}}\n"
	got := markdown.SearchText(content)
	want := "# 标题\n\n正文提到 **项目A** 和 项目B。\n\n`[[note_id=inline-code]]` 不应被替换。\n\n```js\n[[note_id=in-fence]]\n```\n\n末尾  \n"
	if got != want {
		t.Fatalf("searchText = %q\nwant %q", got, want)
	}
}

func TestMarkdownSearchTextFallbackToRemarksAndRemovesEmptyRefs(t *testing.T) {
	content := "[[note_id=a|title=|remarks=笔记甲]] [[note_id=b]] [[note_id=c|face=text|title=]]"
	got := markdown.SearchText(content)
	want := "笔记甲  "
	if got != want {
		t.Fatalf("searchText = %q, want %q", got, want)
	}
}

func TestSearchIndexCollectedForSearchableFacesOnly(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(testRepoRoot(t, svc), notesDir, "2026-09", "search-note-1")
	manifest := normalizeManifest(noteManifest{
		ID:        "search-note-1",
		Title:     "搜索目标",
		FaceOrder: []string{"text", "html"},
		Faces: map[string]noteFaceManifest{
			"text": {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
			"html": {ID: "html", Kind: "html", Title: "HTML", File: "html-view.html"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), "第一面内容提到 量子纠缠 与 [[note_id=other|title=关联笔记]]。")
	mustWriteFile(t, filepath.Join(noteDir, "html-view.html"), "<div>量子纠缠 只在 HTML 面出现</div>")

	if _, err := svc.refreshDerivedIndexesForNote(testRepoID(t, svc), filepath.ToSlash(filepath.Join(notesDir, "2026-09", "search-note-1")), manifest); err != nil {
		t.Fatal(err)
	}

	// 面内容命中：返回该笔记 + 文本面命中 + 摘要
	res, err := svc.queryNoteSearch(testRepoID(t, svc), "量子纠缠", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Items) != 1 || res.Items[0].NoteID != "search-note-1" {
		t.Fatalf("items = %#v", res.Items)
	}
	hit := res.Items[0]
	if len(hit.FaceHits) != 1 {
		t.Fatalf("faceHits = %#v", hit.FaceHits)
	}
	if hit.FaceHits[0].FaceID != "text" || hit.FaceHits[0].Kind != "markdown" {
		t.Fatalf("face hit = %#v", hit.FaceHits[0])
	}
	if hit.FaceHits[0].Snippet == "" {
		t.Fatalf("snippet empty: %#v", hit.FaceHits[0])
	}
	// 标题单独命中时标记 title
	byTitle, err := svc.queryNoteSearch(testRepoID(t, svc), "搜索目标", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(byTitle.Items) != 1 || !containsString(byTitle.Items[0].NoteFields, "title") || len(byTitle.Items[0].FaceHits) != 0 {
		t.Fatalf("title items = %#v", byTitle.Items)
	}
}

func TestSearchQueryTitleHitForEmptyTextFace(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(testRepoRoot(t, svc), notesDir, "2026-09", "search-note-2")
	manifest := normalizeManifest(noteManifest{
		ID:        "search-note-2",
		Title:     "空内容笔记",
		FaceOrder: []string{"text"},
		Faces: map[string]noteFaceManifest{
			"text": {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), "")
	if _, err := svc.refreshDerivedIndexesForNote(testRepoID(t, svc), filepath.ToSlash(filepath.Join(notesDir, "2026-09", "search-note-2")), manifest); err != nil {
		t.Fatal(err)
	}
	res, err := svc.queryNoteSearch(testRepoID(t, svc), "空内容", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Items) != 1 || !containsString(res.Items[0].NoteFields, "title") || len(res.Items[0].FaceHits) != 0 {
		t.Fatalf("items = %#v", res.Items)
	}
}

func TestSearchQueryFaceKindFilter(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(testRepoRoot(t, svc), notesDir, "2026-09", "search-note-3")
	manifest := normalizeManifest(noteManifest{
		ID:        "search-note-3",
		Title:     "过滤目标",
		FaceOrder: []string{"text"},
		Faces: map[string]noteFaceManifest{
			"text": {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), "正文段落里没有任何目标词\n")
	if _, err := svc.refreshDerivedIndexesForNote(testRepoID(t, svc), filepath.ToSlash(filepath.Join(notesDir, "2026-09", "search-note-3")), manifest); err != nil {
		t.Fatal(err)
	}
	// 范围仅文本面内容：标题字段不参与，本笔记应被过滤掉
	res, err := svc.queryNoteSearch(testRepoID(t, svc), "过滤目标", []string{"markdown"}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Items) != 0 {
		t.Fatalf("filtered items = %#v", res.Items)
	}
	// 不限定范围时标题可命中
	all, err := svc.queryNoteSearch(testRepoID(t, svc), "过滤目标", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all.Items) != 1 {
		t.Fatalf("unfiltered items = %#v", all.Items)
	}
}

func TestSearchKindsListsOnlySearchableFaces(t *testing.T) {
	kinds := listSearchableFaceKinds()
	want := []noteSearchFaceKindInfo{{Kind: "markdown", Label: "文本"}}
	if !reflect.DeepEqual(kinds, want) {
		t.Fatalf("kinds = %#v, want %#v", kinds, want)
	}
}

func TestSearchIndexRebuildIsIdempotent(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(testRepoRoot(t, svc), notesDir, "2026-09", "search-note-4")
	manifest := normalizeManifest(noteManifest{
		ID:        "search-note-4",
		Title:     "重建笔记",
		FaceOrder: []string{"text"},
		Faces: map[string]noteFaceManifest{
			"text": {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), "稳定内容内容内容")
	if err := svc.rebuildSearchIndex(testRepoID(t, svc)); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(testRepoRoot(t, svc), searchIndexFile))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.rebuildSearchIndex(testRepoID(t, svc)); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(filepath.Join(testRepoRoot(t, svc), searchIndexFile))
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("rebuild not idempotent:\nbefore: %s\nafter: %s", before, after)
	}
}

func TestSearchSnippetContainsKeyword(t *testing.T) {
	snippet := makeSearchSnippet("这是很长的一段前置文本，"+strings.Repeat("关键字X", 20)+"，后面还有很长的尾巴内容", []string{"关键字X"})
	if snippet == "" {
		t.Fatalf("snippet empty")
	}
	if !textMatchesTokens(snippet, []string{"关键字X"}) {
		t.Fatalf("snippet lost keyword: %q", snippet)
	}
}

// TestSearchSnippetDoesNotSplitMultibyteChars 关键词字节偏移使得截断窗口落在多字节字符中间时，
// 摘要仍必须在字符边界截断，不得产生无效 UTF-8 或替换字符。
func TestSearchSnippetDoesNotSplitMultibyteChars(t *testing.T) {
	// 60 个"啊"(180字节) + "x"(1字节) => 关键词字节偏移 181，
	// 关键词前 48 字节处落在"啊"的中间字节，验证截断按字符边界进行。
	text := strings.Repeat("啊", 60) + "x" + "目标X" + strings.Repeat("哦", 20)
	snippet := makeSearchSnippet(text, []string{"目标X"})
	if snippet == "" {
		t.Fatalf("snippet empty")
	}
	if !textMatchesTokens(snippet, []string{"目标X"}) {
		t.Fatalf("snippet lost keyword: %q", snippet)
	}
	if !utf8.ValidString(snippet) {
		t.Fatalf("snippet is not valid utf8: %q", snippet)
	}
	if strings.ContainsRune(snippet, utf8.RuneError) {
		t.Fatalf("snippet contains replacement rune: %q", snippet)
	}
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// TestRestoreTrashNoteRebuildsSearchIndex 从回收站恢复笔记后，
// 搜索索引必须随统一刷新机制重建，恢复后的内容可再次被搜索命中。
func TestRestoreTrashNoteRebuildsSearchIndex(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteID := "restore-search-note-1"
	noteDir := filepath.Join(testRepoRoot(t, svc), notesDir, "2026-09", noteID)
	rel := filepath.ToSlash(filepath.Join(notesDir, "2026-09", noteID))
	manifest := normalizeManifest(noteManifest{
		ID:        noteID,
		Title:     "恢复搜索目标",
		FaceOrder: []string{"text"},
		Faces: map[string]noteFaceManifest{
			"text": {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), "正文段落里提到 恢复关键词X。")

	if _, err := svc.refreshDerivedIndexesForNote(testRepoID(t, svc), rel, manifest); err != nil {
		t.Fatal(err)
	}
	before, err := svc.queryNoteSearch(testRepoID(t, svc), "恢复关键词X", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Items) != 1 || before.Items[0].NoteID != noteID {
		t.Fatalf("before trash items = %#v", before.Items)
	}

	// 移入回收站：搜索索引应被清理
	if _, err := svc.moveNoteToTrash(testRepoID(t, svc), mustJSONRaw(t, noteMeta{ID: noteID, Dir: rel})); err != nil {
		t.Fatal(err)
	}
	trashed, err := svc.queryNoteSearch(testRepoID(t, svc), "恢复关键词X", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(trashed.Items) != 0 {
		t.Fatalf("after trash items = %#v", trashed.Items)
	}

	// 从回收站恢复：搜索索引应重建，恢复后再次可命中
	items, err := svc.listTrash(testRepoID(t, svc))
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("trash items = %#v", items)
	}
	if _, err := svc.restoreTrashItem(testRepoID(t, svc), mustJSONRaw(t, items[0])); err != nil {
		t.Fatal(err)
	}
	restored, err := svc.queryNoteSearch(testRepoID(t, svc), "恢复关键词X", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.Items) != 1 || restored.Items[0].NoteID != noteID {
		t.Fatalf("after restore items = %#v", restored.Items)
	}
}

func TestSearchMethodsDispatch(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	params, err := json.Marshal(map[string]any{"scope": testRepoID(t, svc), "query": "不存在的内容xyz", "faceKinds": []string{}})
	if err != nil {
		t.Fatal(err)
	}
	out, err := svc.dispatch("hypercortex.search.query", params)
	if err != nil {
		t.Fatalf("dispatch query failed: %v", err)
	}
	res, ok := out.(noteSearchResult)
	if !ok {
		t.Fatalf("query result type = %T", out)
	}
	if len(res.Items) != 0 {
		t.Fatalf("query items = %#v", res.Items)
	}
	if !reflect.DeepEqual(res.Kinds, []noteSearchFaceKindInfo{{Kind: "markdown", Label: "文本"}}) {
		t.Fatalf("kinds = %#v", res.Kinds)
	}

	kindsOut, err := svc.dispatch("hypercortex.search.kinds", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("dispatch kinds failed: %v", err)
	}
	kinds, ok := kindsOut.([]noteSearchFaceKindInfo)
	if !ok || len(kinds) != 1 || kinds[0].Kind != "markdown" {
		t.Fatalf("kinds result = %#v", kindsOut)
	}
}

func TestSearchQueryHonorsLimitAndOffset(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	// 建 5 篇标题都含「分页目标」的笔记：分页切片时排序稳定、命中数量明确。
	for i := 0; i < 5; i++ {
		id := fmt.Sprintf("paging-note-%d", i)
		noteDir := filepath.Join(testRepoRoot(t, svc), notesDir, "2026-09", id)
		manifest := normalizeManifest(noteManifest{
			ID:        id,
			Title:     fmt.Sprintf("分页目标 %d", i),
			FaceOrder: []string{"text"},
			Faces: map[string]noteFaceManifest{
				"text": {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
			},
		})
		if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
			t.Fatal(err)
		}
		mustWriteFile(t, filepath.Join(noteDir, "text.md"), "分页目标 正文内容\n")
		if _, err := svc.refreshDerivedIndexesForNote(testRepoID(t, svc), filepath.ToSlash(filepath.Join(notesDir, "2026-09", id)), manifest); err != nil {
			t.Fatal(err)
		}
	}

	first, err := svc.queryNoteSearch(testRepoID(t, svc), "分页目标", nil, 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 2 {
		t.Fatalf("first page items = %d, want 2", len(first.Items))
	}
	second, err := svc.queryNoteSearch(testRepoID(t, svc), "分页目标", nil, 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 2 {
		t.Fatalf("second page items = %d, want 2", len(second.Items))
	}
	seen := map[string]bool{}
	for _, hit := range first.Items {
		seen[hit.NoteID] = true
	}
	for _, hit := range second.Items {
		if seen[hit.NoteID] {
			t.Fatalf("pages overlap on %s: first=%#v second=%#v", hit.NoteID, first.Items, second.Items)
		}
	}
	third, err := svc.queryNoteSearch(testRepoID(t, svc), "分页目标", nil, 2, 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(third.Items) != 1 {
		t.Fatalf("third page items = %d, want 1", len(third.Items))
	}
	beyond, err := svc.queryNoteSearch(testRepoID(t, svc), "分页目标", nil, 2, 99)
	if err != nil {
		t.Fatal(err)
	}
	if len(beyond.Items) != 0 {
		t.Fatalf("beyond items = %#v, want empty", beyond.Items)
	}
	all, err := svc.queryNoteSearch(testRepoID(t, svc), "分页目标", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all.Items) != 5 {
		t.Fatalf("default items = %d, want 5", len(all.Items))
	}
}

func TestSearchQueryDefaultLimitIs100AndCustomLimitIsFree(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	// 直接构造搜索索引（101 条命中项）：验证「不指定时默认上限 100」与「可自由指定上限」。
	idx := noteSearchIndex{Version: noteSearchIndexVersion, Notes: map[string]noteSearchEntry{}}
	for i := 0; i < 101; i++ {
		id := fmt.Sprintf("limit-note-%03d", i)
		idx.Notes[id] = noteSearchEntry{Title: fmt.Sprintf("上限目标 %d", i), Faces: []noteSearchFaceEntry{}}
	}
	if err := svc.saveNoteSearchIndex(testRepoID(t, svc), idx); err != nil {
		t.Fatal(err)
	}

	def, err := svc.queryNoteSearch(testRepoID(t, svc), "上限目标", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(def.Items) != 100 {
		t.Fatalf("default items = %d, want 100", len(def.Items))
	}
	free, err := svc.queryNoteSearch(testRepoID(t, svc), "上限目标", nil, 200, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(free.Items) != 101 {
		t.Fatalf("custom limit items = %d, want 101", len(free.Items))
	}
}
