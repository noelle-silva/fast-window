package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type effectiveHistorySettings struct {
	Enabled bool
	Limit   int
}

func defaultHistorySettings() HistorySettings {
	return HistorySettings{Enabled: true, Limit: defaultHistoryLimit}
}

func defaultSpaceHistorySettings() SpaceHistorySettings {
	return SpaceHistorySettings{Override: false, Enabled: true, Limit: defaultHistoryLimit}
}

func normalizeHistorySettings(settings HistorySettings) HistorySettings {
	if settings.Limit <= 0 {
		settings.Limit = defaultHistoryLimit
	}
	return settings
}

func normalizeSpaceHistorySettings(settings SpaceHistorySettings, global HistorySettings) SpaceHistorySettings {
	if settings.Limit <= 0 {
		settings.Limit = global.Limit
	}
	return settings
}

func effectiveHistory(space Space, global HistorySettings) effectiveHistorySettings {
	global = normalizeHistorySettings(global)
	if !space.History.Override {
		return effectiveHistorySettings{Enabled: global.Enabled, Limit: global.Limit}
	}
	space.History = normalizeSpaceHistorySettings(space.History, global)
	return effectiveHistorySettings{Enabled: space.History.Enabled, Limit: space.History.Limit}
}

func (s *service) historyImagePath(fileName string) string {
	return filepath.Join(s.dataDir, historyImageDir, filepath.Base(fileName))
}

func (s *service) prepareHistoryEntryImages(entry *HistoryEntry, images []DraftImage) error {
	entry.Images = make([]ImageMeta, 0, len(images))
	if len(images) == 0 {
		return nil
	}
	if err := os.MkdirAll(s.path(historyImageDir), 0o755); err != nil {
		return err
	}
	for _, image := range images {
		imageID := newID("img")
		fileName := imageID + historyImageExtension(image.Type)
		payload, err := decodeDataURL(image.DataURL, image.Type)
		if err != nil {
			_ = s.deleteEntryImages(*entry)
			return err
		}
		if err := os.WriteFile(s.historyImagePath(fileName), payload, 0o600); err != nil {
			_ = s.deleteEntryImages(*entry)
			return err
		}
		entry.Images = append(entry.Images, ImageMeta{ID: imageID, Name: image.Name, Type: image.Type, Size: image.Size, FileName: fileName})
	}
	return nil
}

func decodeDataURL(dataURL string, mediaType string) ([]byte, error) {
	prefix := "data:" + mediaType + ";base64,"
	if !strings.HasPrefix(dataURL, prefix) {
		return nil, fmt.Errorf("图片 data URL 类型不匹配：%s", mediaType)
	}
	return base64.StdEncoding.DecodeString(dataURL[len(prefix):])
}

func historyImageExtension(mediaType string) string {
	switch mediaType {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".img"
	}
}

func (s *service) recordHistory(data AppData, entry *HistoryEntry, images []DraftImage) error {
	space, _ := findSpace(data, entry.SpaceID)
	settings := effectiveHistory(space, data.Settings.History)
	if !settings.Enabled {
		return nil
	}
	if err := s.prepareHistoryEntryImages(entry, images); err != nil {
		return err
	}
	doc, err := s.readHistoryRaw()
	if err != nil {
		_ = s.deleteEntryImages(*entry)
		return err
	}
	doc.Items = append([]HistoryEntry{*entry}, doc.Items...)
	trimmed := trimHistoryItems(doc.Items, data)
	doc.Items = trimmed.Items
	if err := s.writeHistory(doc); err != nil {
		_ = s.deleteEntryImages(*entry)
		return err
	}
	return s.deleteEntryImages(trimmed.Removed...)
}

