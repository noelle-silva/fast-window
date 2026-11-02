// UI 刷新中枢：以“范围标签”约束每次刷新的影响域。
//
// 约定：
// - 无范围标签的变化走全局通道（emit/subscribe），保持旧行为。
// - 能说清“只该动哪里”的变化，必须带范围标签（emitScope/subscribeScope），
//   只惊动订阅该范围的组件，不得波及整页。
// - global / 空地址是同一件事：全局通道，不存在“无人监听的 'global' 车道”。
import { GLOBAL_REFRESH_SCOPE } from '../domain/uiRefreshScope'

export type UiCoreSubscriberErrorInfo = {
  source: 'subscriber'
  scope: string
}

export type UiCoreErrorReporter = (error: unknown, info: UiCoreSubscriberErrorInfo) => void

// 默认可观测出口：订阅者异常不静默吞掉。
const defaultReportSubscriberError: UiCoreErrorReporter = (error, info) => {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(`[uiCore] subscriber failed (${info.scope})`, error)
  }
}

type UiCoreOptions = {
  onSubscriberError?: UiCoreErrorReporter
}

export function createUiCore(options?: UiCoreOptions) {
  const reportSubscriberError = options?.onSubscriberError || defaultReportSubscriberError

  let globalVer = 0
  const globalSubs = new Set<() => void>()

  // scope 版本号使用全局单调刻度：
  // 条目会随最后一个订阅者离开而回收，但重新订阅后拿到的版本仍大于旧值。
  let scopeVerTick = 0
  const scopeVers = new Map<string, number>()
  const scopeSubs = new Map<string, Set<() => void>>()

  function normalizeScope(scopeRaw: unknown): string {
    const scope = String(scopeRaw ?? '').trim()
    return !scope || scope === GLOBAL_REFRESH_SCOPE ? GLOBAL_REFRESH_SCOPE : scope
  }

  function notify(subscribers: Set<() => void>, scope: string) {
    // 快照迭代：通知期间发生的订阅/退订不改变本轮通知集合。
    for (const fn of Array.from(subscribers)) {
      try {
        fn()
      } catch (error) {
        reportSubscriberError(error, { source: 'subscriber', scope })
      }
    }
  }

  function emit() {
    globalVer++
    notify(globalSubs, GLOBAL_REFRESH_SCOPE)
  }

  // emitScopes：一次动作声明多个受影响地址，同一地址只通知一次。
  // global 地址归一到全局通道；其余地址各自独立通知。
  function emitScopes(addresses: readonly unknown[]) {
    const targets = new Set<string>()
    for (const address of addresses) targets.add(normalizeScope(address))

    if (targets.delete(GLOBAL_REFRESH_SCOPE)) emit()

    for (const scope of targets) {
      const subs = scopeSubs.get(scope)
      // 没有订阅者的地址不保留版本条目：长会话下不会为已卸载的消息持续增长。
      if (!subs || !subs.size) continue
      scopeVerTick++
      scopeVers.set(scope, scopeVerTick)
      notify(subs, scope)
    }
  }

  function emitScope(scopeRaw: string) {
    emitScopes([scopeRaw])
  }

  function subscribe(fn: () => void) {
    globalSubs.add(fn)
    return () => {
      globalSubs.delete(fn)
    }
  }

  function subscribeScope(scopeRaw: string, fn: () => void) {
    const scope = normalizeScope(scopeRaw)
    if (scope === GLOBAL_REFRESH_SCOPE) return subscribe(fn)
    let subs = scopeSubs.get(scope)
    if (!subs) {
      subs = new Set()
      scopeSubs.set(scope, subs)
    }
    subs.add(fn)
    return () => {
      const set = scopeSubs.get(scope)
      if (!set) return
      set.delete(fn)
      if (set.size) return
      // 最后一个订阅者离开：回收订阅集合与版本条目（版本刻度全局单调）。
      scopeSubs.delete(scope)
      scopeVers.delete(scope)
    }
  }

  const getVer = () => globalVer
  const getScopeVer = (scopeRaw: string) => {
    const scope = normalizeScope(scopeRaw)
    if (scope === GLOBAL_REFRESH_SCOPE) return globalVer
    return scopeVers.get(scope) || 0
  }

  return {
    emit,
    emitScope,
    emitScopes,
    subscribe,
    subscribeScope,
    getVer,
    getScopeVer,
    dispose: () => {
      globalSubs.clear()
      scopeSubs.clear()
      scopeVers.clear()
    },
  }
}
