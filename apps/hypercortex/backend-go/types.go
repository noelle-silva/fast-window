package main

import "encoding/json"

const (
	stateDirName    = "state"
	libraryDirName  = "library"
	notesDir        = "Notes"
	assetsDir       = "Assets"
	trashDir        = "Trash"
	indexFile       = "hypercortex-index.json"
	metadataFile    = "hypercortex-metadata.json"
	favoritesFile   = "hypercortex-favorites.json"
	refsIndexFile   = "hypercortex-refs.json"
	assetsIndexFile = "hypercortex-assets-index.json"
	manifestFile    = "manifest.json"
	trashMetaFile   = "trash-meta.json"
)

type requestFrame struct {
	ID     string          `json:"id"`
	Type   string          `json:"type"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type responseFrame struct {
	ID     string         `json:"id"`
	Type   string         `json:"type"`
	OK     bool           `json:"ok"`
	Result any            `json:"result,omitempty"`
	Error  map[string]any `json:"error,omitempty"`
}

type fileEntry struct {
	Name        string  `json:"name"`
	IsDirectory bool    `json:"isDirectory"`
	IsFile      bool    `json:"isFile"`
	Size        int64   `json:"size"`
	ModifiedMs  float64 `json:"modifiedMs"`
}

type noteMeta struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Dir         string  `json:"dir"`
	CreatedAtMs float64 `json:"createdAtMs"`
	UpdatedAtMs float64 `json:"updatedAtMs"`
}

type noteIndex struct {
	Version int                 `json:"version"`
	Notes   map[string]noteMeta `json:"notes"`
}

type resourceRef struct {
	AssetID string `json:"assetId"`
	Mime    string `json:"mime,omitempty"`
	Ext     string `json:"ext,omitempty"`
	Kind    string `json:"kind,omitempty"`
	Name    string `json:"name,omitempty"`
}

type faceCapabilities struct {
	Editable    bool `json:"editable"`
	Searchable  bool `json:"searchable"`
	Previewable bool `json:"previewable"`
	Linkable    bool `json:"linkable"`
	Creatable   bool `json:"creatable"`
	Deletable   bool `json:"deletable"`
}

type noteFaceManifest struct {
	ID           string           `json:"id"`
	Kind         string           `json:"kind"`
	Title        string           `json:"title"`
	File         string           `json:"file"`
	Role         string           `json:"role"`
	Settings     map[string]any   `json:"settings"`
	Capabilities faceCapabilities `json:"capabilities"`
}

type noteManifest struct {
	SchemaVersion int                         `json:"schemaVersion"`
	ID            string                      `json:"id"`
	Title         string                      `json:"title"`
	Description   string                      `json:"description"`
	Tags          []string                    `json:"tags"`
	CreatedAtMs   float64                     `json:"createdAtMs"`
	UpdatedAtMs   float64                     `json:"updatedAtMs"`
	PrimaryFaceID string                      `json:"primaryFaceId"`
	FaceOrder     []string                    `json:"faceOrder"`
	Faces         map[string]noteFaceManifest `json:"faces"`
	Resources     []resourceRef               `json:"resources"`
}

type noteDoc struct {
	ID            string        `json:"id"`
	PackageDir    string        `json:"packageDir"`
	Title         string        `json:"title"`
	Description   string        `json:"description"`
	Body          string        `json:"body"`
	Tags          []string      `json:"tags"`
	CreatedAtMs   float64       `json:"createdAtMs"`
	UpdatedAtMs   float64       `json:"updatedAtMs"`
	SchemaVersion int           `json:"schemaVersion"`
	Resources     []resourceRef `json:"resources"`
	DisplayHTML   string        `json:"displayHtml"`
}

type noteFaceDoc struct {
	ID              string           `json:"id"`
	PackageDir      string           `json:"packageDir"`
	NoteID          string           `json:"noteId"`
	NoteTitle       string           `json:"noteTitle"`
	NoteDescription string           `json:"noteDescription"`
	Face            noteFaceManifest `json:"face"`
	Content         string           `json:"content"`
	Exists          bool             `json:"exists"`
	CreatedAtMs     float64          `json:"createdAtMs"`
	UpdatedAtMs     float64          `json:"updatedAtMs"`
	SchemaVersion   int              `json:"schemaVersion"`
}

type htmlFaceDoc struct {
	ID            string   `json:"id"`
	PackageDir    string   `json:"packageDir"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	HTML          string   `json:"html"`
	Exists        bool     `json:"exists"`
	CreatedAtMs   float64  `json:"createdAtMs"`
	UpdatedAtMs   float64  `json:"updatedAtMs"`
	SchemaVersion int      `json:"schemaVersion"`
	FixedScale    *float64 `json:"fixedScale,omitempty"`
}

type assetIndexEntry struct {
	Path        string  `json:"path"`
	Kind        string  `json:"kind,omitempty"`
	Size        int64   `json:"size,omitempty"`
	ModifiedMs  float64 `json:"modifiedMs,omitempty"`
	DisplayName string  `json:"displayName,omitempty"`
}

type assetIndex struct {
	Version int                        `json:"version"`
	Assets  map[string]assetIndexEntry `json:"assets"`
}

type assetPoolItem struct {
	RelPath     string  `json:"relPath"`
	Name        string  `json:"name"`
	DisplayName string  `json:"displayName,omitempty"`
	Size        int64   `json:"size"`
	ModifiedMs  float64 `json:"modifiedMs"`
}

type trashItem struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Dir         string  `json:"dir"`
	CreatedAtMs float64 `json:"createdAtMs"`
	UpdatedAtMs float64 `json:"updatedAtMs"`
	DeletedAtMs float64 `json:"deletedAtMs"`
	OriginalDir string  `json:"originalDir"`
}

type trashMeta struct {
	Version     int     `json:"version"`
	DeletedAtMs float64 `json:"deletedAtMs"`
	OriginalDir string  `json:"originalDir,omitempty"`
}
