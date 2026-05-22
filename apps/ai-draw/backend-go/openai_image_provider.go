package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	maxDebugTextChars = 64 * 1024
	maxBodyBytes      = 10 * 1024 * 1024
)

type openAIImageProvider struct {
	client *http.Client
}

func newOpenAIImageProvider(client *http.Client) *openAIImageProvider {
	if client == nil {
		client = &http.Client{}
	}
	return &openAIImageProvider{client: client}
}

func (provider *openAIImageProvider) Generate(ctx context.Context, input imageGenerationInput) (imageGenerationResult, error) {
	req, debug, cancel, err := provider.buildRequest(ctx, input)
	if err != nil {
		return imageGenerationResult{}, err
	}
	defer cancel()
	response, err := provider.client.Do(req)
	if err != nil {
		if debug != nil {
			debug.UpdatedAt = nowMs()
			debug.Response = generationDebugResponse{Status: nil, BodyText: "", ErrorText: err.Error()}
		}
		return imageGenerationResult{}, providerError{Message: err.Error(), Debug: debug}
	}
	defer response.Body.Close()
	bodyBytes, readErr := io.ReadAll(response.Body)
	bodyText := string(bodyBytes)
	if readErr != nil {
		if debug != nil {
			debug.UpdatedAt = nowMs()
			status := response.StatusCode
			debug.Response = generationDebugResponse{Status: &status, BodyText: "", ErrorText: readErr.Error()}
		}
		return imageGenerationResult{}, providerError{Message: readErr.Error(), Debug: debug}
	}

	if debug != nil {
		status := response.StatusCode
		bodyText, summary := truncateDebugText(bodyText)
		debug.UpdatedAt = nowMs()
		debug.Response = generationDebugResponse{
			Status:    &status,
			BodyText:  bodyText,
			ErrorText: "",
		}
		if summary != "" && debug.Request.BodySummary == "" {
			debug.Request.BodySummary = summary
		}
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		errorText := parseErrorBody(bodyText)
		if errorText == "" {
			errorText = response.Status
		}
		if debug != nil {
			debug.Response.ErrorText = errorText
		}
		return imageGenerationResult{}, providerError{Message: fmt.Sprintf("HTTP %d：%s", response.StatusCode, errorText), Debug: debug}
	}

	dataURL := parseImageDataURLFromHTTPBodyText(bodyText)
	if dataURL == "" {
		if debug != nil {
			debug.Response.ErrorText = "未拿到图片数据"
		}
		return imageGenerationResult{}, providerError{Message: "未拿到图片数据", Debug: debug}
	}
	return imageGenerationResult{ImageDataURL: dataURL, Debug: debug}, nil
}

func (provider *openAIImageProvider) buildRequest(ctx context.Context, input imageGenerationInput) (*http.Request, *generationDebugRecord, func(), error) {
	config, err := validateProviderForRequest(input.provider())
	if err != nil {
		return nil, nil, func() {}, err
	}
	timeoutMs := int64(normalizeRequestTimeoutSec(requestTimeoutSec(input)) * 1000)
	requestCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)

	requestData, err := buildProviderRequestData(input, config)
	if err != nil {
		cancel()
		return nil, nil, func() {}, err
	}
	if int64(len(requestData.Body)) > maxBodyBytes {
		cancel()
		return nil, nil, func() {}, providerError{Message: fmt.Sprintf("请求体过大（约 %s）", formatBytes(int64(len(requestData.Body))))}
	}

	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, requestData.URL, bytes.NewReader(requestData.Body))
	if err != nil {
		cancel()
		return nil, nil, func() {}, err
	}
	for key, value := range requestData.Headers {
		request.Header.Set(key, value)
	}
	debug := buildDebugRecord(input, config, requestData, timeoutMs)
	return request, debug, cancel, nil
}

type validatedProviderConfig struct {
	Provider generationProvider
	BaseURL  string
	APIKey   string
	Model    string
}

type providerRequestData struct {
	URL          string
	Headers      map[string]string
	Body         []byte
	DebugBody    string
	DebugSummary string
	ProtocolKind string
}

