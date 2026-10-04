package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const repoPoolLayoutMigration = "2026-09-26-repo-pool-layout"

// migrateRepoPoolLayout 把历史唯一知识库下沉为仓库池中的默认仓库：
// 先为历史库写入仓库身份（可重试的确认步骤），再把整个目录原子改名进仓库池。
func (svc *service) migrateRepoPoolLayout() error {
	info, err := os.Stat(svc.legacyLibraryDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("历史知识库路径不是目录")
	}
	if err := os.MkdirAll(svc.reposDir, 0o755); err != nil {
		return err
	}
	identity, err := svc.ensureLegacyLibraryIdentity()
	if err != nil {
		return err
	}
	target := filepath.Join(svc.reposDir, identity.ID)
	if exists(target) {
		return fmt.Errorf("仓库池已存在同名仓库目录：%s", identity.ID)
	}
	if err := os.Rename(svc.legacyLibraryDir, target); err != nil {
		return fmt.Errorf("知识库下沉仓库池失败：%w", err)
	}
	return ensureRepoLayout(target)
}

// ensureLegacyLibraryIdentity 为历史知识库生成或复用仓库身份，保证迁移可重试。
func (svc *service) ensureLegacyLibraryIdentity() (repoIdentity, error) {
	if identity, err := svc.readRepoIdentity(svc.legacyLibraryDir); err == nil {
		return identity, nil
	}
	id, err := newRepoID()
	if err != nil {
		return repoIdentity{}, err
	}
	identity := repoIdentity{Version: 1, ID: id, Title: "默认仓库", CreatedAtMs: nowMs()}
	if err := svc.writeRepoIdentity(svc.legacyLibraryDir, identity); err != nil {
		return repoIdentity{}, fmt.Errorf("写入仓库身份失败：%w", err)
	}
	return identity, nil
}