func (s *service) readHistoryEntry(id string) (HistoryEntry, error) {
	doc, err := s.readHistoryRaw()
	if err != nil {
		return HistoryEntry{}, err
	}
	for _, entry := range doc.Items {
		if entry.ID != id {
			continue
		}
		hydrated, err := s.hydrateHistoryImages(HistoryDoc{SchemaVersion: doc.SchemaVersion, DataVersion: doc.DataVersion, Items: []HistoryEntry{entry}})
		if err != nil {
			return HistoryEntry{}, err
		}
		return hydrated.Items[0], nil
	}
	return HistoryEntry{}, fmt.Errorf("历史记录不存在：%s", id)
}

type historyTrimResult struct {
	Items   []HistoryEntry
	Removed []HistoryEntry
}

func trimHistoryItems(items []HistoryEntry, data AppData) historyTrimResult {
	kept := make([]HistoryEntry, 0, len(items))
	removed := []HistoryEntry{}
	counts := map[string]int{}
	spaces := map[string]Space{}
	for _, space := range data.Spaces {
		spaces[space.ID] = space
	}
	for _, entry := range items {
		space, exists := spaces[entry.SpaceID]
		if !exists {
			removed = append(removed, entry)
			continue
		}
		if !historyEntryImagesRestorable(entry) {
			removed = append(removed, entry)
			continue
		}
		settings := effectiveHistory(space, data.Settings.History)
		if counts[entry.SpaceID] >= settings.Limit {
			removed = append(removed, entry)
			continue
		}
		counts[entry.SpaceID]++
		kept = append(kept, entry)
	}
	return historyTrimResult{Items: kept, Removed: removed}
}

func historyEntryImagesRestorable(entry HistoryEntry) bool {
	for _, image := range entry.Images {
		if image.FileName == "" {
			return false
		}
	}
	return true
}

func (s *service) retainHistoryForData(data AppData) error {
	doc, err := s.readHistoryRaw()
	if err != nil {
		return err
	}
	trimmed := trimHistoryItems(doc.Items, data)
	doc.Items = trimmed.Items
	if err := s.writeHistory(doc); err != nil {
		return err
	}
	if err := s.deleteEntryImages(trimmed.Removed...); err != nil {
		return err
	}
	return s.deleteOrphanHistoryImages(doc)
}

func (s *service) hydrateHistoryImages(doc HistoryDoc) (HistoryDoc, error) {
	for entryIndex := range doc.Items {
		for imageIndex := range doc.Items[entryIndex].Images {
			image := &doc.Items[entryIndex].Images[imageIndex]
			if image.FileName == "" {
				return doc, fmt.Errorf("历史图片缺少文件引用：%s", image.Name)
			}
			payload, err := os.ReadFile(s.historyImagePath(image.FileName))
			if err != nil {
				return doc, fmt.Errorf("读取历史图片失败：%s", image.Name)
			}
			image.DataURL = "data:" + image.Type + ";base64," + base64.StdEncoding.EncodeToString(payload)
		}
	}
	return doc, nil
}

func stripHistoryDataURLs(doc HistoryDoc) HistoryDoc {
	for entryIndex := range doc.Items {
		for imageIndex := range doc.Items[entryIndex].Images {
			doc.Items[entryIndex].Images[imageIndex].DataURL = ""
		}
	}
	return doc
}

func (s *service) deleteEntryImages(entries ...HistoryEntry) error {
	for _, entry := range entries {
		for _, image := range entry.Images {
			if image.FileName == "" {
				continue
			}
			err := os.Remove(s.historyImagePath(image.FileName))
			if err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	return nil
}

func (s *service) deleteOrphanHistoryImages(doc HistoryDoc) error {
	valid := map[string]bool{}
	for _, entry := range doc.Items {
		for _, image := range entry.Images {
			if image.FileName != "" {
				valid[filepath.Base(image.FileName)] = true
			}
		}
	}
	entries, err := os.ReadDir(s.path(historyImageDir))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if valid[entry.Name()] {
			continue
		}
		if err := os.Remove(s.historyImagePath(entry.Name())); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
