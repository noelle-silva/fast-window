package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const (
	currentDataVersion    = 9
	migrationsLedgerFile  = "_migrations.json"
	migrationRecoveryDir  = "_migration-recovery"
	migrationRecoveryFile = "recovery.json"
)

type dataMigration struct {
	ID          string
	FromVersion int
	ToVersion   int
	Run         func(*service) error
}

type migrationsLedger struct {
	SchemaVersion int              `json:"schemaVersion"`
	DataVersion   int              `json:"dataVersion"`
	UpdatedAtMs   float64          `json:"updatedAtMs"`
	Applied       []migrationEntry `json:"applied"`
}

type migrationEntry struct {
	ID            string  `json:"id"`
	FromVersion   int     `json:"fromVersion"`
	ToVersion     int     `json:"toVersion"`
	StartedAtMs   float64 `json:"startedAtMs"`
	CompletedAtMs float64 `json:"completedAtMs"`
}

type migrationRecoveryDoc struct {
	SchemaVersion int     `json:"schemaVersion"`
	MigrationID   string  `json:"migrationId"`
	FromVersion   int     `json:"fromVersion"`
	ToVersion     int     `json:"toVersion"`
	FailedAtMs    float64 `json:"failedAtMs"`
	Error         string  `json:"error"`
	DataDir       string  `json:"dataDir"`
	StateDir      string  `json:"stateDir"`
	LibraryDir    string  `json:"libraryDir"`
	RecoveryDir   string  `json:"recoveryDir"`
}

func (svc *service) runDataMigrations() error {
	migrations := []dataMigration{
		{
			ID:          stateLibraryLayoutMigration,
			FromVersion: 0,
			ToVersion:   1,
			Run:         (*service).migrateDataLayout,
		},
		{
			ID:          noteIDPackageDirMigration,
			FromVersion: 1,
			ToVersion:   2,
			Run:         (*service).migrateNotePackageDirsToIDs,
		},
		{
			ID:          noteFaceSystemUnificationMigration,
			FromVersion: 2,
			ToVersion:   3,
			Run:         (*service).migrateNoteFaceSystemUnification,
		},
		{
			ID:          noteFaceRefsV2Migration,
			FromVersion: 3,
			ToVersion:   4,
			Run:         (*service).migrateNoteFaceRefsV2,
		},
		{
			ID:          noteFaceSearchIndexMigration,
			FromVersion: 4,
			ToVersion:   5,
			Run:         (*service).migrateNoteFaceSearchIndex,
		},
		{
			ID:          noteFaceTimestampsMigration,
			FromVersion: 5,
			ToVersion:   6,
			Run:         (*service).migrateNoteFaceTimestamps,
		},
		{
			ID:          htmlFaceLegacySettingsMigration,
			FromVersion: 6,
			ToVersion:   7,
			Run:         (*service).migrateHTMLFaceLegacySettings,
		},
		{
			ID:          dataIdentitySplitMigration,
			FromVersion: 7,
			ToVersion:   8,
			Run:         (*service).migrateDataIdentitySplit,
		},
		{
			ID:          repoPoolLayoutMigration,
			FromVersion: 8,
			ToVersion:   9,
			Run:         (*service).migrateRepoPoolLayout,
		},
	}
	return svc.runMigrations(migrations)
}

