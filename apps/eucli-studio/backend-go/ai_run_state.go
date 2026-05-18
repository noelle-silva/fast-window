package main

import "strings"

func normalizeAssistantRunFinalStatusGo(status string) string {
	value := strings.TrimSpace(status)
	if value == "failed" || value == "canceled" {
		return value
	}
	return "succeeded"
}

func isAssistantRunActiveStatusGo(status string) bool {
	value := strings.TrimSpace(status)
	return value == "queued" || value == "running"
}

func assistantRunGenerationIDGo(msg map[string]any) string {
	if msg == nil {
		return ""
	}
	run := asMap(msg["assistantRun"])
	if run == nil {
		return ""
	}
	return strings.TrimSpace(asString(run["generationId"]))
}

func isAssistantRunCurrentGo(msg map[string]any, generationID string) bool {
	wanted := strings.TrimSpace(generationID)
	return wanted != "" && assistantRunGenerationIDGo(msg) == wanted
}

func isAssistantGeneratingGo(msg map[string]any) bool {
	if msg == nil || strings.TrimSpace(asString(msg["role"])) != "assistant" {
		return false
	}
	if truthy(msg["pending"]) {
		return true
	}
	run := asMap(msg["assistantRun"])
	return run != nil && isAssistantRunActiveStatusGo(asString(run["status"]))
}

func finishAssistantRunMessageGo(msg map[string]any, content string, status string, finishedAt int64) {
	if msg == nil {
		return
	}
	if finishedAt <= 0 {
		finishedAt = nowMs()
	}
	finalStatus := normalizeAssistantRunFinalStatusGo(status)
	msg["content"] = content
	msg["pending"] = false
	msg["streaming"] = false
	if finalStatus == "succeeded" {
		delete(msg, "error")
	} else {
		msg["error"] = finalStatus
	}

	run := asMap(msg["assistantRun"])
	if run == nil {
		return
	}
	next := map[string]any{}
	for key, value := range run {
		next[key] = value
	}
	next["status"] = finalStatus
	next["updatedAt"] = finishedAt
	next["finishedAt"] = finishedAt
	msg["assistantRun"] = next
}
