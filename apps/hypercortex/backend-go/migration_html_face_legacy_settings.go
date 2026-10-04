package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	htmlplugin "fast-window-hypercortex-backend/faceplugins/html"
)

const htmlFaceLegacySettingsMigration = "2026-09-26-html-face-legacy-global-settings"

// migrateHTMLFaceLegacySettings 把旧版 HTML 面全局字段（htmlFaceDisplayMode / htmlFaceFixedScaleDefault）
// 搬入面插件设置统一容器（facePluginSettings.html），版本 6 → 7 的一次性数据升级。
// 规则与早期前端临时迁移一致：容器已有值优先；旧字段原样保留（版本回退时设置不丢失）。
func (svc *service) migrateHTMLFaceLegacySettings() error {
	path := filepath.Join(svc.stateDir, metadataFile)
	var meta map[string]any
	if err := readJSONFile(path, &meta); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("读取元数据失败：%w", err)
	}
	next, changed := mergeHTMLFaceLegacySettings(meta)
	if !changed {
		return nil
	}
	return writeJSONFile(path, next)
}

// mergeHTMLFaceLegacySettings 执行旧字段到设置容器的合并（纯函数）：返回合并结果与是否发生变化。
func mergeHTMLFaceLegacySettings(meta map[string]any) (map[string]any, bool) {
	if meta == nil {
		return meta, false
	}
	legacyMode, hasMode := meta["htmlFaceDisplayMode"]
	legacyScale, hasScale := meta["htmlFaceFixedScaleDefault"]
	if !hasMode && !hasScale {
		return meta, false
	}

	container, _ := meta["facePluginSettings"].(map[string]any)
	htmlRaw, _ := container["html"].(map[string]any)
	html := map[string]any{}
	for key, value := range htmlRaw {
		html[key] = value
	}

	changed := false
	if hasMode {
		if _, exists := html["displayMode"]; !exists {
			html["displayMode"] = htmlplugin.NormalizeLegacyDisplayMode(legacyMode)
			changed = true
		}
	}
	if hasScale {
		if _, exists := html["fixedScale"]; !exists {
			html["fixedScale"] = htmlplugin.NormalizeLegacyFixedScale(legacyScale)
			changed = true
		}
	}
	if !changed {
		return meta, false
	}
	if container == nil {
		container = map[string]any{}
	}
	container["html"] = html
	meta["facePluginSettings"] = container
	return meta, true
}
