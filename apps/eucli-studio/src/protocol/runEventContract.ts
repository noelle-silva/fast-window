// 运行事件契约。
//
// 运行身份（runId）的唯一来源是事件信封的 `runId` 字段。
// payload 里的 `id` 属于各自的命名空间：消息 id、工具计划 id、事件 id。
// 它们永远不能作为运行身份的候选来源——历史故障正是「消息 id 被当成运行 id
// 建卡」，于是真实终态按 runId 收敛时找不到那张卡，停止按钮与尾部占位永久残留。
//
// 本模块把这条契约表达成可执行判定：
//   - 只有生命周期事件（启动 / 重试 / 终态）能决定运行的生死；
//   - 只有「载荷自证为本次运行的状态快照」时才允许合并进运行状态；
//   - 内容事件只表示「有活动」，绝不携带运行状态。

export type RunEventEnvelope = {
  // 事件 id：仅用于去重与日志，不参与运行身份。
  id: string
  // 运行 id：唯一的运行身份来源。
  runId: string
  type: string
  payload: unknown
}

export type RunStateSnapshot = {
  id: string
  roleId: string
  groupId: string
  workspaceId: string
  sessionId: string
  inputMessageId: string
  lastMessageId: string
  dependencyMessageIds: string[]
  stream: boolean
  status: string
  reason: string
  retry: unknown
  error: unknown
}

// 生命周期事件：一次运行的生死只由这组事件决定。
const LIFECYCLE_RUN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'run_started',
  'run_retrying',
  'run_completed',
  'run_failed',
  'run_cancelled',
  // 中间层与部分历史载荷使用单 l 拼写，契约层统一收口。
  'run_canceled',
])

const TERMINAL_RUN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'run_completed',
  'run_failed',
  'run_cancelled',
  'run_canceled',
])

function text(value: unknown) {
  return String(value ?? '').trim()
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object'
}

function textList(value: unknown) {
  const list = Array.isArray(value) ? value : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const id = text(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function isLifecycleRunEventType(value: unknown) {
  return LIFECYCLE_RUN_EVENT_TYPES.has(text(value))
}

export function isTerminalRunEventType(value: unknown) {
  return TERMINAL_RUN_EVENT_TYPES.has(text(value))
}

// readRunEventEnvelope 只认信封：没有 runId 的事件不构成运行事实，直接丢弃。
export function readRunEventEnvelope(raw: unknown): RunEventEnvelope | null {
  const event = isObject(raw) ? raw : null
  if (!event) return null
  const runId = text(event.runId)
  const type = text(event.type)
  if (!runId || !type) return null
  return { id: text(event.id), runId, type, payload: event.payload }
}

// readRunLifecycleSnapshot 是「运行状态快照」的唯一认读口。
//
// 准入条件是载荷自证身份：payload.id 必须等于信封 runId。
// 不带 id（内容事件）、或 id 属于别的命名空间（消息 id / 工具计划 id）一律拒绝。
// 这不是兜底，而是快照必须证明自己属于本次运行的准入条件：
// 宁可这一帧不提供状态，也绝不把别的实体的编号写进运行身份。
export function readRunLifecycleSnapshot(runIdRaw: unknown, payloadRaw: unknown): RunStateSnapshot | null {
  const runId = text(runIdRaw)
  const payload = isObject(payloadRaw) ? payloadRaw : null
  if (!runId || !payload) return null
  if (text(payload.id) !== runId) return null
  const status = text(payload.status)
  if (!status) return null
  return {
    id: runId,
    roleId: text(payload.roleId),
    groupId: text(payload.groupId),
    workspaceId: text(payload.workspaceId),
    sessionId: text(payload.sessionId),
    inputMessageId: text(payload.inputMessageId),
    lastMessageId: text(payload.lastMessageId),
    dependencyMessageIds: textList(payload.dependencyMessageIds),
    stream: !!payload.stream,
    status,
    reason: text(payload.reason),
    retry: payload.retry,
    error: payload.error,
  }
}
