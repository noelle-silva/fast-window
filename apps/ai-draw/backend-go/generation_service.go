package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

const maxBatchCount = 20

type generationService struct {
	registry    *taskRegistry
	outputStore *imageStore
	provider    imageProvider
}

func newGenerationService(outputStore *imageStore, provider imageProvider, sink eventSink) *generationService {
	if provider == nil {
		provider = newOpenAIImageProvider(nil)
	}
	return &generationService{
		registry:    newTaskRegistry(sink),
		outputStore: outputStore,
		provider:    provider,
	}
}

func (svc *generationService) createNormal(params json.RawMessage) (any, error) {
	var payload struct {
		Request createNormalGenerationRequest `json:"request"`
	}
	if err := decodeRequest(params, &payload); err != nil {
		return nil, err
	}
	if err := validateNormalRequest(payload.Request); err != nil {
		return nil, err
	}
	batchCount := clampInt(payload.Request.BatchCount, 1, maxBatchCount, 1)
	tasks := make([]generationTask, 0, batchCount)
	for i := 0; i < batchCount; i++ {
		req := payload.Request
		req.BatchCount = 1
		ctx, cancel := context.WithCancel(context.Background())
		task := svc.registry.create(generationTaskInput{
			Mode:         generationModeNormal,
			Prompt:       strings.TrimSpace(req.Prompt),
			ProviderID:   strings.TrimSpace(req.Provider.ID),
			ProviderName: strings.TrimSpace(req.Provider.Name),
			Model:        resolveProviderModel(req.Provider),
			Cancel:       cancel,
		})
		tasks = append(tasks, task)
		go svc.runTask(ctx, task.ID, imageGenerationInput{TaskID: task.ID, Mode: generationModeNormal, Normal: &req})
	}
	return map[string]any{"tasks": tasks}, nil
}

func (svc *generationService) createLocalEdit(params json.RawMessage) (any, error) {
	var payload struct {
		Request createLocalEditGenerationRequest `json:"request"`
	}
	if err := decodeRequest(params, &payload); err != nil {
		return nil, err
	}
	if err := validateLocalEditRequest(payload.Request); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	req := payload.Request
	task := svc.registry.create(generationTaskInput{
		Mode:         generationModeLocalEdit,
		Prompt:       strings.TrimSpace(req.Prompt),
		ProviderID:   strings.TrimSpace(req.Provider.ID),
		ProviderName: strings.TrimSpace(req.Provider.Name),
		Model:        resolveProviderModel(req.Provider),
		Cancel:       cancel,
	})
	go svc.runTask(ctx, task.ID, imageGenerationInput{TaskID: task.ID, Mode: generationModeLocalEdit, Local: &req})
	return map[string]any{"task": task}, nil
}

func (svc *generationService) get(params json.RawMessage) (any, error) {
	payload, err := decodeMap(params)
	if err != nil {
		return nil, err
	}
	return map[string]any{"task": svc.registry.get(asString(payload["taskId"]))}, nil
}

func (svc *generationService) list(params json.RawMessage) (any, error) {
	payload, err := decodeMap(params)
	if err != nil {
		return nil, err
	}
	return map[string]any{"tasks": svc.registry.list(intNumber(payload["limit"]))}, nil
}

func (svc *generationService) cancel(params json.RawMessage) (any, error) {
	payload, err := decodeMap(params)
	if err != nil {
		return nil, err
	}
	if !svc.registry.cancel(asString(payload["taskId"])) {
		return nil, newDirectError(errorTaskNotFound, "任务不存在")
	}
	return nil, nil
}

func (svc *generationService) dispose() {
	svc.registry.dispose()
}

func (svc *generationService) runTask(ctx context.Context, taskID string, input imageGenerationInput) {
	svc.registry.update(taskID, generationTaskPatch{Status: stringPtr(generationStatusRunning)})
	result, err := svc.provider.Generate(ctx, input)
	if err != nil {
		status := generationStatusFailed
		errorText := err.Error()
		if errors.Is(ctx.Err(), context.Canceled) {
			status = generationStatusCanceled
			errorText = "已取消"
		}
		patch := generationTaskPatch{Status: &status, Error: &errorText}
		var providerErr providerError
		if errors.As(err, &providerErr) && providerErr.Debug != nil {
			patch.Debug = providerErr.Debug
		}
		svc.registry.update(taskID, patch)
		return
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		status := generationStatusCanceled
		errorText := "已取消"
		svc.registry.update(taskID, generationTaskPatch{Status: &status, Error: &errorText, Debug: result.Debug})
		return
	}

	imageDataURL := result.ImageDataURL
	savedPath := ""
	if input.autoSave() {
		path, err := svc.outputStore.saveBase64(result.ImageDataURL)
		if err != nil {
			status := generationStatusFailed
			errorText := err.Error()
			svc.registry.update(taskID, generationTaskPatch{Status: &status, Error: &errorText, Debug: result.Debug})
			return
		}
		savedPath = path
		imageDataURL = ""
	}
	status := generationStatusSucceeded
	svc.registry.update(taskID, generationTaskPatch{Status: &status, ImageDataURL: &imageDataURL, SavedPath: &savedPath, Debug: result.Debug})
}

func decodeRequest(raw json.RawMessage, target any) error {
	if len(raw) == 0 || string(raw) == "null" {
		return newDirectError(errorBadRequest, "生成请求参数为空")
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return newDirectError(errorBadRequest, "生成请求参数无效")
	}
	return nil
}

func validateNormalRequest(req createNormalGenerationRequest) error {
	if strings.TrimSpace(req.Prompt) == "" {
		return newDirectError(errorBadRequest, "提示词为空")
	}
	return validateProviderBasics(req.Provider)
}

func validateLocalEditRequest(req createLocalEditGenerationRequest) error {
	if strings.TrimSpace(req.Prompt) == "" {
		return newDirectError(errorBadRequest, "提示词为空")
	}
	if strings.TrimSpace(req.CropImage.DataURL) == "" {
		return newDirectError(errorBadRequest, "选区图片为空")
	}
	return validateProviderBasics(req.Provider)
}

func validateProviderBasics(provider generationProvider) error {
	if strings.TrimSpace(provider.BaseURL) == "" {
		return newDirectError(errorBadRequest, "Base URL 为空")
	}
	if strings.TrimSpace(provider.APIKey) == "" {
		return newDirectError(errorBadRequest, "API Key 为空")
	}
	if strings.TrimSpace(resolveProviderModel(provider)) == "" {
		return newDirectError(errorBadRequest, "模型为空")
	}
	return nil
}

func clampInt(value int, min int, max int, fallback int) int {
	if value == 0 {
		value = fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
