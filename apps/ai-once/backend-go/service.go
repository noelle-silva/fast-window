package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	dataFile       = "data.json"
	settingsFile   = "settings.json"
	historyFile    = "history.json"
	metaFile       = "_meta.json"
	migrationsFile = "_migrations.json"
	dataVersion    = 2
	defaultMaxCount = 6
	defaultMaxMB    = 8
)

type service struct {
	dataDir string
}

func newService() (*service, error) {
	dir := strings.TrimSpace(os.Getenv("FW_APP_DATA_DIR"))
	if dir == "" {
		cwd, err := os.Getwd()
		if err != nil { return nil, err }
		dir = filepath.Join(cwd, "data")
	}
	return &service{dataDir: dir}, nil
}

func (s *service) ensureReady() error {
	if err := os.MkdirAll(s.dataDir, 0o755); err != nil { return err }
	if err := s.ensureMeta(); err != nil { return err }
	if _, err := os.Stat(s.path(dataFile)); err == nil {
		data, readErr := s.readData()
		if readErr != nil { return readErr }
		return s.writeData(normalizeData(data))
	}
	data, source, err := s.migrateOrDefault()
	if err != nil { return err }
	if err := s.writeData(normalizeData(data)); err != nil { return err }
	return s.writeMigration(source)
}

func (s *service) path(name string) string { return filepath.Join(s.dataDir, name) }

func (s *service) ensureMeta() error {
	if _, err := os.Stat(s.path(metaFile)); err == nil { return nil }
	return writeJSON(s.path(metaFile), map[string]any{"schemaVersion": 2, "createdAt": time.Now().Format(time.RFC3339), "app": "ai-once"})
}

func (s *service) writeMigration(source string) error {
	return writeJSON(s.path(migrationsFile), map[string]any{"schemaVersion": 1, "items": []map[string]any{{"id": "to-data-v2", "source": source, "createdAt": time.Now().Format(time.RFC3339)}}})
}

func (s *service) migrateOrDefault() (AppData, string, error) {
	var legacy legacySettings
	settingsOK := readJSONIfExists(s.path(settingsFile), &legacy) == nil && (legacy.BaseURL != "" || legacy.APIKey != "" || legacy.Model != "" || legacy.SystemPrompt != "")
	data := defaultData()
	if settingsOK {
		p := &data.Settings.Providers[0]
		p.Name = firstNonEmpty(legacy.ProviderName, "默认供应商")
		p.BaseURL = trimSlash(firstNonEmpty(legacy.BaseURL, "https://api.openai.com/v1"))
		p.APIKey = legacy.APIKey
		if legacy.Model != "" { data.Spaces[0].DefaultModelByProvider[p.ID] = legacy.Model }
		data.Spaces[0].Templates[0].SystemPrompt = firstNonEmpty(legacy.SystemPrompt, "你是一个严谨、直接、可执行的助手。")
	}
	return data, map[bool]string{true: "settings.json/history.json", false: "fresh"}[settingsOK], nil
}

type legacySettings struct {
	ProviderName string  `json:"providerName"`
	BaseURL      string  `json:"baseUrl"`
	APIKey       string  `json:"apiKey"`
	Model        string  `json:"model"`
	SystemPrompt string  `json:"systemPrompt"`
	Temperature  float64 `json:"temperature"`
}

func defaultData() AppData {
	now := time.Now().UnixMilli()
	pid, sid, tid := newID("prov"), newID("space"), newID("tpl")
	return AppData{Version: dataVersion, Settings: Settings{ActiveProviderID: pid, ImageMaxCount: defaultMaxCount, ImageMaxMB: defaultMaxMB, Providers: []Provider{{ID: pid, Name: "默认供应商", BaseURL: "https://api.openai.com/v1", APIKey: "", ModelsCache: ModelsCache{Items: []string{}, FetchedAt: 0}}}}, Spaces: []Space{{ID: sid, Name: "默认空间", CreatedAt: now, UpdatedAt: now, DefaultModelByProvider: map[string]string{}, ActiveTemplateID: tid, Templates: []Template{{ID: tid, Name: "默认", SystemPrompt: "你是一个严谨、直接、可执行的助手。"}}}}}
}

