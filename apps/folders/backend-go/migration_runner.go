package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	migrationStateFile = "_migrations.json"
)

type dataMigration struct {
	ID          string
	FromVersion int
	ToVersion   int
	Description string
	Recovery    migrationRecoverySpec
	Apply       func(*service) error
}

type migrationState struct {
	SchemaVersion int                       `json:"schemaVersion"`
	UpdatedAt     int64                     `json:"updatedAt"`
	Applied       []migrationStateRecord    `json:"applied"`
	ByID          map[string]migrationEntry `json:"-"`
}

type migrationStateRecord struct {
	ID          string `json:"id"`
	FromVersion int    `json:"fromVersion"`
	ToVersion   int    `json:"toVersion"`
	Description string `json:"description"`
	AppliedAt   int64  `json:"appliedAt"`
}

type migrationStateRecordJSON struct {
	ID          string            `json:"id"`
	FromVersion int               `json:"fromVersion"`
	ToVersion   int               `json:"toVersion"`
	Description string            `json:"description"`
	AppliedAt   migrationTimeJSON `json:"appliedAt"`
}

type migrationStateJSON struct {
	SchemaVersion int                        `json:"schemaVersion"`
	UpdatedAt     migrationTimeJSON          `json:"updatedAt"`
	Applied       []migrationStateRecordJSON `json:"applied"`
}

type migrationTimeJSON int64

func (value *migrationTimeJSON) UnmarshalJSON(payload []byte) error {
	text := strings.TrimSpace(string(payload))
	if text == "" || text == "null" {
		*value = 0
		return nil
	}

	var millis int64
	if err := json.Unmarshal(payload, &millis); err == nil {
		*value = migrationTimeJSON(millis)
		return nil
	}

	var timestamp string
	if err := json.Unmarshal(payload, &timestamp); err != nil {
		return fmt.Errorf("expected unix milliseconds or RFC3339 timestamp: %w", err)
	}
	if strings.TrimSpace(timestamp) == "" {
		*value = 0
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		return fmt.Errorf("parse RFC3339 timestamp failed: %w", err)
	}
	*value = migrationTimeJSON(parsed.UnixMilli())
	return nil
}

type migrationEntry struct {
	ToVersion int
}

func (svc *service) runMigrations() error {
	current, hasData, err := svc.dataVersionForMigration()
	if err != nil {
		return err
	}
	if current > dataVersion {
		return fmt.Errorf("folders data version %d is newer than supported version %d", current, dataVersion)
	}

	state, err := svc.loadMigrationState()
	if err != nil {
		return err
	}
	if !hasData {
		if err := svc.saveMigrationState(state); err != nil {
			return err
		}
		return svc.writeMeta()
	}

	registry := registeredMigrations()
	for current < dataVersion {
		migration := findMigration(registry, current)
		if migration == nil {
			return fmt.Errorf("missing folders data migration: from version %d to %d", current, dataVersion)
		}
		if _, ok := state.ByID[migration.ID]; ok {
			return fmt.Errorf("folders migration ledger says %s is applied but data is still version %d", migration.ID, current)
		}

		recoveryDir, err := svc.prepareMigrationRecovery(migration)
		if err != nil {
			return err
		}
		if err := migration.Apply(svc); err != nil {
			return fmt.Errorf("folders data migration failed: %s; recovery package: %s: %w", migration.ID, filepath.ToSlash(recoveryDir), err)
		}
		current = migration.ToVersion
		if err := svc.writeMeta(); err != nil {
			return err
		}
		state.add(migration)
		if err := svc.saveMigrationState(state); err != nil {
			return err
		}
	}

	if err := svc.saveMigrationState(state); err != nil {
		return err
	}
	return svc.writeMeta()
}

func registeredMigrations() []dataMigration {
	return []dataMigration{
		legacyFlatWorkspaceMigration(1),
		legacyFlatWorkspaceMigration(2),
		legacyFlatWorkspaceMigration(3),
		legacyFlatWorkspaceMigration(4),
		categoryOrderMigration(),
		allViewMigration(),
	}
}

func legacyFlatWorkspaceMigration(fromVersion int) dataMigration {
	return dataMigration{
		ID:          fmt.Sprintf("2026-05-12-folders-data-v%d-to-v5", fromVersion),
		FromVersion: fromVersion,
		ToVersion:   5,
		Description: "Migrate legacy single-workspace folders data into category workspaces",
		Recovery: migrationRecoverySpec{
			AffectedPaths: []string{dataFile, metaFile, migrationStateFile},
			Notes: []string{
				"The migration preserves legacy folder groups, items, containers, layouts, and wallpaper data under the folder category.",
				"The url and file categories are initialized as empty workspaces because legacy folders data only represented folder targets.",
			},
		},
		Apply: func(svc *service) error {
			return svc.migrateLegacyWorkspaceToCategories(fromVersion)
		},
	}
}

func categoryOrderMigration() dataMigration {
	return dataMigration{
		ID:          "2026-05-15-folders-data-v5-to-v6-category-order",
		FromVersion: 5,
		ToVersion:   6,
		Description: "Add explicit category order settings to folders data",
		Recovery: migrationRecoverySpec{
			AffectedPaths: []string{dataFile, metaFile, migrationStateFile},
			Notes: []string{
				"The migration preserves all category workspaces and initializes categoryOrder from the canonical folder, url, file order.",
			},
		},
		Apply: func(svc *service) error {
			return svc.migrateCategoryOrder()
		},
	}
}

