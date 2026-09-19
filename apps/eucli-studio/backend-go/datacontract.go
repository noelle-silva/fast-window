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

// 数据契约：应用数据目录的版本登记与迁移账本。
// 独立于业务数据文件，负责目录可写保证、版本保护与迁移记录。
const (
	dataSchemaVersion  = 1
	dataVersion        = 1
	dataMetaFile       = "_meta.json"
	dataMigrationsFile = "_migrations.json"
	dataWriteTestFile  = ".fw-eucli-studio-backend-write-test"
)

type dataMetaDoc struct {
	SchemaVersion int    `json:"schemaVersion"`
	DataVersion   int    `json:"dataVersion"`
	UpdatedAt     string `json:"updatedAt"`
}

type dataMigrationEntry struct {
	ID          string `json:"id"`
	FromVersion int    `json:"fromVersion"`
	ToVersion   int    `json:"toVersion"`
	Description string `json:"description"`
	AppliedAt   string `json:"appliedAt"`
}

type dataMigrationsLedger struct {
	SchemaVersion int                  `json:"schemaVersion"`
	DataVersion   int                  `json:"dataVersion"`
	Applied       []dataMigrationEntry `json:"applied"`
}

// ensureDataContract 在业务存储初始化之前运行，保证数据目录可写、
// 数据版本受保护，并刷新版本元信息与迁移账本。
func ensureDataContract(dataDir string) error {
	dir := strings.TrimSpace(dataDir)
	if dir == "" {
		return errors.New("FW_APP_DATA_DIR is required")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("数据目录不可创建: %w", err)
	}
	if err := ensureDataDirWritable(dir); err != nil {
		return err
	}
	if err := runDataMigrations(dir); err != nil {
		return err
	}
	return writeDataMeta(dir)
}

func ensureDataDirWritable(dir string) error {
	testPath := filepath.Join(dir, dataWriteTestFile)
	if err := os.WriteFile(testPath, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("数据目录不可写: %w", err)
	}
	_ = os.Remove(testPath)
	return nil
}

func runDataMigrations(dir string) error {
	ledger := dataMigrationsLedger{
		SchemaVersion: dataSchemaVersion,
		DataVersion:   dataVersion,
		Applied:       []dataMigrationEntry{},
	}
	path := filepath.Join(dir, dataMigrationsFile)
	if payload, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(payload, &ledger); err != nil {
			return fmt.Errorf("读取数据迁移账本失败: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("读取数据迁移账本失败: %w", err)
	}

	if ledger.DataVersion > dataVersion {
		return fmt.Errorf("数据版本 %d 高于当前程序支持的版本 %d，请更新客户端", ledger.DataVersion, dataVersion)
	}
	ledger.SchemaVersion = dataSchemaVersion
	ledger.DataVersion = dataVersion
	if ledger.Applied == nil {
		ledger.Applied = []dataMigrationEntry{}
	}
	return writeDataJSON(path, ledger)
}

func writeDataMeta(dir string) error {
	return writeDataJSON(filepath.Join(dir, dataMetaFile), dataMetaDoc{
		SchemaVersion: dataSchemaVersion,
		DataVersion:   dataVersion,
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339),
	})
}

func writeDataJSON(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(payload, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
