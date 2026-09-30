package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestAssetSearchMatchesAndFilters(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	root := testRepoRoot(t, svc)

	idA := strings.Repeat("a", 64)
	idB := strings.Repeat("b", 64)
	idC := strings.Repeat("c", 64)
	entries := map[string]assetIndexEntry{}
	makeAsset := func(id string, ext string, category string, size int, displayName string, sourceName string, remark string, tags []string, updatedMs float64) {
		rel := filepath.ToSlash(filepath.Join(assetsDir, category, "2026-09", id+"."+ext))
		mustWriteFile(t, filepath.Join(root, filepath.FromSlash(rel)), strings.Repeat("x", size))
		entry := newAssetMetadata(assetIndexEntry{
			AssetID:     id,
			Ext:         ext,
			Path:        rel,
			DisplayName: displayName,
			SourceName:  sourceName,
			Remark:      remark,
			Tags:        tags,
			Size:        int64(size),
			UpdatedAtMs: updatedMs,
		})
		entries[assetKey(id, ext)] = entry
	}
	makeAsset(idA, "pdf", "docs", 1000, "季度报告", "report.pdf", "", []string{"财务"}, 100)
	makeAsset(idB, "png", "images", 5000, "", "photo.png", "会议记录", nil, 200)
	makeAsset(idC, "txt", "docs", 200, "", "notes.txt", "", []string{"财务", "笔记"}, 300)
	if err := svc.saveAssetIndex(scope, assetIndex{Version: assetIndexVersion, Assets: entries}); err != nil {
		t.Fatal(err)
	}

	count := func(query assetSearchQuery) []assetPoolItem {
		query.Scope = scope
		page, err := svc.queryAssetSearch(query)
		if err != nil {
			t.Fatalf("query %#v failed: %v", query, err)
		}
		return page.Items
	}

	// 关键词全维度（名字/备注/标签）：财务命中 A、C 的标签
	if items := count(assetSearchQuery{Query: "财务"}); len(items) != 2 {
		t.Fatalf("tags match = %d, want 2", len(items))
	}
	// 仅名字维度：报告命中 A 的显示名
	items := count(assetSearchQuery{Query: "报告", Fields: []string{"name"}})
	if len(items) != 1 || items[0].AssetID != idA {
		t.Fatalf("name-only = %#v", items)
	}
	// 仅备注维度：会议命中 B
	items = count(assetSearchQuery{Query: "会议", Fields: []string{"remark"}})
	if len(items) != 1 || items[0].AssetID != idB {
		t.Fatalf("remark-only = %#v", items)
	}
	// 名字维度不含系统编号：按编号片段搜索不应命中
	if items := count(assetSearchQuery{Query: strings.Repeat("a", 8)}); len(items) != 0 {
		t.Fatalf("asset id must not match name dimension: %#v", items)
	}
	// 类型过滤：image 只命中 B
	items = count(assetSearchQuery{Kind: "image"})
	if len(items) != 1 || items[0].AssetID != idB {
		t.Fatalf("kind filter = %#v", items)
	}
	// 大小范围
	if items := count(assetSearchQuery{SizeFrom: 1000}); len(items) != 2 {
		t.Fatalf("sizeFrom = %d, want 2", len(items))
	}
	if items := count(assetSearchQuery{SizeTo: 1000}); len(items) != 2 {
		t.Fatalf("sizeTo = %d, want 2", len(items))
	}
	// 更新时间范围：200 之后的 B、C，按更新时间倒序
	items = count(assetSearchQuery{UpdatedFromMs: 200})
	if len(items) != 2 || items[0].AssetID != idC || items[1].AssetID != idB {
		t.Fatalf("updatedFrom = %#v", items)
	}
	// 无条件：全部 3 条，按更新时间倒序 C、B、A
	items = count(assetSearchQuery{})
	if len(items) != 3 || items[0].AssetID != idC || items[1].AssetID != idB || items[2].AssetID != idA {
		t.Fatalf("no condition = %#v", items)
	}
	// 分页
	items = count(assetSearchQuery{Limit: 1, Offset: 1})
	if len(items) != 1 || items[0].AssetID != idB {
		t.Fatalf("paging = %#v", items)
	}
	// 未知维度快速失败
	if _, err := svc.queryAssetSearch(assetSearchQuery{Scope: scope, Query: "x", Fields: []string{"unknown"}}); err == nil {
		t.Fatal("unknown field must be rejected")
	}
}
