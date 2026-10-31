// 会话切换状态机（纯 reducer）。
//
// 三层事实严格分开：
//   - data：控制器权威。选中哪个会话由 controller 决定，本状态机不持有会话数据。
//   - paint：UI 传感器。可见页只由 PAINTED 事件推进，永不由 SELECT / BODY_READY 推进。
//   - failure：加载失败终态。FAILED 让「永远等不到正文」收敛到可重试的可见状态。
//
// 「正文是否就绪」的唯一事实源是外部的 loadedChatId，本状态机不再重复记录
// （曾经的 bodyReadyKey 与它是同一事实的两次表达，已删除）。
//
// 任何事件都带 seq；seq 不匹配即静默丢弃。因此 A→B→C 快速切换时，
// B 的迟到 PAINTED 不会把可见页拉回 B，可见页从 A 直接跳到 C。

export type SessionSwitchState = {
  seq: number
  selectedKey: string
  visibleKey: string
  // failedKey 非空表示「该目标的正文加载已失败」，且尚无更新的目标顶替。
  // 它是一个终态：必须让 UI 收敛到错误占位 + 重试入口，而不是无限 loading。
  failedKey: string
  // failedReason 是失败原因（展示用）；失败被新目标 / 新尝试覆盖时清空。
  failedReason: string
}

export type SessionSwitchEvent =
  | { type: 'SELECT'; key: string }
  | { type: 'BODY_READY'; key: string; seq: number }
  | { type: 'PAINTED'; key: string; seq: number }
  | { type: 'FAILED'; key: string; seq: number; reason: string }
  | { type: 'RETRY'; key: string }

export function createSessionSwitchState(): SessionSwitchState {
  return { seq: 0, selectedKey: '', visibleKey: '', failedKey: '', failedReason: '' }
}

export function reduceSessionSwitch(state: SessionSwitchState, event: SessionSwitchEvent): SessionSwitchState {
  if (!event || typeof event !== 'object') return state

  if (event.type === 'RETRY') {
    const key = String(event.key || '').trim()
    if (!key) return state
    // 重试是「对同一目标发起新一轮尝试」：序号必须继续前进，绝不能归零。
    // 归零会让上一轮迟到的事件与新一轮撞号，被误认为当前轮。
    // 可见页保持不变：失败不该把用户已经看到的内容顶掉。
    return {
      seq: state.seq + 1,
      selectedKey: key,
      visibleKey: state.visibleKey,
      failedKey: '',
      failedReason: '',
    }
  }

  if (event.type === 'SELECT') {
    const key = String(event.key || '').trim()
    // 空选择不推进任何东西：旧页继续可见，直到新页真正可绘制。
    if (!key || key === state.selectedKey) return state
    return {
      seq: state.seq + 1,
      selectedKey: key,
      visibleKey: state.visibleKey,
      // 换了目标就清掉上一次的失败：失败属于「那个目标」，不跨目标延续。
      failedKey: '',
      failedReason: '',
    }
  }

  const key = String((event as { key?: unknown }).key || '').trim()
  const seq = Math.max(0, Math.floor(Number((event as { seq?: unknown }).seq) || 0))
  // 迟到事件：请求序号已推进，或不是当前选中项，一律丢弃。
  if (!key || seq !== state.seq || key !== state.selectedKey) return state

  if (event.type === 'BODY_READY') {
    // 正文到达说明这次加载成功：清掉同目标的失败标记（重试成功路径）。
    if (!state.failedKey) return state
    return { ...state, failedKey: '', failedReason: '' }
  }

  if (event.type === 'PAINTED') {
    if (state.visibleKey === key && !state.failedKey) return state
    // 画出来即代表这次切换成功收尾。
    return { ...state, visibleKey: key, failedKey: '', failedReason: '' }
  }

  if (event.type === 'FAILED') {
    const reason = String((event as { reason?: unknown }).reason || '').trim()
    if (state.failedKey === key && state.failedReason === reason) return state
    return { ...state, failedKey: key, failedReason: reason }
  }

  return state
}

export function sessionSwitchPending(state: SessionSwitchState): boolean {
  // 失败不是「还在切换」：继续显示进度条会让用户以为系统仍在努力。
  if (state.failedKey && state.failedKey === state.selectedKey) return false
  return !!state.selectedKey && state.selectedKey !== state.visibleKey
}

// 没有旧页可垫底（冷启动首次、上次失败、上次 empty）时，才允许骨架。
export function sessionSwitchNeedsSkeleton(state: SessionSwitchState): boolean {
  return sessionSwitchPending(state) && !state.visibleKey
}

// sessionSwitchFailed 是「当前目标加载失败」的唯一判定点。
export function sessionSwitchFailed(state: SessionSwitchState): boolean {
  return !!state.failedKey && state.failedKey === state.selectedKey
}
