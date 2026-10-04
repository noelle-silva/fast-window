package main

import (
	"errors"
	"os"
	"strings"
)

// faceFileWrite 描述一次面内容文件的写入意图。
type faceFileWrite struct {
	RelPath string
	Content string
}

// faceFileBackup 记录面文件在事务开始前的原状，用于失败回滚。
type faceFileBackup struct {
	relPath  string
	existed  bool
	original []byte
}

// faceFileTransaction 面内容文件写入事务：写入/删除前记录原状，
// 任一环节失败可整体回滚，避免磁盘上出现「部分面已更新」的中间状态。
type faceFileTransaction struct {
	svc     *service
	scope   string
	backups []faceFileBackup
}

// writeFaceFiles 开启事务并依次写入面内容文件；中途失败时自动回滚已写文件。
func (svc *service) writeFaceFiles(scope string, writes []faceFileWrite) (*faceFileTransaction, error) {
	tx := &faceFileTransaction{svc: svc, scope: scope}
	for _, write := range writes {
		target, err := svc.resolvePath(scope, write.RelPath)
		if err != nil {
			tx.rollback()
			return nil, err
		}
		if err := tx.backup(write.RelPath, target); err != nil {
			tx.rollback()
			return nil, err
		}
		if err := writeFileAtomic(target, []byte(write.Content)); err != nil {
			tx.rollback()
			return nil, err
		}
	}
	return tx, nil
}

// remove 在事务内删除面文件；失败可随事务整体回滚。
func (tx *faceFileTransaction) remove(relPath string) error {
	if strings.TrimSpace(relPath) == "" {
		return nil
	}
	target, err := tx.svc.resolvePath(tx.scope, relPath)
	if err != nil {
		return err
	}
	if err := tx.backup(relPath, target); err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (tx *faceFileTransaction) backup(relPath string, target string) error {
	original, err := os.ReadFile(target)
	switch {
	case err == nil:
		tx.backups = append(tx.backups, faceFileBackup{relPath: relPath, existed: true, original: original})
		return nil
	case errors.Is(err, os.ErrNotExist):
		tx.backups = append(tx.backups, faceFileBackup{relPath: relPath, existed: false})
		return nil
	default:
		return err
	}
}

// rollback 把所有已写/已删文件恢复到事务开始前的状态。
func (tx *faceFileTransaction) rollback() {
	for _, item := range tx.backups {
		target, err := tx.svc.resolvePath(tx.scope, item.relPath)
		if err != nil {
			continue
		}
		if item.existed {
			_ = writeFileAtomic(target, item.original)
			continue
		}
		_ = os.Remove(target)
	}
}
