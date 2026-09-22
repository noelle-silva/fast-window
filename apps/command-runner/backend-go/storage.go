package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func (svc *service) ensureReady() error {
	if err := os.MkdirAll(svc.dataDir, 0o755); err != nil {
		return err
	}
	if err := ensureWritable(svc.dataDir); err != nil {
		return err
	}
	if err := svc.runMigrations(); err != nil {
		return err
	}
	if _, err := os.Stat(svc.settingsPath()); errors.Is(err, os.ErrNotExist) {
		if _, err := svc.saveGlobalSettings(defaultShellID, defaultCloseMode, defaultCountdownSeconds, defaultRunMode, defaultProcessOwnership); err != nil {
			return err
		}
	}
	if _, err := os.Stat(svc.reposPath()); errors.Is(err, os.ErrNotExist) {
		if err := writeJSON(svc.reposPath(), reposDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Repos: []repo{}}); err != nil {
			return err
		}
	}
	if _, err := os.Stat(svc.commandsPath()); errors.Is(err, os.ErrNotExist) {
		if err := writeJSON(svc.commandsPath(), commandsDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Commands: []command{}}); err != nil {
			return err
		}
	}
	if _, err := os.Stat(svc.collectionsPath()); errors.Is(err, os.ErrNotExist) {
		if err := writeJSON(svc.collectionsPath(), collectionsDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Nodes: map[string]*collectionNode{}}); err != nil {
			return err
		}
	}
	if _, err := os.Stat(svc.quickRunsPath()); errors.Is(err, os.ErrNotExist) {
		if err := writeJSON(svc.quickRunsPath(), quickRunsDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, QuickRuns: []quickRun{}}); err != nil {
			return err
		}
	}
	if err := svc.ensureCollections(); err != nil {
		return err
	}
	if err := svc.ensureQuickRuns(); err != nil {
		return err
	}
	return cleanRunTmp(svc.runTmpPath())
}

func (svc *service) runMigrations() error {
	ledger := migrationsLedger{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Applied: []migrationEntry{}}
	path := filepath.Join(svc.dataDir, migrationsFile)
	if bytes, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(bytes, &ledger); err != nil {
			return fmt.Errorf("read migrations ledger failed: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read migrations ledger failed: %w", err)
	}

	if ledger.DataVersion > dataVersion {
		return fmt.Errorf("data version %d is newer than supported version %d", ledger.DataVersion, dataVersion)
	}
	ledger.SchemaVersion = dataSchemaVersion
	ledger.DataVersion = dataVersion
	if ledger.Applied == nil {
		ledger.Applied = []migrationEntry{}
	}
	if err := writeJSON(path, ledger); err != nil {
		return err
	}
	return writeJSON(filepath.Join(svc.dataDir, metaFile), metaDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, UpdatedAt: nowText()})
}

func (svc *service) settingsPath() string {
	return filepath.Join(svc.dataDir, settingsFile)
}

func (svc *service) reposPath() string {
	return filepath.Join(svc.dataDir, reposFile)
}

func (svc *service) commandsPath() string {
	return filepath.Join(svc.dataDir, commandsFile)
}

func (svc *service) collectionsPath() string {
	return filepath.Join(svc.dataDir, collectionsFile)
}

func (svc *service) quickRunsPath() string {
	return filepath.Join(svc.dataDir, quickRunsFile)
}

func (svc *service) readSettings() (appSettings, error) {
	var settings appSettings
	if err := readJSON(svc.settingsPath(), &settings); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return defaultSettings(), nil
		}
		return appSettings{}, err
	}
	if settings.CustomShells == nil {
		settings.CustomShells = []customShell{}
	}
	return settings, nil
}

func defaultSettings() appSettings {
	return appSettings{
		SchemaVersion:           dataSchemaVersion,
		DataVersion:             dataVersion,
		DefaultShellID:          defaultShellID,
		DefaultCloseMode:        defaultCloseMode,
		DefaultCountdownSeconds: defaultCountdownSeconds,
		DefaultRunMode:          defaultRunMode,
		DefaultProcessOwnership: defaultProcessOwnership,
		CustomShells:            []customShell{},
	}
}

func (svc *service) writeSettings(settings appSettings) error {
	settings.SchemaVersion = dataSchemaVersion
	settings.DataVersion = dataVersion
	settings.UpdatedAt = nowText()
	if settings.CustomShells == nil {
		settings.CustomShells = []customShell{}
	}
	return writeJSON(svc.settingsPath(), settings)
}

