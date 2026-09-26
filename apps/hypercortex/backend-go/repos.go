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
)

// repoIdentity 是仓库的身份数据，与仓库工作状态（hypercortex-repo-state.json）分离。
type repoIdentity struct {
	Version     int     `json:"version"`
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	CreatedAtMs float64 `json:"createdAtMs"`
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
