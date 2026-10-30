// 三层超时预算（design-5 契约 2）的前端唯一来源。
//
//   T_transport(内层) < T_transport(外层) < T_interaction
//   box 10s/30s < studio 15s/40s < 前端 20s/45s
//
// 硬约束：
//   1. 前端绝不自己编数字：默认值只在这里，运行期由 healthCheck.timeoutBudget 覆盖；
//   2. 任何一处调用方传入的 timeoutMs 都只是「更短等待的意愿」，绝不越过预算；
//   3. T_work 独立于这三层，只归 box（模型 300s / 流空闲 120s），前端不参与。

export type TimeoutClass = 'interaction' | 'background'

export type TimeoutBudget = {
  interactionMs: number
  backgroundMs: number
}

// 与 backend-go/timeout_budget.go 的 frontend*Timeout 保持同源。
// 这里的默认值只在 healthCheck 尚未到达时使用（首次连接窗口）。
const DEFAULT_BUDGET: TimeoutBudget = {
  interactionMs: 20_000,
  backgroundMs: 45_000,
}

let budget: TimeoutBudget = { ...DEFAULT_BUDGET }

// applyTimeoutBudget 只接受 healthCheck 签发的预算：服务端是唯一权威。
export function applyTimeoutBudget(raw: unknown): TimeoutBudget {
  const source = raw && typeof raw === 'object' ? (raw as any) : null
  const interaction = Number(source?.interactionMs)
  const background = Number(source?.backgroundMs)
  const next: TimeoutBudget = {
    interactionMs: Number.isFinite(interaction) && interaction > 0 ? interaction : DEFAULT_BUDGET.interactionMs,
    backgroundMs: Number.isFinite(background) && background > 0 ? background : DEFAULT_BUDGET.backgroundMs,
  }
  // 预算倒挂是配置错误：快速失败而不是静默修正，否则问题会被藏起来。
  if (next.interactionMs >= next.backgroundMs) {
    throw new Error(`超时预算倒挂：interaction=${next.interactionMs}ms >= background=${next.backgroundMs}ms`)
  }
  budget = next
  return { ...budget }
}

export function currentTimeoutBudget(): TimeoutBudget {
  return { ...budget }
}

export function timeoutForClass(classKind: TimeoutClass): number {
  return classKind === 'background' ? budget.backgroundMs : budget.interactionMs
}

// 读方法集合：与 backend-go/timeout_budget.go 的 methodTimeoutClass 一一对应。
// 前端不做二次发明——任何新增读方法必须同时出现在两端。
const INTERACTION_METHODS = new Set<string>([
  'aiChat.healthCheck',
  'aiChat.storageGet',
  'aiChat.storageGetMany',
  'aiChat.sessionIndex.get',
  'aiChat.sessionSummary.list',
  'aiChat.session.get',
  'aiChat.session.window',
  'aiChat.session.graph',
  'aiChat.setActiveChat',
  'aiChat.imageRead',
  'eucli.config.get',
  'releaseCandidates.list',
  'artifacts.installations',
])

// timeoutClassForNetRequest 按承载的 HTTP 方法/路径判定透传一跳的类别：
// GET 是读（交互），其余是写/命令（后台），`/cancel` 是用户点击的交互命令。
export function timeoutClassForNetRequest(request: unknown): TimeoutClass {
  const raw = request && typeof request === 'object' ? (request as any) : {}
  const verb = String(raw.method || 'GET').toUpperCase()
  const path = String(raw.path || raw.url || '').trim()
  if (path.endsWith('/cancel')) return 'interaction'
  return verb === 'GET' ? 'interaction' : 'background'
}

// resolveTimeoutMs 是前端唯一的超时解析入口。
//
// 它只返回「该类别在预算表里的值」：外层必须严格长于内层
// （studio 15s/40s，box 10s/30s），因此任何调用方传入的更短或更长值
// 都不能改变结果——否则就重新制造了「前端先放弃、studio/box 继续写」的倒挂。
//
// explicit 参数保留只是为了兼容旧调用点，取值不参与决策。
export function resolveTimeoutMs(method: string, params: unknown, explicit?: number): number {
  void explicit
  const classKind = method === 'aiChat.netRequest'
    ? timeoutClassForNetRequest(params)
    : INTERACTION_METHODS.has(method) ? 'interaction' : 'background'
  return timeoutForClass(classKind)
}

// 测试用：重置到默认预算，避免用例之间互相污染。
export function resetTimeoutBudgetForTests() {
  budget = { ...DEFAULT_BUDGET }
}

export const DEFAULT_TIMEOUT_BUDGET = DEFAULT_BUDGET
