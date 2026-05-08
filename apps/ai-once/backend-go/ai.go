package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type httpDoer interface { Do(*http.Request) (*http.Response, error) }

var httpClient httpDoer = &http.Client{Timeout: 60 * time.Second}

func (s *service) refreshModels(providerID string) (AppData, error) {
	data, err := s.readData(); if err != nil { return data, err }
	idx := providerIndex(data, firstNonEmpty(providerID, data.Settings.ActiveProviderID))
	if idx < 0 { return data, errors.New("供应商不存在") }
	p := data.Settings.Providers[idx]
	if err := requireProvider(p, false); err != nil { return data, err }
	req, err := http.NewRequest(http.MethodGet, trimSlash(p.BaseURL)+"/models", nil); if err != nil { return data, err }
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(p.APIKey))
	res, err := httpClient.Do(req); if err != nil { return data, err }
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 { return data, fmt.Errorf("models HTTP %d: %s", res.StatusCode, string(body)) }
	ids, err := parseModels(body); if err != nil { return data, err }
	data.Settings.Providers[idx].ModelsCache = ModelsCache{Items: ids, FetchedAt: time.Now().UnixMilli()}
	return s.saveData(data)
}

func parseModels(body []byte) ([]string, error) {
	var raw struct { Data []map[string]any `json:"data"`; Models []map[string]any `json:"models"` }
	if err := json.Unmarshal(body, &raw); err != nil { return nil, err }
	list := raw.Data
	if len(list) == 0 { list = raw.Models }
	if list == nil { return nil, errors.New("models 响应格式不支持（期望 data[] 或 models[]）") }
	ids := make([]string, 0, len(list))
	seen := map[string]bool{}
	for _, item := range list {
		id, _ := item["id"].(string)
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] { seen[id] = true; ids = append(ids, id) }
	}
	return sortedModelIDs(ids), nil
}

func (s *service) ask(req AskRequest) (HistoryEntry, error) {
	data, err := s.readData(); if err != nil { return HistoryEntry{}, err }
	providerID := firstNonEmpty(req.ProviderID, data.Settings.ActiveProviderID)
	pi := providerIndex(data, providerID)
	if pi < 0 { return HistoryEntry{}, errors.New("供应商不存在") }
	space, si := findSpace(data, req.SpaceID)
	if si < 0 { return HistoryEntry{}, errors.New("空间不存在") }
	tpl := findTemplate(space, firstNonEmpty(req.TemplateID, space.ActiveTemplateID))
	if tpl.ID == "" { return HistoryEntry{}, errors.New("模板不存在") }
	model := strings.TrimSpace(req.Model)
	if model == "" { model = strings.TrimSpace(space.DefaultModelByProvider[providerID]) }
	if model == "" { return HistoryEntry{}, errors.New("请选择/填写模型") }
	input := strings.TrimSpace(req.Input)
	if input == "" && len(req.Images) == 0 { return HistoryEntry{}, errors.New("输入不能为空") }
	if err := validateImages(req.Images, data.Settings.ImageMaxCount, data.Settings.ImageMaxMB); err != nil { return HistoryEntry{}, err }
	p := data.Settings.Providers[pi]
	if err := requireProvider(p, true); err != nil { return HistoryEntry{}, err }
	messages := buildMessages(tpl.SystemPrompt, input, req.Images)
	payload := map[string]any{"model": model, "messages": messages, "temperature": 0.2, "stream": false}
	out, callErr := callChatCompletion(p, payload)
	entry := HistoryEntry{ID: newID("hist"), SpaceID: space.ID, TemplateID: tpl.ID, ProviderID: providerID, Model: model, Input: input, Output: out, Images: imageMetas(req.Images), CreatedAt: time.Now().Format(time.RFC3339)}
	if callErr != nil { entry.Error = callErr.Error() }
	data.Spaces[si].DefaultModelByProvider[providerID] = model
	data.Spaces[si].UpdatedAt = time.Now().UnixMilli()
	_ = s.writeData(data)
	_ = s.appendHistory(entry)
	if callErr != nil { return entry, callErr }
	return entry, nil
}

