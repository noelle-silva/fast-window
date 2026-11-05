// 分支视图偏好：树上的「当前选择」只是一项视窗偏好。
//
// 它只保存选中节点 id 与点击时捕获的祖先链；既不写入会话事实，
// 也不生成任何消息 / 父子关系。后台拓扑变化时只有两种结果：
//   - 选中节点仍然可达 → 偏好原样保留（新增节点、分叉都不改变选择）；
//   - 选中节点被删除或不再可达 → 沿祖先链收敛到最近的有效祖先；
//     祖先链也全部失效时退回跟随最新，绝不留下悬空 id。
//
// 本模块是纯函数：App 用它在渲染期得到生效偏好，再把收敛结果写回状态。
// 这样失效的那一帧也不会拿到空引用或旧节点。

import type { ViewIntentState } from './viewIntent'
import { anchorViewIntent, followLatestIntent } from './viewIntent'

export type BranchViewTopology = {
  has: (mid: string) => boolean
  parentOf: (mid: string) => string
  // 节点存在，且沿 parent 链可以终止（允许父节点不在当前窗口内：
  // 树布局把它当作根，仍属于可达事实；只有环或缺失自身才算不可达）。
  isReachable: (mid: string) => boolean
}

type TopologySource = {
  byId: Set<string>
  parentById: Map<string, string>
}

function buildTopologySource(messagesRaw: unknown): TopologySource {
  const messages = Array.isArray(messagesRaw) ? messagesRaw : []
  const byId = new Set<string>()
  const parentById = new Map<string, string>()
  for (const message of messages) {
    const id = String((message as any)?.id || '').trim()
    if (!id || byId.has(id)) continue
    byId.add(id)
    parentById.set(id, String((message as any)?.parentMid || '').trim())
  }
  return { byId, parentById }
}

function topologyFromSource(source: TopologySource): BranchViewTopology {
  const has = (midRaw: string) => {
    const mid = String(midRaw || '').trim()
    return !!mid && source.byId.has(mid)
  }

  const parentOf = (midRaw: string) => {
    const mid = String(midRaw || '').trim()
    return mid ? source.parentById.get(mid) || '' : ''
  }

  const isReachable = (midRaw: string) => {
    let cur = String(midRaw || '').trim()
    if (!cur || !source.byId.has(cur)) return false
    const seen = new Set<string>()
    let guard = 0
    while (cur) {
      if (seen.has(cur)) return false
      seen.add(cur)
      guard++
      if (guard > 6000) return false
      if (!source.byId.has(cur)) return true
      cur = source.parentById.get(cur) || ''
    }
    return true
  }

  return { has, parentOf, isReachable }
}

// 后台拓扑只从会话消息快照读取；这里绝不补造节点，也不改写入参。
export function branchViewTopologyFromChat(chat: unknown): BranchViewTopology {
  return branchViewTopologyFromMessages(Array.isArray((chat as any)?.messages) ? (chat as any).messages : [])
}

export function branchViewTopologyFromMessages(messagesRaw: unknown): BranchViewTopology {
  return topologyFromSource(buildTopologySource(messagesRaw))
}

// branchViewAncestorTrail 返回 mid 的最近祖先链（近 → 远），只收录当前拓扑里存在的节点。
// 父节点不在窗口内时链在此终止：它是已知边界，不是可收敛的祖先。
export function branchViewAncestorTrail(topology: BranchViewTopology, midRaw: unknown): string[] {
  const mid = String(midRaw || '').trim()
  if (!mid) return []
  const out: string[] = []
  const seen = new Set<string>([mid])
  let cur = topology.parentOf(mid)
  let guard = 0
  while (cur && !seen.has(cur) && guard < 6000) {
    guard++
    if (!topology.has(cur)) break
    seen.add(cur)
    out.push(cur)
    cur = topology.parentOf(cur)
  }
  return out
}

function normalizedTrail(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const mid = String(item || '').trim()
    if (!mid || seen.has(mid)) continue
    seen.add(mid)
    out.push(mid)
  }
  return out
}

// convergeViewIntentState 把失效的锚定偏好收敛到最近的有效祖先。
//
// 不变量：
//   - 跟随态不收敛（它本来就随后台事实解析）；
//   - 选中节点仍可达时返回同一个 state 引用：新增 / 分叉不会改写选择；
//   - 收敛只改偏好，不动 chat / messages，也不生成任何节点。
export function convergeViewIntentState(state: ViewIntentState, topology: BranchViewTopology): ViewIntentState {
  if (!state || state.intent.kind !== 'anchor') return state
  const selected = String(state.intent.mid || '').trim()
  if (!selected) return state
  if (topology.isReachable(selected)) return state

  const trail = normalizedTrail(state.anchorTrail)
  for (const candidate of trail) {
    if (candidate === selected) continue
    if (!topology.isReachable(candidate)) continue
    return {
      ...state,
      intent: anchorViewIntent(candidate),
      anchorTrail: branchViewAncestorTrail(topology, candidate),
    }
  }

  // 连一个有效祖先都没有：偏好回到跟随最新，不留悬空选中 id。
  return { ...state, intent: followLatestIntent(), anchorTrail: [] }
}
