package main

import (
	"fmt"
	"sort"
	"strings"
)

// assetSearchDefaultLimit 是未指定条数时附件搜索返回的默认上限。
const assetSearchDefaultLimit = 100

// assetSearchQuery 是一次附件搜索请求的全部条件：文本维度、类型、大小、时间范围与分段。
type assetSearchQuery struct {
	Scope         string
	Query         string
	Fields        []string
	Kind          string
	SizeFrom      float64
	SizeTo        float64
	UpdatedFromMs float64
	UpdatedToMs   float64
	Limit         int
	Offset        int
}

// queryAssetSearch 在附件元信息上搜索附件：
// fields 选择参与文本匹配的维度（name/remark/tags 可自由组合；缺省为全部三项，name 覆盖显示名/来源名/文件名）；
// kind/sizeFrom/sizeTo/updatedFromMs/updatedToMs 为过滤条件；
// 未提供关键词时按过滤条件列出附件（按更新时间倒序），提供关键词时按命中维度计分排序。
func (svc *service) queryAssetSearch(query assetSearchQuery) ([]assetPoolItem, error) {
	limit := query.Limit
	if limit <= 0 {
		limit = assetSearchDefaultLimit
	}
	offset := query.Offset
	if offset < 0 {
		offset = 0
	}
	fieldSet := map[string]bool{}
	for _, field := range query.Fields {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		switch field {
		case "name", "remark", "tags":
			fieldSet[field] = true
		default:
			return nil, fmt.Errorf("未知的搜索维度：%s", field)
		}
	}
	explicitFields := len(fieldSet) > 0
	matchName := !explicitFields || fieldSet["name"]
	matchRemark := !explicitFields || fieldSet["remark"]
	matchTags := !explicitFields || fieldSet["tags"]

	tokens := normalizeSearchTokens(query.Query)
	kind := strings.TrimSpace(query.Kind)

	items, err := svc.listAssets(query.Scope)
	if err != nil {
		return nil, err
	}

	type assetSearchHit struct {
		item  assetPoolItem
		score int
	}
	hits := []assetSearchHit{}
	for _, item := range items {
		if kind != "" && item.Kind != kind {
			continue
		}
		if query.SizeFrom > 0 && float64(item.Size) < query.SizeFrom {
			continue
		}
		if query.SizeTo > 0 && float64(item.Size) > query.SizeTo {
			continue
		}
		if query.UpdatedFromMs > 0 && item.UpdatedAtMs < query.UpdatedFromMs {
			continue
		}
		if query.UpdatedToMs > 0 && item.UpdatedAtMs > query.UpdatedToMs {
			continue
		}
		score := 0
		if len(tokens) > 0 {
			if matchName && textMatchesTokens(assetSearchNameText(item), tokens) {
				score += 12
			}
			if matchRemark && textMatchesTokens(item.Remark, tokens) {
				score += 6
			}
			if matchTags && len(item.Tags) > 0 && textMatchesTokens(strings.Join(item.Tags, " "), tokens) {
				score += 6
			}
			if score == 0 {
				continue
			}
		}
		hits = append(hits, assetSearchHit{item: item, score: score})
	}
	sort.Slice(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		if hits[i].item.UpdatedAtMs != hits[j].item.UpdatedAtMs {
			return hits[i].item.UpdatedAtMs > hits[j].item.UpdatedAtMs
		}
		return hits[i].item.AssetID < hits[j].item.AssetID
	})
	if offset >= len(hits) {
		return []assetPoolItem{}, nil
	}
	hits = hits[offset:]
	if len(hits) > limit {
		hits = hits[:limit]
	}
	out := make([]assetPoolItem, 0, len(hits))
	for _, hit := range hits {
		out = append(out, hit.item)
	}
	return out, nil
}

// assetSearchNameText 汇总附件的「名字」文本：显示名 / 来源名 / 文件名。
func assetSearchNameText(item assetPoolItem) string {
	parts := make([]string, 0, 3)
	for _, part := range []string{item.DisplayName, item.SourceName, item.Name} {
		if text := strings.TrimSpace(part); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, " ")
}
