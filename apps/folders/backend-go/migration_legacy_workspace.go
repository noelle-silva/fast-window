package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type legacyCollectionsDocInput struct {
	SchemaVersion    *int                      `json:"schemaVersion"`
	DataVersion      *int                      `json:"dataVersion"`
	ActiveCategoryID *string                   `json:"activeCategoryId"`
	CategoryOrder    *[]string                 `json:"categoryOrder"`
	Groups           *[]collectionGroup        `json:"groups"`
	Items            *[]legacyCollectionItem   `json:"items"`
	Containers       *[]desktopContainer       `json:"containers"`
	Desktop          *desktopStateInput        `json:"desktop"`
	UpdatedAt        *string                   `json:"updatedAt"`
	Categories       *[]categoryWorkspaceInput `json:"categories"`
}

type legacyCollectionItem struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Path            string            `json:"path"`
	Target          collectionTarget  `json:"target"`
	GroupID         string            `json:"groupId"`
	PageOrder       int64             `json:"pageOrder"`
	ContainerID     string            `json:"containerId,omitempty"`
	CreatedAt       string            `json:"createdAt"`
	UpdatedAt       string            `json:"updatedAt"`
	CreatedAtMS     int64             `json:"createdAtMs"`
	UpdatedAtMS     int64             `json:"updatedAtMs"`
	Layout          *folderGridLayout `json:"layout,omitempty"`
	ContainerLayout *folderGridLayout `json:"containerLayout,omitempty"`
	Icon            *desktopIcon      `json:"icon,omitempty"`
}

func (svc *service) migrateLegacyWorkspaceToCategories(fromVersion int) error {
	payload, err := os.ReadFile(filepath.Join(svc.dataDir, dataFile))
	if err != nil {
		return fmt.Errorf("read legacy folders data failed: %w", err)
	}
	legacy, err := decodeLegacyFlatWorkspace(payload, fromVersion)
	if err != nil {
		return err
	}
	normalized, err := normalizeV5CollectionsDoc(legacy)
	if err != nil {
		return err
	}
	normalized.UpdatedAt = nowText()
	return writeJSON(filepath.Join(svc.dataDir, dataFile), collectionsDocV5JSON{
		SchemaVersion:    normalized.SchemaVersion,
		DataVersion:      normalized.DataVersion,
		ActiveCategoryID: normalized.ActiveCategoryID,
		Categories:       normalized.Categories,
		UpdatedAt:        normalized.UpdatedAt,
	})
}

func decodeLegacyFlatWorkspace(payload []byte, fromVersion int) (collectionsDoc, error) {
	if strings.TrimSpace(string(payload)) == "" {
		return collectionsDoc{}, errors.New("legacy folders data file is empty")
	}
	var input legacyCollectionsDocInput
	if err := json.Unmarshal(payload, &input); err != nil {
		return collectionsDoc{}, fmt.Errorf("parse legacy folders data failed: %w", err)
	}
	if input.Categories != nil {
		return collectionsDoc{}, errors.New("legacy folders migration expected flat workspace data, got category workspace data")
	}
	if input.SchemaVersion == nil {
		return collectionsDoc{}, errors.New("legacy folders data schemaVersion is required")
	}
	if *input.SchemaVersion != dataSchemaVersion {
		return collectionsDoc{}, fmt.Errorf("legacy folders data schemaVersion %d is not supported; expected %d", *input.SchemaVersion, dataSchemaVersion)
	}
	if fromVersion <= 0 || fromVersion >= 5 {
		return collectionsDoc{}, fmt.Errorf("legacy folders migration source version %d is invalid", fromVersion)
	}
	if input.DataVersion != nil && *input.DataVersion != fromVersion {
		return collectionsDoc{}, fmt.Errorf("legacy folders dataVersion %d does not match migration source version %d", *input.DataVersion, fromVersion)
	}
	if input.Groups == nil {
		return collectionsDoc{}, errors.New("legacy folders data groups is required")
	}
	if input.Items == nil {
		return collectionsDoc{}, errors.New("legacy folders data items is required")
	}
	if input.Containers == nil {
		return collectionsDoc{}, errors.New("legacy folders data containers is required")
	}
	if input.Desktop == nil {
		return collectionsDoc{}, errors.New("legacy folders data desktop is required")
	}

	desktop, err := decodeLegacyDesktopState(*input.Desktop)
	if err != nil {
		return collectionsDoc{}, err
	}
	workspace := categoryWorkspace{ID: defaultCategoryID, Groups: *input.Groups, Items: legacyItemsAsFolderItems(*input.Items), Containers: *input.Containers, Desktop: desktop}
	updatedAt := ""
	if input.UpdatedAt != nil {
		updatedAt = *input.UpdatedAt
	}
	return collectionsDoc{SchemaVersion: dataSchemaVersion, DataVersion: 5, ActiveCategoryID: defaultCategoryID, Categories: []categoryWorkspace{workspace, defaultCategoryWorkspace("url"), defaultCategoryWorkspace("file")}, UpdatedAt: updatedAt}, nil
}

