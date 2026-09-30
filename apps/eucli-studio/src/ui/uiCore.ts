// UI 刷新中枢：以“范围标签”约束每次刷新的影响域。
//
// 约定：
// - 无范围标签的变化走全局通道（emit/subscribe），保持旧行为。
// - 能说清“只该动哪里”的变化，必须带范围标签（emitScope/subscribeScope），
//   只惊动订阅该范围的组件，不得波及整页。
export function createUiCore() {
  let globalVer = 0
  const globalSubs = new Set<() => void>()
  const scopeVers = new Map<string, number>()
  const scopeSubs = new Map<string, Set<() => void>>()

  function notify(subs: Set<() => void>) {
    for (const fn of subs) {
      try {
        fn()
      } catch (_) {}
    }
  }

  function emit() {
    globalVer++
    notify(globalSubs)
  }

  function emitScope(scopeRaw: string) {
    const scope = String(scopeRaw || '').trim()
    if (!scope) {
      emit()
      return
    }
    scopeVers.set(scope, (scopeVers.get(scope) || 0) + 1)
    const subs = scopeSubs.get(scope)
    if (subs) notify(subs)
  }

  function subscribe(fn: () => void) {
    globalSubs.add(fn)
    return () => {
      globalSubs.delete(fn)
    }
  }

  function subscribeScope(scopeRaw: string, fn: () => void) {
    const scope = String(scopeRaw || '').trim()
    if (!scope) return subscribe(fn)
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
      if (!set.size) scopeSubs.delete(scope)
    }
  }

  const getVer = () => globalVer
  const getScopeVer = (scopeRaw: string) => scopeVers.get(String(scopeRaw || '').trim()) || 0

  return {
    emit,
    emitScope,
    subscribe,
    subscribeScope,
    getVer,
    getScopeVer,
    dispose: () => {
      globalSubs.clear()
      scopeSubs.clear()
    },
  }
}
