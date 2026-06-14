package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type capabilityInvokeRequest struct {
	CapabilityID string
	Input        string
	Config       json.RawMessage
}

type capabilityQueryOptionsRequest struct {
	CapabilityID string
	OptionSource string
	Config       json.RawMessage
}

type askOnceConfig struct {
	SpaceID    string `json:"spaceId"`
	TemplateID string `json:"templateId"`
}

const (
	capabilityAskOnce         = "ask-once"
	optionSourceListSpaces    = "list-spaces"
	optionSourceListTemplates = "list-templates"
)

func invokeCapability(ctx context.Context, svc *service, req capabilityInvokeRequest) (any, error) {
	switch strings.TrimSpace(req.CapabilityID) {
	case capabilityAskOnce:
		return askOnce(ctx, svc, req)
	default:
		return nil, fmt.Errorf("未知能力: %s", req.CapabilityID)
	}
}

func askOnce(ctx context.Context, svc *service, req capabilityInvokeRequest) (any, error) {
	input := strings.TrimSpace(req.Input)
	if input == "" {
		return nil, errors.New("input 不能为空")
	}

	config, err := parseAskOnceConfig(req.Config)
	if err != nil {
		return nil, err
	}

	askReq, err := buildAskOnceRequest(svc, input, config)
	if err != nil {
		return nil, err
	}

	return executeAskOnceRequest(ctx, svc, askReq)
}

func queryCapabilityOptions(svc *service, req capabilityQueryOptionsRequest) (any, error) {
	switch strings.TrimSpace(req.CapabilityID) {
	case capabilityAskOnce:
		return queryAskOnceOptions(svc, req)
	default:
		return nil, fmt.Errorf("未知能力: %s", req.CapabilityID)
	}
}

func queryAskOnceOptions(svc *service, req capabilityQueryOptionsRequest) (any, error) {
	switch strings.TrimSpace(req.OptionSource) {
	case optionSourceListSpaces:
		return listSpaceOptions(svc)
	case optionSourceListTemplates:
		return listTemplateOptions(svc, req.Config)
	default:
		return nil, fmt.Errorf("未知选项来源: %s", req.OptionSource)
	}
}

func listSpaceOptions(svc *service) (any, error) {
	data, err := readReadyData(svc)
	if err != nil {
		return nil, err
	}

	options := make([]map[string]string, 0, len(data.Spaces))
	for _, sp := range data.Spaces {
		options = append(options, map[string]string{"value": sp.ID, "label": sp.Name})
	}
	return options, nil
}

func listTemplateOptions(svc *service, rawConfig json.RawMessage) (any, error) {
	var config struct {
		SpaceID string `json:"spaceId"`
	}
	if err := json.Unmarshal(rawConfig, &config); err != nil {
		return nil, fmt.Errorf("选项配置无效: %w", err)
	}

	data, err := readReadyData(svc)
	if err != nil {
		return nil, err
	}
	space, si := findSpace(data, config.SpaceID)
	if si < 0 {
		return nil, errors.New("空间不存在")
	}

	options := make([]map[string]string, 0, len(space.Templates))
	for _, tpl := range space.Templates {
		options = append(options, map[string]string{"value": tpl.ID, "label": tpl.Name})
	}
	return options, nil
}

func parseAskOnceConfig(rawConfig json.RawMessage) (askOnceConfig, error) {
	var config askOnceConfig
	if err := json.Unmarshal(rawConfig, &config); err != nil {
		return askOnceConfig{}, fmt.Errorf("能力配置无效: %w", err)
	}
	return config, nil
}

func buildAskOnceRequest(svc *service, input string, config askOnceConfig) (AskRequest, error) {
	data, err := readReadyData(svc)
	if err != nil {
		return AskRequest{}, err
	}
	space, si := findSpace(data, config.SpaceID)
	if si < 0 {
		return AskRequest{}, errors.New("空间不存在")
	}
	providerID := data.Settings.ActiveProviderID
	model := space.DefaultModelByProvider[providerID]

	return AskRequest{
		SpaceID:    config.SpaceID,
		TemplateID: config.TemplateID,
		ProviderID: providerID,
		Model:      model,
		Input:      input,
	}, nil
}

func executeAskOnceRequest(ctx context.Context, svc *service, req AskRequest) (any, error) {
	svc.mu.Lock()
	defer svc.mu.Unlock()

	entry, err := svc.ask(ctx, req)
	if err != nil {
		return nil, err
	}
	if entry.Error != "" {
		return nil, errors.New(entry.Error)
	}
	return map[string]any{"output": entry.Output}, nil
}

func readReadyData(svc *service) (AppData, error) {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if err := svc.ensureReady(); err != nil {
		return AppData{}, err
	}
	data, err := svc.readData()
	if err != nil {
		return AppData{}, err
	}
	return data, nil
}
