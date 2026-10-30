// 会话切换状态机（纯 reducer）。
//
// 三层事实严格分开：
//   - data：控制器权威。选中哪个会话由 controller 决定，本状态机不持有会话数据。
//   - paint：UI 传感器。可见页只由 PAINTED 事件推进，永不由 SELECT / BODY_READY 推进。
//   - enhance：纯咨询。BODY_READY 只记录数据就绪，不门控任何渲染。
//
// 任何事件都带 seq；seq 不匹配即静默丢弃。因此 A→B→C 快速切换时，
// B 的迟到 PAINTED 不会把可见页拉回 B，可见页从 A 直接跳到 C。

export type SessionSwitchState = {
  seq: number
  selectedKey: string
  visibleKey: string
  bodyReadyKey: string
}

export type SessionSwitchEvent =
  | { type: 'SELECT'; key: string }
  | { type: 'BODY_READY'; key: string; seq: number }
  | { type: 'PAINTED'; key: string; seq: number }
  | { type: 'RESET' }

export function createSessionSwitchState(): SessionSwitchState {
  return { seq: 0, selectedKey: '', visibleKey: '', bodyReadyKey: '' }
}

export function reduceSessionSwitch(state: SessionSwitchState, event: SessionSwitchEvent): SessionSwitchState {
  if (!event || typeof event !== 'object') return state

  if (event.type === 'RESET') return createSessionSwitchState()

  if (event.type === 'SELECT') {
    const key = String(event.key || '').trim()
    // 空选择不推进任何东西：旧页继续可见，直到新页真正可绘制。
    if (!key || key === state.selectedKey) return state
    return {
      seq: state.seq + 1,
      selectedKey: key,
      visibleKey: state.visibleKey,
      bodyReadyKey: '',
    }
  }

  const key = String((event as { key?: unknown }).key || '').trim()
  const seq = Math.max(0, Math.floor(Number((event as { seq?: unknown }).seq) || 0))
  // 迟到事件：请求序号已推进，或不是当前选中项，一律丢弃。
  if (!key || seq !== state.seq || key !== state.selectedKey) return state

  if (event.type === 'BODY_READY') {
    if (state.bodyReadyKey === key) return state
    return { ...state, bodyReadyKey: key }
  }

  if (event.type === 'PAINTED') {
    if (state.visibleKey === key) return state
    return { ...state, visibleKey: key }
  }

  return state
}

export function sessionSwitchPending(state: SessionSwitchState): boolean {
  return !!state.selectedKey && state.selectedKey !== state.visibleKey
}

// 没有旧页可垫底（冷启动首次、上次失败、上次 empty）时，才允许骨架。
export function sessionSwitchNeedsSkeleton(state: SessionSwitchState): boolean {
  return sessionSwitchPending(state) && !state.visibleKey
}
