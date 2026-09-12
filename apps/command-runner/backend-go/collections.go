package main

import (
	"fmt"
	"sort"
	"strings"
)

// 收藏夹树的事实源约定：
//   - nodes 表中只存在收藏夹节点（含每个仓库的隐式根节点，根节点 id = repoId）；
//   - children 数组同时表达「归属」与「顺序」：id 在 nodes 中存在 = 子收藏夹，否则 = 命令引用；
//   - 一条命令/一个收藏夹同一时刻只被一个 children 数组引用（单选归属）。

func (svc *service) listCollections() (map[string]any, error) {
	doc, err := svc.loadCollections()
	if err != nil {
		return nil, err
	}
	return map[string]any{"nodes": doc.Nodes}, nil
}

func newRepoRootNode(repoID string) *collectionNode {
	return &collectionNode{
		ID:        repoID,
		RepoID:    repoID,
		Type:      "folder",
		Name:      "",
		Children:  []string{},
		CreatedAt: nowText(),
		UpdatedAt: nowText(),
	}
}

// ensureRepoRoot 确保仓库根节点存在（新建仓库时调用）。
func (svc *service) ensureRepoRoot(repoID string) error {
	doc, err := svc.loadCollections()
	if err != nil {
		return err
	}
	if node, ok := doc.Nodes[repoID]; ok && node != nil {
		return nil
	}
	doc.Nodes[repoID] = newRepoRootNode(repoID)
	return svc.writeCollections(doc)
}

func collectionParentID(doc collectionsDoc, nodeID string) (string, bool) {
	for _, node := range doc.Nodes {
		if node == nil {
			continue
		}
		for _, childID := range node.Children {
			if childID == nodeID {
				return node.ID, true
			}
		}
	}
	return "", false
}

// collectionSubtreeFolderIDs 返回以 folderID 为根的子树内全部收藏夹 id（含自身）。
func collectionSubtreeFolderIDs(doc collectionsDoc, folderID string) map[string]bool {
	result := map[string]bool{}
	stack := []string{folderID}
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if result[current] {
			continue
		}
		node, ok := doc.Nodes[current]
		if !ok || node == nil {
			continue
		}
		result[current] = true
		for _, childID := range node.Children {
			if _, isFolder := doc.Nodes[childID]; isFolder {
				stack = append(stack, childID)
			}
		}
	}
	return result
}

func removeID(ids []string, id string) []string {
	next := make([]string, 0, len(ids))
	for _, item := range ids {
		if item != id {
			next = append(next, item)
		}
	}
	return next
}

func insertIDAt(ids []string, id string, index int) []string {
	at := index
	if at < 0 || at > len(ids) {
		at = len(ids)
	}
	next := make([]string, 0, len(ids)+1)
	next = append(next, ids[:at]...)
	next = append(next, id)
	next = append(next, ids[at:]...)
	return next
}

// createCollectionFolder 在指定父收藏夹（可为仓库根节点）下新建空收藏夹。
func (svc *service) createCollectionFolder(repoID, parentID, name string) (collectionNode, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return collectionNode{}, fmt.Errorf("收藏夹名称不能为空")
	}
	doc, err := svc.loadCollections()
	if err != nil {
		return collectionNode{}, err
	}
	parent, ok := doc.Nodes[parentID]
	if !ok || parent == nil || parent.RepoID != repoID {
		return collectionNode{}, fmt.Errorf("父收藏夹不存在: %s", parentID)
	}
	node := &collectionNode{
		ID:        newID("folder"),
		RepoID:    repoID,
		Type:      "folder",
		Name:      name,
		Children:  []string{},
		CreatedAt: nowText(),
		UpdatedAt: nowText(),
	}
	doc.Nodes[node.ID] = node
	parent.Children = append(parent.Children, node.ID)
	parent.UpdatedAt = nowText()
	if err := svc.writeCollections(doc); err != nil {
		return collectionNode{}, err
	}
	return *node, nil
}

func (svc *service) renameCollectionFolder(folderID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("收藏夹名称不能为空")
	}
	doc, err := svc.loadCollections()
	if err != nil {
		return err
	}
	node, ok := doc.Nodes[folderID]
	if !ok || node == nil {
		return fmt.Errorf("收藏夹不存在: %s", folderID)
	}
	if node.ID == node.RepoID {
		return fmt.Errorf("根节点不能重命名")
	}
	node.Name = name
	node.UpdatedAt = nowText()
	return svc.writeCollections(doc)
}

// dissolveCollectionFolder 解散收藏夹：其子项按原顺序上移到父级原位，再删除该节点。
func (svc *service) dissolveCollectionFolder(folderID string) error {
	doc, err := svc.loadCollections()
	if err != nil {
		return err
	}
	node, ok := doc.Nodes[folderID]
	if !ok || node == nil {
		return fmt.Errorf("收藏夹不存在: %s", folderID)
	}
	if node.ID == node.RepoID {
		return fmt.Errorf("根节点不能删除")
	}
	parentID, ok := collectionParentID(doc, folderID)
	if !ok {
		return fmt.Errorf("收藏夹没有归属: %s", folderID)
	}
	parent := doc.Nodes[parentID]
	next := make([]string, 0, len(parent.Children)-1+len(node.Children))
	for _, childID := range parent.Children {
		if childID == folderID {
			next = append(next, node.Children...)
			continue
		}
		next = append(next, childID)
	}
	parent.Children = next
	parent.UpdatedAt = nowText()
	delete(doc.Nodes, folderID)
	return svc.writeCollections(doc)
}

