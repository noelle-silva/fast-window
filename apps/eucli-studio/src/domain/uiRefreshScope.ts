// 刷新范围地址：把“哪里变了”变成可比较的字符串标签。
//
// 约定：任何进入范围通道的变化都必须能说清它只该动哪里。
// 目前开放“某条消息”“输入区”两种最小范围；其余变化仍走全局通道。

export const GLOBAL_REFRESH_SCOPE = 'global'

// 输入区范围：输入草稿与草稿图片的变化只该动输入区，不惊动整页。
export const COMPOSER_REFRESH_SCOPE = 'composer'

export function messageRefreshScope(mid: unknown) {
  const id = String(mid || '').trim()
  return id ? `message:${id}` : GLOBAL_REFRESH_SCOPE
}
