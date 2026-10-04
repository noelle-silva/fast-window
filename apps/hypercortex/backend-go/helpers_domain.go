package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func nowMs() float64 {
	return float64(time.Now().UnixMilli())
}

// searchDefaultLimit 是搜索未指定条数时的统一默认上限（笔记搜索与附件搜索共用）。
const searchDefaultLimit = 100

// noteSearchFields 与 assetSearchFields 是两类搜索各自允许的匹配维度集合，
// 从搜索目录的维度选项派生（单一事实源），查询校验与界面出口永远一致。
var noteSearchFields = searchFieldSet(noteSearchFieldOptions)
var assetSearchFields = searchFieldSet(assetSearchFieldOptions)

// normalizeSearchWindow 归一化搜索的条数与起始位置：条数 <=0 取统一默认上限，偏移 <0 归 0。
func normalizeSearchWindow(limit int, offset int) (int, int) {
	if limit <= 0 {
		limit = searchDefaultLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// normalizeSearchFields 把提交的匹配维度收敛为集合；未知维度快速失败。
func normalizeSearchFields(fields []string, allowed map[string]bool) (map[string]bool, error) {
	set := map[string]bool{}
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		if !allowed[field] {
			return nil, fmt.Errorf("未知的搜索维度：%s", field)
		}
		set[field] = true
	}
	return set, nil
}

func asString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return fmt.Sprintf("%.0f", v)
	case json.Number:
		return v.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

func asFloat(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case int:
		return float64(v)
	case json.Number:
		f, _ := v.Float64()
		return f
	default:
		return 0
	}
}

func normalizeTags(value any) []string {
	list, ok := value.([]any)
	if !ok {
		return []string{}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, item := range list {
		tag := strings.TrimSpace(asString(item))
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	return out
}

func normalizeResources(value any) []resourceRef {
	list, ok := value.([]any)
	if !ok {
		return []resourceRef{}
	}
	seen := map[string]bool{}
	out := []resourceRef{}
	for _, item := range list {
		rec, ok := item.(map[string]any)
		if !ok {
			continue
		}
		assetID := strings.TrimSpace(asString(rec["assetId"]))
		if assetID == "" || seen[assetID] {
			continue
		}
		seen[assetID] = true
		out = append(out, resourceRef{AssetID: assetID, Mime: strings.TrimSpace(asString(rec["mime"])), Ext: strings.TrimSpace(asString(rec["ext"])), Kind: strings.TrimSpace(asString(rec["kind"])), Name: strings.TrimSpace(asString(rec["name"]))})
	}
	return out
}

func noteID() string {
	return time.Now().Format("20060102150405") + fmt.Sprintf("%03d", time.Now().Nanosecond()/1e6)
}

func mimeFromExt(ext string) string {
	return assetFileMimeFromExt(ext)
}

func kindFromMime(m string) string {
	m = normalizeAssetMime(m)
	if kind := assetFileKindFromMime(m); kind != "" {
		return kind
	}
	if strings.HasPrefix(m, "image/") {
		return "image"
	}
	if strings.HasPrefix(m, "video/") {
		return "video"
	}
	if strings.HasPrefix(m, "audio/") {
		return "audio"
	}
	return "document"
}

func categoryFromKind(kind string) string {
	switch kind {
	case "image":
		return "images"
	case "video", "audio":
		return "videos"
	default:
		return "docs"
	}
}

func parseAssetFileName(name string) (string, string) {
	s := strings.TrimSpace(name)
	dot := strings.LastIndex(s, ".")
	if dot <= 0 {
		return s, ""
	}
	return s[:dot], strings.ToLower(s[dot+1:])
}

func assetKey(assetID string, ext string) string {
	assetID = strings.TrimSpace(assetID)
	ext = strings.Trim(strings.ToLower(strings.TrimSpace(ext)), ".")
	if ext == "" {
		return assetID
	}
	return assetID + "." + ext
}

// assetMarker 生成可直接写入笔记正文的资产引用标记。
// 协议双实现：前端 src/assetMarker.ts 是界面侧实现（复制/插入用），这里是数据侧实现
// （上传结果携带的 marker）；默认宽度规则（图片 320、视频 480）改动时两端必须同步。
func assetMarker(assetID string, ext string, kind string) string {
	ref := assetKey(assetID, ext)
	if ref == "" {
		return ""
	}
	switch strings.TrimSpace(kind) {
	case "image":
		return "{{asset:" + ref + "||320}}"
	case "video":
		return "{{asset:" + ref + "||480}}"
	default:
		return "{{asset:" + ref + "}}"
	}
}
