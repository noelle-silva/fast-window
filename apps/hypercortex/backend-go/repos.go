package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	reposDirName = "repos"
	// repoIdentityFile 是仓库身份文件：记录仓库标识、名称与创建时间。
	repoIdentityFile = "hypercortex-repo.json"
	// repoTrashDirName 是全局仓库回收站：被删除的仓库整包存放于此，与知识库内部的回收站互不相干。
	repoTrashDirName = "repo-trash"
	// repoTrashMetaFile 记录仓库的删除时间，随仓库一起被移出/移回。
	repoTrashMetaFile = "repo-trash-meta.json"
)

// repoIdentity 是仓库的身份数据，与仓库工作状态（hypercortex-repo-state.json）分离。
type repoIdentity struct {
	Version     int     `json:"version"`
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	CreatedAtMs float64 `json:"createdAtMs"`
}

// deletedRepo 是仓库回收站中的条目：仓库身份 + 删除时间。
type deletedRepo struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	CreatedAtMs float64 `json:"createdAtMs"`
	DeletedAtMs float64 `json:"deletedAtMs"`
}

type repoTrashMeta struct {
	Version     int     `json:"version"`
	DeletedAtMs float64 `json:"deletedAtMs"`
}

// repoRoot 把仓库标识解析为仓库根目录；标识格式非法或仓库不存在时快速失败。
func (svc *service) repoRoot(repoID string) (string, error) {
	id := strings.TrimSpace(repoID)
	if !isRepoID(id) {
		return "", fmt.Errorf("非法仓库标识：%s", id)
	}
	root := filepath.Join(svc.reposDir, id)
	if !exists(filepath.Join(root, repoIdentityFile)) {
		return "", fmt.Errorf("仓库不存在：%s", id)
	}
	return root, nil
}

// isRepoID 判断是否为合法仓库标识：32 位小写十六进制字符串。
func isRepoID(value string) bool {
	if len(value) != 32 {
		return false
	}
	for _, char := range value {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') {
			continue
		}
		return false
	}
	return true
}

func newRepoID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("生成仓库标识失败：%w", err)
	}
	return hex.EncodeToString(buf), nil
}

func (svc *service) readRepoIdentity(root string) (repoIdentity, error) {
	var identity repoIdentity
	if err := readJSONFile(filepath.Join(root, repoIdentityFile), &identity); err != nil {
		return repoIdentity{}, err
	}
	identity.ID = strings.TrimSpace(identity.ID)
	if !isRepoID(identity.ID) {
		return repoIdentity{}, errors.New("仓库身份文件缺少有效标识")
	}
	identity.Title = normalizeRepoTitle(identity.Title)
	return identity, nil
}

func (svc *service) writeRepoIdentity(root string, identity repoIdentity) error {
	identity.Version = 1
	identity.ID = strings.TrimSpace(identity.ID)
	identity.Title = normalizeRepoTitle(identity.Title)
	return writeJSONFile(filepath.Join(root, repoIdentityFile), identity)
}

func normalizeRepoTitle(value string) string {
	title := strings.TrimSpace(value)
	if title == "" {
		return "未命名仓库"
	}
	return title
}

