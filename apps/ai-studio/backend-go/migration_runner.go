package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	appmigrations "fast-window-ai-studio-backend/migrations"
)

const (
	aiStudioSchemaVersion = 1
	aiStudioDataVersion   = 6
	migrationStateKey     = "_migrations"
)

type dataMigration = appmigrations.Migration

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

type migrationEntry struct {
	ToVersion int
}

func (svc *service) runMigrations() error {
	meta, err := svc.loadSplitMetaForMigration()
	if err != nil {
		return err
	}
	if meta == nil {
		return nil
	}

	current := int(asInt64(meta["dataVersion"], 0))
	if current <= 0 {
		current = 2
	}
	if current > aiStudioDataVersion {
		return fmt.Errorf("存储数据版本过高：当前 %d，程序支持 %d", current, aiStudioDataVersion)
	}

	state, err := svc.loadMigrationState()
	if err != nil {
		return err
	}

	registry := registeredMigrations()
	metaDirty := false
	for current < aiStudioDataVersion {
		migration := findMigration(registry, current)
		if migration == nil {
			return fmt.Errorf("缺少数据迁移：从版本 %d 到 %d", current, aiStudioDataVersion)
		}
		if applied, ok := state.ByID[migration.ID]; ok {
			if applied.ToVersion <= current {
				return fmt.Errorf("迁移记录异常：%s", migration.ID)
			}
			current = applied.ToVersion
			meta["dataVersion"] = current
			metaDirty = true
			continue
		}

		backupDir, err := svc.backupDataBeforeMigration(migration.ID)
		if err != nil {
			return err
		}
		ctx := appmigrations.Context{DataDir: svc.dataDir, Meta: meta}
		if err := migration.Apply(ctx); err != nil {
			return fmt.Errorf("数据迁移失败：%s，已保留备份 %s：%w", migration.ID, backupDir, err)
		}

		current = migration.ToVersion
		meta["dataVersion"] = current
		meta["schemaVersion"] = aiStudioSchemaVersion
		meta["updatedAt"] = nowMs()
		if err := svc.storageSetByKey(splitMetaKey, meta); err != nil {
			return err
		}
		state.add(migration)
		if err := svc.saveMigrationState(state); err != nil {
			return err
		}
		metaDirty = false
	}
	if metaDirty {
		meta["schemaVersion"] = aiStudioSchemaVersion
		meta["updatedAt"] = nowMs()
		if err := svc.storageSetByKey(splitMetaKey, meta); err != nil {
			return err
		}
	}

	return nil
}

func registeredMigrations() []dataMigration {
	return appmigrations.All()
}

func findMigration(items []dataMigration, fromVersion int) *dataMigration {
	for i := range items {
		if items[i].FromVersion == fromVersion {
			return &items[i]
		}
	}
	return nil
}

func (svc *service) loadSplitMetaForMigration() (map[string]any, error) {
	path, err := svc.storagePathForKey(splitMetaKey)
	if err != nil {
		return nil, err
	}
	rawBytes, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(rawBytes)) == "" {
		return nil, nil
	}
	var meta map[string]any
	if err := json.Unmarshal(rawBytes, &meta); err != nil {
		return nil, err
	}
	if meta == nil {
		return nil, nil
	}
	if int(asInt64(meta["schemaVersion"], 0)) != aiStudioSchemaVersion {
		return nil, errors.New("存储索引损坏：meta/index 格式不正确")
	}
	return meta, nil
}

func (svc *service) loadMigrationState() (migrationState, error) {
	state := migrationState{SchemaVersion: 1, Applied: []migrationStateRecord{}, ByID: map[string]migrationEntry{}}
	value, err := svc.storageGetByKey(migrationStateKey)
	if err != nil {
		return state, err
	}
	obj, _ := value.(map[string]any)
	if obj == nil {
		return state, nil
	}
	state.SchemaVersion = int(asInt64(obj["schemaVersion"], 1))
	state.UpdatedAt = asInt64(obj["updatedAt"], 0)
	for _, raw := range asSlice(obj["applied"]) {
		entry := asMap(raw)
		id := strings.TrimSpace(asString(entry["id"]))
		if id == "" {
			continue
		}
		record := migrationStateRecord{
			ID:          id,
			FromVersion: int(asInt64(entry["fromVersion"], 0)),
			ToVersion:   int(asInt64(entry["toVersion"], 0)),
			Description: asString(entry["description"]),
			AppliedAt:   asInt64(entry["appliedAt"], 0),
		}
		state.Applied = append(state.Applied, record)
		state.ByID[id] = migrationEntry{ToVersion: record.ToVersion}
	}
	return state, nil
}

func (state *migrationState) add(migration *dataMigration) {
	if state.ByID == nil {
		state.ByID = map[string]migrationEntry{}
	}
	if _, ok := state.ByID[migration.ID]; ok {
		return
	}
	record := migrationStateRecord{
		ID:          migration.ID,
		FromVersion: migration.FromVersion,
		ToVersion:   migration.ToVersion,
		Description: migration.Description,
		AppliedAt:   nowMs(),
	}
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
	state.UpdatedAt = nowMs()
	return svc.storageSetByKey(migrationStateKey, map[string]any{
		"schemaVersion": state.SchemaVersion,
		"updatedAt":     state.UpdatedAt,
		"applied":       state.Applied,
	})
}

func (svc *service) backupDataBeforeMigration(migrationID string) (string, error) {
	stamp := time.Now().Format("20060102-150405")
	backupDir := filepath.Join(svc.dataDir, "_migration-backups", stamp+"-"+sanitizeMigrationID(migrationID))
	backupAbs, err := filepath.Abs(backupDir)
	if err != nil {
		return "", err
	}
	if err := copyDirFiltered(svc.dataDir, backupDir, func(path string, info os.FileInfo) bool {
		pathAbs, err := filepath.Abs(path)
		if err == nil && (pathAbs == backupAbs || strings.HasPrefix(pathAbs, backupAbs+string(os.PathSeparator))) {
			return false
		}
		rel, err := filepath.Rel(svc.dataDir, path)
		if err != nil {
			return false
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return true
		}
		return rel != "_migration-backups" && !strings.HasPrefix(rel, "_migration-backups/")
	}); err != nil {
		return "", err
	}
	return backupDir, nil
}

func sanitizeMigrationID(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "migration"
	}
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	out := strings.Trim(b.String(), "._- ")
	if out == "" {
		return "migration"
	}
	if len(out) > 80 {
		return out[:80]
	}
	return out
}

func copyDirFiltered(src string, dst string, include func(string, os.FileInfo) bool) error {
	srcAbs, err := filepath.Abs(src)
	if err != nil {
		return err
	}
	dstAbs, err := filepath.Abs(dst)
	if err != nil {
		return err
	}
	return filepath.Walk(srcAbs, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == dstAbs || strings.HasPrefix(path, dstAbs+string(os.PathSeparator)) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if include != nil && !include(path, info) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(srcAbs, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return os.MkdirAll(dstAbs, 0o755)
		}
		to := filepath.Join(dstAbs, rel)
		if info.IsDir() {
			return os.MkdirAll(to, info.Mode().Perm())
		}
		return copyFile(path, to, info.Mode().Perm())
	})
}

func copyFile(src string, dst string, perm os.FileMode) error {
	payload, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, payload, perm)
}
