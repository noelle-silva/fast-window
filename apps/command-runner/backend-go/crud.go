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
	reordered, err := reorderByID(doc.Repos, orderedIDs, func(item repo) string { return item.ID }, func(repo) bool { return true })
	if err != nil {
		return err
	}
	doc.Repos = reordered
	return svc.writeRepos(doc)
}

// reorderByID 在 inScope 命中的条目中按 orderedIDs 重排，并把它们放回各自原本占据的位置；
// scope 外的条目保持原位不动。orderedIDs 必须恰好覆盖 scope 内全部条目（不多、不少、不重复）。
func reorderByID[T any](items []T, orderedIDs []string, idOf func(T) string, inScope func(T) bool) ([]T, error) {
	scoped := make([]T, 0, len(items))
	for _, item := range items {
		if inScope(item) {
			scoped = append(scoped, item)
		}
	}
	if len(orderedIDs) != len(scoped) {
		return nil, fmt.Errorf("排序 ID 数量（%d）与现有条目数量（%d）不一致", len(orderedIDs), len(scoped))
	}
	existing := make(map[string]T, len(scoped))
	for _, item := range scoped {
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
	result := make([]T, len(items))
	cursor := 0
	for index, item := range items {
		if !inScope(item) {
			result[index] = item
			continue
		}
		result[index] = reordered[cursor]
		cursor++
	}
	return result, nil
}

func (svc *service) createRepo(draft repoDraft) (repo, error) {
	name := strings.TrimSpace(draft.Name)
	path := strings.TrimSpace(draft.Path)
	if name == "" {
		return repo{}, fmt.Errorf("仓库名称不能为空")
	}
	if path == "" {
		return repo{}, fmt.Errorf("仓库路径不能为空")
	}
	if draft.CloseMode != "" && !validCloseMode(draft.CloseMode) {
		return repo{}, fmt.Errorf("未知关闭策略: %s", draft.CloseMode)
	}
	if draft.CountdownSeconds != 0 &&
		(draft.CountdownSeconds < minCountdownSeconds || draft.CountdownSeconds > maxCountdownSeconds) {
		return repo{}, fmt.Errorf("倒计时秒数必须在 %d-%d 之间", minCountdownSeconds, maxCountdownSeconds)
	}
	if draft.RunMode != "" && !validRunMode(draft.RunMode) {
		return repo{}, fmt.Errorf("未知运行模式: %s", draft.RunMode)
	}
	if !validProcessOwnership(draft.ProcessOwnership) {
		return repo{}, fmt.Errorf("未知进程归属: %s", draft.ProcessOwnership)
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return repo{}, fmt.Errorf("仓库目录不存在: %s", path)
	}
	placeholders, err := normalizePlaceholders(draft.Placeholders)
	if err != nil {
		return repo{}, err
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
		ID:               newID("repo"),
		Name:             name,
		Path:             path,
		ShellID:          "",
		CloseMode:        draft.CloseMode,
		CountdownSeconds: draft.CountdownSeconds,
		RunMode:          draft.RunMode,
		ProcessOwnership: draft.ProcessOwnership,
		Placeholders:     placeholders,
		CreatedAt:        nowText(),
	}
	doc.Repos = append(doc.Repos, item)
	if err := svc.writeRepos(doc); err != nil {
		return repo{}, err
	}
	if err := svc.ensureRepoRoot(item.ID); err != nil {
		return repo{}, err
	}
	return item, nil
}

func (svc *service) updateRepo(id string, draft repoDraft) (repo, error) {
	name := strings.TrimSpace(draft.Name)
	path := strings.TrimSpace(draft.Path)
	if name == "" {
		return repo{}, fmt.Errorf("仓库名称不能为空")
	}
	if path == "" {
		return repo{}, fmt.Errorf("仓库路径不能为空")
	}
	if draft.CloseMode != "" && !validCloseMode(draft.CloseMode) {
		return repo{}, fmt.Errorf("未知关闭策略: %s", draft.CloseMode)
	}
	if draft.CountdownSeconds != 0 &&
		(draft.CountdownSeconds < minCountdownSeconds || draft.CountdownSeconds > maxCountdownSeconds) {
		return repo{}, fmt.Errorf("倒计时秒数必须在 %d-%d 之间", minCountdownSeconds, maxCountdownSeconds)
	}
	if draft.RunMode != "" && !validRunMode(draft.RunMode) {
		return repo{}, fmt.Errorf("未知运行模式: %s", draft.RunMode)
	}
	if !validProcessOwnership(draft.ProcessOwnership) {
		return repo{}, fmt.Errorf("未知进程归属: %s", draft.ProcessOwnership)
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return repo{}, fmt.Errorf("仓库目录不存在: %s", path)
	}
	placeholders, err := normalizePlaceholders(draft.Placeholders)
	if err != nil {
		return repo{}, err
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
		occupied, err := svc.repoLevelPlaceholderOccupancy(id)
		if err != nil {
			return repo{}, err
		}
		if err := ensurePlaceholderNamesFree(placeholders, occupied); err != nil {
			return repo{}, err
		}
		doc.Repos[index].Name = name
		doc.Repos[index].Path = path
		doc.Repos[index].CloseMode = draft.CloseMode
		doc.Repos[index].CountdownSeconds = draft.CountdownSeconds
		doc.Repos[index].RunMode = draft.RunMode
		doc.Repos[index].ProcessOwnership = draft.ProcessOwnership
		doc.Repos[index].Placeholders = placeholders
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
	removedCommandIDs := make([]string, 0)
	for _, item := range commandsDoc.Commands {
		if item.RepoID == id {
			removedCommandIDs = append(removedCommandIDs, item.ID)
			continue
		}
		keptCommands = append(keptCommands, item)
	}
	commandsDoc.Commands = keptCommands
	if err := svc.writeCommands(commandsDoc); err != nil {
		return err
	}
	if err := svc.dropRepoCollections(id); err != nil {
		return err
	}
	return svc.detachCommandsFromQuickRuns(removedCommandIDs)
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

func (svc *service) createCommand(draft commandDraft) (command, error) {
	if err := draft.validate(); err != nil {
		return command{}, err
	}
	placeholders, err := normalizePlaceholders(draft.Placeholders)
	if err != nil {
		return command{}, err
	}
	reposDoc, err := svc.loadRepos()
	if err != nil {
		return command{}, err
	}
	var target repo
	found := false
	for _, item := range reposDoc.Repos {
		if item.ID == draft.RepoID {
			target = item
			found = true
			break
		}
	}
	if !found {
		return command{}, fmt.Errorf("仓库不存在: %s", draft.RepoID)
	}
	occupied, err := svc.commandPlaceholderOccupancy(target, "")
	if err != nil {
		return command{}, err
	}
	if err := ensurePlaceholderNamesFree(placeholders, occupied); err != nil {
		return command{}, err
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
		NotifyOnComplete: draft.NotifyOnComplete,
		ShellID:          draft.ShellID,
		CloseMode:        draft.CloseMode,
		CountdownSeconds: draft.CountdownSeconds,
		RunMode:          draft.RunMode,
		ProcessOwnership: draft.ProcessOwnership,
		MaxEmbeddedRuns:  draft.MaxEmbeddedRuns,
		Placeholders:     placeholders,
		CreatedAt:        nowText(),
		UpdatedAt:        nowText(),
	}
	doc.Commands = append(doc.Commands, item)
	if err := svc.writeCommands(doc); err != nil {
		return command{}, err
	}
	if err := svc.appendCommandToRoot(draft.RepoID, item.ID); err != nil {
		return command{}, err
	}
	return item, nil
}

func (svc *service) updateCommand(id string, draft commandDraft) (command, error) {
	if err := draft.validate(); err != nil {
		return command{}, err
	}
	placeholders, err := normalizePlaceholders(draft.Placeholders)
	if err != nil {
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
		target, err := svc.findRepo(existing.RepoID)
		if err != nil {
			return command{}, err
		}
		occupied, err := svc.commandPlaceholderOccupancy(target, id)
		if err != nil {
			return command{}, err
		}
		if err := ensurePlaceholderNamesFree(placeholders, occupied); err != nil {
			return command{}, err
		}
		doc.Commands[index].Name = strings.TrimSpace(draft.Name)
		doc.Commands[index].Script = draft.Script
		doc.Commands[index].Note = strings.TrimSpace(draft.Note)
		doc.Commands[index].ConfirmBeforeRun = draft.ConfirmBeforeRun
		doc.Commands[index].NotifyOnComplete = draft.NotifyOnComplete
		doc.Commands[index].ShellID = draft.ShellID
		doc.Commands[index].CloseMode = draft.CloseMode
		doc.Commands[index].CountdownSeconds = draft.CountdownSeconds
		doc.Commands[index].RunMode = draft.RunMode
		doc.Commands[index].ProcessOwnership = draft.ProcessOwnership
		doc.Commands[index].MaxEmbeddedRuns = draft.MaxEmbeddedRuns
		doc.Commands[index].Placeholders = placeholders
		doc.Commands[index].UpdatedAt = nowText()
		if err := svc.writeCommands(doc); err != nil {
			return command{}, err
		}
		return doc.Commands[index], nil
	}
	return command{}, fmt.Errorf("未找到命令: %s", id)
}

// findRepo 按 id 查找仓库实体，供命令的占位符作用域校验等场景使用。
func (svc *service) findRepo(id string) (repo, error) {
	doc, err := svc.loadRepos()
	if err != nil {
		return repo{}, err
	}
	for _, item := range doc.Repos {
		if item.ID == id {
			return item, nil
		}
	}
	return repo{}, fmt.Errorf("未找到仓库: %s", id)
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
	if err := svc.writeCommands(doc); err != nil {
		return err
	}
	if err := svc.detachCommand(id); err != nil {
		return err
	}
	return svc.detachCommandsFromQuickRuns([]string{id})
}
