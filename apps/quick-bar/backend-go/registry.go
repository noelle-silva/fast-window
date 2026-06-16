package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const registryFile = "registry.json"

type registryDoc struct {
	Buttons []registryButton `json:"buttons"`
}

type registryButton struct {
	ID           string         `json:"id"`
	App          map[string]any `json:"app"`
	AppID        string         `json:"appId"`
	CapabilityID string         `json:"capabilityId"`
	Title        string         `json:"title"`
	Icon         string         `json:"icon"`
	Config       map[string]any `json:"config"`
	Enabled      *bool          `json:"enabled"`
	CreatedAt    string         `json:"createdAt"`
}

type addRegistryButtonParams struct {
	App          map[string]any `json:"app"`
	AppID        string         `json:"appId"`
	CapabilityID string         `json:"capabilityId"`
	Title        string         `json:"title"`
	Icon         string         `json:"icon"`
	Config       map[string]any `json:"config"`
}

type removeRegistryButtonParams struct {
	ID string `json:"id"`
}

type updateRegistryButtonParams struct {
	ID      string          `json:"id"`
	Title   *string         `json:"title"`
	Icon    *string         `json:"icon"`
	Config  *map[string]any `json:"config"`
	Enabled *bool           `json:"enabled"`
}

func (svc *service) listRegistryButtons() ([]registryButton, error) {
	doc, err := svc.readRegistry()
	if err != nil {
		return nil, err
	}
	return doc.Buttons, nil
}

func (svc *service) addRegistryButton(params json.RawMessage) (registryButton, error) {
	var input addRegistryButtonParams
	if err := decodeRegistryParams(params, &input); err != nil {
		return registryButton{}, err
	}
	input.normalize()
	if err := input.validate(); err != nil {
		return registryButton{}, err
	}

	doc, err := svc.readRegistry()
	if err != nil {
		return registryButton{}, err
	}
	id, err := newRegistryButtonID()
	if err != nil {
		return registryButton{}, err
	}
	button := registryButton{
		ID:           id,
		App:          input.App,
		AppID:        input.AppID,
		CapabilityID: input.CapabilityID,
		Title:        input.Title,
		Config:       nonNilConfig(input.Config),
		Enabled:      boolPtr(true),
		CreatedAt:    nowText(),
	}
	button.Icon = resolveRegistryButtonIcon(input.Icon, registryButtonIconSeed(button))
	doc.Buttons = append(doc.Buttons, button)
	if err := svc.writeRegistry(doc); err != nil {
		return registryButton{}, err
	}
	return button, nil
}

