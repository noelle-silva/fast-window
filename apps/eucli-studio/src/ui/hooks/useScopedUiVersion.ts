import * as React from 'react'

// useScopedUiVersion 让组件只订阅某个范围的刷新版本号：
// 该范围被 emitScope 通知时，只有本组件重渲染，不惊动整页。
export function useScopedUiVersion(controller: any, scope: string) {
  const getSnapshot = React.useCallback(() => controller?.getScopeVer?.(scope) ?? 0, [controller, scope])
  const subscribe = React.useCallback((onChange: () => void) => controller?.subscribeScope?.(scope, onChange) ?? (() => {}), [controller, scope])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
