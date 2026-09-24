package main

import (
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
