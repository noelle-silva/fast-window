// 会话视图意图：决定“当前看哪里”的唯一事实源。
//
// 只有两种意图，互斥：
// - 跟随最新：自动推进到“跟随目标”。
// - 锚定当前点：停在指定节点。
//
// 意图只由“切换节点的动作”或“发起运行”改写；其余概念不得各自记一份视图状态。
// 本模块是纯函数状态机：App 与测试共用同一份转移逻辑，保证测的就是跑的。
//
// “运行产出节点”的定义统一由 resolveRunFocusMid 提供（与控制器分支激活同源），
// 本模块只负责在“意图”与“运行事实”之上解析出当前焦点。

import { resolveRunFocusMid } from './branching'

export type ViewIntent = { kind: 'follow' } | { kind: 'anchor'; mid: string }

// 一次运行对视图有价值的只读事实。
export type RunViewFact = {
  runId: string
  anchorMid: string
  outputMid: string
  createdAt: number
}

// 解析“跟随目标”所需的只读事实。
export type ViewFocusContext = {
  // 刚发起、尚未登记为运行的运行分叉点（空窗期用）。
  pendingRunAnchorMid?: string
  // 当前目标会话里的活动运行。
  runs?: RunViewFact[]
  // 当前活动分支头部。
  branchHeadMid?: string
  // 当前会话：用于把“运行产出”解析为真实存在的节点。
  chat?: any
}

// 视图意图状态：意图 + 空窗期临时分叉点。
export type ViewIntentState = {
  intent: ViewIntent
  pendingRunAnchorMid: string
}

export function initialViewIntentState(): ViewIntentState {
  return { intent: { kind: 'follow' }, pendingRunAnchorMid: '' }
}

export function followLatestIntent(): ViewIntent {
  return { kind: 'follow' }
}

export function anchorViewIntent(midRaw: unknown): ViewIntent {
  return { kind: 'anchor', mid: String(midRaw || '').trim() }
}

// viewIntentAnchorMid 读取锚定节点；跟随态返回空串。
export function viewIntentAnchorMid(intent: ViewIntent): string {
  return intent.kind === 'anchor' ? intent.mid : ''
}

// runViewFactsFromCards 把运行卡片统一映射为跟随事实。
// UI 渲染与控制器分支激活都经此转换，保证“最新节点”只有一处定义。
export function runViewFactsFromCards(cardsRaw: unknown): RunViewFact[] {
  const cards = Array.isArray(cardsRaw) ? (cardsRaw as any[]) : []
  return cards.map((card) => ({
    runId: String(card?.runId || '').trim(),
    anchorMid: String(card?.anchorMessageId || card?.inputMessageId || '').trim(),
    outputMid: String(card?.lastMessageId || '').trim(),
    createdAt: Number(card?.createdAt || 0),
  }))
}

// selectFollowRun 从活动运行里挑出“跟随对象”：
// 取发起时间最晚的那次运行（用户最近发起的），保证多分支并行时目标稳定、不随输出横跳。
export function selectFollowRun(runsRaw: unknown): RunViewFact | null {
  const runs = Array.isArray(runsRaw) ? (runsRaw as RunViewFact[]) : []
  if (!runs.length) return null
  let pick = runs[0]
  for (const run of runs) {
    if (Number(run?.createdAt || 0) >= Number(pick?.createdAt || 0)) pick = run
  }
  return pick || null
}

// resolveFollowTargetMid 解析“跟随最新”当前会落在哪个节点。
// 这就是判定里的“最新节点”：与它相同 → 跟随，否则 → 锚定。
// 优先级：
//   1. 刚发起运行、尚未登记 → 发起时记下的分叉点；
//   2. 活动运行 → 跟随对象的产出节点，尚无产出则用其分叉点；
//   3. 无运行 → 当前分支头部。
export function resolveFollowTargetMid(context: ViewFocusContext): string {
  const pendingMid = String(context.pendingRunAnchorMid || '').trim()
  if (pendingMid) return pendingMid
  const run = selectFollowRun(context.runs)
  if (run) {
    // 产出节点定义与控制器分支激活同源：统一走 resolveRunFocusMid。
    if (context.chat) {
      const resolved = resolveRunFocusMid(context.chat, { anchorMid: run.anchorMid, outputMid: run.outputMid })
      if (resolved) return resolved
    }
    const outputMid = String(run.outputMid || '').trim()
    if (outputMid) return outputMid
    const anchorMid = String(run.anchorMid || '').trim()
    if (anchorMid) return anchorMid
  }
  return String(context.branchHeadMid || '').trim()
}

// resolveViewFocusMid 把意图解析为具体焦点节点：锚定态取锚定节点，否则取跟随目标。
export function resolveViewFocusMid(intent: ViewIntent, context: ViewFocusContext): string {
  if (intent.kind === 'anchor' && intent.mid) return intent.mid
  return resolveFollowTargetMid(context)
}

// onRunStarted 是“发起运行”的状态转移：回到跟随最新，并记下空窗期分叉点。
export function onRunStarted(state: ViewIntentState, anchorMidRaw: unknown): ViewIntentState {
  return { intent: followLatestIntent(), pendingRunAnchorMid: String(anchorMidRaw || '').trim() }
}

// onNodeClicked 是“切换节点”动作的唯一意图转移：
// 点中跟随目标 → 跟随最新；点其它任何节点（含上游、同级分支）→ 锚定该节点。
// 不动空窗期分叉点：锚定态本就不受它影响；跟随态保留它可让“点回目标”稳定停在原目标，
// 不会因清掉分叉点而跳到别的旧运行产出。
export function onNodeClicked(state: ViewIntentState, clickedMidRaw: unknown, followTargetMidRaw: unknown): ViewIntentState {
  const clicked = String(clickedMidRaw || '').trim()
  const target = String(followTargetMidRaw || '').trim()
  if (!clicked) return state
  const intent = clicked === target ? followLatestIntent() : anchorViewIntent(clicked)
  return { ...state, intent }
}

// onRunRegistered 在运行被登记后清掉空窗期临时分叉点（仅当锚点匹配）。
export function onRunRegistered(state: ViewIntentState, registeredAnchorMidRaw: unknown): ViewIntentState {
  const pending = String(state.pendingRunAnchorMid || '').trim()
  if (!pending) return state
  const registered = String(registeredAnchorMidRaw || '').trim()
  if (registered && registered === pending) return { ...state, pendingRunAnchorMid: '' }
  return state
}

// onChatSwitched 切换会话时重置为跟随最新。
export function onChatSwitched(): ViewIntentState {
  return initialViewIntentState()
}
