package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const recoveryDirName = "_migration-recovery"

type migrationRecoverySpec struct {
	AffectedPaths []string
	Notes         []string
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
	recoveryDir, err := svc.createMigrationRecoveryDir(migration)
	if err != nil {
		return "", err
	}
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
	now := nowMS()
	plan := migrationRecoveryPlan{
		MigrationID:     migration.ID,
		FromVersion:     migration.FromVersion,
		ToVersion:       migration.ToVersion,
		Description:     migration.Description,
		CreatedAt:       now,
		Strategy:        "copy-before-migrate",
		AffectedPaths:   paths,
		CopiedPaths:     copied,
		ExecutionLog:    []migrationRecoveryLog{{At: now, Step: "prepare", Message: fmt.Sprintf("copied %d affected path(s) into the recovery package", len(copied))}},
		FailureRecovery: defaultMigrationFailureRecoverySteps(recoveryDir),
		Notes:           migration.Recovery.Notes,
	}
	if err := writeJSON(filepath.Join(recoveryDir, "plan.json"), plan); err != nil {
		return "", err
	}
	return recoveryDir, nil
}

func (svc *service) createMigrationRecoveryDir(migration *dataMigration) (string, error) {
	baseDir := filepath.Join(svc.dataDir, recoveryDirName)
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return "", err
	}
	baseName := time.Now().Format("20060102-150405") + "-" + sanitizeMigrationID(migration.ID)
	for i := 0; i < 1000; i++ {
		name := baseName
		if i > 0 {
			name = fmt.Sprintf("%s-%03d", baseName, i)
		}
		dir := filepath.Join(baseDir, name)
		if err := os.Mkdir(dir, 0o755); err == nil {
			return dir, nil
		} else if !errors.Is(err, os.ErrExist) {
			return "", err
		}
	}
	return "", fmt.Errorf("unable to create unique migration recovery package for %s", migration.ID)
}

func normalizeRecoveryPaths(paths []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, raw := range paths {
		value, ok := normalizeRecoveryPath(raw)
		if !ok || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func normalizeRecoveryPath(raw string) (string, bool) {
	value := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	value = strings.Trim(value, "/")
	if value == "" || value == "." || strings.ContainsRune(value, 0) {
		return "", false
	}
	if filepath.IsAbs(filepath.FromSlash(value)) || filepath.VolumeName(filepath.FromSlash(value)) != "" {
		return "", false
	}
	parts := strings.Split(value, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", false
		}
	}
	if value == recoveryDirName || strings.HasPrefix(value, recoveryDirName+"/") {
		return "", false
	}
	return value, true
}

func (svc *service) copyRecoveryPath(pattern string, filesDir string) ([]string, error) {
	if strings.ContainsAny(pattern, "*?[") {
		return svc.copyRecoveryGlob(pattern, filesDir)
	}
	path, err := safeJoinPath(svc.dataDir, filepath.FromSlash(pattern))
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	return copyPathToRecovery(svc.dataDir, path, filesDir)
}

func (svc *service) copyRecoveryGlob(pattern string, filesDir string) ([]string, error) {
	fullPattern, err := safeJoinPath(svc.dataDir, filepath.FromSlash(pattern))
	if err != nil {
		return nil, err
	}
	matches, err := filepath.Glob(fullPattern)
	if err != nil {
		return nil, err
	}
	copied := []string{}
	for _, match := range matches {
		paths, err := copyPathToRecovery(svc.dataDir, match, filesDir)
		if err != nil {
			return nil, err
		}
		copied = append(copied, paths...)
	}
	sort.Strings(copied)
	return copied, nil
}

func copyPathToRecovery(dataDir string, src string, filesDir string) ([]string, error) {
	info, err := os.Lstat(src)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("migration recovery does not copy symlinked path: %s", filepath.ToSlash(src))
	}
	if info.IsDir() {
		copied := []string{}
		err := filepath.WalkDir(src, func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			entryInfo, err := entry.Info()
			if err != nil {
				return err
			}
			if entryInfo.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("migration recovery does not copy symlinked path: %s", filepath.ToSlash(path))
			}
			rel, err := safeRelPath(dataDir, path)
			if err != nil {
				return err
			}
			dst, err := safeJoinPath(filesDir, filepath.FromSlash(rel))
			if err != nil {
				return err
			}
			if entry.IsDir() {
				if err := os.MkdirAll(dst, 0o755); err != nil {
					return err
				}
				copied = append(copied, rel+"/")
				return nil
			}
			if err := copyFileToRecovery(path, dst, entryInfo.Mode().Perm()); err != nil {
				return err
			}
			copied = append(copied, rel)
			return nil
		})
		sort.Strings(copied)
		return copied, err
	}
	rel, err := safeRelPath(dataDir, src)
	if err != nil {
		return nil, err
	}
	dst, err := safeJoinPath(filesDir, filepath.FromSlash(rel))
	if err != nil {
		return nil, err
	}
	if err := copyFileToRecovery(src, dst, info.Mode().Perm()); err != nil {
		return nil, err
	}
	return []string{rel}, nil
}

func copyFileToRecovery(src string, dst string, perm os.FileMode) error {
	payload, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, payload, perm)
}

func defaultMigrationFailureRecoverySteps(recoveryDir string) []string {
	return []string{
		"Close Folders and confirm folders-backend has exited.",
		"Open this recovery package: " + filepath.ToSlash(recoveryDir),
		"Copy files from the files directory back to the same relative paths in the Folders data directory.",
		"Start Folders again; if it still fails, keep the recovery package and data directory for diagnosis.",
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

func safeJoinPath(baseDir string, relPath string) (string, error) {
	if filepath.IsAbs(relPath) || filepath.VolumeName(relPath) != "" {
		return "", errors.New("absolute migration recovery path is not allowed")
	}
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
		return "", errors.New("migration recovery path traversal detected")
	}
	return fullClean, nil
}

func safeRelPath(baseDir string, targetPath string) (string, error) {
	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}
	targetAbs, err := filepath.Abs(targetPath)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(baseAbs, targetAbs)
	if err != nil {
		return "", err
	}
	relSlash := filepath.ToSlash(rel)
	if relSlash == "." || strings.HasPrefix(relSlash, "../") || relSlash == ".." || filepath.IsAbs(rel) || filepath.VolumeName(rel) != "" {
		return "", errors.New("migration recovery path traversal detected")
	}
	return relSlash, nil
}
