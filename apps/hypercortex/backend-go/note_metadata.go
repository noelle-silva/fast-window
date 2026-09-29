package main

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
)

// updateNoteMetadata 增量更新笔记级元数据：只改提交的字段（标题/简介/标签），
// 缺失字段沿用旧值；expectedVersion 与保存接口共用同一防覆盖保险丝语义。
// 这是笔记元数据的唯一独立写入通道：不触碰任何面内容与资源清单。
func (svc *service) updateNoteMetadata(scope string, packageDir string, raw json.RawMessage, expectedVersion float64) (any, error) {
	dir := strings.TrimSpace(packageDir)
	if dir == "" {
		return nil, errors.New("缺少笔记目录")
	}
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	rawTitle, hasTitle := input["title"]
	rawDescription, hasDescription := input["description"]
	rawTags, hasTags := input["tags"]
	if !hasTitle && !hasDescription && !hasTags {
		return nil, errors.New("至少提供 title、description、tags 之一")
	}
	manifest, err := svc.loadNoteManifest(scope, dir)
	if err != nil {
		return nil, err
	}
	// 防覆盖保险丝：版本不一致时拒绝写入并回报当前版本。
	if err := checkVersionConflict("笔记", expectedVersion, manifest.UpdatedAtMs); err != nil {
		return nil, err
	}
	changed := false
	if hasTitle {
		title := strings.TrimSpace(asString(rawTitle))
		if title == "" {
			return nil, errors.New("笔记标题不能为空")
		}
		if title != manifest.Title {
			manifest.Title = title
			changed = true
		}
	}
	if hasDescription {
		description := strings.TrimSpace(asString(rawDescription))
		if description != manifest.Description {
			manifest.Description = description
			changed = true
		}
	}
	if hasTags {
		if _, ok := rawTags.([]any); !ok {
			return nil, errors.New("tags 必须是数组")
		}
		tags := normalizeTags(rawTags)
		if !sameStringList(tags, manifest.Tags) {
			manifest.Tags = tags
			changed = true
		}
	}
	if !changed {
		return map[string]any{"version": manifest.UpdatedAtMs, "changed": false}, nil
	}
	manifest.UpdatedAtMs = nowMs()
	manifest = normalizeManifest(manifest)
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(dir, manifestFile)), manifest); err != nil {
		return nil, err
	}
	meta := noteMeta{ID: manifest.ID, Title: manifest.Title, Description: manifest.Description, Dir: filepath.ToSlash(dir), CreatedAtMs: manifest.CreatedAtMs, UpdatedAtMs: manifest.UpdatedAtMs}
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	if _, err := svc.refreshDerivedIndexesForNote(scope, dir, manifest); err != nil {
		return nil, err
	}
	return map[string]any{"version": manifest.UpdatedAtMs, "changed": true, "meta": meta}, nil
}

// sameStringList 判断两个字符串列表是否逐项相等。
func sameStringList(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
