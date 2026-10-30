// graph 投影（design-4 P3）的客户端契约与归一化。
//
// 问题：窗口模式只加载一窗（≤24 条），而会话树需要「整条 DAG」才能画对。
// 若树视图直接吃首窗消息，分支结构会被截断——只画得出首屏 24 条。
//
// 解决：树视图用独立的 graph 投影：业务端只回「结构」（节点 id / parent / branch /
// createdAt / 极短文本），不带消息正文。它比整份会话小得多，且与分页窗口正交：
//   window → 渲染哪一窗消息
//   graph  → 画哪一棵树
//
// 三个硬约束：
//   1. graph 只含结构，绝不含 content / parts（那是 window / get 的职责）；
//   2. 节点按 (createdAt, id) 稳定升序，与 wire 契约同源；
//   3. 父节点不在集合内时按根处理（跨窗口边界的正常现象，不是错误）。

export const SESSION_GRAPH_SCHEMA_VERSION = 1

export type SessionGraphNode = {
  id: string
  parentId: string
  branchId: string
  createdAt: number
  role: string
  text: string
  kind: string
}

export type SessionGraph = {
  schemaVersion: number
  chatId: string
  nodes: SessionGraphNode[]
  // head 是本次投影对应的路径终点：树视图据此高亮当前路径。
  head: string
}

export class SessionGraphContractError extends Error {
  readonly violations: string[]
  constructor(violations: string[]) {
    super(`会话 graph 契约校验失败：${violations.join('；')}`)
    this.name = 'SessionGraphContractError'
    this.violations = violations
  }
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function createdAtOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function roleOf(value: unknown): string {
  const role = text(value)
  if (role === 'assistant' || role === 'system') return role
  return 'user'
}

// normalizeSessionGraph 只做校验 + 归一，不做任何修复：
// 结构坏了就立刻失败，绝不带着半棵树继续渲染。
export function normalizeSessionGraph(raw: unknown): SessionGraph {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  if (!source) throw new SessionGraphContractError(['graph 必须是对象'])

  const version = Number(source.schemaVersion ?? 0)
  if (version !== SESSION_GRAPH_SCHEMA_VERSION) {
    throw new SessionGraphContractError([`schemaVersion 不支持：${String(source.schemaVersion)}`])
  }

  const violations: string[] = []
  const rawNodes = source.nodes
  if (!Array.isArray(rawNodes)) violations.push('nodes 必须是数组')

  const nodes: SessionGraphNode[] = []
  const seen = new Set<string>()
  let previousCreatedAt = -Infinity
  let previousId = ''

  for (const [index, item] of (Array.isArray(rawNodes) ? rawNodes : []).entries()) {
    const node = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null
    if (!node) {
      violations.push(`nodes[${index}] 不是对象`)
      continue
    }
    const id = text(node.id)
    if (!id) {
      violations.push(`nodes[${index}].id 为空`)
      continue
    }
    if (seen.has(id)) {
      violations.push(`nodes[${index}](${id}) 重复`)
      continue
    }
    seen.add(id)

    // graph 只承载结构：正文出现即契约违约（那是 window 的职责）。
    if (node.content !== undefined || node.parts !== undefined) {
      violations.push(`nodes[${index}](${id}) 不得携带消息正文`)
    }

    const createdAt = createdAtOf(node.createdAt)
    if (createdAt < previousCreatedAt || (createdAt === previousCreatedAt && id < previousId)) {
      violations.push(`nodes[${index}](${id}) 未按 (createdAt,id) 升序`)
    }
    previousCreatedAt = createdAt
    previousId = id

    nodes.push({
      id,
      parentId: text(node.parentId ?? node.parentMessageId ?? node.parentMid),
      branchId: text(node.branchId),
      createdAt,
      role: roleOf(node.role),
      text: text(node.text),
      kind: text(node.kind) || 'message',
    })
  }

  if (violations.length) throw new SessionGraphContractError(violations)

  return {
    schemaVersion: SESSION_GRAPH_SCHEMA_VERSION,
    chatId: text(source.chatId),
    nodes,
    head: text(source.head),
  }
}

// graphAsMessages 把结构投影转成「树布局可直接消费」的消息形状。
// 只有树需要的字段：id / parentMid / branchId / createdAt / role / content。
// 这不是「伪造会话」：它只喂给 buildChatTreeLayout，不进入消息渲染路径。
export function graphAsMessages(graph: SessionGraph): any[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    parentMid: node.parentId,
    branchId: node.branchId,
    createdAt: node.createdAt,
    role: node.role,
    type: node.role === 'assistant' ? 'assistant' : node.role === 'system' ? 'system_control' : 'user',
    content: node.text,
  }))
}

// activePathIds 返回从 head 沿 parent 链回溯到根的节点集合。
// 树视图用它高亮「当前在看哪条路径」。
export function activePathIds(graph: SessionGraph, headOverride?: string): Set<string> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const out = new Set<string>()
  let current = text(headOverride) || graph.head
  if (!current) {
    // 没有 head 时退回叶子节点（最大 createdAt 的无子节点）。
    const parents = new Set(graph.nodes.map((node) => node.parentId).filter(Boolean))
    const leaves = graph.nodes.filter((node) => !parents.has(node.id))
    current = leaves.length ? leaves[leaves.length - 1].id : ''
  }
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const node = byId.get(current)
    if (!node) break
    out.add(current)
    current = node.parentId
  }
  return out
}
