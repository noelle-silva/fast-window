package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	aiDrawSchemaVersion = 1
	aiDrawDataVersion   = 2
	migrationStateFile  = "_migrations.json"
	metaFile            = "_meta.json"
)

type dataMigration struct {
	ID          string
	FromVersion int
	ToVersion   int
	Description string
	Recovery    migrationRecoverySpec
	Apply       func(*service) error
}

type migrationRecoverySpec struct {
	AffectedPaths []string
	Notes         []string
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

type migrationEntry struct {
	ToVersion int
}

func (svc *service) runMigrations() error {
	meta, err := svc.loadMetaForMigration()
	if err != nil {
		return err
	}
	current := intNumber(meta["dataVersion"])
	if current <= 0 {
		current = 1
	}
	if current > aiDrawDataVersion {
		return fmt.Errorf("AI 绘图数据版本过高：当前 %d，程序支持 %d", current, aiDrawDataVersion)
	}

	state, err := svc.loadMigrationState()
	if err != nil {
		return err
	}
	for current < aiDrawDataVersion {
		migration := findMigration(registeredMigrations(), current)
		if migration == nil {
			return fmt.Errorf("缺少 AI 绘图数据迁移：从版本 %d 到 %d", current, aiDrawDataVersion)
		}
		if applied, ok := state.ByID[migration.ID]; ok {
			if applied.ToVersion <= current {
				return fmt.Errorf("迁移记录异常：%s", migration.ID)
			}
			current = applied.ToVersion
			continue
		}

		recoveryDir, err := svc.prepareMigrationRecovery(migration)
		if err != nil {
			return err
		}
		if err := migration.Apply(svc); err != nil {
			return fmt.Errorf("AI 绘图数据迁移失败：%s，已保留恢复包 %s：%w", migration.ID, recoveryDir, err)
		}
		current = migration.ToVersion
		meta["schemaVersion"] = aiDrawSchemaVersion
		meta["dataVersion"] = current
		meta["updatedAt"] = nowMs()
		if err := svc.store.write(filepath.Join(svc.dataDir, metaFile), meta); err != nil {
			return err
		}
		state.add(migration)
		if err := svc.saveMigrationState(state); err != nil {
			return err
		}
	}

	meta["schemaVersion"] = aiDrawSchemaVersion
	meta["dataVersion"] = aiDrawDataVersion
	meta["updatedAt"] = nowMs()
	return svc.store.write(filepath.Join(svc.dataDir, metaFile), meta)
}

func registeredMigrations() []dataMigration {
	return []dataMigration{pluginEraLayoutMigration()}
}

func findMigration(items []dataMigration, fromVersion int) *dataMigration {
	for i := range items {
		if items[i].FromVersion == fromVersion {
			return &items[i]
		}
	}
	return nil
}

func (svc *service) loadMetaForMigration() (map[string]any, error) {
	path := filepath.Join(svc.dataDir, metaFile)
	value, err := svc.store.read(path)
	if err != nil {
		return nil, err
	}
	if value == nil {
		now := nowMs()
		dataVersion := aiDrawDataVersion
		if svc.hasLegacyMigrationInput() {
			dataVersion = 1
		}
		return map[string]any{"schemaVersion": aiDrawSchemaVersion, "dataVersion": dataVersion, "createdAt": now, "updatedAt": now}, nil
	}
	meta, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("AI 绘图数据索引损坏：_meta.json 格式不正确")
	}
	if intNumber(meta["schemaVersion"]) <= 0 {
		meta["schemaVersion"] = aiDrawSchemaVersion
	}
	return meta, nil
}

func (svc *service) hasLegacyMigrationInput() bool {
	if fileExists(filepath.Join(svc.dataDir, legacyPackFile)) {
		return true
	}
	for _, key := range []string{"settings", "taskHistory", "promptLibrary", "refLibraryIndex"} {
		if fileExists(filepath.Join(svc.dataDir, shardFile(key))) {
			return true
		}
		if fileExists(filepath.Join(svc.dataDir, filepath.FromSlash(legacyShardDir), shardFile(key))) {
			return true
		}
	}
	return false
}