func buildMessages(systemPrompt, input string, images []DraftImage) []map[string]any {
	messages := []map[string]any{}
	if strings.TrimSpace(systemPrompt) != "" { messages = append(messages, map[string]any{"role": "system", "content": systemPrompt}) }
	if len(images) == 0 { return append(messages, map[string]any{"role": "user", "content": input}) }
	parts := []map[string]any{}
	if input != "" { parts = append(parts, map[string]any{"type": "text", "text": input}) }
	for _, img := range images { parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": img.DataURL}}) }
	return append(messages, map[string]any{"role": "user", "content": parts})
}

func callChatCompletion(p Provider, payload map[string]any) (string, error) {
	b, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, trimSlash(p.BaseURL)+"/chat/completions", bytes.NewReader(b)); if err != nil { return "", err }
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(p.APIKey))
	res, err := httpClient.Do(req); if err != nil { return "", err }
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	var raw map[string]any
	_ = json.Unmarshal(body, &raw)
	if res.StatusCode < 200 || res.StatusCode >= 300 { return "", fmt.Errorf("AI HTTP %d: %s", res.StatusCode, errorFromBody(raw, body)) }
	choices, _ := raw["choices"].([]any)
	if len(choices) == 0 { return "", errors.New("响应为空（choices 不存在）") }
	choice, _ := choices[0].(map[string]any)
	if msg, _ := choice["message"].(map[string]any); msg != nil { if text, _ := msg["content"].(string); text != "" { return text, nil } }
	if text, _ := choice["text"].(string); text != "" { return text, nil }
	return "", errors.New("响应为空（choices[0].message.content 不存在）")
}

func validateImages(images []DraftImage, maxCount int, maxMB float64) error {
	if maxCount <= 0 { maxCount = defaultMaxCount }
	if maxMB <= 0 { maxMB = defaultMaxMB }
	if len(images) > maxCount { return fmt.Errorf("最多 %d 张图片", maxCount) }
	maxBytes := int64(maxMB * 1024 * 1024)
	for _, img := range images {
		if !strings.HasPrefix(img.Type, "image/") { return fmt.Errorf("%s 不是图片", firstNonEmpty(img.Name, "文件")) }
		if img.Size > maxBytes { return fmt.Errorf("%s 超过 %.1f MB", firstNonEmpty(img.Name, "图片"), maxMB) }
		if !strings.HasPrefix(img.DataURL, "data:image/") { return fmt.Errorf("%s 缺少合法 data URL", firstNonEmpty(img.Name, "图片")) }
		comma := strings.IndexByte(img.DataURL, ',')
		if comma < 0 { return fmt.Errorf("%s data URL 无效", firstNonEmpty(img.Name, "图片")) }
		if _, err := base64.StdEncoding.DecodeString(img.DataURL[comma+1:]); err != nil { return fmt.Errorf("%s data URL 不是合法 base64", firstNonEmpty(img.Name, "图片")) }
	}
	return nil
}

func requireProvider(p Provider, requireKey bool) error {
	if !strings.HasPrefix(p.BaseURL, "http://") && !strings.HasPrefix(p.BaseURL, "https://") { return errors.New("未配置 Base URL") }
	if requireKey && strings.TrimSpace(p.APIKey) == "" { return errors.New("未配置 API Key") }
	if !requireKey && strings.TrimSpace(p.APIKey) == "" { return errors.New("未配置 API Key") }
	return nil
}

func providerIndex(data AppData, id string) int { for i, p := range data.Settings.Providers { if p.ID == id { return i } }; return -1 }
func findSpace(data AppData, id string) (Space, int) { for i, s := range data.Spaces { if s.ID == id { return s, i } }; if len(data.Spaces) > 0 && id == "" { return data.Spaces[0], 0 }; return Space{}, -1 }
func findTemplate(space Space, id string) Template { for _, t := range space.Templates { if t.ID == id { return t } }; if len(space.Templates) > 0 && id == "" { return space.Templates[0] }; return Template{} }
func imageMetas(images []DraftImage) []ImageMeta { out := make([]ImageMeta, 0, len(images)); for _, img := range images { out = append(out, ImageMeta{Name: img.Name, Type: img.Type, Size: img.Size}) }; return out }
func errorFromBody(raw map[string]any, body []byte) string { if e, _ := raw["error"].(map[string]any); e != nil { if m, _ := e["message"].(string); m != "" { return m } }; return string(body) }
