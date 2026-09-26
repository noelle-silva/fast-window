package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"

	"fast-window-hypercortex-backend/faceplugin"
	htmlplugin "fast-window-hypercortex-backend/faceplugins/html"
	markdownplugin "fast-window-hypercortex-backend/faceplugins/markdown"
)

// 官方面插件装配清单：宿主只登记插件包，不包含任何具体面类型的实现。
func init() {
	mustRegisterFacePlugin(markdownplugin.Plugin())
	mustRegisterFacePlugin(htmlplugin.Plugin())
}

func mustRegisterFacePlugin(plugin faceplugin.Plugin) {
	if err := faceplugin.Register(plugin); err != nil {
		panic(err)
	}
}

// facePluginsStateFile 记录已注册插件声明的指纹，用于检测声明变化并重建派生索引。
const facePluginsStateFile = "face-plugins-state.json"

type facePluginsState struct {
	Version                int    `json:"version"`
	DeclarationFingerprint string `json:"declarationFingerprint"`
}

// faceDeclarationFingerprint 计算当前已注册插件声明（含能力与设置）的稳定指纹。
func faceDeclarationFingerprint() string {
	payload, err := json.Marshal(faceplugin.ListDeclarations())
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:8])
}

// ensurePluginDataState 保证派生索引与当前插件声明一致：
// 声明指纹变化（或首次运行）时全量重建引用索引与搜索索引，然后记录新指纹。
func (svc *service) ensurePluginDataState() error {
	svc.pluginStateOnce.Do(func() {
		svc.pluginStateErr = svc.reconcilePluginDataState()
	})
	return svc.pluginStateErr
}

func (svc *service) reconcilePluginDataState() error {
	fingerprint := faceDeclarationFingerprint()
	path := filepath.Join(svc.libraryDir, facePluginsStateFile)
	var state facePluginsState
	if err := readJSONFile(path, &state); err == nil && state.DeclarationFingerprint != "" && state.DeclarationFingerprint == fingerprint {
		return nil
	}
	log.Printf("面插件声明发生变化，重建派生索引（指纹 %s）", fingerprint)
	if err := svc.rebuildRefsIndex("library"); err != nil {
		return fmt.Errorf("重建引用索引失败：%w", err)
	}
	if err := svc.rebuildSearchIndex("library"); err != nil {
		return fmt.Errorf("重建搜索索引失败：%w", err)
	}
	return writeJSONFile(path, facePluginsState{Version: 1, DeclarationFingerprint: fingerprint})
}