func validateProviderForRequest(provider generationProvider) (validatedProviderConfig, error) {
	baseURL := trimSlash(provider.BaseURL)
	apiKey := strings.TrimSpace(provider.APIKey)
	model := resolveProviderModel(provider)
	if !isHTTPBaseURL(baseURL) {
		return validatedProviderConfig{}, providerError{Message: "Base URL 无效"}
	}
	if apiKey == "" {
		return validatedProviderConfig{}, providerError{Message: "API Key 为空"}
	}
	if model == "" {
		return validatedProviderConfig{}, providerError{Message: "模型为空"}
	}
	return validatedProviderConfig{Provider: provider, BaseURL: baseURL, APIKey: apiKey, Model: model}, nil
}

func buildProviderRequestData(input imageGenerationInput, config validatedProviderConfig) (providerRequestData, error) {
	headers := map[string]string{"Authorization": "Bearer " + config.APIKey}
	if input.Mode == generationModeLocalEdit && input.Local != nil {
		body, err := json.Marshal(buildLocalEditChatBody(input.Local, config.Model))
		if err != nil {
			return providerRequestData{}, err
		}
		headers["Content-Type"] = "application/json"
		return providerRequestData{URL: config.BaseURL + "/chat/completions", Headers: headers, Body: body, DebugBody: string(body), ProtocolKind: protocolKindChat}, nil
	}
	if input.Normal == nil {
		return providerRequestData{}, providerError{Message: "生成请求无效"}
	}
	if strings.TrimSpace(config.Provider.Protocol) == "chat" {
		body, err := json.Marshal(buildNormalChatBody(input.Normal, config.Model))
		if err != nil {
			return providerRequestData{}, err
		}
		headers["Content-Type"] = "application/json"
		return providerRequestData{URL: config.BaseURL + "/chat/completions", Headers: headers, Body: body, DebugBody: string(body), ProtocolKind: protocolKindChat}, nil
	}
	if len(input.Normal.RefImages) > 0 {
		return buildImagesEditsRequestData(input.Normal, config, headers)
	}
	optionFields, err := buildOpenAIImageOptionFields(input.Normal.ImageOptions, config.Model, protocolKindImages, protocolKindImages)
	if err != nil {
		return providerRequestData{}, err
	}
	bodyMap := map[string]any{
		"model":  config.Model,
		"prompt": input.Normal.Prompt,
		"n":      1,
	}
	for key, value := range optionFields {
		bodyMap[key] = value
	}
	if shouldSendLegacyResponseFormat(config.Model) {
		bodyMap["response_format"] = "b64_json"
	}
	body, err := json.Marshal(bodyMap)
	if err != nil {
		return providerRequestData{}, err
	}
	headers["Content-Type"] = "application/json"
	return providerRequestData{URL: config.BaseURL + "/images/generations", Headers: headers, Body: body, DebugBody: string(body), ProtocolKind: protocolKindImages}, nil
}

func buildImagesEditsRequestData(req *createNormalGenerationRequest, config validatedProviderConfig, headers map[string]string) (providerRequestData, error) {
	optionFields, err := buildOpenAIImageOptionFields(req.ImageOptions, config.Model, protocolKindImages, protocolKindImagesEdits)
	if err != nil {
		return providerRequestData{}, err
	}
	parts := []multipartPart{
		{Name: "model", Value: config.Model},
		{Name: "prompt", Value: req.Prompt},
	}
	for _, key := range orderedImageOptionFieldKeys(optionFields) {
		parts = append(parts, multipartPart{Name: key, Value: fmt.Sprint(optionFields[key])})
	}
	if shouldSendLegacyResponseFormat(config.Model) {
		parts = append(parts, multipartPart{Name: "response_format", Value: "b64_json"})
	}
	var imageBytes int64
	for index, image := range req.RefImages {
		mime, bytes, err := normalizeImageInput(image.DataURL)
		if err != nil {
			return providerRequestData{}, err
		}
		imageBytes += int64(len(bytes))
		parts = append(parts, multipartPart{
			Name:        "image[]",
			Filename:    fmt.Sprintf("ref-%d.%s", index+1, extFromMime(mime)),
			ContentType: mime,
			Bytes:       bytes,
		})
	}
	body, contentType, err := buildMultipartFormData(parts)
	if err != nil {
		return providerRequestData{}, err
	}
	headers["Content-Type"] = contentType
	return providerRequestData{
		URL:          config.BaseURL + "/images/edits",
		Headers:      headers,
		Body:         body,
		DebugBody:    fmt.Sprintf("[multipart/form-data] fields=%s; images=%d; bytes=%s", debugMultipartFieldNames(parts), len(req.RefImages), formatBytes(int64(len(body)))),
		DebugSummary: fmt.Sprintf("图片总字节：%s", formatBytes(imageBytes)),
		ProtocolKind: protocolKindImagesEdits,
	}, nil
}