func (svc *service) saveGlobalSettings(shellID, closeMode string, countdownSeconds int, runMode, processOwnership string) (appSettings, error) {
	settings, err := svc.readSettings()
	if err != nil {
		return appSettings{}, err
	}
	if shellID != "" && !isKnownShellID(shellID) {
		return appSettings{}, fmt.Errorf("未知终端: %s", shellID)
	}
	if closeMode != "" && !validCloseMode(closeMode) {
		return appSettings{}, fmt.Errorf("未知关闭策略: %s", closeMode)
	}
	if countdownSeconds != 0 &&
		(countdownSeconds < minCountdownSeconds || countdownSeconds > maxCountdownSeconds) {
		return appSettings{}, fmt.Errorf("倒计时秒数必须在 %d-%d 之间", minCountdownSeconds, maxCountdownSeconds)
	}
	if runMode != "" && !validRunMode(runMode) {
		return appSettings{}, fmt.Errorf("未知运行模式: %s", runMode)
	}
	if processOwnership != "" && !validProcessOwnership(processOwnership) {
		return appSettings{}, fmt.Errorf("未知进程归属: %s", processOwnership)
	}
	if shellID != "" {
		settings.DefaultShellID = shellID
	}
	if closeMode != "" {
		settings.DefaultCloseMode = closeMode
	}
	if countdownSeconds != 0 {
		settings.DefaultCountdownSeconds = countdownSeconds
	}
	if runMode != "" {
		settings.DefaultRunMode = runMode
	}
	if processOwnership != "" {
		settings.DefaultProcessOwnership = processOwnership
	}
	if settings.DefaultCountdownSeconds < minCountdownSeconds {
		settings.DefaultCountdownSeconds = defaultCountdownSeconds
	}
	if settings.DefaultRunMode == "" {
		settings.DefaultRunMode = defaultRunMode
	}
	if settings.DefaultProcessOwnership == "" {
		settings.DefaultProcessOwnership = defaultProcessOwnership
	}
	if err := svc.writeSettings(settings); err != nil {
		return appSettings{}, err
	}
	return settings, nil
}

func (svc *service) loadRepos() (reposDoc, error) {
	var doc reposDoc
	if err := readJSON(svc.reposPath(), &doc); err != nil {
		return reposDoc{}, err
	}
	if doc.Repos == nil {
		doc.Repos = []repo{}
	}
	for index := range doc.Repos {
		if doc.Repos[index].Placeholders == nil {
			doc.Repos[index].Placeholders = []placeholder{}
		}
		applyDefaultPlaceholderModes(doc.Repos[index].Placeholders)
	}
	return doc, nil
}

func (svc *service) writeRepos(doc reposDoc) error {
	doc.SchemaVersion = dataSchemaVersion
	doc.DataVersion = dataVersion
	if doc.Repos == nil {
		doc.Repos = []repo{}
	}
	for index := range doc.Repos {
		if doc.Repos[index].Placeholders == nil {
			doc.Repos[index].Placeholders = []placeholder{}
		}
	}
	return writeJSON(svc.reposPath(), doc)
}

func (svc *service) loadCommands() (commandsDoc, error) {
	var doc commandsDoc
	if err := readJSON(svc.commandsPath(), &doc); err != nil {
		return commandsDoc{}, err
	}
	if doc.Commands == nil {
		doc.Commands = []command{}
	}
	for index := range doc.Commands {
		if doc.Commands[index].Placeholders == nil {
			doc.Commands[index].Placeholders = []placeholder{}
		}
		applyDefaultPlaceholderModes(doc.Commands[index].Placeholders)
	}
	return doc, nil
}

func (svc *service) writeCommands(doc commandsDoc) error {
	doc.SchemaVersion = dataSchemaVersion
	doc.DataVersion = dataVersion
	if doc.Commands == nil {
		doc.Commands = []command{}
	}
	for index := range doc.Commands {
		if doc.Commands[index].Placeholders == nil {
			doc.Commands[index].Placeholders = []placeholder{}
		}
	}
	return writeJSON(svc.commandsPath(), doc)
}

func (svc *service) loadCollections() (collectionsDoc, error) {
	var doc collectionsDoc
	if err := readJSON(svc.collectionsPath(), &doc); err != nil {
		return collectionsDoc{}, err
	}
	if doc.Nodes == nil {
		doc.Nodes = map[string]*collectionNode{}
	}
	return doc, nil
}

func (svc *service) writeCollections(doc collectionsDoc) error {
	doc.SchemaVersion = dataSchemaVersion
	doc.DataVersion = dataVersion
	if doc.Nodes == nil {
		doc.Nodes = map[string]*collectionNode{}
	}
	return writeJSON(svc.collectionsPath(), doc)
}

func (svc *service) loadQuickRuns() (quickRunsDoc, error) {
	var doc quickRunsDoc
	if err := readJSON(svc.quickRunsPath(), &doc); err != nil {
		return quickRunsDoc{}, err
	}
	if doc.QuickRuns == nil {
		doc.QuickRuns = []quickRun{}
	}
	return doc, nil
}

func (svc *service) writeQuickRuns(doc quickRunsDoc) error {
	doc.SchemaVersion = dataSchemaVersion
	doc.DataVersion = dataVersion
	if doc.QuickRuns == nil {
		doc.QuickRuns = []quickRun{}
	}
	return writeJSON(svc.quickRunsPath(), doc)
}

func ensureWritable(dir string) error {
	path := filepath.Join(dir, ".fw-command-runner-write-test")
	if err := os.WriteFile(path, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("data dir is not writable: %w", err)
	}
	_ = os.Remove(path)
	return nil
}
