// 刷新范围地址：把“哪里变了”变成可比较的字符串标签。
//
// 约定：任何进入范围通道的变化都必须能说清它只该动哪里。
// 目前只开放“某条消息”这一种最小范围；其余变化仍走全局通道。

export const GLOBAL_REFRESH_SCOPE = 'global'

export function messageRefreshScope(mid: unknown) {
  const id = String(mid || '').trim()
  return id ? `message:${id}` : GLOBAL_REFRESH_SCOPE
}
