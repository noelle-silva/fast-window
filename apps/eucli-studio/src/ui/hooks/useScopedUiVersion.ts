import * as React from 'react'

const NOOP_SUBSCRIBE = () => () => {}

// useScopedUiVersion 让组件只订阅某个范围的刷新版本号：
// 该范围被 emitScope 通知时，只有本组件重渲染，不惊动整页。
//
// enabled=false 时完全不建立订阅（用于保活页：隐藏页不该继续接收流式刷新）。
// 注意不能用空 scope 代替：空 scope 在订阅层会退化为全局订阅，反而更贵。
export function useScopedUiVersion(controller: any, scope: string, enabled = true) {
  const getSnapshot = React.useCallback(
    () => (enabled ? controller?.getScopeVer?.(scope) ?? 0 : 0),
    [controller, scope, enabled],
  )
  const subscribe = React.useCallback(
    (onChange: () => void) => (enabled ? controller?.subscribeScope?.(scope, onChange) ?? NOOP_SUBSCRIBE() : NOOP_SUBSCRIBE()),
    [controller, scope, enabled],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// useScopedUiVersions 组合订阅多个范围：一次动作命中任意地址都会让本组件重渲染。
//
// 地址列表在渲染期可能是新数组，因此以稳定 key 作为订阅/快照的失效依据；
// enabled=false 时与单地址版本一致，完全不建立订阅。
export function useScopedUiVersions(controller: any, scopes: readonly string[], enabled = true) {
  const key = scopes.join('\n')
  const getSnapshot = React.useCallback(() => {
    if (!enabled) return ''
    return key
      .split('\n')
      .filter(Boolean)
      .map((scope) => String(controller?.getScopeVer?.(scope) ?? 0))
      .join(':')
  }, [controller, key, enabled])
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (!enabled) return NOOP_SUBSCRIBE()
      const addresses = key.split('\n').filter(Boolean)
      if (!addresses.length) return NOOP_SUBSCRIBE()
      const unsubscribes = addresses.map(
        (scope) => controller?.subscribeScope?.(scope, onChange) ?? NOOP_SUBSCRIBE(),
      )
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe()
      }
    },
    [controller, key, enabled],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// useUiDataVersion 让被 memo 隔离的组件订阅“全局数据版本”：
// 数据变化（全局 emit）时本组件仍会重渲染并读到最新数据；
// 而父级的纯本地 UI 变化（开弹层、搜索打字等）不会通过 memo，组件不重绘。
export function useUiDataVersion(controller: any) {
  const getSnapshot = React.useCallback(() => controller?.getSnapshot?.() ?? 0, [controller])
  const subscribe = React.useCallback((onChange: () => void) => controller?.subscribe?.(onChange) ?? (() => {}), [controller])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