// moveCollectionNode 将命令或收藏夹移动到目标收藏夹的指定位置（index < 0 表示末尾）。
// index 语义：在移动节点后的目标 children 数组中插入的位置（与前端一致）。
func (svc *service) moveCollectionNode(nodeID, targetFolderID string, index int) error {
	nodeID = strings.TrimSpace(nodeID)
	targetFolderID = strings.TrimSpace(targetFolderID)
	if nodeID == "" || targetFolderID == "" {
		return fmt.Errorf("移动参数不完整")
	}
	doc, err := svc.loadCollections()
	if err != nil {
		return err
	}
	target, ok := doc.Nodes[targetFolderID]
	if !ok || target == nil {
		return fmt.Errorf("目标收藏夹不存在: %s", targetFolderID)
	}
	sourceID, ok := collectionParentID(doc, nodeID)
	if !ok {
		return fmt.Errorf("节点没有归属: %s", nodeID)
	}
	source := doc.Nodes[sourceID]
	if source == nil || source.RepoID != target.RepoID {
		return fmt.Errorf("不能跨仓库移动")
	}
	if _, isFolder := doc.Nodes[nodeID]; isFolder {
		if collectionSubtreeFolderIDs(doc, nodeID)[targetFolderID] {
			return fmt.Errorf("不能移动到自身或子收藏夹")
		}
	}
	source.Children = removeID(source.Children, nodeID)
	source.UpdatedAt = nowText()
	target.Children = insertIDAt(target.Children, nodeID, index)
	target.UpdatedAt = nowText()
	return svc.writeCollections(doc)
}

// appendCommandToRoot 将新命令挂到其仓库根节点末尾（未分类区）。
func (svc *service) appendCommandToRoot(repoID, commandID string) error {
	doc, err := svc.loadCollections()
	if err != nil {
		return err
	}
	root, ok := doc.Nodes[repoID]
	if !ok || root == nil {
		return fmt.Errorf("仓库收藏夹根不存在: %s", repoID)
	}
	root.Children = append(root.Children, commandID)
	root.UpdatedAt = nowText()
	return svc.writeCollections(doc)
}

// detachCommand 从树中移除命令引用（删除命令时调用）。
func (svc *service) detachCommand(commandID string) error {
	doc, err := svc.loadCollections()
	if err != nil {
		return err
	}
	changed := false
	for _, node := range doc.Nodes {
		if node == nil {
			continue
		}
		next := removeID(node.Children, commandID)
		if len(next) != len(node.Children) {
			node.Children = next
			node.UpdatedAt = nowText()
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return svc.writeCollections(doc)
}

// dropRepoCollections 删除某仓库的全部收藏夹节点（删除仓库时调用）。
func (svc *service) dropRepoCollections(repoID string) error {
	doc, err := svc.loadCollections()
	if err != nil {
		return err
	}
	changed := false
	for id, node := range doc.Nodes {
		if node == nil || node.RepoID != repoID {
			continue
		}
		delete(doc.Nodes, id)
		changed = true
	}
	if !changed {
		return nil
	}
	return svc.writeCollections(doc)
}

// ensureCollections 启动迁移与一致性维护：
//  1. 清除不存在仓库的节点；
//  2. 清除无效/跨仓库/重复的 children 引用（按节点 id 稳定顺序保留第一个引用）；
//  3. 保证每个仓库都有根节点，并把未被任何收藏夹引用的命令按存储顺序补回根节点。
func (svc *service) ensureCollections() error {
	doc, err := svc.loadCollections()
	if err != nil {
		return err
	}
	reposDoc, err := svc.loadRepos()
	if err != nil {
		return err
	}
	commandsDoc, err := svc.loadCommands()
	if err != nil {
		return err
	}

	repoIDs := make(map[string]bool, len(reposDoc.Repos))
	for _, item := range reposDoc.Repos {
		repoIDs[item.ID] = true
	}
	commandByID := make(map[string]command, len(commandsDoc.Commands))
	for _, item := range commandsDoc.Commands {
		commandByID[item.ID] = item
	}

	for id, node := range doc.Nodes {
		if node == nil || !repoIDs[node.RepoID] {
			delete(doc.Nodes, id)
		}
	}

	claimed := map[string]bool{}
	nodeIDs := make([]string, 0, len(doc.Nodes))
	for id := range doc.Nodes {
		nodeIDs = append(nodeIDs, id)
	}
	sort.Strings(nodeIDs)
	for _, id := range nodeIDs {
		node := doc.Nodes[id]
		if node == nil {
			continue
		}
		next := make([]string, 0, len(node.Children))
		for _, childID := range node.Children {
			if claimed[childID] {
				continue
			}
			if childNode, isFolder := doc.Nodes[childID]; isFolder {
				if childNode == nil || childNode.RepoID != node.RepoID {
					continue
				}
				claimed[childID] = true
				next = append(next, childID)
				continue
			}
			cmd, exists := commandByID[childID]
			if !exists || cmd.RepoID != node.RepoID {
				continue
			}
			claimed[childID] = true
			next = append(next, childID)
		}
		node.Children = next
	}

	appended := map[string][]string{}
	for _, item := range commandsDoc.Commands {
		if !repoIDs[item.RepoID] || claimed[item.ID] {
			continue
		}
		appended[item.RepoID] = append(appended[item.RepoID], item.ID)
	}
	for repoID := range repoIDs {
		root, ok := doc.Nodes[repoID]
		if !ok || root == nil {
			root = newRepoRootNode(repoID)
			doc.Nodes[repoID] = root
		}
		if extra := appended[repoID]; len(extra) > 0 {
			root.Children = append(root.Children, extra...)
		}
	}
	return svc.writeCollections(doc)
}
