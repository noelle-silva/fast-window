// 客户端内置诊断入口（notify 域）。
//
// 命名约定：
//   - 目录：src/diagnostics/
//   - 文件：<domain>.diagnostics.ts
//   - 安装：install<Domain>Diagnostics
//   - 全局：__eucliStudioDiagnostics.notify.<command>
//   - 随包发布，不做构建排除；安装后无副作用，只有显式调用才工作。
//
// 目的：在真实运行实例里测量「一次会话切换惊动了哪些通知通道」以及
// 「一次 scope 通知只让哪些 Surface 渲染」。模块只选已有会话、只切换选中，
// 不发送消息、不删除会话、不打开或关闭弹层，结束时恢复原会话。
//
// 用法（浏览器控制台）：
//   __eucliStudioDiagnostics.notify.help()
//   await __eucliStudioDiagnostics.notify.run({ scenario: 'all' })
//   await __eucliStudioDiagnostics.notify.run({ scenario: 'switch', iterations: 5 })
//   await __eucliStudioDiagnostics.notify.run({ scenario: 'scope' })
//   __eucliStudioDiagnostics.notify.report()
//   __eucliStudioDiagnostics.notify.surfaceCounts()

import { readActiveChatSelection } from '../domain/activeChatSelection'
import { refreshScopes } from '../domain/uiRefreshScope'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { EUCLI_STUDIO_DIAGNOSTICS_KEY } from '../runtime/eucliStudioGlobals'
import {
  disableRenderProbe,
  enableRenderProbe,
  resetRenderProbe,
  snapshotRenderProbe,
  type RenderProbeId,
  type RenderProbeSnapshot,
} from './renderProbe'

const DEFAULT_ITERATIONS = 3
const MAX_ITERATIONS = 50
const DEFAULT_SWITCH_SETTLE_MS = 400
const MAX_SWITCH_SETTLE_MS = 1500
const SWITCH_CHANGE_TIMEOUT_MS = 2000
const ACTION_TIMEOUT_MS = 3000
const FRAME_TIMEOUT_MS = 300
const SWITCH_GLOBAL_BUDGET = 0

export type NotifyScenario = 'all' | 'switch' | 'scope'
export type NotifyScopeScenario = 'composer' | 'settings' | 'navigation'
export type NotifyRowResult = 'PASS' | 'FAIL' | 'SKIP' | 'INFO'
export type NotifyRowScenario = 'switch' | 'scope' | 'run'

export type NotifyDiagnosticRow = {
  scenario: NotifyRowScenario
  metric: string
  actual: string | number
  budget: string | number
  result: NotifyRowResult
}

export type NotifySwitchSample = {
  iteration: number
  fromChatId: string
  toChatId: string
  changed: boolean
  deltaGlobal: number
  deltaNavigation: number
  deltaChatList: number
}

export type NotifySwitchDetails = {
  kind: 'role' | 'group' | 'workspace'
  targetId: string
  activeChatId: string
  otherChatId: string
  candidateIds: string[]
  iterations: number
  samples: NotifySwitchSample[]
  restored: boolean | null
  skippedReason: string
}

export type NotifyScopeVersion = {
  before: number
  after: number
  delta: number
}

export type NotifyScopeDetails = {
  snapshots: Partial<Record<NotifyScopeScenario, Record<RenderProbeId, number>>>
  versions: Partial<Record<NotifyScopeScenario, NotifyScopeVersion>>
}

export type NotifyRunDetails = {
  scenario: NotifyScenario
  iterations: number
  settleMs: number
  switch?: NotifySwitchDetails
  scope?: NotifyScopeDetails
  error?: string
}

export type NotifyRunReport = {
  ok: boolean
  startedAt: number
  finishedAt: number
  rows: NotifyDiagnosticRow[]
  details: NotifyRunDetails
}

export type NotifyRunOptions = {
  scenario?: NotifyScenario
  iterations?: number
  settleMs?: number
}

export type NotifyDiagnosticsDeps = {
  controller: {
    getState: () => any
    getSnapshot: () => number
    getScopeVer: (scope: string) => number
    emitScope: (scope: string) => void
    actions?: Record<string, any>
  }
}

export type NotifyDiagnostics = {
  help: () => void
  run: (options?: NotifyRunOptions) => Promise<NotifyRunReport>
  report: () => NotifyRunReport | null
  surfaceCounts: () => RenderProbeSnapshot
}