func (svc *service) runMigrations(migrations []dataMigration) error {
	ledger, err := svc.loadMigrationsLedger()
	if err != nil {
		return svc.failMigration("ledger-load", 0, currentDataVersion, err)
	}
	if ledger.DataVersion > currentDataVersion {
		return svc.failMigration("version-check", currentDataVersion, ledger.DataVersion, fmt.Errorf("数据目录版本 %d 高于当前程序支持版本 %d", ledger.DataVersion, currentDataVersion))
	}

	for _, migration := range migrations {
		if migration.ToVersion <= ledger.DataVersion {
			continue
		}
		if migration.FromVersion != ledger.DataVersion {
			return svc.failMigration(migration.ID, migration.FromVersion, migration.ToVersion, fmt.Errorf("数据目录版本不连续：当前版本 %d，迁移要求从 %d 开始", ledger.DataVersion, migration.FromVersion))
		}
		startedAt := nowMs()
		if err := migration.Run(svc); err != nil {
			return svc.failMigration(migration.ID, migration.FromVersion, migration.ToVersion, err)
		}
		completedAt := nowMs()
		ledger.SchemaVersion = 1
		ledger.DataVersion = migration.ToVersion
		ledger.UpdatedAtMs = completedAt
		ledger.Applied = append(ledger.Applied, migrationEntry{
			ID:            migration.ID,
			FromVersion:   migration.FromVersion,
			ToVersion:     migration.ToVersion,
			StartedAtMs:   startedAt,
			CompletedAtMs: completedAt,
		})
		if err := svc.writeMigrationsLedger(ledger); err != nil {
			return svc.failMigration(migration.ID, migration.FromVersion, migration.ToVersion, fmt.Errorf("写入数据升级账本失败: %w", err))
		}
	}

	if ledger.DataVersion < currentDataVersion {
		return svc.failMigration("version-check", ledger.DataVersion, currentDataVersion, fmt.Errorf("缺少从数据版本 %d 升级到 %d 的迁移步骤", ledger.DataVersion, currentDataVersion))
	}
	return svc.clearMigrationRecovery()
}

func (svc *service) loadMigrationsLedger() (migrationsLedger, error) {
	ledger := migrationsLedger{SchemaVersion: 1, DataVersion: 0, Applied: []migrationEntry{}}
	path := filepath.Join(svc.dataDir, migrationsLedgerFile)
	if err := readJSONFile(path, &ledger); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return migrationsLedger{SchemaVersion: 1, DataVersion: 0, Applied: []migrationEntry{}}, nil
		}
		return migrationsLedger{}, fmt.Errorf("读取数据升级账本失败: %w", err)
	}
	if ledger.SchemaVersion <= 0 {
		ledger.SchemaVersion = 1
	}
	if ledger.DataVersion < 0 {
		return migrationsLedger{}, fmt.Errorf("数据升级账本版本非法: %d", ledger.DataVersion)
	}
	if ledger.Applied == nil {
		ledger.Applied = []migrationEntry{}
	}
	return ledger, nil
}

func (svc *service) writeMigrationsLedger(ledger migrationsLedger) error {
	ledger.SchemaVersion = 1
	ledger.UpdatedAtMs = nowMs()
	if ledger.Applied == nil {
		ledger.Applied = []migrationEntry{}
	}
	return writeJSONFile(filepath.Join(svc.dataDir, migrationsLedgerFile), ledger)
}

func (svc *service) failMigration(id string, fromVersion int, toVersion int, cause error) error {
	if cause == nil {
		cause = errors.New("未知数据升级错误")
	}
	recoveryDir := filepath.Join(svc.dataDir, migrationRecoveryDir)
	doc := migrationRecoveryDoc{
		SchemaVersion: 1,
		MigrationID:   id,
		FromVersion:   fromVersion,
		ToVersion:     toVersion,
		FailedAtMs:    nowMs(),
		Error:         cause.Error(),
		DataDir:       svc.dataDir,
		StateDir:      svc.stateDir,
		LibraryDir:    svc.legacyLibraryDir,
		RecoveryDir:   recoveryDir,
	}
	if err := writeJSONFile(filepath.Join(recoveryDir, migrationRecoveryFile), doc); err != nil {
		return fmt.Errorf("数据升级失败：%w；写入恢复信息失败: %v", cause, err)
	}
	return fmt.Errorf("数据升级失败：%w", cause)
}

func (svc *service) clearMigrationRecovery() error {
	if err := os.RemoveAll(filepath.Join(svc.dataDir, migrationRecoveryDir)); err != nil {
		return fmt.Errorf("清理数据升级恢复信息失败: %w", err)
	}
	return nil
}
