package main

import (
	"fmt"
	"strings"
)

func (svc *service) listQuickRuns() (map[string]any, error) {
	doc, err := svc.loadQuickRuns()
	if err != nil {
		return nil, err
	}
	return map[string]any{"quickRuns": doc.QuickRuns}, nil
}

// normalizeQuickRunCommandIDs 校验命令引用：非空、无重复、全部命令存在，返回规范化后的有序引用。
func (svc *service) normalizeQuickRunCommandIDs(commandIDs []string) ([]string, error) {
	if len(commandIDs) == 0 {
		return nil, fmt.Errorf("请至少选择一条命令")
	}
	commandsDoc, err := svc.loadCommands()
	if err != nil {
		return nil, err
	}
	known := make(map[string]bool, len(commandsDoc.Commands))
	for _, item := range commandsDoc.Commands {
		known[item.ID] = true
	}
	result := make([]string, 0, len(commandIDs))
	seen := make(map[string]bool, len(commandIDs))
	for _, id := range commandIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			return nil, fmt.Errorf("命令引用不能为空")
		}
		if seen[id] {
			return nil, fmt.Errorf("同一条命令不能重复选择: %s", id)
		}
		if !known[id] {
			return nil, fmt.Errorf("命令不存在: %s", id)
		}
		seen[id] = true
		result = append(result, id)
	}
	return result, nil
}

func (svc *service) createQuickRun(name string, commandIDs []string) (quickRun, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return quickRun{}, fmt.Errorf("快捷运行名称不能为空")
	}
	ids, err := svc.normalizeQuickRunCommandIDs(commandIDs)
	if err != nil {
		return quickRun{}, err
	}
	doc, err := svc.loadQuickRuns()
	if err != nil {
		return quickRun{}, err
	}
	item := quickRun{
		ID:         newID("quickrun"),
		Name:       name,
		CommandIDs: ids,
		CreatedAt:  nowText(),
		UpdatedAt:  nowText(),
	}
	doc.QuickRuns = append(doc.QuickRuns, item)
	if err := svc.writeQuickRuns(doc); err != nil {
		return quickRun{}, err
	}
	return item, nil
}

func (svc *service) updateQuickRun(id, name string, commandIDs []string) (quickRun, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return quickRun{}, fmt.Errorf("快捷运行名称不能为空")
	}
	ids, err := svc.normalizeQuickRunCommandIDs(commandIDs)
	if err != nil {
		return quickRun{}, err
	}
	doc, err := svc.loadQuickRuns()
	if err != nil {
		return quickRun{}, err
	}
	for index := range doc.QuickRuns {
		if doc.QuickRuns[index].ID != id {
			continue
		}
		doc.QuickRuns[index].Name = name
		doc.QuickRuns[index].CommandIDs = ids
		doc.QuickRuns[index].UpdatedAt = nowText()
		if err := svc.writeQuickRuns(doc); err != nil {
			return quickRun{}, err
		}
		return doc.QuickRuns[index], nil
	}
	return quickRun{}, fmt.Errorf("未找到快捷运行: %s", id)
}

func (svc *service) deleteQuickRun(id string) error {
	doc, err := svc.loadQuickRuns()
	if err != nil {
		return err
	}
	kept := make([]quickRun, 0, len(doc.QuickRuns))
	removed := false
	for _, item := range doc.QuickRuns {
		if item.ID == id {
			removed = true
			continue
		}
		kept = append(kept, item)
	}
	if !removed {
		return fmt.Errorf("未找到快捷运行: %s", id)
	}
	doc.QuickRuns = kept
	return svc.writeQuickRuns(doc)
}

// runQuickRun 按引用顺序启动条目内的全部命令，单条失败不中断其余命令。
// 每条命令的启动完全复用既有单命令运行分流（外部窗口 / 内置空间）。
func (svc *service) runQuickRun(id string) (map[string]any, error) {
	doc, err := svc.loadQuickRuns()
	if err != nil {
		return nil, err
	}
	target := quickRun{}
	found := false
	for _, item := range doc.QuickRuns {
		if item.ID == id {
			target = item
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("未找到快捷运行: %s", id)
	}
	if len(target.CommandIDs) == 0 {
		return nil, fmt.Errorf("快捷运行「%s」没有可运行的命令", target.Name)
	}

	// 命令名一次性建索引用于结果反馈；引用失效时退化为命令 id。
	commandsDoc, err := svc.loadCommands()
	if err != nil {
		return nil, err
	}
	nameByID := make(map[string]string, len(commandsDoc.Commands))
	for _, item := range commandsDoc.Commands {
		nameByID[item.ID] = item.Name
	}
	displayName := func(commandID string) string {
		if name, ok := nameByID[commandID]; ok && name != "" {
			return name
		}
		return commandID
	}

	started := make([]map[string]any, 0, len(target.CommandIDs))
	failures := make([]map[string]any, 0)
	for _, commandID := range target.CommandIDs {
		result, runErr := svc.runCommandByMode(commandID)
		if runErr != nil {
			failures = append(failures, map[string]any{
				"commandId":   commandID,
				"commandName": displayName(commandID),
				"error":       runErr.Error(),
			})
			continue
		}
		entry := map[string]any{
			"commandId":   commandID,
			"commandName": displayName(commandID),
		}
		if runID, ok := result["runId"].(string); ok && runID != "" {
			entry["runId"] = runID
		}
		started = append(started, entry)
	}
	return map[string]any{"started": started, "failures": failures}, nil
}

// filterQuickRunCommandIDs 过滤命令引用：保留首次出现且仍然有效的引用。
func filterQuickRunCommandIDs(commandIDs []string, valid map[string]bool) []string {
	result := make([]string, 0, len(commandIDs))
	seen := make(map[string]bool, len(commandIDs))
	for _, id := range commandIDs {
		if seen[id] || !valid[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}

// detachCommandsFromQuickRuns 清理一组命令在所有条目中的引用（删除命令/仓库时调用）。
func (svc *service) detachCommandsFromQuickRuns(commandIDs []string) error {
	if len(commandIDs) == 0 {
		return nil
	}
	removed := make(map[string]bool, len(commandIDs))
	for _, id := range commandIDs {
		removed[id] = true
	}
	doc, err := svc.loadQuickRuns()
	if err != nil {
		return err
	}
	changed := false
	for index := range doc.QuickRuns {
		before := doc.QuickRuns[index].CommandIDs
		next := make([]string, 0, len(before))
		for _, id := range before {
			if removed[id] {
				continue
			}
			next = append(next, id)
		}
		if len(next) != len(before) {
			doc.QuickRuns[index].CommandIDs = next
			doc.QuickRuns[index].UpdatedAt = nowText()
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return svc.writeQuickRuns(doc)
}

// ensureQuickRuns 启动一致性维护：过滤失效与重复的命令引用；引用被清空的条目本身保留。
func (svc *service) ensureQuickRuns() error {
	doc, err := svc.loadQuickRuns()
	if err != nil {
		return err
	}
	commandsDoc, err := svc.loadCommands()
	if err != nil {
		return err
	}
	valid := make(map[string]bool, len(commandsDoc.Commands))
	for _, item := range commandsDoc.Commands {
		valid[item.ID] = true
	}
	changed := false
	for index := range doc.QuickRuns {
		before := doc.QuickRuns[index].CommandIDs
		next := filterQuickRunCommandIDs(before, valid)
		if len(next) != len(before) {
			doc.QuickRuns[index].CommandIDs = next
			doc.QuickRuns[index].UpdatedAt = nowText()
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return svc.writeQuickRuns(doc)
}