func (svc *service) loadMigrationState() (migrationState, error) {
	state := migrationState{SchemaVersion: 1, Applied: []migrationStateRecord{}, ByID: map[string]migrationEntry{}}
	value, err := svc.store.read(filepath.Join(svc.dataDir, migrationStateFile))
	if err != nil {
		return state, err
	}
	obj, _ := value.(map[string]any)
	if obj == nil {
		return state, nil
	}
	state.SchemaVersion = intNumber(obj["schemaVersion"])
	if state.SchemaVersion <= 0 {
		state.SchemaVersion = 1
	}
	state.UpdatedAt = int64Number(obj["updatedAt"])
	for _, raw := range anySlice(obj["applied"]) {
		entry, _ := raw.(map[string]any)
		id := strings.TrimSpace(asString(entry["id"]))
		if id == "" {
			continue
		}
		record := migrationStateRecord{
			ID:          id,
			FromVersion: intNumber(entry["fromVersion"]),
			ToVersion:   intNumber(entry["toVersion"]),
			Description: asString(entry["description"]),
			AppliedAt:   int64Number(entry["appliedAt"]),
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
	state.ByID[migration.ID] = migrationEntry{ToVersion: record.ToVersion}
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
	return svc.store.write(filepath.Join(svc.dataDir, migrationStateFile), map[string]any{
		"schemaVersion": state.SchemaVersion,
		"updatedAt":     state.UpdatedAt,
		"applied":       state.Applied,
	})
}

type migrationRecoveryPlan struct {
	MigrationID     string                 `json:"migrationId"`
	FromVersion     int                    `json:"fromVersion"`
	ToVersion       int                    `json:"toVersion"`
	Description     string                 `json:"description"`
	CreatedAt       int64                  `json:"createdAt"`
	Strategy        string                 `json:"strategy"`
	AffectedPaths   []string               `json:"affectedPaths"`
	CopiedPaths     []string               `json:"copiedPaths"`
	ExecutionLog    []migrationRecoveryLog `json:"executionLog"`
	FailureRecovery []string               `json:"failureRecovery"`
	Notes           []string               `json:"notes"`
}

type migrationRecoveryLog struct {
	At      int64  `json:"at"`
	Step    string `json:"step"`
	Message string `json:"message"`
}

func (svc *service) prepareMigrationRecovery(migration *dataMigration) (string, error) {
	stamp := time.Now().Format("20060102-150405")
	recoveryDir := filepath.Join(svc.dataDir, "_migration-recovery", stamp+"-"+sanitizeMigrationID(migration.ID))
	filesDir := filepath.Join(recoveryDir, "files")
	paths := normalizeRecoveryPaths(migration.Recovery.AffectedPaths)
	copied := []string{}
	for _, rel := range paths {
		matches, err := svc.copyRecoveryPath(rel, filesDir)
		if err != nil {
			return "", err
		}
		copied = append(copied, matches...)
	}
	sort.Strings(copied)
	plan := migrationRecoveryPlan{
		MigrationID:     migration.ID,
		FromVersion:     migration.FromVersion,
		ToVersion:       migration.ToVersion,
		Description:     migration.Description,
		CreatedAt:       nowMs(),
		Strategy:        "change-set",
		AffectedPaths:   paths,
		CopiedPaths:     copied,
		ExecutionLog:    []migrationRecoveryLog{{At: nowMs(), Step: "prepare", Message: fmt.Sprintf("已复制 %d 个受影响路径到恢复包", len(copied))}},
		FailureRecovery: defaultFailureRecoverySteps(recoveryDir),
		Notes:           migration.Recovery.Notes,
	}
	if err := svc.writeRecoveryJSON(filepath.Join(recoveryDir, "plan.json"), plan); err != nil {
		return "", err
	}
	return recoveryDir, nil
}

func normalizeRecoveryPaths(paths []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, raw := range paths {
		value := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
		value = strings.Trim(value, "/")
		if value == "" || value == "." || strings.ContainsRune(value, 0) || strings.HasPrefix(value, "../") || strings.Contains(value, "/../") {
			continue
		}
		if value == "_migration-recovery" || strings.HasPrefix(value, "_migration-recovery/") {
			continue
		}
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}

func (svc *service) copyRecoveryPath(pattern string, filesDir string) ([]string, error) {
	if strings.Contains(pattern, "*") {
		return svc.copyRecoveryGlob(pattern, filesDir)
	}
	path, err := safeJoin(svc.dataDir, filepath.FromSlash(pattern))
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	if err := copyPathToRecovery(svc.dataDir, path, filesDir); err != nil {
		return nil, err
	}
	return []string{filepath.ToSlash(pattern)}, nil
}

func (svc *service) copyRecoveryGlob(pattern string, filesDir string) ([]string, error) {
	fullPattern, err := safeJoin(svc.dataDir, filepath.FromSlash(pattern))
	if err != nil {
		return nil, err
	}
	matches, err := filepath.Glob(fullPattern)
	if err != nil {
		return nil, err
	}
	copied := []string{}
	for _, path := range matches {
		if err := copyPathToRecovery(svc.dataDir, path, filesDir); err != nil {
			return nil, err
		}
		rel, err := filepath.Rel(svc.dataDir, path)
		if err == nil {
			copied = append(copied, filepath.ToSlash(rel))
		}
	}
	return copied, nil
}

func copyPathToRecovery(dataDir string, src string, filesDir string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return filepath.WalkDir(src, func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			return copyPathToRecovery(dataDir, path, filesDir)
		})
	}
	rel, err := filepath.Rel(dataDir, src)
	if err != nil {
		return err
	}
	dst := filepath.Join(filesDir, rel)
	return copyFile(src, dst, info.Mode().Perm())
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

func (svc *service) writeRecoveryJSON(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return atomicWriteFile(path, append(payload, '\n'), 0o644)
}

func defaultFailureRecoverySteps(recoveryDir string) []string {
	return []string{
		"关闭 AI 绘图，确认 ai-draw-backend 进程已经退出。",
		"打开本恢复包目录：" + filepath.ToSlash(recoveryDir),
		"按 files 下保留的相对路径，把文件复制回 AI 绘图数据目录。",
		"恢复后重新启动 AI 绘图；如果仍失败，请保留本恢复包和数据目录用于诊断。",
	}
}

func sanitizeMigrationID(id string) string {
	value := strings.TrimSpace(strings.ToLower(id))
	var out strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			out.WriteRune(r)
		} else {
			out.WriteByte('-')
		}
	}
	text := strings.Trim(out.String(), "-")
	if text == "" {
		return "migration"
	}
	return text
}

func safeJoin(baseDir string, relPath string) (string, error) {
	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}
	fullAbs, err := filepath.Abs(filepath.Join(baseAbs, relPath))
	if err != nil {
		return "", err
	}
	baseClean := filepath.Clean(baseAbs)
	fullClean := filepath.Clean(fullAbs)
	if fullClean != baseClean && !strings.HasPrefix(fullClean, baseClean+string(os.PathSeparator)) {
		return "", errors.New("path traversal detected")
	}
	return fullClean, nil
}

func anySlice(value any) []any {
	items, _ := value.([]any)
	return items
}

func int64Number(value any) int64 {
	switch n := value.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case json.Number:
		v, _ := n.Int64()
		return v
	default:
		return 0
	}
}
