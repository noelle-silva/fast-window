// 任务树：角色与工作区各自一棵，节点以 id 为身份，children 的顺序就是显示顺序。
// 这里只放纯计算：形状归一、路径解析、草稿比对与本地顺序调整。
// 结构动作的真正裁决在服务端，客户端不重复实现校验。

export type TaskScope = 'role' | 'workspace'

export const TASK_SCOPES: readonly TaskScope[] = ['role', 'workspace']

// 作用域中文名的单一事实源：设置页与输入区模态窗共用同一套文案。
export const TASK_SCOPE_LABELS: Record<TaskScope, string> = {
  role: '角色任务',
  workspace: '工作区任务',
}

export type TaskNode = {
  id: string
  name: string
  description: string
  content: string
  /** 卡片展示标记：开启后这一层的复制键用主题色标出；不影响复制的内容与行为。 */
  copyHighlight: boolean
  children: TaskNode[]
  createdAt: string
  updatedAt: string
}

export type TaskTree = {
  tasks: TaskNode[]
}

/** 编辑中的节点副本：只包含人改得动的四个字段。 */
export type TaskDraft = {
  id: string
  name: string
  description: string
  content: string
  copyHighlight: boolean
}

export const EMPTY_TASK_TREE: TaskTree = { tasks: [] }

/** 名字允许为空；展示时用这个兜底，落库不改写。 */
export const UNNAMED_TASK_LABEL = '未命名任务'

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function normalizeTaskNode(raw: any): TaskNode {
  return {
    id: text(raw?.id),
    name: text(raw?.name),
    description: text(raw?.description),
    content: String(raw?.content ?? ''),
    // 只认真正的布尔真值：旧数据没有这个字段，读出来就是关闭。
    copyHighlight: raw?.copyHighlight === true,
    children: Array.isArray(raw?.children) ? raw.children.map(normalizeTaskNode) : [],
    createdAt: text(raw?.createdAt),
    updatedAt: text(raw?.updatedAt),
  }
}

export function normalizeTaskTree(raw: any): TaskTree {
  return { tasks: Array.isArray(raw?.tasks) ? raw.tasks.map(normalizeTaskNode) : [] }
}

/** 节点 id 由客户端给出，服务端只做唯一性校验。 */
export function createTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function taskLabel(node: TaskNode | null | undefined): string {
  return text(node?.name) || UNNAMED_TASK_LABEL
}

// ---------------------------------------------------------------- 路径

/**
 * 按 id 路径从根往下取节点链。
 * 路径里某一段不存在（节点被删、或换了一份树）时在上一段截断，
 * 调用方据此回落到最近的祖先，而不是停在一个不存在的层。
 */
export function resolveTaskPath(tree: TaskTree, pathIds: readonly string[]): TaskNode[] {
  const trail: TaskNode[] = []
  let layer = tree.tasks
  for (const id of pathIds) {
    const found = layer.find((node) => node.id === id)
    if (!found) break
    trail.push(found)
    layer = found.children
  }
  return trail
}

export function taskPathIds(path: readonly TaskNode[]): string[] {
  return path.map((node) => node.id)
}

export function taskLayerNodes(tree: TaskTree, path: readonly TaskNode[]): TaskNode[] {
  return path.length ? path[path.length - 1].children : tree.tasks
}

export function taskById(tree: TaskTree, taskId: string): TaskNode | null {
  const walk = (nodes: TaskNode[]): TaskNode | null => {
    for (const node of nodes) {
      if (node.id === taskId) return node
      const found = walk(node.children)
      if (found) return found
    }
    return null
  }
  return walk(tree.tasks)
}

// ---------------------------------------------------------------- 草稿

export function taskDraftOf(node: TaskNode | null | undefined): TaskDraft | null {
  if (!node) return null
  return {
    id: node.id,
    name: node.name,
    description: node.description,
    content: node.content,
    copyHighlight: node.copyHighlight,
  }
}

export function taskDraftIsDirty(node: TaskNode | null | undefined, draft: TaskDraft | null): boolean {
  if (!node || !draft || node.id !== draft.id) return false
  return (
    node.name !== draft.name ||
    node.description !== draft.description ||
    node.content !== draft.content ||
    node.copyHighlight !== draft.copyHighlight
  )
}

/** 把草稿的四个字段写回树里的同 id 节点，其余部分原样保留。 */
export function applyTaskDraft(tree: TaskTree, draft: TaskDraft): TaskTree {
  const walk = (nodes: TaskNode[]): TaskNode[] =>
    nodes.map((node) => {
      if (node.id === draft.id) {
        return {
          ...node,
          name: draft.name,
          description: draft.description,
          content: draft.content,
          copyHighlight: draft.copyHighlight,
        }
      }
      if (!node.children.length) return node
      return { ...node, children: walk(node.children) }
    })
  return { tasks: walk(tree.tasks) }
}

// ---------------------------------------------------------------- 结构

/** 该节点自己加它的全部后代：移动目标与删除影响范围都用这一份清单。 */
export function taskSubtreeIds(node: TaskNode): string[] {
  const ids = [node.id]
  for (const child of node.children) ids.push(...taskSubtreeIds(child))
  return ids
}

export type TaskParentOption = {
  id: string
  label: string
  depth: number
}

/** 可作为父级的候选节点（不含被排除的子树），按树的先后顺序摊平并带上层级。 */
export function taskParentOptions(tree: TaskTree, excludeIds: ReadonlySet<string>): TaskParentOption[] {
  const options: TaskParentOption[] = []
  const walk = (nodes: TaskNode[], depth: number) => {
    for (const node of nodes) {
      if (excludeIds.has(node.id)) continue
      options.push({ id: node.id, label: taskLabel(node), depth })
      walk(node.children, depth + 1)
    }
  }
  walk(tree.tasks, 1)
  return options
}

/** 同层内上移（delta=-1）或下移（delta=1）；越界时原样返回。 */
export function moveTaskInLayer(layerIds: readonly string[], taskId: string, delta: number): string[] {
  const from = layerIds.indexOf(taskId)
  if (from < 0) return [...layerIds]
  const to = from + delta
  if (to < 0 || to >= layerIds.length) return [...layerIds]
  const next = [...layerIds]
  next.splice(from, 1)
  next.splice(to, 0, taskId)
  return next
}

/** 节点所在层的父级 id 与该层全部 id（顺序即显示顺序）；节点不存在时返回 null。 */
export function taskSiblingLayer(tree: TaskTree, taskId: string): { parentId: string; ids: string[] } | null {
  const walk = (nodes: TaskNode[], parentId: string): { parentId: string; ids: string[] } | null => {
    if (nodes.some((node) => node.id === taskId)) {
      return { parentId, ids: nodes.map((node) => node.id) }
    }
    for (const node of nodes) {
      const found = walk(node.children, node.id)
      if (found) return found
    }
    return null
  }
  return walk(tree.tasks, '')
}