func orderedImageOptionFieldKeys(fields map[string]any) []string {
	order := []string{"size", "quality", "output_format", "output_compression", "background", "moderation", "input_fidelity", "style"}
	out := []string{}
	for _, key := range order {
		if _, ok := fields[key]; ok {
			out = append(out, key)
		}
	}
	return out
}

func debugMultipartFieldNames(parts []multipartPart) string {
	names := []string{}
	for _, part := range parts {
		if part.Filename != "" {
			continue
		}
		names = append(names, part.Name)
	}
	return strings.Join(names, ",")
}

func buildNormalChatBody(req *createNormalGenerationRequest, model string) map[string]any {
	content := any(req.Prompt)
	if len(req.RefImages) > 0 {
		items := []map[string]any{{"type": "text", "text": req.Prompt}}
		for _, image := range req.RefImages {
			items = append(items, map[string]any{"type": "image_url", "image_url": map[string]any{"url": image.DataURL}})
		}
		content = items
	}
	return chatBody(model, req.Provider.ChatSystemPrompt, content)
}

func buildLocalEditChatBody(req *createLocalEditGenerationRequest, model string) map[string]any {
	content := []map[string]any{
		{"type": "text", "text": fmt.Sprintf("请根据要求修改图片：%s\n图 1 是需要修改的选区图片；后续图片为参考图。只输出一张最终图片，格式必须是 data URL 或 JSON 图片字段。", req.Prompt)},
		{"type": "image_url", "image_url": map[string]any{"url": req.CropImage.DataURL}},
	}
	for _, image := range req.RefImages {
		content = append(content, map[string]any{"type": "image_url", "image_url": map[string]any{"url": image.DataURL}})
	}
	return chatBody(model, req.Provider.ChatSystemPrompt, content)
}

func chatBody(model string, systemPrompt string, userContent any) map[string]any {
	messages := []map[string]any{}
	if text := strings.TrimSpace(systemPrompt); text != "" {
		messages = append(messages, map[string]any{"role": "system", "content": text})
	}
	messages = append(messages, map[string]any{"role": "user", "content": userContent})
	return map[string]any{"model": model, "messages": messages, "temperature": 0.2}
}

func buildDebugRecord(input imageGenerationInput, config validatedProviderConfig, data providerRequestData, timeoutMs int64) *generationDebugRecord {
	if !debugMode(input) {
		return nil
	}
	bodyText, summary := truncateDebugText(data.DebugBody)
	if data.DebugSummary != "" {
		summary = data.DebugSummary
	}
	now := nowMs()
	return &generationDebugRecord{
		TaskID:       input.TaskID,
		Mode:         input.Mode,
		ProviderID:   config.Provider.ID,
		ProviderName: config.Provider.Name,
		Model:        config.Model,
		ProtocolKind: data.ProtocolKind,
		CreatedAt:    now,
		UpdatedAt:    now,
		Request: generationDebugRequest{
			Method:      http.MethodPost,
			URL:         data.URL,
			Headers:     redactedHeaders(data.Headers),
			BodyText:    bodyText,
			BodySummary: summary,
			TimeoutMs:   timeoutMs,
		},
		Response:     generationDebugResponse{Status: nil, BodyText: "", ErrorText: ""},
		AttemptCount: 1,
	}
}

func truncateDebugText(text string) (string, string) {
	if len(text) <= maxDebugTextChars {
		return text, ""
	}
	return text[:maxDebugTextChars], fmt.Sprintf("已截断：原始长度 %s", formatBytes(int64(len(text))))
}

func redactedHeaders(headers map[string]string) map[string]string {
	out := make(map[string]string, len(headers))
	for key, value := range headers {
		if strings.EqualFold(key, "Authorization") {
			out[key] = "[REDACTED]"
			continue
		}
		out[key] = value
	}
	return out
}

func requestTimeoutSec(input imageGenerationInput) int {
	if input.Local != nil {
		return input.Local.RequestTimeoutSec
	}
	if input.Normal != nil {
		return input.Normal.RequestTimeoutSec
	}
	return defaultRequestTimeoutSec
}

func debugMode(input imageGenerationInput) bool {
	if input.Local != nil {
		return input.Local.DebugMode
	}
	if input.Normal != nil {
		return input.Normal.DebugMode
	}
	return false
}
