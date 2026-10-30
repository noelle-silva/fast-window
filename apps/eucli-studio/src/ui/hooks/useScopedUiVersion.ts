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

// useUiDataVersion 让被 memo 隔离的组件订阅“全局数据版本”：
// 数据变化（全局 emit）时本组件仍会重渲染并读到最新数据；
// 而父级的纯本地 UI 变化（开弹层、搜索打字等）不会通过 memo，组件不重绘。
export function useUiDataVersion(controller: any) {
  const getSnapshot = React.useCallback(() => controller?.getSnapshot?.() ?? 0, [controller])
  const subscribe = React.useCallback((onChange: () => void) => controller?.subscribe?.(onChange) ?? (() => {}), [controller])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