func allViewMigration() dataMigration {
	return dataMigration{
		ID:          "2026-05-16-folders-data-v6-to-v7-all-view",
		FromVersion: 6,
		ToVersion:   dataVersion,
		Description: "Add persisted all-category aggregate view settings to folders data",
		Recovery: migrationRecoverySpec{
			AffectedPaths: []string{dataFile, metaFile, migrationStateFile},
			Notes: []string{
				"The migration preserves all concrete category workspaces and initializes the all-category view as an empty aggregate selection.",
			},
		},
		Apply: func(svc *service) error {
			return svc.migrateAllView()
		},
	}
}

func findMigration(items []dataMigration, fromVersion int) *dataMigration {
	for i := range items {
		if items[i].FromVersion == fromVersion {
			return &items[i]
		}
	}
	return nil
}

func (svc *service) dataVersionForMigration() (int, bool, error) {
	payload, err := os.ReadFile(filepath.Join(svc.dataDir, dataFile))
	if errors.Is(err, os.ErrNotExist) {
		return dataVersion, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("read folders data for migration failed: %w", err)
	}
	if strings.TrimSpace(string(payload)) == "" {
		return 0, true, errors.New("folders data file is empty")
	}

	var header struct {
		SchemaVersion *int `json:"schemaVersion"`
		DataVersion   *int `json:"dataVersion"`
	}
	if err := json.Unmarshal(payload, &header); err != nil {
		return 0, true, fmt.Errorf("parse folders data for migration failed: %w", err)
	}
	if header.SchemaVersion != nil && *header.SchemaVersion > dataSchemaVersion {
		return 0, true, fmt.Errorf("folders data schemaVersion %d is newer than supported version %d", *header.SchemaVersion, dataSchemaVersion)
	}
	if header.DataVersion != nil && *header.DataVersion > 0 {
		return *header.DataVersion, true, nil
	}

	metaVersion, ok, err := svc.metaDataVersionForMigration()
	if err != nil {
		return 0, true, err
	}
	if ok && metaVersion > 0 {
		return metaVersion, true, nil
	}
	return 0, true, errors.New("folders data dataVersion is required for migration")
}

func (svc *service) metaDataVersionForMigration() (int, bool, error) {
	payload, err := os.ReadFile(filepath.Join(svc.dataDir, metaFile))
	if errors.Is(err, os.ErrNotExist) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("read folders migration meta failed: %w", err)
	}
	if strings.TrimSpace(string(payload)) == "" {
		return 0, false, nil
	}
	var meta metaDoc
	if err := json.Unmarshal(payload, &meta); err != nil {
		return 0, true, fmt.Errorf("parse folders migration meta failed: %w", err)
	}
	if meta.SchemaVersion > dataSchemaVersion {
		return 0, true, fmt.Errorf("folders data schemaVersion %d is newer than supported version %d", meta.SchemaVersion, dataSchemaVersion)
	}
	return meta.DataVersion, true, nil
}

func (svc *service) loadMigrationState() (migrationState, error) {
	state := migrationState{SchemaVersion: 1, Applied: []migrationStateRecord{}, ByID: map[string]migrationEntry{}}
	payload, err := os.ReadFile(filepath.Join(svc.dataDir, migrationStateFile))
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, fmt.Errorf("read folders migration ledger failed: %w", err)
	}
	if strings.TrimSpace(string(payload)) == "" {
		return state, nil
	}
	var raw migrationStateJSON
	if err := json.Unmarshal(payload, &raw); err != nil {
		return state, fmt.Errorf("parse folders migration ledger failed: %w", err)
	}
	state.SchemaVersion = raw.SchemaVersion
	state.UpdatedAt = int64(raw.UpdatedAt)
	state.Applied = make([]migrationStateRecord, 0, len(raw.Applied))
	for _, record := range raw.Applied {
		state.Applied = append(state.Applied, migrationStateRecord{
			ID:          record.ID,
			FromVersion: record.FromVersion,
			ToVersion:   record.ToVersion,
			Description: record.Description,
			AppliedAt:   int64(record.AppliedAt),
		})
	}
	if state.SchemaVersion <= 0 {
		state.SchemaVersion = 1
	}
	if state.Applied == nil {
		state.Applied = []migrationStateRecord{}
	}
	state.ByID = map[string]migrationEntry{}
	for _, record := range state.Applied {
		id := strings.TrimSpace(record.ID)
		if id == "" {
			continue
		}
		state.ByID[id] = migrationEntry{ToVersion: record.ToVersion}
	}
	return state, nil
}

func (state *migrationState) add(migration *dataMigration) {
	if state.ByID == nil {
		state.ByID = map[string]migrationEntry{}
	}
	if _, exists := state.ByID[migration.ID]; exists {
		return
	}
	record := migrationStateRecord{ID: migration.ID, FromVersion: migration.FromVersion, ToVersion: migration.ToVersion, Description: migration.Description, AppliedAt: nowMS()}
	state.Applied = append(state.Applied, record)
	state.ByID[migration.ID] = migrationEntry{ToVersion: migration.ToVersion}
	state.SchemaVersion = 1
	state.UpdatedAt = record.AppliedAt
}

func (svc *service) saveMigrationState(state migrationState) error {
	if state.SchemaVersion <= 0 {
		state.SchemaVersion = 1
	}
	if state.Applied == nil {
		state.Applied = []migrationStateRecord{}
	}
	state.UpdatedAt = nowMS()
	return writeJSON(filepath.Join(svc.dataDir, migrationStateFile), map[string]any{"schemaVersion": state.SchemaVersion, "updatedAt": state.UpdatedAt, "applied": state.Applied})
}

func nowMS() int64 {
	return time.Now().UnixMilli()
}
