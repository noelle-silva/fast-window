package main

import (
	"fmt"
	"os"
	"strings"
)

func (svc *service) listRepos() (reposDoc, error) {
	return svc.loadRepos()
}

func (svc *service) reorderRepos(orderedIDs []string) error {
	doc, err := svc.loadRepos()
	if err != nil {
		return err
	}
	reordered, err := reorderByID(doc.Repos, orderedIDs, func(item repo) string { return item.ID })
	if err != nil {
		return err
	}
	doc.Repos = reordered
	return svc.writeRepos(doc)
}

// reorderByID 按传入的 ID 顺序重排条目；ID 集合必须与现有条目完全一致（不多、不少、不重复）。
func reorderByID[T any](items []T, orderedIDs []string, idOf func(T) string) ([]T, error) {
	if len(orderedIDs) != len(items) {
		return nil, fmt.Errorf("排序 ID 数量（%d）与现有条目数量（%d）不一致", len(orderedIDs), len(items))
	}
	existing := make(map[string]T, len(items))
	for _, item := range items {
		existing[idOf(item)] = item
	}
	seen := make(map[string]bool, len(orderedIDs))
	reordered := make([]T, 0, len(orderedIDs))
	for _, id := range orderedIDs {
		if seen[id] {
			return nil, fmt.Errorf("排序 ID 重复: %s", id)
		}
		item, ok := existing[id]
		if !ok {
			return nil, fmt.Errorf("未知条目: %s", id)
		}
		seen[id] = true
		reordered = append(reordered, item)
	}
	return reordered, nil
}

func (svc *service) createRepo(name, path string) (repo, error) {
	name = strings.TrimSpace(name)
	path = strings.TrimSpace(path)
	if name == "" {
		return repo{}, fmt.Errorf("仓库名称不能为空")
	}
	if path == "" {
		return repo{}, fmt.Errorf("仓库路径不能为空")
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return repo{}, fmt.Errorf("仓库目录不存在: %s", path)
	}

	doc, err := svc.loadRepos()
	if err != nil {
		return repo{}, err
	}
	for _, existing := range doc.Repos {
		if strings.EqualFold(existing.Path, path) {
			return repo{}, fmt.Errorf("该仓库已注册: %s", existing.Name)
		}
	}
	item := repo{
		ID:        newID("repo"),
		Name:      name,
		Path:      path,
		ShellID:   "",
		CreatedAt: nowText(),
	}
	doc.Repos = append(doc.Repos, item)
	if err := svc.writeRepos(doc); err != nil {
		return repo{}, err
	}
	return item, nil
}

func (svc *service) updateRepo(id, name, path string) (repo, error) {
	name = strings.TrimSpace(name)
	path = strings.TrimSpace(path)
	if name == "" {
		return repo{}, fmt.Errorf("仓库名称不能为空")
	}
	if path == "" {
		return repo{}, fmt.Errorf("仓库路径不能为空")
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return repo{}, fmt.Errorf("仓库目录不存在: %s", path)
	}

	doc, err := svc.loadRepos()
	if err != nil {
		return repo{}, err
	}
	for index, existing := range doc.Repos {
		if existing.ID != id {
			continue
		}
		for _, other := range doc.Repos {
			if other.ID != id && strings.EqualFold(other.Path, path) {
				return repo{}, fmt.Errorf("该仓库已注册: %s", other.Name)
			}
		}
		doc.Repos[index].Name = name
		doc.Repos[index].Path = path
		if err := svc.writeRepos(doc); err != nil {
			return repo{}, err
		}
		return doc.Repos[index], nil
	}
	return repo{}, fmt.Errorf("未找到仓库: %s", id)
}

func (svc *service) deleteRepo(id string) error {
	doc, err := svc.loadRepos()
	if err != nil {
		return err
	}
	kept := make([]repo, 0, len(doc.Repos))
	removed := false
	for _, item := range doc.Repos {
		if item.ID == id {
			removed = true
			continue
		}
		kept = append(kept, item)
	}
	if !removed {
		return fmt.Errorf("未找到仓库: %s", id)
	}
	doc.Repos = kept
	if err := svc.writeRepos(doc); err != nil {
		return err
	}

	commandsDoc, err := svc.loadCommands()
	if err != nil {
		return err
	}
	keptCommands := make([]command, 0, len(commandsDoc.Commands))
	for _, item := range commandsDoc.Commands {
		if item.RepoID == id {
			continue
		}
		keptCommands = append(keptCommands, item)
	}
	commandsDoc.Commands = keptCommands
	return svc.writeCommands(commandsDoc)
}

