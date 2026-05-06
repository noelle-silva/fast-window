package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	currentDataVersion          = 1
	migrationsLedgerFile        = "_migrations.json"
	migrationRecoveryDir        = "_migration-recovery"
	migrationRecoveryFile       = "recovery.json"
	stateLibraryLayoutMigration = "2026-05-06-state-library-layout"
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

type migrationReport struct {
	Imported bool     `json:"imported"`
	Files    []string `json:"files"`
	Skipped  []string `json:"skipped"`
}

func (svc *service) migrateDataLayout() error {
	for _, file := range []string{metadataFile, favoritesFile} {
		if err := svc.moveRootFileToState(file); err != nil {
			return err
		}
	}
	for _, dir := range []string{notesDir, assetsDir, trashDir} {
		if err := svc.moveRootDirToLibrary(dir); err != nil {
			return err
		}
	}
	for _, file := range []string{indexFile, refsIndexFile, assetsIndexFile} {
		if err := svc.moveRootFileToLibrary(file); err != nil {
			return err
		}
	}
	return nil
}

func (svc *service) runDataMigrations() error {
	migrations := []dataMigration{
		{
			ID:          stateLibraryLayoutMigration,
			FromVersion: 0,
			ToVersion:   1,
			Run:         (*service).migrateDataLayout,
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
		LibraryDir:    svc.libraryDir,
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

func (svc *service) importLegacyData(sourceDir string) (migrationReport, error) {
	source, err := filepath.Abs(strings.TrimSpace(sourceDir))
	if err != nil {
		return migrationReport{}, fmt.Errorf("解析导入目录失败: %w", err)
	}
	if source == "" || !exists(source) {
		return migrationReport{}, errors.New("导入目录不存在")
	}
	if isInside(svc.dataDir, source) {
		return migrationReport{}, errors.New("导入目录不能位于当前 HyperCortex 数据目录内部")
	}
	if err := svc.ensureRoots(); err != nil {
		return migrationReport{}, err
	}

	report := migrationReport{Imported: true}
	for _, file := range []string{metadataFile, favoritesFile} {
		copied, err := copyFileIfTargetMissing(filepath.Join(source, file), filepath.Join(svc.stateDir, file))
		if err != nil {
			return report, err
		}
		report.record(file, copied)
	}
	for _, dir := range []string{notesDir, assetsDir, trashDir} {
		copied, err := copyDirMissingEntries(filepath.Join(source, dir), filepath.Join(svc.libraryDir, dir))
		if err != nil {
			return report, err
		}
		report.record(dir+"/", copied)
	}
	for _, file := range []string{indexFile, refsIndexFile, assetsIndexFile} {
		copied, err := copyFileIfTargetMissing(filepath.Join(source, file), filepath.Join(svc.libraryDir, file))
		if err != nil {
			return report, err
		}
		report.record(file, copied)
	}
	return report, nil
}

func (report *migrationReport) record(path string, copied bool) {
	if copied {
		report.Files = append(report.Files, path)
	} else {
		report.Skipped = append(report.Skipped, path)
	}
}

func (svc *service) moveRootFileToState(name string) error {
	return moveFileIfTargetMissing(filepath.Join(svc.dataDir, name), filepath.Join(svc.stateDir, name))
}

func (svc *service) moveRootFileToLibrary(name string) error {
	return moveFileIfTargetMissing(filepath.Join(svc.dataDir, name), filepath.Join(svc.libraryDir, name))
}

func (svc *service) moveRootDirToLibrary(name string) error {
	return moveDirIfTargetMissing(filepath.Join(svc.dataDir, name), filepath.Join(svc.libraryDir, name))
}

func moveFileIfTargetMissing(from string, to string) error {
	info, err := os.Stat(from)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.IsDir() {
		return nil
	}
	if exists(to) {
		return nil
	}
	if err := ensureParent(to); err != nil {
		return err
	}
	return os.Rename(from, to)
}

func moveDirIfTargetMissing(from string, to string) error {
	info, err := os.Stat(from)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || exists(to) {
		return nil
	}
	if err := ensureParent(to); err != nil {
		return err
	}
	return os.Rename(from, to)
}

func copyFileIfTargetMissing(from string, to string) (bool, error) {
	info, err := os.Stat(from)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if info.IsDir() || exists(to) {
		return false, nil
	}
	if err := ensureParent(to); err != nil {
		return false, err
	}
	src, err := os.Open(from)
	if err != nil {
		return false, err
	}
	defer src.Close()
	dst, err := os.OpenFile(to, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return false, err
	}
	_, copyErr := io.Copy(dst, src)
	closeErr := dst.Close()
	if copyErr != nil {
		_ = os.Remove(to)
		return false, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(to)
		return false, closeErr
	}
	return true, nil
}

func copyDirIfTargetMissing(from string, to string) (bool, error) {
	info, err := os.Stat(from)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.IsDir() || exists(to) {
		return false, nil
	}
	if err := os.MkdirAll(to, 0o755); err != nil {
		return false, err
	}
	if err := copyDirContents(from, to); err != nil {
		_ = os.RemoveAll(to)
		return false, err
	}
	return true, nil
}

func copyDirMissingEntries(from string, to string) (bool, error) {
	info, err := os.Stat(from)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.IsDir() {
		return false, nil
	}
	if err := os.MkdirAll(to, 0o755); err != nil {
		return false, err
	}
	return copyDirContentsMissingEntries(from, to)
}

func copyDirContents(from string, to string) error {
	entries, err := os.ReadDir(from)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		src := filepath.Join(from, entry.Name())
		dst := filepath.Join(to, entry.Name())
		if entry.IsDir() {
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return err
			}
			if err := copyDirContents(src, dst); err != nil {
				return err
			}
			continue
		}
		if _, err := copyFileIfTargetMissing(src, dst); err != nil {
			return err
		}
	}
	return nil
}

func copyDirContentsMissingEntries(from string, to string) (bool, error) {
	entries, err := os.ReadDir(from)
	if err != nil {
		return false, err
	}
	copiedAny := false
	for _, entry := range entries {
		src := filepath.Join(from, entry.Name())
		dst := filepath.Join(to, entry.Name())
		if entry.IsDir() {
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return copiedAny, err
			}
			copied, err := copyDirContentsMissingEntries(src, dst)
			if err != nil {
				return copiedAny, err
			}
			copiedAny = copiedAny || copied
			continue
		}
		copied, err := copyFileIfTargetMissing(src, dst)
		if err != nil {
			return copiedAny, err
		}
		copiedAny = copiedAny || copied
	}
	return copiedAny, nil
}
