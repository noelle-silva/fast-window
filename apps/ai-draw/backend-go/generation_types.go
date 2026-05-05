package main

import "context"

const (
	generationModeNormal    = "normal"
	generationModeLocalEdit = "local-edit"

	generationStatusPending   = "pending"
	generationStatusRunning   = "running"
	generationStatusSucceeded = "succeeded"
	generationStatusFailed    = "failed"
	generationStatusCanceled  = "canceled"
	generationStatusCanceling = "canceling"

	protocolKindImages      = "images"
	protocolKindImagesEdits = "images-edits"
	protocolKindChat        = "chat"
)

type generationProvider struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	BaseURL          string   `json:"baseUrl"`
	APIKey           string   `json:"apiKey"`
	Protocol         string   `json:"protocol"`
	Models           []string `json:"models"`
	Model            string   `json:"model"`
	CustomModel      string   `json:"customModel"`
	Size             string   `json:"size"`
	ChatSystemPrompt string   `json:"chatSystemPrompt"`
}

type generationRefImage struct {
	Name       string `json:"name"`
	DataURL    string `json:"dataUrl"`
	SourcePath string `json:"sourcePath,omitempty"`
}

type generationCropImage struct {
	Name    string `json:"name"`
	DataURL string `json:"dataUrl"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
}

type createNormalGenerationRequest struct {
	Provider          generationProvider   `json:"provider"`
	Prompt            string               `json:"prompt"`
	RefImages         []generationRefImage `json:"refImages"`
	BatchCount        int                  `json:"batchCount"`
	AutoSave          bool                 `json:"autoSave"`
	ShrinkRefImages   bool                 `json:"shrinkRefImages"`
	DebugMode         bool                 `json:"debugMode"`
	RequestTimeoutSec int                  `json:"requestTimeoutSec"`
}

type createLocalEditGenerationRequest struct {
	Provider          generationProvider   `json:"provider"`
	Prompt            string               `json:"prompt"`
	CropImage         generationCropImage  `json:"cropImage"`
	RefImages         []generationRefImage `json:"refImages"`
	AutoSave          bool                 `json:"autoSave"`
	ShrinkRefImages   bool                 `json:"shrinkRefImages"`
	DebugMode         bool                 `json:"debugMode"`
	RequestTimeoutSec int                  `json:"requestTimeoutSec"`
}

type generationDebugRecord struct {
	TaskID       string                  `json:"taskId"`
	Mode         string                  `json:"mode"`
	ProviderID   string                  `json:"providerId"`
	ProviderName string                  `json:"providerName"`
	Model        string                  `json:"model"`
	ProtocolKind string                  `json:"protocolKind"`
	CreatedAt    int64                   `json:"createdAt"`
	UpdatedAt    int64                   `json:"updatedAt"`
	Request      generationDebugRequest  `json:"request"`
	Response     generationDebugResponse `json:"response"`
	AttemptCount int                     `json:"attemptCount"`
}

type generationDebugRequest struct {
	Method      string            `json:"method"`
	URL         string            `json:"url"`
	Headers     map[string]string `json:"headers"`
	BodyText    string            `json:"bodyText"`
	BodySummary string            `json:"bodySummary,omitempty"`
	TimeoutMs   int64             `json:"timeoutMs"`
}

type generationDebugResponse struct {
	Status    *int   `json:"status"`
	BodyText  string `json:"bodyText"`
	ErrorText string `json:"errorText"`
}

type generationTask struct {
	ID           string                 `json:"id"`
	Mode         string                 `json:"mode"`
	Status       string                 `json:"status"`
	Prompt       string                 `json:"prompt"`
	CreatedAt    int64                  `json:"createdAt"`
	UpdatedAt    int64                  `json:"updatedAt"`
	ImageDataURL string                 `json:"imageDataUrl,omitempty"`
	SavedPath    string                 `json:"savedPath,omitempty"`
	Error        string                 `json:"error,omitempty"`
	Debug        *generationDebugRecord `json:"debug"`

	ProviderID   string             `json:"-"`
	ProviderName string             `json:"-"`
	Model        string             `json:"-"`
	Cancel       context.CancelFunc `json:"-"`
}

type generationTaskInput struct {
	Mode         string
	Prompt       string
	ProviderID   string
	ProviderName string
	Model        string
	Cancel       context.CancelFunc
}

type imageGenerationInput struct {
	TaskID string
	Mode   string
	Normal *createNormalGenerationRequest
	Local  *createLocalEditGenerationRequest
}

func (input imageGenerationInput) provider() generationProvider {
	if input.Local != nil {
		return input.Local.Provider
	}
	if input.Normal != nil {
		return input.Normal.Provider
	}
	return generationProvider{}
}

func (input imageGenerationInput) prompt() string {
	if input.Local != nil {
		return input.Local.Prompt
	}
	if input.Normal != nil {
		return input.Normal.Prompt
	}
	return ""
}

func (input imageGenerationInput) autoSave() bool {
	if input.Local != nil {
		return input.Local.AutoSave
	}
	if input.Normal != nil {
		return input.Normal.AutoSave
	}
	return false
}

type imageGenerationResult struct {
	ImageDataURL string
	Debug        *generationDebugRecord
}

type imageProvider interface {
	Generate(ctx context.Context, input imageGenerationInput) (imageGenerationResult, error)
}

type providerError struct {
	Message string
	Debug   *generationDebugRecord
}

func (err providerError) Error() string {
	return err.Message
}