func (svc *service) listCommands(repoID string) (map[string]any, error) {
	doc, err := svc.loadCommands()
	if err != nil {
		return nil, err
	}
	commands := make([]command, 0, len(doc.Commands))
	for _, item := range doc.Commands {
		if repoID != "" && item.RepoID != repoID {
			continue
		}
		commands = append(commands, item)
	}
	return map[string]any{"commands": commands}, nil
}

func (svc *service) reorderCommands(orderedIDs []string) error {
	doc, err := svc.loadCommands()
	if err != nil {
		return err
	}
	reordered, err := reorderByID(doc.Commands, orderedIDs, func(item command) string { return item.ID })
	if err != nil {
		return err
	}
	doc.Commands = reordered
	return svc.writeCommands(doc)
}

func (svc *service) createCommand(draft commandDraft) (command, error) {
	if err := draft.validate(); err != nil {
		return command{}, err
	}
	reposDoc, err := svc.loadRepos()
	if err != nil {
		return command{}, err
	}
	exists := false
	for _, item := range reposDoc.Repos {
		if item.ID == draft.RepoID {
			exists = true
			break
		}
	}
	if !exists {
		return command{}, fmt.Errorf("仓库不存在: %s", draft.RepoID)
	}

	doc, err := svc.loadCommands()
	if err != nil {
		return command{}, err
	}
	item := command{
		ID:               newID("cmd"),
		RepoID:           draft.RepoID,
		Name:             strings.TrimSpace(draft.Name),
		Script:           draft.Script,
		Note:             strings.TrimSpace(draft.Note),
		ConfirmBeforeRun: draft.ConfirmBeforeRun,
		ShellID:          draft.ShellID,
		CloseMode:        draft.CloseMode,
		CountdownSeconds: draft.CountdownSeconds,
		CreatedAt:        nowText(),
		UpdatedAt:        nowText(),
	}
	doc.Commands = append(doc.Commands, item)
	if err := svc.writeCommands(doc); err != nil {
		return command{}, err
	}
	return item, nil
}

func (svc *service) updateCommand(id string, draft commandDraft) (command, error) {
	if err := draft.validate(); err != nil {
		return command{}, err
	}
	doc, err := svc.loadCommands()
	if err != nil {
		return command{}, err
	}
	for index, existing := range doc.Commands {
		if existing.ID != id {
			continue
		}
		if existing.RepoID != draft.RepoID {
			return command{}, fmt.Errorf("命令不能更换所属仓库")
		}
		doc.Commands[index].Name = strings.TrimSpace(draft.Name)
		doc.Commands[index].Script = draft.Script
		doc.Commands[index].Note = strings.TrimSpace(draft.Note)
		doc.Commands[index].ConfirmBeforeRun = draft.ConfirmBeforeRun
		doc.Commands[index].ShellID = draft.ShellID
		doc.Commands[index].CloseMode = draft.CloseMode
		doc.Commands[index].CountdownSeconds = draft.CountdownSeconds
		doc.Commands[index].UpdatedAt = nowText()
		if err := svc.writeCommands(doc); err != nil {
			return command{}, err
		}
		return doc.Commands[index], nil
	}
	return command{}, fmt.Errorf("未找到命令: %s", id)
}

func (svc *service) deleteCommand(id string) error {
	doc, err := svc.loadCommands()
	if err != nil {
		return err
	}
	kept := make([]command, 0, len(doc.Commands))
	removed := false
	for _, item := range doc.Commands {
		if item.ID == id {
			removed = true
			continue
		}
		kept = append(kept, item)
	}
	if !removed {
		return fmt.Errorf("未找到命令: %s", id)
	}
	doc.Commands = kept
	return svc.writeCommands(doc)
}
