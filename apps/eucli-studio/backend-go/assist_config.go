package main

import (
	"context"
	"strings"
)

// assistServiceSpec 是「AI 微服务」到 e-b 配置端点的唯一映射。
// 读路径（fetchAssistConfigs）与写路径（setAssistConfig）共用同一张表，
// 避免端点字面量散落在多个调用点。
type assistServiceSpec struct {
	key  string
	path string
}

var assistServiceSpecs = []assistServiceSpec{
	{key: "mermaidFix", path: "/api/assist/mermaid-fix/config"},
	{key: "chatTitleNaming", path: "/api/assist/chat-title/config"},
	{key: "stickerNaming", path: "/api/assist/stickers/name/config"},
	{key: "contextCompression", path: "/api/assist/context-compression/config"},
}

func assistServiceSpecByKey(key string) (assistServiceSpec, bool) {
	key = strings.TrimSpace(key)
	for _, spec := range assistServiceSpecs {
		if spec.key == key {
			return spec, true
		}
	}
	return assistServiceSpec{}, false
}

// setAssistConfig 只写「目标 service 对应的那一个端点」。
//
// 它不触碰本地 projection 偏好：客户端偏好（meta/index）与 e-b assist 配置
// 是两条独立的持久化事实，任何一侧失败都不应拖垮另一侧。
func (p *projectionService) setAssistConfig(ctx context.Context, service string, config map[string]any) error {
	spec, ok := assistServiceSpecByKey(service)
	if !ok {
		return newError("BAD_REQUEST", "未知的 AI 微服务："+strings.TrimSpace(service))
	}
	body := assistConfigBody(spec.key, config)
	if _, err := p.eb.request(ctx, ebRequest{Method: "PUT", Path: spec.path, Body: mustJSON(body)}); err != nil {
		return err
	}
	p.model.assist.invalidate()
	return nil
}

// assistConfigBody 把前端 settings.aiServices 的单个 service 配置转换成
// e-b assist 端点的写入体。contextCompression 的字段集合与其他服务不同，
// 因此在这里按 service key 收敛，而不是复制四份写入逻辑。
func assistConfigBody(service string, config map[string]any) map[string]any {
	kind := stringField(config, "kind")
	providerID := stringField(config, "providerId")
	groupID := stringField(config, "groupId")
	modelID := stringField(config, "modelId")
	coordinate := assistModelCoordinate(kind, providerID, groupID, modelID)
	if service == "contextCompression" {
		return map[string]any{
			"modelPick":            modelID,
			"coordinate":           coordinate,
			"retainRecentMessages": intField(config, "retainRecentMessages", 15),
			"lowTemperature":       boolField(config, "lowTemperature", true),
		}
	}
	return map[string]any{
		"enabled":        boolField(config, "enabled", false),
		"modelPick":      modelID,
		"coordinate":     coordinate,
		"systemPrompt":   stringField(config, "systemPrompt"),
		"lowTemperature": boolField(config, "lowTemperature", true),
	}
}
