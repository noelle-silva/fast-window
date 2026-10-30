package main

import "strings"

// 角色模型的客户端投影：把业务端的候选模型池翻译为界面字段。
// 业务端候选池是唯一事实源；候选标识由坐标推导，客户端不维护第二套标识空间。
// 兼容旧业务端的单一坐标形态：坐标直接翻译为「一个候选 + 它即默认」。

func uiModelRefFromCoordinate(coordinate map[string]any) map[string]any {
	kind := stringField(coordinate, "kind")
	if kind == "" {
		kind = "provider"
	}
	return map[string]any{
		"kind":       kind,
		"groupId":    stringField(coordinate, "groupId"),
		"providerId": stringField(coordinate, "providerId"),
		"modelId":    stringField(coordinate, "modelId"),
	}
}

func coordinateCandidateID(coordinate map[string]any) string {
	modelID := stringField(coordinate, "modelId")
	groupID := stringField(coordinate, "groupId")
	if stringField(coordinate, "kind") == "model_group" || groupID != "" {
		return "model_group:" + groupID + ":" + modelID
	}
	return "provider:" + stringField(coordinate, "providerId") + ":" + modelID
}

// uiModelCandidates 输出候选池的坐标清单；空坐标项被跳过。
func uiModelCandidates(modelConfig map[string]any) []any {
	raw := objectList(modelConfig["candidates"])
	if len(raw) == 0 {
		coordinate := objectMap(modelConfig["coordinate"])
		if strings.TrimSpace(stringField(coordinate, "modelId")) == "" {
			return []any{}
		}
		return []any{uiModelRefFromCoordinate(coordinate)}
	}
	out := make([]any, 0, len(raw))
	for _, item := range raw {
		ref := uiModelRefFromCoordinate(objectMap(item["coordinate"]))
		if strings.TrimSpace(stringField(ref, "modelId")) == "" {
			continue
		}
		out = append(out, ref)
	}
	return out
}

// uiDefaultCandidateID 把业务端的默认候选标识翻译为坐标推导标识；
// 旧形态的单一坐标天然成为默认候选。
func uiDefaultCandidateID(modelConfig map[string]any, candidates []any) string {
	if id := stringField(modelConfig, "defaultCandidateId"); id != "" {
		for _, item := range objectList(modelConfig["candidates"]) {
			if stringField(item, "id") != id {
				continue
			}
			return coordinateCandidateID(objectMap(item["coordinate"]))
		}
	}
	if len(candidates) == 1 {
		return coordinateCandidateID(objectMap(candidates[0]))
	}
	return ""
}

func boxModelConfigFromUI(role map[string]any) map[string]any {
	candidates := make([]any, 0)
	for _, item := range objectList(role["modelCandidates"]) {
		coordinate := map[string]any{
			"kind":       fallback(stringField(item, "kind"), "provider"),
			"groupId":    stringField(item, "groupId"),
			"providerId": stringField(item, "providerId"),
			"modelId":    stringField(item, "modelId"),
		}
		if strings.TrimSpace(stringField(coordinate, "modelId")) == "" {
			continue
		}
		candidates = append(candidates, map[string]any{"id": coordinateCandidateID(coordinate), "coordinate": coordinate})
	}
	return map[string]any{
		"candidates":         candidates,
		"defaultCandidateId": stringField(role, "defaultModelCandidateId"),
		"temperature":        numberField(role, "temperature", 1),
		"temperatureEnabled": boolField(role, "temperatureEnabled", false),
	}
}