func (svc *service) migrateCategoryOrder() error {
	payload, err := os.ReadFile(filepath.Join(svc.dataDir, dataFile))
	if err != nil {
		return fmt.Errorf("read folders data failed: %w", err)
	}
	doc, err := decodeV5CollectionsDoc(payload)
	if err != nil {
		return err
	}
	normalized, err := normalizeCollectionsDocWithOrder(doc, defaultCategoryOrder(), 6)
	if err != nil {
		return err
	}
	normalized.UpdatedAt = nowText()
	return writeJSON(filepath.Join(svc.dataDir, dataFile), collectionsDocV6JSON{
		SchemaVersion:    normalized.SchemaVersion,
		DataVersion:      normalized.DataVersion,
		ActiveCategoryID: normalized.ActiveCategoryID,
		CategoryOrder:    normalized.CategoryOrder,
		Categories:       normalized.Categories,
		UpdatedAt:        normalized.UpdatedAt,
	})
}

func (svc *service) migrateAllView() error {
	payload, err := os.ReadFile(filepath.Join(svc.dataDir, dataFile))
	if err != nil {
		return fmt.Errorf("read folders data failed: %w", err)
	}
	doc, err := decodeV6CollectionsDoc(payload)
	if err != nil {
		return err
	}
	normalized, err := normalizeCollectionsDoc(doc)
	if err != nil {
		return err
	}
	normalized.UpdatedAt = nowText()
	return writeJSON(filepath.Join(svc.dataDir, dataFile), normalized)
}

func decodeV5CollectionsDoc(payload []byte) (collectionsDoc, error) {
	if strings.TrimSpace(string(payload)) == "" {
		return collectionsDoc{}, errors.New("folders data file is empty")
	}
	var input legacyCollectionsDocInput
	if err := json.Unmarshal(payload, &input); err != nil {
		return collectionsDoc{}, fmt.Errorf("parse folders data failed: %w", err)
	}
	if input.SchemaVersion == nil {
		return collectionsDoc{}, errors.New("folders data schemaVersion is required")
	}
	if *input.SchemaVersion != dataSchemaVersion {
		return collectionsDoc{}, fmt.Errorf("folders data schemaVersion %d is not supported; expected %d", *input.SchemaVersion, dataSchemaVersion)
	}
	if input.DataVersion == nil || *input.DataVersion != 5 {
		return collectionsDoc{}, errors.New("folders dataVersion 5 is required for category order migration")
	}
	if input.ActiveCategoryID == nil {
		return collectionsDoc{}, errors.New("folders data activeCategoryId is required")
	}
	if input.Categories == nil {
		return collectionsDoc{}, errors.New("folders data categories is required")
	}
	categories := make([]categoryWorkspace, 0, len(*input.Categories))
	for index, raw := range *input.Categories {
		workspace, err := decodeCategoryWorkspace(raw)
		if err != nil {
			return collectionsDoc{}, fmt.Errorf("categories[%d]: %w", index, err)
		}
		categories = append(categories, workspace)
	}
	updatedAt := ""
	if input.UpdatedAt != nil {
		updatedAt = *input.UpdatedAt
	}
	return collectionsDoc{SchemaVersion: dataSchemaVersion, DataVersion: 6, ActiveCategoryID: *input.ActiveCategoryID, CategoryOrder: defaultCategoryOrder(), Categories: categories, UpdatedAt: updatedAt}, nil
}