export type NotifyTargetDescriptor = {
  kind: 'role' | 'group' | 'workspace'
  targetId: string
  box: any
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), Math.max(1, ms))
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  return (async () => {
    const deadline = Date.now() + Math.max(1, Math.min(3000, timeoutMs))
    while (Date.now() < deadline) {
      if (check()) return true
      await delay(25)
    }
    return check()
  })()
}

function waitOneFrame(timeoutMs = FRAME_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(finish, Math.max(1, Math.min(3000, timeoutMs)))
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish)
    else setTimeout(finish, 0)
  })
}

export function normalizeNotifyScenario(value: unknown): NotifyScenario {
  const scenario = text(value).toLowerCase()
  return scenario === 'switch' || scenario === 'scope' ? scenario : 'all'
}

export function normalizeNotifyIterations(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_ITERATIONS
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_ITERATIONS
  return Math.max(1, Math.min(MAX_ITERATIONS, parsed))
}

// activeChatId 变化后的结算窗口：给正文加载、列表更新等异步副作用留出落地时间。
export function normalizeSwitchSettleMs(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_SWITCH_SETTLE_MS
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_SWITCH_SETTLE_MS
  return Math.max(0, Math.min(MAX_SWITCH_SETTLE_MS, parsed))
}

// 会话列表的唯一候选来源：已列出的 meta 与已加载的 chat 合并去重。
// 诊断只使用这里返回的既有会话，绝不创建新会话。
export function collectChatIds(box: any): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const list of [box?.chatMetas, box?.chats]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const id = text(item?.id)
      if (!id || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

export function resolveNotifyTarget(state: any): NotifyTargetDescriptor {
  const draft = state?.draft || {}
  const ui = state?.data?.ui || {}
  const kindRaw = text(draft.activeTargetKind || ui.activeTargetKind || 'role')
  const kind: NotifyTargetDescriptor['kind'] =
    kindRaw === 'group' || kindRaw === 'workspace' ? kindRaw : 'role'
  if (kind === 'group') {
    const targetId = text(draft.activeGroupId || ui.activeGroupId)
    return { kind, targetId, box: state?.data?.chatsByGroup?.[targetId] || null }
  }
  if (kind === 'workspace') {
    const targetId = workspaceRoleTargetId(
      text(draft.activeWorkspaceId || ui.activeWorkspaceId),
      text(draft.activeRoleId || ui.activeRoleId),
    )
    return { kind, targetId, box: state?.data?.chatsByWorkspace?.[targetId] || null }
  }
  const targetId = text(draft.activeRoleId || ui.activeRoleId)
  return { kind, targetId, box: state?.data?.chatsByRole?.[targetId] || null }
}

export function readNotifyBox(state: any, kind: NotifyTargetDescriptor['kind'], targetId: string): any {
  if (!targetId) return null
  if (kind === 'group') return state?.data?.chatsByGroup?.[targetId] || null
  if (kind === 'workspace') return state?.data?.chatsByWorkspace?.[targetId] || null
  return state?.data?.chatsByRole?.[targetId] || null
}

// switch 的硬指标：正常完成的切换不得产生全局广播。
// 未完成切换不参与全局预算判定，避免把「没切换」误记成「切换很干净」。
export function evaluateSwitchSample(sample: NotifySwitchSample): NotifyDiagnosticRow[] {
  const prefix = `switch#${sample.iteration}`
  return [
    {
      scenario: 'switch',
      metric: `${prefix}.activeChatChanged`,
      actual: sample.changed ? 'changed' : 'unchanged',
      budget: 'changed',
      result: sample.changed ? 'PASS' : 'FAIL',
    },
    {
      scenario: 'switch',
      metric: `${prefix}.deltaGlobal`,
      actual: sample.deltaGlobal,
      budget: SWITCH_GLOBAL_BUDGET,
      result: !sample.changed ? 'SKIP' : sample.deltaGlobal === SWITCH_GLOBAL_BUDGET ? 'PASS' : 'FAIL',
    },
    {
      scenario: 'switch',
      metric: `${prefix}.deltaNavigation`,
      actual: sample.deltaNavigation,
      budget: 'reported',
      result: 'INFO',
    },
    {
      scenario: 'switch',
      metric: `${prefix}.deltaChatList`,
      actual: sample.deltaChatList,
      budget: 'reported',
      result: 'INFO',
    },
  ]
}

const SCOPE_RELATED_PROBES: Record<NotifyScopeScenario, RenderProbeId[]> = {
  composer: ['composer'],
  settings: ['shell', 'settings'],
  navigation: ['topbar', 'sidebar', 'sessionViewport'],
}

const SCOPE_ZERO_PROBES: Record<NotifyScopeScenario, RenderProbeId[]> = {
  composer: ['topbar', 'sidebar', 'sessionViewport', 'overlay'],
  settings: ['overlay'],
  navigation: ['overlay'],
}

function probeCount(counts: Record<string, number>, id: RenderProbeId) {
  return Number(counts?.[id] || 0)
}

function zeroBudgetRow(scenario: NotifyScopeScenario, id: RenderProbeId, counts: Record<string, number>): NotifyDiagnosticRow {
  const actual = probeCount(counts, id)
  return {
    scenario: 'scope',
    metric: `${scenario}.${id}.renders`,
    actual,
    budget: 0,
    result: actual === 0 ? 'PASS' : 'FAIL',
  }
}

function relatedRenderRow(scenario: NotifyScopeScenario, id: RenderProbeId, counts: Record<string, number>): NotifyDiagnosticRow {
  return {
    scenario: 'scope',
    metric: `${scenario}.${id}.renders`,
    actual: probeCount(counts, id),
    budget: 'reported',
    result: 'INFO',
  }
}

// 正向证据使用 scope 版本增量：范围被真正通知时版本必然前进。
// renderProbe 只用于证明无关 Surface 没有被惊动，不再要求相关 Surface 一定重渲染，
// 因为订阅可能落在 Surface 内部子组件上（例如 composer 由 ChatComposer 订阅）。
export function evaluateScopeIsolation(
  scenario: NotifyScopeScenario,
  counts: Record<string, number>,
  scopeVersionDelta: number,
): NotifyDiagnosticRow[] {
  return [
    {
      scenario: 'scope',
      metric: `${scenario}.scopeVersionDelta`,
      actual: scopeVersionDelta,
      budget: '>0',
      result: scopeVersionDelta > 0 ? 'PASS' : 'FAIL',
    },
    ...SCOPE_RELATED_PROBES[scenario].map((id) => relatedRenderRow(scenario, id, counts)),
    ...SCOPE_ZERO_PROBES[scenario].map((id) => zeroBudgetRow(scenario, id, counts)),
  ]
}

export function isNotifyReportOk(rows: readonly NotifyDiagnosticRow[]): boolean {
  return !rows.some((row) => row.result === 'FAIL')
}

export function installNotifyDiagnostics(deps: NotifyDiagnosticsDeps): NotifyDiagnostics {
  const { controller } = deps
  let lastReport: NotifyRunReport | null = null

  function help() {
    const lines = [
      'notify 诊断：真实会话切换 + scope 渲染隔离测量',
      '',
      '用法：',
      "  __eucliStudioDiagnostics.notify.run({ scenario: 'all' })",
      "  __eucliStudioDiagnostics.notify.run({ scenario: 'switch', iterations: 5 })",
      "  __eucliStudioDiagnostics.notify.run({ scenario: 'switch', settleMs: 400 })",
      "  __eucliStudioDiagnostics.notify.run({ scenario: 'scope' })",
      '  __eucliStudioDiagnostics.notify.report()',
      '  __eucliStudioDiagnostics.notify.surfaceCounts()',
      '',
      '场景：',
      '  switch  在当前 role / group / workspace 的既有会话间真实切换，',
      '          记录全局、navigation、chatList 版本增量；全局增量必须为 0。',
      '          activeChatId 变化后等待结算窗口再读版本，默认 400ms、上限 1500ms。',
      '          会话不足 2 条时 skipped；结束恢复原会话。',
      '  scope   依次发出 composer / settings / navigation 范围通知，',
      '          以 getScopeVer 增量作为正向证据，用 renderProbe 验证无关 Surface；',
      '          overlay 必须为 0，相关 Surface 渲染计数仅作 INFO 报告。',
      '  all     先 switch 后 scope。',
      '  iterations 默认 3，范围 1..50；settleMs 默认 400，范围 0..1500。',
      '',
      '安全边界：不发送消息、不删除会话、不打开或关闭弹层。',
    ]
    console.log(lines.join('\n'))
  }

  function report() {
    return lastReport
  }

  function surfaceCounts() {
    return snapshotRenderProbe()
  }

  function readCurrentState() {
    return controller.getState?.() || {}
  }

  function readActiveChatId(target: NotifyTargetDescriptor) {
    const box = readNotifyBox(readCurrentState(), target.kind, target.targetId)
    return readActiveChatSelection(box)
  }

  function readVersions(target: NotifyTargetDescriptor) {
    return {
      global: Number(controller.getSnapshot?.() ?? 0),
      navigation: Number(controller.getScopeVer?.(refreshScopes.navigation()) ?? 0),
      chatList: Number(controller.getScopeVer?.(refreshScopes.chatList(target.kind, target.targetId)) ?? 0),
    }
  }

  async function requestActiveChat(chatId: string) {
    const action = controller.actions?.setActiveChat
    if (typeof action !== 'function') throw new Error('controller.actions.setActiveChat 不可用')
    await withTimeout(Promise.resolve(action(chatId)), ACTION_TIMEOUT_MS, 'setActiveChat 调用超时')
  }

  async function runSwitch(rows: NotifyDiagnosticRow[], iterations: number, settleMs: number): Promise<NotifySwitchDetails> {
    const target = resolveNotifyTarget(readCurrentState())
    const candidateIds = collectChatIds(target.box)
    const activeChatId = target.targetId ? readActiveChatSelection(target.box) : ''
    const details: NotifySwitchDetails = {
      kind: target.kind,
      targetId: target.targetId,
      activeChatId,
      otherChatId: '',
      candidateIds,
      iterations,
      samples: [],
      restored: null,
      skippedReason: '',
    }

    if (!target.targetId || candidateIds.length < 2) {
      details.skippedReason = !target.targetId ? '当前没有活动目标' : '当前目标下不足 2 条既有会话'
      rows.push({
        scenario: 'switch',
        metric: 'eligibleChats',
        actual: candidateIds.length,
        budget: '>=2',
        result: 'SKIP',
      })
      return details
    }

    const originalChatId = activeChatId || candidateIds[0]
    const otherChatId = candidateIds.find((id) => id !== originalChatId) || ''
    details.activeChatId = originalChatId
    details.otherChatId = otherChatId
    if (!otherChatId) {
      details.skippedReason = '找不到可切换的另一条会话'
      rows.push({ scenario: 'switch', metric: 'eligibleChats', actual: 1, budget: '>=2', result: 'SKIP' })
      return details
    }

    let currentChatId = activeChatId || originalChatId
    if (!activeChatId) {
      try {
        await requestActiveChat(originalChatId)
        const selected = await waitFor(() => readActiveChatId(target) === originalChatId, SWITCH_CHANGE_TIMEOUT_MS)
        if (!selected) throw new Error('建立基线会话超时')
        currentChatId = originalChatId
      } catch (error) {
        details.skippedReason = String((error as any)?.message || error || '建立基线会话失败')
        rows.push({
          scenario: 'switch',
          metric: 'baselineActiveChat',
          actual: details.skippedReason,
          budget: 'selected',
          result: 'FAIL',
        })
        return details
      }
    }

    try {
      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        const desiredChatId = currentChatId === originalChatId ? otherChatId : originalChatId
        const before = readVersions(target)
        let changed = false
        try {
          await requestActiveChat(desiredChatId)
          changed = await waitFor(() => readActiveChatId(target) === desiredChatId, SWITCH_CHANGE_TIMEOUT_MS)
          if (changed) {
            // 结算窗口：给正文加载、列表更新等异步副作用留出落地时间；
            // settleMs 已归一化到 0..1500，不会无限等待。
            await delay(settleMs)
          }
        } catch (error) {
          rows.push({
            scenario: 'switch',
            metric: `switch#${iteration}.invoke`,
            actual: String((error as any)?.message || error || 'setActiveChat 失败'),
            budget: 'no exception',
            result: 'FAIL',
          })
        }

        const after = readVersions(target)
        const sample: NotifySwitchSample = {
          iteration,
          fromChatId: currentChatId,
          toChatId: desiredChatId,
          changed,
          deltaGlobal: after.global - before.global,
          deltaNavigation: after.navigation - before.navigation,
          deltaChatList: after.chatList - before.chatList,
        }
        details.samples.push(sample)
        rows.push(...evaluateSwitchSample(sample))
        if (changed) currentChatId = desiredChatId
      }
    } finally {
      let restored = readActiveChatId(target) === originalChatId
      if (!restored) {
        try {
          await requestActiveChat(originalChatId)
          restored = await waitFor(() => readActiveChatId(target) === originalChatId, SWITCH_CHANGE_TIMEOUT_MS)
        } catch {
          restored = false
        }
      }
      details.restored = restored
      rows.push({
        scenario: 'switch',
        metric: 'restoreOriginalChat',
        actual: restored ? 'restored' : 'not-restored',
        budget: 'restored',
        result: restored ? 'PASS' : 'FAIL',
      })
    }
    return details
  }

  async function runScope(rows: NotifyDiagnosticRow[]): Promise<NotifyScopeDetails> {
    const details: NotifyScopeDetails = { snapshots: {}, versions: {} }
    const scenes: Array<{ scenario: NotifyScopeScenario; scope: string }> = [
      { scenario: 'composer', scope: refreshScopes.composer() },
      { scenario: 'settings', scope: refreshScopes.settings() },
      { scenario: 'navigation', scope: refreshScopes.navigation() },
    ]

    enableRenderProbe()
    try {
      resetRenderProbe()
      if (typeof controller.emitScope !== 'function') {
        rows.push({
          scenario: 'scope',
          metric: 'emitScope',
          actual: 'missing',
          budget: 'available',
          result: 'FAIL',
        })
        return details
      }

      for (const scene of scenes) {
        resetRenderProbe()
        try {
          const beforeVersion = Number(controller.getScopeVer?.(scene.scope) ?? 0)
          controller.emitScope(scene.scope)
          await delay(0)
          await waitOneFrame()
          const afterVersion = Number(controller.getScopeVer?.(scene.scope) ?? 0)
          const version: NotifyScopeVersion = {
            before: beforeVersion,
            after: afterVersion,
            delta: afterVersion - beforeVersion,
          }
          const counts = snapshotRenderProbe().counts
          details.versions[scene.scenario] = version
          details.snapshots[scene.scenario] = { ...counts }
          rows.push(...evaluateScopeIsolation(scene.scenario, counts, version.delta))
        } catch (error) {
          rows.push({
            scenario: 'scope',
            metric: `${scene.scenario}.error`,
            actual: String((error as any)?.message || error || '执行失败'),
            budget: 'no exception',
            result: 'FAIL',
          })
        }
      }
    } finally {
      disableRenderProbe()
      resetRenderProbe()
    }
    return details
  }

  async function run(options?: NotifyRunOptions): Promise<NotifyRunReport> {
    const startedAt = Date.now()
    const scenario = normalizeNotifyScenario(options?.scenario)
    const iterations = normalizeNotifyIterations(options?.iterations)
    const settleMs = normalizeSwitchSettleMs(options?.settleMs)
    const rows: NotifyDiagnosticRow[] = []
    const details: NotifyRunDetails = { scenario, iterations, settleMs }
    const recordError = (label: NotifyRowScenario, error: unknown) => {
      const message = String((error as any)?.message || error || '诊断执行失败')
      details.error = details.error ? `${details.error}; ${label}: ${message}` : `${label}: ${message}`
      rows.push({
        scenario: label,
        metric: `${label}.error`,
        actual: message,
        budget: 'no exception',
        result: 'FAIL',
      })
    }

    try {
      if (scenario === 'switch' || scenario === 'all') {
        try {
          details.switch = await runSwitch(rows, iterations, settleMs)
        } catch (error) {
          recordError('switch', error)
        }
      }
      if (scenario === 'scope' || scenario === 'all') {
        try {
          details.scope = await runScope(rows)
        } catch (error) {
          recordError('scope', error)
        }
      }
    } catch (error) {
      recordError('run', error)
    }

    const report: NotifyRunReport = {
      ok: isNotifyReportOk(rows),
      startedAt,
      finishedAt: Date.now(),
      rows,
      details,
    }
    lastReport = report

    try {
      console.table(rows.map(({ scenario: rowScenario, metric, actual, budget, result }) => ({
        scenario: rowScenario,
        metric,
        actual,
        budget,
        result,
      })))
    } catch {
      // 控制台输出失败不改变诊断结论。
    }
    return report
  }

  const diagnostics: NotifyDiagnostics = { help, run, report, surfaceCounts }
  try {
    const root = ((window as any)[EUCLI_STUDIO_DIAGNOSTICS_KEY] ||= {}) as Record<string, any>
    root.notify = diagnostics
  } catch {
    // 诊断入口安装失败不得影响应用启动。
  }
  return diagnostics
}
