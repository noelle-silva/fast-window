import * as React from 'react'

// useScopedUiVersion 让组件只订阅某个范围的刷新版本号：
// 该范围被 emitScope 通知时，只有本组件重渲染，不惊动整页。
export function useScopedUiVersion(controller: any, scope: string) {
  const getSnapshot = React.useCallback(() => controller?.getScopeVer?.(scope) ?? 0, [controller, scope])
  const subscribe = React.useCallback((onChange: () => void) => controller?.subscribeScope?.(scope, onChange) ?? (() => {}), [controller, scope])
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

