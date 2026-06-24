package main

import (
	"bytes"
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

type addCollectionConfig struct {
	CategoryID string `json:"categoryId"`
	GroupID    string `json:"groupId"`
}

type capabilityOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type addCollectionResult struct {
	OK         bool   `json:"ok"`
	Text       string `json:"text"`
	CategoryID string `json:"categoryId"`
	GroupID    string `json:"groupId"`
}

const (
	capabilityAddCollection    = "add-collection"
	optionSourceListCategories = "list-categories"
	optionSourceListGroups     = "list-groups"
)

func invokeCapability(ctx context.Context, svc *service, req capabilityInvokeRequest) (any, error) {
	switch strings.TrimSpace(req.CapabilityID) {
	case capabilityAddCollection:
		return addCollection(ctx, svc, req)
	default:
		return nil, fmt.Errorf("未知能力: %s", req.CapabilityID)
	}
}

func queryCapabilityOptions(svc *service, req capabilityQueryOptionsRequest) (any, error) {
	switch strings.TrimSpace(req.CapabilityID) {
	case capabilityAddCollection:
		return queryAddCollectionOptions(svc, req)
	default:
		return nil, fmt.Errorf("未知能力: %s", req.CapabilityID)
	}
}

func parseAddCollectionConfig(rawConfig json.RawMessage) (addCollectionConfig, error) {
	payload := bytes.TrimSpace(rawConfig)
	if len(payload) == 0 {
		payload = []byte("{}")
	}
	var config addCollectionConfig
	if err := json.Unmarshal(payload, &config); err != nil {
		return addCollectionConfig{}, fmt.Errorf("能力配置无效: %w", err)
	}
	return config, nil
}

func queryAddCollectionOptions(svc *service, req capabilityQueryOptionsRequest) (any, error) {
	switch strings.TrimSpace(req.OptionSource) {
	case optionSourceListCategories:
		return listCategoryOptions(), nil
	case optionSourceListGroups:
		return listGroupOptions(svc, req.Config)
	default:
		return nil, fmt.Errorf("未知选项来源: %s", req.OptionSource)
	}
}

func listCategoryOptions() []capabilityOption {
	return []capabilityOption{
		{Value: "folder", Label: "文件夹"},
		{Value: "url", Label: "网址"},
		{Value: "file", Label: "文件"},
	}
}

func listGroupOptions(svc *service, rawConfig json.RawMessage) ([]capabilityOption, error) {
	config, err := parseAddCollectionConfig(rawConfig)
	if err != nil {
		return nil, err
	}
	categoryID := normalizeCategoryID(config.CategoryID)
	if categoryID == "" {
		return nil, errors.New("categoryId 必须是 folder、url 或 file")
	}

	svc.mu.Lock()
	defer svc.mu.Unlock()
	if err := svc.ensureReady(); err != nil {
		return nil, err
	}
	doc, err := svc.readCollections()
	if err != nil {
		return nil, err
	}
	workspace, _, err := workspaceByID(doc, categoryID)
	if err != nil {
		return nil, err
	}
	options := make([]capabilityOption, 0, len(workspace.Groups))
	for _, group := range workspace.Groups {
		options = append(options, capabilityOption{Value: group.ID, Label: group.Name})
	}
	return options, nil
}

func addCollection(ctx context.Context, svc *service, req capabilityInvokeRequest) (addCollectionResult, error) {
	if err := ctx.Err(); err != nil {
		return addCollectionResult{}, err
	}
	input := strings.TrimSpace(req.Input)
	if input == "" {
		return addCollectionResult{}, errors.New("input 不能为空")
	}
	config, err := parseAddCollectionConfig(req.Config)
	if err != nil {
		return addCollectionResult{}, err
	}
	item, err := buildAddCollectionItemInput(config.CategoryID, config.GroupID, input)
	if err != nil {
		return addCollectionResult{}, err
	}
	categoryID := normalizeCategoryID(config.CategoryID)
	if categoryID == "" {
		return addCollectionResult{}, errors.New("categoryId 必须是 folder、url 或 file")
	}

	svc.mu.Lock()
	defer svc.mu.Unlock()
	if err := svc.ensureReady(); err != nil {
		return addCollectionResult{}, err
	}
	view, err := svc.addItemInput(categoryID, item)
	if err != nil {
		return addCollectionResult{}, err
	}
	return addCollectionResult{OK: true, Text: addCollectionSuccessText(categoryID, item.GroupID, view.Groups), CategoryID: categoryID, GroupID: item.GroupID}, nil
}

func buildAddCollectionItemInput(categoryID string, groupID string, input string) (collectionItemInput, error) {
	target, err := collectionTargetFromCapabilityInput(categoryID, input)
	if err != nil {
		return collectionItemInput{}, err
	}
	return collectionItemInput{
		ID:      "",
		Target:  target,
		GroupID: groupID,
		Icon:    nil,
	}, nil
}

func collectionTargetFromCapabilityInput(categoryID string, input string) (collectionTarget, error) {
	switch normalizeCategoryID(categoryID) {
	case "folder":
		return collectionTarget{Kind: "folder", Path: input}, nil
	case "file":
		return collectionTarget{Kind: "file", Path: input}, nil
	case "url":
		return collectionTarget{Kind: "url", URL: input}, nil
	default:
		return collectionTarget{}, errors.New("categoryId 必须是 folder、url 或 file")
	}
}

func addCollectionSuccessText(categoryID string, groupID string, groups []collectionGroup) string {
	categoryName := categoryLabel(categoryID)
	for _, group := range groups {
		if group.ID == groupID && strings.TrimSpace(group.Name) != "" {
			return fmt.Sprintf("已添加到收藏集：%s / %s", categoryName, strings.TrimSpace(group.Name))
		}
	}
	return fmt.Sprintf("已添加到收藏集：%s", categoryName)
}

func categoryLabel(categoryID string) string {
	switch normalizeCategoryID(categoryID) {
	case "folder":
		return "文件夹"
	case "url":
		return "网址"
	case "file":
		return "文件"
	default:
		return "未知片区"
	}
}