// listRepos 扫描仓库池：只返回身份文件完整有效的仓库，按创建时间稳定排序。
func (svc *service) listRepos() ([]repoIdentity, error) {
	entries, err := os.ReadDir(svc.reposDir)
	if errors.Is(err, os.ErrNotExist) {
		return []repoIdentity{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []repoIdentity{}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		identity, err := svc.readRepoIdentity(filepath.Join(svc.reposDir, entry.Name()))
		if err != nil || identity.ID != entry.Name() {
			continue
		}
		out = append(out, identity)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAtMs != out[j].CreatedAtMs {
			return out[i].CreatedAtMs < out[j].CreatedAtMs
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// createRepo 创建仓库：先在池内临时目录完成身份与骨架，再原子改名发布，避免留下半成品。
func (svc *service) createRepo(title string) (repoIdentity, error) {
	id, err := newRepoID()
	if err != nil {
		return repoIdentity{}, err
	}
	identity := repoIdentity{Version: 1, ID: id, Title: normalizeRepoTitle(title), CreatedAtMs: nowMs()}
	if err := svc.buildRepo(identity, nil); err != nil {
		return repoIdentity{}, err
	}
	return identity, nil
}

// buildRepo 在仓库池内以临时目录构建仓库；build 完成后原子发布为正式仓库目录。
func (svc *service) buildRepo(identity repoIdentity, build func(root string) error) error {
	if err := os.MkdirAll(svc.reposDir, 0o755); err != nil {
		return err
	}
	target := filepath.Join(svc.reposDir, identity.ID)
	if exists(target) {
		return fmt.Errorf("仓库目录已存在：%s", identity.ID)
	}
	tmp := filepath.Join(svc.reposDir, ".creating-"+identity.ID)
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	if err := svc.writeRepoIdentity(tmp, identity); err != nil {
		return err
	}
	if err := ensureRepoLayout(tmp); err != nil {
		return err
	}
	if build != nil {
		if err := build(tmp); err != nil {
			return err
		}
	}
	return os.Rename(tmp, target)
}

// ensureRepoLayout 保证仓库目录骨架完整（幂等）。
func ensureRepoLayout(root string) error {
	dirs := []string{
		notesDir,
		assetsDir,
		filepath.Join(assetsDir, "images"),
		filepath.Join(assetsDir, "videos"),
		filepath.Join(assetsDir, "docs"),
		trashDir,
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			return err
		}
	}
	return nil
}

// ensureRepoPool 保证仓库池存在且至少有一个可用仓库。
func (svc *service) ensureRepoPool() error {
	if err := os.MkdirAll(svc.reposDir, 0o755); err != nil {
		return err
	}
	repos, err := svc.listRepos()
	if err != nil {
		return err
	}
	if len(repos) > 0 {
		return nil
	}
	_, err = svc.createRepo("默认仓库")
	return err
}

// activateRepo 让指定仓库进入可用状态：骨架完整、身份可读、派生索引与插件声明一致。
func (svc *service) activateRepo(repoID string) (repoIdentity, error) {
	root, err := svc.repoRoot(repoID)
	if err != nil {
		return repoIdentity{}, err
	}
	if err := ensureRepoLayout(root); err != nil {
		return repoIdentity{}, err
	}
	identity, err := svc.readRepoIdentity(root)
	if err != nil {
		return repoIdentity{}, err
	}
	if err := svc.ensureRepoPluginState(identity.ID); err != nil {
		return repoIdentity{}, err
	}
	return identity, nil
}

// renameRepo 只更新仓库身份中的名称；标识与文件夹保持不变。
func (svc *service) renameRepo(repoID string, title string) (repoIdentity, error) {
	root, err := svc.repoRoot(repoID)
	if err != nil {
		return repoIdentity{}, err
	}
	if strings.TrimSpace(title) == "" {
		return repoIdentity{}, errors.New("仓库名称不能为空")
	}
	identity, err := svc.readRepoIdentity(root)
	if err != nil {
		return repoIdentity{}, err
	}
	identity.Title = normalizeRepoTitle(title)
	if err := svc.writeRepoIdentity(root, identity); err != nil {
		return repoIdentity{}, err
	}
	return identity, nil
}

// deleteRepo 把仓库整包移入全局仓库回收站；池中至少保留一个仓库。
func (svc *service) deleteRepo(repoID string) error {
	root, err := svc.repoRoot(repoID)
	if err != nil {
		return err
	}
	repos, err := svc.listRepos()
	if err != nil {
		return err
	}
	if len(repos) <= 1 {
		return errors.New("至少保留一个仓库，无法删除")
	}
	if err := os.MkdirAll(svc.repoTrashDir, 0o755); err != nil {
		return err
	}
	target := filepath.Join(svc.repoTrashDir, repoID)
	if exists(target) {
		return fmt.Errorf("仓库回收站已存在同标识条目：%s", repoID)
	}
	if err := os.Rename(root, target); err != nil {
		return fmt.Errorf("移入仓库回收站失败：%w", err)
	}
	meta := repoTrashMeta{Version: 1, DeletedAtMs: nowMs()}
	if err := writeJSONFile(filepath.Join(target, repoTrashMetaFile), meta); err != nil {
		_ = os.Rename(target, root)
		return err
	}
	return nil
}

// listDeletedRepos 列出仓库回收站中可恢复的仓库，按删除时间倒序。
func (svc *service) listDeletedRepos() ([]deletedRepo, error) {
	entries, err := os.ReadDir(svc.repoTrashDir)
	if errors.Is(err, os.ErrNotExist) {
		return []deletedRepo{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []deletedRepo{}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		root := filepath.Join(svc.repoTrashDir, entry.Name())
		identity, err := svc.readRepoIdentity(root)
		if err != nil || identity.ID != entry.Name() {
			continue
		}
		var meta repoTrashMeta
		_ = readJSONFile(filepath.Join(root, repoTrashMetaFile), &meta)
		deletedAt := meta.DeletedAtMs
		if deletedAt <= 0 {
			if info, err := entry.Info(); err == nil {
				deletedAt = float64(info.ModTime().UnixMilli())
			}
		}
		out = append(out, deletedRepo{ID: identity.ID, Title: identity.Title, CreatedAtMs: identity.CreatedAtMs, DeletedAtMs: deletedAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DeletedAtMs > out[j].DeletedAtMs })
	return out, nil
}

// restoreRepo 把仓库从全局回收站移回仓库池。
func (svc *service) restoreRepo(repoID string) (repoIdentity, error) {
	id := strings.TrimSpace(repoID)
	if !isRepoID(id) {
		return repoIdentity{}, fmt.Errorf("非法仓库标识：%s", id)
	}
	from := filepath.Join(svc.repoTrashDir, id)
	identity, err := svc.readRepoIdentity(from)
	if err != nil || identity.ID != id {
		return repoIdentity{}, fmt.Errorf("仓库回收站中不存在该仓库：%s", id)
	}
	target := filepath.Join(svc.reposDir, id)
	if exists(target) {
		return repoIdentity{}, fmt.Errorf("仓库池已存在同标识仓库：%s", id)
	}
	if err := os.MkdirAll(svc.reposDir, 0o755); err != nil {
		return repoIdentity{}, err
	}
	if err := os.Rename(from, target); err != nil {
		return repoIdentity{}, fmt.Errorf("恢复仓库失败：%w", err)
	}
	_ = os.Remove(filepath.Join(target, repoTrashMetaFile))
	return identity, nil
}

// purgeDeletedRepo 从仓库回收站真实删除仓库（不可恢复）；仅允许对回收站中的条目执行。
func (svc *service) purgeDeletedRepo(repoID string) error {
	id := strings.TrimSpace(repoID)
	if !isRepoID(id) {
		return fmt.Errorf("非法仓库标识：%s", id)
	}
	if exists(filepath.Join(svc.reposDir, id)) {
		return errors.New("仓库仍在仓库池中，无法永久删除")
	}
	root := filepath.Join(svc.repoTrashDir, id)
	identity, err := svc.readRepoIdentity(root)
	if err != nil || identity.ID != id {
		return fmt.Errorf("仓库回收站中不存在该仓库：%s", id)
	}
	if err := os.RemoveAll(root); err != nil {
		return fmt.Errorf("永久删除仓库失败：%w", err)
	}
	return nil
}
