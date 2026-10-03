package main

import "strings"

// searchFieldOption 是一个可勾选的文本匹配维度（键 + 展示名）。
type searchFieldOption struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// searchKindOption 是一个可勾选的数据类型（类型标识 + 展示名）。
type searchKindOption struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}

// searchCatalog 是界面搜索过滤项的完整事实源：
// 笔记与附件各自可用的匹配维度、可搜面类型与附件类型全部由后端出口动态给出，
// 前端不保留任何维度或类型镜像；查询请求里的维度键以本目录为准。
type searchCatalog struct {
	NoteFields    []searchFieldOption      `json:"noteFields"`
	NoteFaceKinds []noteSearchFaceKindInfo `json:"noteFaceKinds"`
	AssetFields   []searchFieldOption      `json:"assetFields"`
	AssetKinds    []searchKindOption       `json:"assetKinds"`
}

// 笔记匹配维度：标题 / 简介 / 标签 / 正文（顺序即界面展示顺序）。
var noteSearchFieldOptions = []searchFieldOption{
	{Key: "title", Label: "标题"},
	{Key: "description", Label: "简介"},
	{Key: "tags", Label: "标签"},
	{Key: "content", Label: "正文"},
}

// 附件匹配维度：名称 / 备注 / 标签（名称覆盖显示名与来源名）。
var assetSearchFieldOptions = []searchFieldOption{
	{Key: "name", Label: "名称"},
	{Key: "remark", Label: "备注"},
	{Key: "tags", Label: "标签"},
}

// assetSearchKindLabels 是附件类型展示名；类型集合从文件类型目录派生，避免双事实源。
var assetSearchKindLabels = map[string]string{
	"image":    "图片",
	"audio":    "音频",
	"video":    "视频",
	"document": "文档",
}

func buildSearchCatalog() searchCatalog {
	return searchCatalog{
		NoteFields:    noteSearchFieldOptions,
		NoteFaceKinds: listSearchableFaceKinds(),
		AssetFields:   assetSearchFieldOptions,
		AssetKinds:    listAssetSearchKinds(),
	}
}

// searchFieldSet 把维度选项收敛为校验集合（键唯一）。
func searchFieldSet(options []searchFieldOption) map[string]bool {
	set := map[string]bool{}
	for _, option := range options {
		set[option.Key] = true
	}
	return set
}

// listAssetSearchKinds 按文件类型目录的首次出现顺序列出附件类型，标签缺失时回落为类型标识。
func listAssetSearchKinds() []searchKindOption {
	seen := map[string]bool{}
	out := []searchKindOption{}
	for _, item := range assetFileTypes {
		kind := strings.TrimSpace(item.Kind)
		if kind == "" || seen[kind] {
			continue
		}
		seen[kind] = true
		label := assetSearchKindLabels[kind]
		if label == "" {
			label = kind
		}
		out = append(out, searchKindOption{Kind: kind, Label: label})
	}
	return out
}
