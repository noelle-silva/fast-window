// 会话 wire 契约的 strict 校验。
//
// studio 后端已经从「第二份会话模型」退化为字节中继，因此**客户端是唯一真解析方**。
// 唯一真解析方必须自己守住契约：形状不对就立刻失败，绝不带着半截数据继续渲染。
//
// schemaVersion 是契约的启用标记：
//   - 存在 → 按 strict 契约逐条校验，任何不变量被破坏都抛错
//   - 缺失 → 业务端尚未升级，按 legacy 载荷放行（不做形状改写）
//
// 这样「前端 strict 校验」与「box 加 schemaVersion」可以各自独立上线，
// 不需要靠一个隐式的跨仓库提交顺序来保证正确性。

export const SESSION_WIRE_SCHEMA_VERSION = 1

export type SessionWireProfile = 'view' | 'edit' | 'full'

export type SessionWireMessage = {
  id: string
  branchId: string
  parentMessageId: string
  createdAt: number
  [key: string]: unknown
}

export type SessionWire = {
  schemaVersion: number
  messages: SessionWireMessage[]
  asyncToolTasks: unknown[]
  [key: string]: unknown
}

export class SessionWireContractError extends Error {
  readonly violations: string[]
  constructor(violations: string[]) {
    super(`会话 wire 契约校验失败：${violations.join('；')}`)
    this.name = 'SessionWireContractError'
    this.violations = violations
  }
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function messageCreatedAt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export type SessionWireValidationOptions = {
  // 窗口分页切片不带会话级字段，因此不要求 asyncToolTasks。
  requireAsyncToolTasks?: boolean
  // 序列首条是否允许没有 parentMessageId。
  //
  // 默认 true：契约明确允许根消息无父（design-4 §决策 2 的契约不变量），
  // 而首窗 ≤ limit 条时**必然**包含根消息 —— 若首条强制有父，
  // 任何短会话（消息数 ≤ limit）都会在首屏被误判为契约违约。
  allowRootWithoutParent?: boolean
}

// isSessionWireV1 判断业务端是否已启用新契约。
// 只有「字段完全缺席」才算 legacy；出现但版本不支持属于契约违约，必须失败。
export function isSessionWireV1(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  return Number((raw as any).schemaVersion) === SESSION_WIRE_SCHEMA_VERSION
}

function hasSchemaVersion(raw: Record<string, unknown>): boolean {
  const value = raw.schemaVersion
  return value !== undefined && value !== null
}

// validateSessionWire 只做校验、不做修复：任何一条不变量被破坏都抛错。
export function validateSessionWire(raw: unknown, options: SessionWireValidationOptions = {}): SessionWire {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  if (!source) throw new SessionWireContractError(['会话文档必须是对象'])

  if (!isSessionWireV1(source)) {
    // schemaVersion 出现过但不匹配：这是明确的契约违约，不是旧版载荷。
    if (hasSchemaVersion(source)) {
      throw new SessionWireContractError([`schemaVersion 不支持：${String(source.schemaVersion)}`])
    }
    return {
      ...source,
      schemaVersion: 0,
      messages: Array.isArray(source.messages) ? (source.messages as SessionWireMessage[]) : [],
      asyncToolTasks: Array.isArray(source.asyncToolTasks) ? source.asyncToolTasks : [],
    }
  }

  const violations: string[] = []
  const rawMessages = source.messages
  if (!Array.isArray(rawMessages)) violations.push('messages 必须是数组')
  const messages = Array.isArray(rawMessages) ? rawMessages : []

  if (options.requireAsyncToolTasks !== false && !Array.isArray(source.asyncToolTasks)) {
    violations.push('asyncToolTasks 缺失')
  }
  validateMessageSequence(messages, options.allowRootWithoutParent !== false, violations)

  if (violations.length) throw new SessionWireContractError(violations)

  return {
    ...source,
    schemaVersion: SESSION_WIRE_SCHEMA_VERSION,
    messages: messages as SessionWireMessage[],
    asyncToolTasks: Array.isArray(source.asyncToolTasks) ? source.asyncToolTasks : [],
  }
}

// validateSessionWindowPage 校验窗口分页：分页切片不承担「整份会话」的会话级不变量。
// /window 是新增端点，没有历史载荷需要兼容，因此一律 strict 校验。
//
// 关键：窗口**必须**允许首条无父。首窗条数 ≤ limit，短会话会把根消息一起带进来；
// 根消息按契约就是无父的。若这里拒绝，所有消息数 ≤ limit 的会话都加载失败。
export function validateSessionWindowPage(raw: unknown): Record<string, any> {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : null
  if (!source) throw new SessionWireContractError(['会话窗口文档必须是对象'])
  if (!Array.isArray(source.messages)) throw new SessionWireContractError(['会话窗口 messages 必须是数组'])
  const violations: string[] = []
  validateMessageSequence(source.messages, true, violations)
  if (violations.length) throw new SessionWireContractError(violations)
  return source
}

// validateMessageSequence 是消息序列不变量的唯一实现：整份会话与窗口分页共用。
function validateMessageSequence(messages: unknown[], allowRootWithoutParent: boolean, violations: string[]) {
  let previousCreatedAt = -Infinity
  let previousId = ''
  messages.forEach((item, index) => {
    const message = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null
    if (!message) {
      violations.push(`messages[${index}] 不是对象`)
      return
    }
    const id = text(message.id)
    if (!id) {
      violations.push(`messages[${index}].id 为空`)
      return
    }
    if (!text(message.branchId)) violations.push(`messages[${index}](${id}).branchId 为空`)

    const parentMessageId = text(message.parentMessageId ?? message.parentMid)
    const parentOptional = index === 0 && allowRootWithoutParent
    if (!parentOptional && !parentMessageId) violations.push(`messages[${index}](${id}).parentMessageId 为空`)

    const createdAt = messageCreatedAt(message.createdAt)
    if (createdAt < previousCreatedAt || (createdAt === previousCreatedAt && id < previousId)) {
      violations.push(`messages[${index}](${id}) 未按 (createdAt,id) 升序`)
    }
    previousCreatedAt = createdAt
    previousId = id

    validateContentProjection(message, id, index, violations)
  })
}

// validateContentProjection 守住「content 与 text parts 不重复表达正文」：
// 两者同时存在且内容一致，说明业务端没有完成投影去重（契约不变量 4）。
// 两者同时存在但内容不一致，说明数据已损坏，必须立刻失败。
function validateContentProjection(message: Record<string, unknown>, id: string, index: number, violations: string[]) {
  const content = typeof message.content === 'string' ? message.content : ''
  const parts = Array.isArray(message.parts) ? message.parts : []
  const textParts = parts.filter((part: any) => part && typeof part === 'object' && text(part.type) === 'text')
  if (!content || !textParts.length) return
  const joined = textParts.map((part: any) => String(part.text ?? '')).join('')
  if (joined === content) violations.push(`messages[${index}](${id}) content 与 text parts 重复`)
  else violations.push(`messages[${index}](${id}) content 与 text parts 不一致`)
}