func normalizeData(data AppData) AppData {
	if data.Version != dataVersion { data.Version = dataVersion }
	if data.Settings.ImageMaxCount <= 0 { data.Settings.ImageMaxCount = defaultMaxCount }
	if data.Settings.ImageMaxMB <= 0 { data.Settings.ImageMaxMB = defaultMaxMB }
	if len(data.Settings.Providers) == 0 { data.Settings.Providers = defaultData().Settings.Providers }
	seenProviders := map[string]bool{}
	for i := range data.Settings.Providers {
		p := &data.Settings.Providers[i]
		if p.ID == "" || seenProviders[p.ID] { p.ID = newID("prov") }
		seenProviders[p.ID] = true
		p.Name = firstNonEmpty(p.Name, "供应商")
		p.BaseURL = trimSlash(firstNonEmpty(p.BaseURL, "https://api.openai.com/v1"))
		if p.ModelsCache.Items == nil { p.ModelsCache.Items = []string{} }
	}
	if !providerExists(data, data.Settings.ActiveProviderID) { data.Settings.ActiveProviderID = data.Settings.Providers[0].ID }
	if len(data.Spaces) == 0 { data.Spaces = defaultData().Spaces }
	for i := range data.Spaces {
		s := &data.Spaces[i]
		if s.ID == "" { s.ID = newID("space") }
		s.Name = firstNonEmpty(s.Name, "空间")
		if s.CreatedAt == 0 { s.CreatedAt = time.Now().UnixMilli() }
		if s.UpdatedAt == 0 { s.UpdatedAt = s.CreatedAt }
		if s.DefaultModelByProvider == nil { s.DefaultModelByProvider = map[string]string{} }
		if len(s.Templates) == 0 { s.Templates = []Template{{ID: newID("tpl"), Name: "默认", SystemPrompt: ""}} }
		for j := range s.Templates {
			if s.Templates[j].ID == "" { s.Templates[j].ID = newID("tpl") }
			s.Templates[j].Name = firstNonEmpty(s.Templates[j].Name, "模板")
		}
		if !templateExists(*s, s.ActiveTemplateID) { s.ActiveTemplateID = s.Templates[0].ID }
	}
	return data
}

func (s *service) readData() (AppData, error) { var data AppData; err := readJSON(s.path(dataFile), &data); return normalizeData(data), err }
func (s *service) writeData(data AppData) error { return writeJSON(s.path(dataFile), normalizeData(data)) }
func (s *service) saveData(data AppData) (AppData, error) { data = normalizeData(data); return data, s.writeData(data) }

func (s *service) readHistory() (HistoryDoc, error) {
	doc := HistoryDoc{SchemaVersion: 1, DataVersion: dataVersion, Items: []HistoryEntry{}}
	if err := readJSONIfExists(s.path(historyFile), &doc); err != nil { return doc, err }
	if doc.Items == nil { doc.Items = []HistoryEntry{} }
	return doc, nil
}

func (s *service) writeHistory(doc HistoryDoc) error { doc.SchemaVersion = 1; doc.DataVersion = dataVersion; if doc.Items == nil { doc.Items = []HistoryEntry{} }; return writeJSON(s.path(historyFile), doc) }
func (s *service) clearHistory() (HistoryDoc, error) { doc := HistoryDoc{SchemaVersion: 1, DataVersion: dataVersion, Items: []HistoryEntry{}}; return doc, s.writeHistory(doc) }
func (s *service) appendHistory(entry HistoryEntry) error { doc, err := s.readHistory(); if err != nil { return err }; doc.Items = append([]HistoryEntry{entry}, doc.Items...); if len(doc.Items) > 300 { doc.Items = doc.Items[:300] }; return s.writeHistory(doc) }

func writeJSON(path string, value any) error { b, err := json.MarshalIndent(value, "", "  "); if err != nil { return err }; b = append(b, '\n'); return os.WriteFile(path, b, 0o600) }
func readJSON(path string, out any) error { b, err := os.ReadFile(path); if err != nil { return err }; return json.Unmarshal(b, out) }
func readJSONIfExists(path string, out any) error { err := readJSON(path, out); if errors.Is(err, os.ErrNotExist) { return nil }; return err }

func providerExists(data AppData, id string) bool { for _, p := range data.Settings.Providers { if p.ID == id { return true } }; return false }
func templateExists(space Space, id string) bool { for _, t := range space.Templates { if t.ID == id { return true } }; return false }
func firstNonEmpty(values ...string) string { for _, v := range values { if strings.TrimSpace(v) != "" { return strings.TrimSpace(v) } }; return "" }
func trimSlash(s string) string { return strings.TrimRight(strings.TrimSpace(s), "/") }
func newID(prefix string) string { var b [6]byte; _, _ = rand.Read(b[:]); return fmt.Sprintf("%s-%d-%s", prefix, time.Now().UnixMilli(), hex.EncodeToString(b[:])) }
func sortedModelIDs(ids []string) []string { sort.Strings(ids); return ids }