func decodeV6CollectionsDoc(payload []byte) (collectionsDoc, error) {
	if strings.TrimSpace(string(payload)) == "" {
		return collectionsDoc{}, errors.New("folders data file is empty")
	}
	var input legacyCollectionsDocInput
	if err := json.Unmarshal(payload, &input); err != nil {
		return collectionsDoc{}, fmt.Errorf("parse folders data failed: %w", err)
	}
	if input.SchemaVersion == nil {
		return collectionsDoc{}, errors.New("folders data schemaVersion is required")
	}
	if *input.SchemaVersion != dataSchemaVersion {
		return collectionsDoc{}, fmt.Errorf("folders data schemaVersion %d is not supported; expected %d", *input.SchemaVersion, dataSchemaVersion)
	}
	if input.DataVersion == nil || *input.DataVersion != 6 {
		return collectionsDoc{}, errors.New("folders dataVersion 6 is required for all view migration")
	}
	if input.ActiveCategoryID == nil {
		return collectionsDoc{}, errors.New("folders data activeCategoryId is required")
	}
	if input.CategoryOrder == nil {
		return collectionsDoc{}, errors.New("folders data categoryOrder is required")
	}
	if input.Categories == nil {
		return collectionsDoc{}, errors.New("folders data categories is required")
	}
	categories := make([]categoryWorkspace, 0, len(*input.Categories))
	for index, raw := range *input.Categories {
		workspace, err := decodeCategoryWorkspace(raw)
		if err != nil {
			return collectionsDoc{}, fmt.Errorf("categories[%d]: %w", index, err)
		}
		categories = append(categories, workspace)
	}
	updatedAt := ""
	if input.UpdatedAt != nil {
		updatedAt = *input.UpdatedAt
	}
	return collectionsDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, ActiveCategoryID: *input.ActiveCategoryID, CategoryOrder: *input.CategoryOrder, Categories: categories, AllView: defaultAllCategoryView(), UpdatedAt: updatedAt}, nil
}

type collectionsDocV5JSON struct {
	SchemaVersion    int                 `json:"schemaVersion"`
	DataVersion      int                 `json:"dataVersion"`
	ActiveCategoryID string              `json:"activeCategoryId"`
	Categories       []categoryWorkspace `json:"categories"`
	UpdatedAt        string              `json:"updatedAt"`
}

type collectionsDocV6JSON struct {
	SchemaVersion    int                 `json:"schemaVersion"`
	DataVersion      int                 `json:"dataVersion"`
	ActiveCategoryID string              `json:"activeCategoryId"`
	CategoryOrder    []string            `json:"categoryOrder"`
	Categories       []categoryWorkspace `json:"categories"`
	UpdatedAt        string              `json:"updatedAt"`
}

func decodeLegacyDesktopState(input desktopStateInput) (desktopState, error) {
	iconLayout := defaultDesktopIconLayout()
	if input.IconLayout != nil {
		decoded, err := decodeLegacyDesktopIconLayout(*input.IconLayout)
		if err != nil {
			return desktopState{}, err
		}
		iconLayout = decoded
	}
	return desktopState{Wallpaper: input.Wallpaper, IconLayout: iconLayout}, nil
}

func decodeLegacyDesktopIconLayout(input desktopIconLayoutInput) (desktopIconLayout, error) {
	rowGap := defaultDesktopIconGap
	if input.RowGap != nil {
		rowGap = *input.RowGap
	}
	columnGap := defaultDesktopIconGap
	if input.ColumnGap != nil {
		columnGap = *input.ColumnGap
	}
	iconScale := defaultDesktopIconScale
	if input.IconScale != nil {
		iconScale = *input.IconScale
	}
	return normalizeDesktopIconLayout(desktopIconLayout{RowGap: rowGap, ColumnGap: columnGap, IconScale: iconScale})
}

func legacyItemsAsFolderItems(items []legacyCollectionItem) []collectionItem {
	next := make([]collectionItem, 0, len(items))
	for _, item := range items {
		target := item.Target
		if strings.TrimSpace(target.Kind) == "" {
			target = collectionTarget{Kind: "folder", Path: strings.TrimSpace(item.Path)}
		}
		next = append(next, collectionItem{
			ID:              item.ID,
			Name:            item.Name,
			Target:          target,
			GroupID:         item.GroupID,
			PageOrder:       item.PageOrder,
			ContainerID:     item.ContainerID,
			CreatedAt:       item.CreatedAt,
			UpdatedAt:       item.UpdatedAt,
			CreatedAtMS:     item.CreatedAtMS,
			UpdatedAtMS:     item.UpdatedAtMS,
			Layout:          item.Layout,
			ContainerLayout: item.ContainerLayout,
			Icon:            item.Icon,
		})
	}
	return next
}
