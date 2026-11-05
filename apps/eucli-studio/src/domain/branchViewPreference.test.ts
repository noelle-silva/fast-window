import { describe, expect, it } from 'vitest'
import {
  branchViewAncestorTrail,
  branchViewTopologyFromChat,
  branchViewTopologyFromMessages,
  convergeViewIntentState,
} from './branchViewPreference'
import type { ViewIntentState } from './viewIntent'
import { anchorViewIntent, followLatestIntent } from './viewIntent'

// 分支视图偏好只描述「当前选择」，且只依赖后台拓扑做失效判定。
// 这里用消息链模拟会话事实，验证：新增/分叉不改选择，删除/不可达才收敛。

function message(id: string, parentMid: string) {
  return { id, parentMid }
}

function chat(messages: any[]) {
  return { messages }
}

function anchorState(mid: string, trail: string[], pendingRunAnchorMid = ''): ViewIntentState {
  return { intent: anchorViewIntent(mid), pendingRunAnchorMid, anchorTrail: trail }
}

function mainTree() {
  return chat([
    message('u1', ''),
    message('a1', 'u1'),
    message('u2', 'a1'),
    message('a2', 'u2'),
    message('a2b', 'u2'),
  ])
}

describe('branchViewTopology 只读后台拓扑', () => {
  it('节点存在 / 父链 / 可达性均来自消息快照', () => {
    const topology = branchViewTopologyFromMessages(mainTree().messages)
    expect(topology.has('a2')).toBe(true)
    expect(topology.has('missing')).toBe(false)
    expect(topology.parentOf('a2')).toBe('u2')
    expect(topology.isReachable('a2')).toBe(true)
    expect(topology.isReachable('missing')).toBe(false)
    expect(topology.isReachable('')).toBe(false)
  })

  it('父节点不在当前窗口时仍视为可达边界，不制造悬空判定', () => {
    const topology = branchViewTopologyFromMessages([message('m1', 'window-before')])
    expect(topology.isReachable('m1')).toBe(true)
    expect(branchViewAncestorTrail(topology, 'm1')).toEqual([])
  })

  it('祖先链按近→远收录，环会被截断', () => {
    const topology = branchViewTopologyFromMessages([
      message('u1', ''),
      message('a1', 'u1'),
      message('u2', 'a1'),
      message('a2', 'u2'),
    ])
    expect(branchViewAncestorTrail(topology, 'a2')).toEqual(['u2', 'a1', 'u1'])

    const cycle = branchViewTopologyFromMessages([message('x', 'y'), message('y', 'x')])
    expect(cycle.isReachable('x')).toBe(false)
    expect(branchViewAncestorTrail(cycle, 'x')).toEqual(['y'])
  })

  it('点击选择不会改写后台消息', () => {
    const source = mainTree()
    const before = JSON.stringify(source)
    const topology = branchViewTopologyFromChat(source)
    branchViewAncestorTrail(topology, 'a2b')
    expect(JSON.stringify(source)).toBe(before)
  })
})

describe('分支视图偏好收敛', () => {
  it('选中节点仍可达：后台新增节点 / 分叉不改变选择（返回同一状态）', () => {
    const state = anchorState('a2', ['u2', 'a1', 'u1'])
    const source = mainTree()
    const topology = branchViewTopologyFromChat(source)

    expect(convergeViewIntentState(state, topology)).toBe(state)

    source.messages.push(message('a3', 'a2'))
    source.messages.push(message('a2c', 'u2'))
    const grown = branchViewTopologyFromChat(source)
    expect(convergeViewIntentState(state, grown)).toBe(state)
  })

  it('选中节点被删除：收敛到最近的有效祖先', () => {
    const state = anchorState('a2b', ['u2', 'a1', 'u1'])
    const source = mainTree()
    source.messages = source.messages.filter((m) => m.id !== 'a2b')
    const topology = branchViewTopologyFromChat(source)

    const next = convergeViewIntentState(state, topology)
    expect(next.intent).toEqual({ kind: 'anchor', mid: 'u2' })
    expect(next.anchorTrail).toEqual(['a1', 'u1'])
  })

  it('选中节点及其父节点都被删除：继续向上收敛', () => {
    const state = anchorState('a2', ['u2', 'a1', 'u1'])
    const source = mainTree()
    source.messages = source.messages.filter((m) => m.id !== 'a2' && m.id !== 'u2')
    const topology = branchViewTopologyFromChat(source)

    const next = convergeViewIntentState(state, topology)
    expect(next.intent).toEqual({ kind: 'anchor', mid: 'a1' })
    expect(next.anchorTrail).toEqual(['u1'])
  })

  it('选中节点与全部已知祖先都失效：退回跟随最新，不留悬空 id', () => {
    const state = anchorState('a2', ['u2', 'a1', 'u1'], 'pending-anchor')
    const topology = branchViewTopologyFromMessages([message('x', '')])

    const next = convergeViewIntentState(state, topology)
    expect(next.intent).toEqual(followLatestIntent())
    expect(next.anchorTrail).toEqual([])
    expect(next.pendingRunAnchorMid).toBe('pending-anchor')
  })

  it('选中节点存在但不可达（环）：按祖先链收敛', () => {
    const state = anchorState('x', ['p', 'root'])
    const topology = branchViewTopologyFromMessages([
      message('root', ''),
      message('p', 'root'),
      message('x', 'y'),
      message('y', 'x'),
    ])

    const next = convergeViewIntentState(state, topology)
    expect(next.intent).toEqual({ kind: 'anchor', mid: 'p' })
    expect(next.anchorTrail).toEqual(['root'])
  })

  it('跟随态不参与收敛', () => {
    const state: ViewIntentState = { intent: followLatestIntent(), pendingRunAnchorMid: '', anchorTrail: ['u1'] }
    const topology = branchViewTopologyFromMessages([])
    expect(convergeViewIntentState(state, topology)).toBe(state)
  })

  it('空值与重复祖先安全处理，不抛错', () => {
    const state = anchorState('gone', ['u2', '', 'u2', 'u1'])
    const topology = branchViewTopologyFromMessages(mainTree().messages)

    const next = convergeViewIntentState(state, topology)
    expect(next.intent).toEqual({ kind: 'anchor', mid: 'u2' })

    const empty = anchorState('gone', [])
    expect(convergeViewIntentState(empty, topology).intent).toEqual(followLatestIntent())
    expect(convergeViewIntentState(null as any, topology)).toBeNull()
    expect(convergeViewIntentState(anchorState('', []), topology).intent).toEqual({ kind: 'anchor', mid: '' })
  })
})
