package main

import (
	"fast-window-hypercortex-backend/faceplugin"
	markdownplugin "fast-window-hypercortex-backend/faceplugins/markdown"
)

// 官方面插件装配清单：宿主只登记插件包，不包含任何具体面类型的实现。
func init() {
	mustRegisterFacePlugin(markdownplugin.Plugin())
	// 网页面暂以宿主内注册接入同一注册表，过程 3 迁移为独立插件包。
	mustRegisterFacePlugin(htmlFacePlugin())
}

func mustRegisterFacePlugin(plugin faceplugin.Plugin) {
	if err := faceplugin.Register(plugin); err != nil {
		panic(err)
	}
}
