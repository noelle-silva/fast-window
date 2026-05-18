package main

import (
	"encoding/json"
	"strings"
)

type sseState struct {
	Buf          string
	Done         bool
	FinishReason string
}

func sseFeedGo(state *sseState, chunkText string, onJSON func(map[string]any) error) (bool, error) {
	if state == nil {
		return false, nil
	}
	if chunkText == "" {
		return state.Done, nil
	}
	state.Buf += chunkText
	if strings.Contains(state.Buf, "\r") {
		state.Buf = strings.ReplaceAll(state.Buf, "\r", "")
	}
	for {
		idx := strings.Index(state.Buf, "\n\n")
		if idx < 0 {
			break
		}
		block := state.Buf[:idx]
		state.Buf = state.Buf[idx+2:]
		lines := strings.Split(block, "\n")
		datas := make([]string, 0, len(lines))
		for _, line := range lines {
			if line == "" || strings.HasPrefix(line, ":") {
				continue
			}
			if strings.HasPrefix(line, "data:") {
				datas = append(datas, strings.TrimLeft(line[5:], " \t"))
			}
		}
		data := strings.TrimSpace(strings.Join(datas, "\n"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			state.Done = true
			break
		}
		var jsonValue map[string]any
		if err := json.Unmarshal([]byte(data), &jsonValue); err != nil {
			continue
		}
		if onJSON != nil {
			if err := onJSON(jsonValue); err != nil {
				return state.Done, err
			}
		}
		if finishReason := finishReasonOf(jsonValue); finishReason != "" {
			state.Done = true
			state.FinishReason = finishReason
			break
		}
	}
	return state.Done, nil
}

func extractOpenAIDeltaGo(jsonValue map[string]any) string {
	choices := asSlice(jsonValue["choices"])
	if len(choices) > 0 {
		choice := asMap(choices[0])
		delta := asMap(choice["delta"])
		if content := asString(delta["content"]); content != "" {
			return content
		}
		if text := asString(delta["text"]); text != "" {
			return text
		}
		if text := asString(choice["text"]); text != "" {
			return text
		}
	}
	return asString(jsonValue["output_text"])
}

func finishReasonOf(jsonValue map[string]any) string {
	choices := asSlice(jsonValue["choices"])
	if len(choices) > 0 {
		choice := asMap(choices[0])
		if value := firstFinishReason(choice); value != "" {
			return value
		}
		if value := firstFinishReason(asMap(choice["delta"])); value != "" {
			return value
		}
	}
	return firstFinishReason(jsonValue)
}

func firstFinishReason(obj map[string]any) string {
	if obj == nil {
		return ""
	}
	keys := []string{"finish_reason", "finishReason", "stop_reason", "stopReason"}
	for _, key := range keys {
		value := strings.TrimSpace(asString(obj[key]))
		if value != "" {
			return value
		}
	}
	return ""
}
