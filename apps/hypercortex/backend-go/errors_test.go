package main

import (
	"fmt"
	"io/fs"
	"os"
	"strings"
	"testing"
)

func TestConvergeErrorMessageMapsFilesystemFailures(t *testing.T) {
	missing := &fs.PathError{Op: "open", Path: `E:\vault\repos\fd5ae1648030e14ec8391c5735e325cb\Notes\a\manifest.json`, Err: os.ErrNotExist}
	if got := convergeErrorMessage("hypercortex.notes.loadManifest", missing); got != "笔记不存在" {
		t.Fatalf("not-exist message = %q", got)
	}
	failed := &fs.PathError{Op: "open", Path: `E:\vault\b.json`, Err: os.ErrPermission}
	if got := convergeErrorMessage("hypercortex.assets.list", failed); got != "附件数据不可用" {
		t.Fatalf("unavailable message = %q", got)
	}
	if got := convergeErrorMessage("hypercortex.trash.list", failed); got != "回收站数据不可用" {
		t.Fatalf("subject mapping = %q", got)
	}
	if got := convergeErrorMessage("hypercortex.refs.queryRelations", os.ErrNotExist); got != "引用关系不存在" {
		t.Fatalf("bare sentinel = %q", got)
	}
}

func TestConvergeErrorMessageKeepsDomainTextAndMasksPaths(t *testing.T) {
	domain := fmt.Errorf("仓库不存在：%s", "abc")
	if got := convergeErrorMessage("hypercortex.repos.purge", domain); got != "仓库不存在：abc" {
		t.Fatalf("domain text changed: %q", got)
	}
	leaked := fmt.Errorf("读取失败：open E:\\vault\\fd5ae1648030e14ec8391c5735e325cb\\manifest.json 失败")
	got := convergeErrorMessage("hypercortex.notes.loadManifest", leaked)
	if strings.Contains(got, `E:\`) || strings.Contains(got, "fd5ae1648030e14ec8391c5735e325cb") {
		t.Fatalf("path or internal id leaked: %q", got)
	}
	if !strings.Contains(got, "（路径已收敛）") {
		t.Fatalf("mask placeholder missing: %q", got)
	}
}

func TestErrorSubjectMapsMethodFamilies(t *testing.T) {
	cases := map[string]string{
		"hypercortex.notes.loadFace":     "笔记",
		"hypercortex.assets.readDataUrl": "附件",
		"hypercortex.favorites.tryLoad":  "收藏夹",
		"hypercortex.trash.list":         "回收站",
		"hypercortex.repos.list":         "仓库",
		"hypercortex.access.load":        "访问配置",
		"hypercortex.unknown.method":     "数据",
	}
	for method, want := range cases {
		if got := errorSubject(method); got != want {
			t.Fatalf("errorSubject(%q) = %q, want %q", method, got, want)
		}
	}
}
