// 会话正文加载失败的唯一记录点。
//
// 为什么需要它：正文加载失败在多个调用点被 `.catch(() => {})` 吞掉（这是刻意的，
// 单个会话失败不该炸整页）。但「吞掉」不等于「没有失败」——UI 必须能看见它，
// 否则目标会话永远等不到正文，界面就停在「正在打开…」。
//
// 失败属于「一次具体会话的加载尝试」，因此按 kind + targetId + chatId 分格存放：
//   - 并发加载的多个会话各自记录，绝不互相覆盖；
//   - 成功只清空自己这一格，不会抹掉别的会话的失败；
//   - UI 只查询「当前目标会话」那一格，提示不会挂到错误的目标上。
//
// 它是「一次加载尝试」的事实，不是业务数据：不进 meta、不参与持久化。

export type ChatLoadTargetKind = 'role' | 'group' | 'workspace'

export type ChatLoadFailure = {
  kind: ChatLoadTargetKind
  targetId: string
  chatId: string
  reason: string
}

export type ChatLoadFailures = Record<string, ChatLoadFailure>

function normalizeId(value: unknown) {
  return String(value || '').trim()
}

// 一次失败属于「哪个会话」：kind + targetId + chatId 三元组。
// 单格存储会让并发失败互相覆盖，因此键必须完整表达会话身份。
export function chatLoadFailureKey(kind: ChatLoadTargetKind, targetId: unknown, chatId: unknown) {
  return JSON.stringify([kind, normalizeId(targetId), normalizeId(chatId)])
}

// UI 只认「当前目标会话」的失败事实：其它会话的失败与它无关。
export function selectChatLoadFailure(
  failures: ChatLoadFailures | null | undefined,
  kind: ChatLoadTargetKind,
  targetId: unknown,
  chatId: unknown,
): ChatLoadFailure | null {
  return failures?.[chatLoadFailureKey(kind, targetId, chatId)] || null
}

export function createChatLoadFailureTracker(deps: {
  getState: () => any
  emit: () => void
}) {
  const { getState, emit } = deps

  function record(kind: ChatLoadTargetKind, targetId: string, chatId: string, error: unknown) {
    const state = getState()
    if (!state) return
    const reason = String((error as any)?.message || error || '会话加载失败').trim() || '会话加载失败'
    state.chatLoadFailures[chatLoadFailureKey(kind, targetId, chatId)] = {
      kind,
      targetId: normalizeId(targetId),
      chatId: normalizeId(chatId),
      reason,
    }
    emit()
  }

  function clear(kind: ChatLoadTargetKind, targetId: string, chatId: string) {
    const state = getState()
    if (!state) return
    const key = chatLoadFailureKey(kind, targetId, chatId)
    if (!state.chatLoadFailures[key]) return
    delete state.chatLoadFailures[key]
    emit()
  }

  // track 包裹一次正文加载：
  //   - 新一轮尝试开始先作废该会话的旧失败事实（旧结果不再代表本次尝试）；
  //   - 失败记录本次事实并继续向上抛（调用方仍可自行处理）；
  //   - 成功无需再清：开始时已作废，本次尝试没有写回任何失败。
  // 绝不改变原有控制流，也绝不触碰其它会话的失败。
  async function track<T>(kind: ChatLoadTargetKind, targetId: string, chatId: string, run: () => Promise<T>): Promise<T> {
    clear(kind, targetId, chatId)
    try {
      return await run()
    } catch (error) {
      record(kind, targetId, chatId, error)
      throw error
    }
  }

  return { track, record, clear }
}
