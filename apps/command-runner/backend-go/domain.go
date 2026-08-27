package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"
)

const (
	dataSchemaVersion = 1
	dataVersion       = 1
)

const (
	closeModeKeepOpen  = "keep-open"
	closeModeCountdown = "countdown"
	closeModeImmediate = "close-immediately"
)

const (
	defaultShellID          = "cmd"
	defaultCloseMode        = closeModeKeepOpen
	defaultCountdownSeconds = 10
	minCountdownSeconds     = 1
	maxCountdownSeconds     = 3600
)

type appSettings struct {
	SchemaVersion           int           `json:"schemaVersion"`
	DataVersion             int           `json:"dataVersion"`
	DefaultShellID          string        `json:"defaultShellId"`
	DefaultCloseMode        string        `json:"defaultCloseMode"`
	DefaultCountdownSeconds int           `json:"defaultCountdownSeconds"`
	CustomShells            []customShell `json:"customShells"`
	UpdatedAt               string        `json:"updatedAt"`
}

type customShell struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ExePath      string `json:"exePath"`
	ArgsTemplate string `json:"argsTemplate"`
}

type repo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	ShellID   string `json:"shellId"`
	CreatedAt string `json:"createdAt"`
}

type reposDoc struct {
	SchemaVersion int    `json:"schemaVersion"`
	DataVersion   int    `json:"dataVersion"`
	Repos         []repo `json:"repos"`
}

type command struct {
	ID               string `json:"id"`
	RepoID           string `json:"repoId"`
	Name             string `json:"name"`
	Script           string `json:"script"`
	Note             string `json:"note"`
	ConfirmBeforeRun bool   `json:"confirmBeforeRun"`
	ShellID          string `json:"shellId"`
	CloseMode        string `json:"closeMode"`
	CountdownSeconds int    `json:"countdownSeconds"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type commandsDoc struct {
	SchemaVersion int       `json:"schemaVersion"`
	DataVersion   int       `json:"dataVersion"`
	Commands      []command `json:"commands"`
}

type commandDraft struct {
	RepoID           string `json:"repoId"`
	Name             string `json:"name"`
	Script           string `json:"script"`
	Note             string `json:"note"`
	ConfirmBeforeRun bool   `json:"confirmBeforeRun"`
	ShellID          string `json:"shellId"`
	CloseMode        string `json:"closeMode"`
	CountdownSeconds int    `json:"countdownSeconds"`
}

type metaDoc struct {
	SchemaVersion int    `json:"schemaVersion"`
	DataVersion   int    `json:"dataVersion"`
	UpdatedAt     string `json:"updatedAt"`
}

type migrationsLedger struct {
	SchemaVersion int              `json:"schemaVersion"`
	DataVersion   int              `json:"dataVersion"`
	Applied       []migrationEntry `json:"applied"`
}

type migrationEntry struct {
	ID          string `json:"id"`
	FromVersion int    `json:"fromVersion"`
	ToVersion   int    `json:"toVersion"`
	Description string `json:"description"`
	AppliedAt   string `json:"appliedAt"`
}

func newID(prefix string) string {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		panic(fmt.Sprintf("generate id failed: %v", err))
	}
	return fmt.Sprintf("%s-%s", prefix, hex.EncodeToString(bytes))
}

func validCloseMode(mode string) bool {
	switch mode {
	case closeModeKeepOpen, closeModeCountdown, closeModeImmediate:
		return true
	default:
		return false
	}
}

func (draft commandDraft) validate() error {
	if strings.TrimSpace(draft.RepoID) == "" {
		return fmt.Errorf("命令必须归属一个仓库")
	}
	if strings.TrimSpace(draft.Name) == "" {
		return fmt.Errorf("命令名称不能为空")
	}
	if strings.TrimSpace(draft.Script) == "" {
		return fmt.Errorf("命令脚本不能为空")
	}
	if draft.ShellID != "" && !isKnownShellID(draft.ShellID) {
		return fmt.Errorf("未知终端: %s", draft.ShellID)
	}
	if draft.CloseMode != "" && !validCloseMode(draft.CloseMode) {
		return fmt.Errorf("未知关闭策略: %s", draft.CloseMode)
	}
	if draft.CountdownSeconds != 0 &&
		(draft.CountdownSeconds < minCountdownSeconds || draft.CountdownSeconds > maxCountdownSeconds) {
		return fmt.Errorf("倒计时秒数必须在 %d-%d 之间", minCountdownSeconds, maxCountdownSeconds)
	}
	return nil
}

func (svc *service) runTmpPath() string {
	return joinPath(svc.dataDir, runTmpDir)
}

func joinPath(dir, name string) string {
	return dir + string(os.PathSeparator) + name
}

func nowStamp() string {
	return time.Now().UTC().Format(time.RFC3339)
}
