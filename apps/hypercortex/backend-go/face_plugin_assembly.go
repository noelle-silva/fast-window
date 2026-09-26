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

// ensureRepoPluginState 保证指定仓库的派生索引与当前插件声明一致：
// 声明指纹变化（或首次激活）时全量重建引用索引与搜索索引，然后记录新指纹。
// 每个仓库在进程内只调和一次；调和结果同时受仓库激活入口调用约束。
func (svc *service) ensureRepoPluginState(repoID string) error {
	svc.pluginMu.Lock()
	defer svc.pluginMu.Unlock()
	if svc.pluginReadyRepos[repoID] {
		return nil
	}
	if err := svc.reconcileRepoPluginState(repoID); err != nil {
		return err
	}
	svc.pluginReadyRepos[repoID] = true
	return nil
}

func (svc *service) reconcileRepoPluginState(repoID string) error {
	fingerprint := faceDeclarationFingerprint()
	root, err := svc.repoRoot(repoID)
	if err != nil {
		return err
	}
	path := filepath.Join(root, facePluginsStateFile)
	var state facePluginsState
	if err := readJSONFile(path, &state); err == nil && state.DeclarationFingerprint != "" && state.DeclarationFingerprint == fingerprint {
		return nil
	}
	log.Printf("仓库 %s 的面插件声明发生变化，重建派生索引（指纹 %s）", repoID, fingerprint)
	if err := svc.rebuildRefsIndex(repoID); err != nil {
		return fmt.Errorf("重建引用索引失败：%w", err)
	}
	if err := svc.rebuildSearchIndex(repoID); err != nil {
		return fmt.Errorf("重建搜索索引失败：%w", err)
	}
	return writeJSONFile(path, facePluginsState{Version: 1, DeclarationFingerprint: fingerprint})
}
