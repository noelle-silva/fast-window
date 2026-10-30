// 会话正文加载失败的唯一记录点。
//
// 为什么需要它：正文加载失败在多个调用点被 `.catch(() => {})` 吞掉（这是刻意的，
// 单个会话失败不该炸整页）。但「吞掉」不等于「没有失败」——UI 必须能看见它，
// 否则目标会话永远等不到正文，界面就停在「正在打开…」。
//
// 因此这里把「失败事实」收敛成一个显式的状态格：
//   - 只有正文加载失败才写它（不写网络错误以外的猜测原因）；
//   - 任何一次成功加载都会清空它；
//   - UI 读取它并交给 sessionSwitch 状态机进入 FAILED 终态。
//
// 它是「一次加载尝试」的事实，不是业务数据：不进 meta、不参与持久化。

export type ChatLoadTargetKind = 'role' | 'group' | 'workspace'

export type ChatLoadFailure = {
  kind: ChatLoadTargetKind
  targetId: string
  chatId: string
  reason: string
}

export function emptyChatLoadFailure(): ChatLoadFailure {
  return { kind: 'role', targetId: '', chatId: '', reason: '' }
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
    state.chatLoadError = {
      kind,
      targetId: String(targetId || '').trim(),
      chatId: String(chatId || '').trim(),
      reason,
    }
    emit()
  }

  function clear() {
    const state = getState()
    if (!state) return
    const current = state.chatLoadError as ChatLoadFailure | null
    if (!current || !current.chatId) return
    state.chatLoadError = emptyChatLoadFailure()
    emit()
  }

  // track 包裹一次正文加载：失败记录事实并继续向上抛（调用方仍可自行处理），
  // 成功则清空失败格。绝不改变原有控制流。
  async function track<T>(kind: ChatLoadTargetKind, targetId: string, chatId: string, run: () => Promise<T>): Promise<T> {
    try {
      const value = await run()
      clear()
      return value
    } catch (error) {
      record(kind, targetId, chatId, error)
      throw error
    }
  }

  return { track, record, clear }
}
