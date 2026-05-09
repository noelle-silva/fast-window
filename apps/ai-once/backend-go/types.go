package main

type AppData struct {
	Version  int      `json:"version"`
	Settings Settings `json:"settings"`
	Spaces   []Space  `json:"spaces"`
}

type Settings struct {
	Providers        []Provider      `json:"providers"`
	ActiveProviderID string          `json:"activeProviderId"`
	ImageMaxCount    int             `json:"imageMaxCount"`
	ImageMaxMB       float64         `json:"imageMaxMb"`
	History          HistorySettings `json:"history"`
}

type HistorySettings struct {
	Enabled bool `json:"enabled"`
	Limit   int  `json:"limit"`
}

type Provider struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	BaseURL     string      `json:"baseUrl"`
	APIKey      string      `json:"apiKey"`
	ModelsCache ModelsCache `json:"modelsCache"`
}

type ModelsCache struct {
	Items     []string `json:"items"`
	FetchedAt int64    `json:"fetchedAt"`
}

type Space struct {
	ID                     string               `json:"id"`
	Name                   string               `json:"name"`
	CreatedAt              int64                `json:"createdAt"`
	UpdatedAt              int64                `json:"updatedAt"`
	DefaultModelByProvider map[string]string    `json:"defaultModelByProvider"`
	ActiveTemplateID       string               `json:"activeTemplateId"`
	Templates              []Template           `json:"templates"`
	History                SpaceHistorySettings `json:"history"`
}

type SpaceHistorySettings struct {
	Override bool `json:"override"`
	Enabled  bool `json:"enabled"`
	Limit    int  `json:"limit"`
}

type Template struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	SystemPrompt string `json:"systemPrompt"`
}

type HistoryDoc struct {
	SchemaVersion int            `json:"schemaVersion"`
	DataVersion   int            `json:"dataVersion"`
	Items         []HistoryEntry `json:"items"`
}

type HistoryEntry struct {
	ID         string      `json:"id"`
	SpaceID    string      `json:"spaceId"`
	TemplateID string      `json:"templateId"`
	ProviderID string      `json:"providerId"`
	Model      string      `json:"model"`
	Input      string      `json:"input"`
	Output     string      `json:"output"`
	Error      string      `json:"error,omitempty"`
	Images     []ImageMeta `json:"images"`
	CreatedAt  string      `json:"createdAt"`
}

type ImageMeta struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Size     int64  `json:"size"`
	FileName string `json:"fileName,omitempty"`
	DataURL  string `json:"dataUrl,omitempty"`
}

type DraftImage struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Size    int64  `json:"size"`
	DataURL string `json:"dataUrl"`
}

type AskRequest struct {
	SpaceID    string       `json:"spaceId"`
	TemplateID string       `json:"templateId"`
	ProviderID string       `json:"providerId"`
	Model      string       `json:"model"`
	Input      string       `json:"input"`
	Images     []DraftImage `json:"images"`
}