func (svc *service) removeRegistryButton(params json.RawMessage) (map[string]any, error) {
	var input removeRegistryButtonParams
	if err := decodeRegistryParams(params, &input); err != nil {
		return nil, err
	}
	id := strings.TrimSpace(input.ID)
	if id == "" {
		return nil, errors.New("registry button id is required")
	}

	doc, err := svc.readRegistry()
	if err != nil {
		return nil, err
	}
	index := findRegistryButtonIndex(doc.Buttons, id)
	if index < 0 {
		return nil, fmt.Errorf("registry button not found: %s", id)
	}
	doc.Buttons = append(doc.Buttons[:index], doc.Buttons[index+1:]...)
	if err := svc.writeRegistry(doc); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func (svc *service) updateRegistryButton(params json.RawMessage) (registryButton, error) {
	var input updateRegistryButtonParams
	if err := decodeRegistryParams(params, &input); err != nil {
		return registryButton{}, err
	}
	id := strings.TrimSpace(input.ID)
	if id == "" {
		return registryButton{}, errors.New("registry button id is required")
	}
	if input.Title == nil && input.Icon == nil && input.Config == nil && input.Enabled == nil {
		return registryButton{}, errors.New("registry update requires title, icon, config or enabled")
	}

	doc, err := svc.readRegistry()
	if err != nil {
		return registryButton{}, err
	}
	index := findRegistryButtonIndex(doc.Buttons, id)
	if index < 0 {
		return registryButton{}, fmt.Errorf("registry button not found: %s", id)
	}
	if input.Title != nil {
		title := strings.TrimSpace(*input.Title)
		if title == "" {
			return registryButton{}, errors.New("registry button title is required")
		}
		doc.Buttons[index].Title = title
	}
	if input.Config != nil {
		doc.Buttons[index].Config = nonNilConfig(*input.Config)
	}
	if input.Icon != nil {
		doc.Buttons[index].Icon = resolveRegistryButtonIcon(*input.Icon, registryButtonIconSeed(doc.Buttons[index]))
	}
	if input.Enabled != nil {
		doc.Buttons[index].Enabled = boolPtr(*input.Enabled)
	}
	if err := svc.writeRegistry(doc); err != nil {
		return registryButton{}, err
	}
	return doc.Buttons[index], nil
}

func (svc *service) readRegistry() (registryDoc, error) {
	doc := registryDoc{Buttons: []registryButton{}}
	bytes, err := os.ReadFile(svc.registryPath())
	if errors.Is(err, os.ErrNotExist) {
		return doc, nil
	}
	if err != nil {
		return doc, fmt.Errorf("read registry failed: %w", err)
	}
	if err := json.Unmarshal(bytes, &doc); err != nil {
		return doc, fmt.Errorf("decode registry failed: %w", err)
	}
	return normalizeRegistryDoc(doc), nil
}

func (svc *service) writeRegistry(doc registryDoc) error {
	if err := writeJSON(svc.registryPath(), normalizeRegistryDoc(doc)); err != nil {
		return fmt.Errorf("write registry failed: %w", err)
	}
	return nil
}

func (svc *service) registryPath() string {
	return filepath.Join(svc.dataDir, registryFile)
}

func decodeRegistryParams(params json.RawMessage, out any) error {
	if len(params) == 0 || string(params) == "null" {
		return errors.New("registry params are required")
	}
	if err := json.Unmarshal(params, out); err != nil {
		return fmt.Errorf("decode registry params failed: %w", err)
	}
	return nil
}

func (params *addRegistryButtonParams) normalize() {
	params.App = nonNilMap(params.App)
	params.AppID = strings.TrimSpace(params.AppID)
	params.CapabilityID = strings.TrimSpace(params.CapabilityID)
	params.Title = strings.TrimSpace(params.Title)
	params.Icon = strings.TrimSpace(params.Icon)
	params.Config = nonNilConfig(params.Config)
}

func (params addRegistryButtonParams) validate() error {
	if len(params.App) == 0 {
		return errors.New("registry button app is required")
	}
	if params.AppID == "" {
		return errors.New("registry button appId is required")
	}
	if params.CapabilityID == "" {
		return errors.New("registry button capabilityId is required")
	}
	if params.Title == "" {
		return errors.New("registry button title is required")
	}
	return nil
}

func normalizeRegistryDoc(doc registryDoc) registryDoc {
	if doc.Buttons == nil {
		doc.Buttons = []registryButton{}
	}
	for index := range doc.Buttons {
		doc.Buttons[index].App = nonNilMap(doc.Buttons[index].App)
		doc.Buttons[index].Config = nonNilConfig(doc.Buttons[index].Config)
		doc.Buttons[index].Icon = resolveRegistryButtonIcon(doc.Buttons[index].Icon, registryButtonIconSeed(doc.Buttons[index]))
		if doc.Buttons[index].Enabled == nil {
			doc.Buttons[index].Enabled = boolPtr(true)
		}
	}
	return doc
}

func registryButtonIconSeed(button registryButton) string {
	return strings.Join([]string{button.ID, button.AppID, button.CapabilityID, button.Title}, ":")
}

func boolPtr(value bool) *bool {
	return &value
}

func nonNilMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func nonNilConfig(config map[string]any) map[string]any {
	if config == nil {
		return map[string]any{}
	}
	return config
}

func findRegistryButtonIndex(buttons []registryButton, id string) int {
	for index, button := range buttons {
		if button.ID == id {
			return index
		}
	}
	return -1
}

func newRegistryButtonID() (string, error) {
	var bytes [6]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("generate registry button id failed: %w", err)
	}
	return fmt.Sprintf("btn-%d-%s", time.Now().UnixMilli(), hex.EncodeToString(bytes[:])), nil
}
