// 增量 DOM 提交：以「渲染输出的顶层块字符串」为粒度做前缀复用。
//
// 原理：流式内容只会增长，渲染输出的顶层块序列里，除最后一个块外，
// 已经出现的块字符串不会再变化（同一段 Markdown 渲染结果稳定）。
// 因此可以：
//   1. 切分新输出的顶层块，与上一帧缓存的块序列求公共前缀；
//   2. 公共前缀对应的 DOM 节点原地保留（同一对象，已渲染公式与交互不动）；
//   3. 只对发生变化的尾部块做解析与装饰。
// 这样每帧成本只与「新增内容」有关，不再随全文线性增长。
//
// 安全性：块字符串未变 ⇒ 其渲染结果必然未变，复用的是同一份内容，视觉零变化。
// 逐块解析拼接与整体解析的等价性由 blockParseEquivalence 基准守护。

import { splitTopLevelBlocks, commonBlockPrefix } from './topLevelBlocks'

type BlockCacheEntry = {
  blocks: string[]
  // 每个块解析后产生的顶层节点数；用于把「块下标」精确换算成「节点数」。
  nodeCounts: number[]
}

// 每个宿主元素上缓存的上一帧块序列（WeakMap 随节点生命周期回收）。
const blockCache = new WeakMap<HTMLElement, BlockCacheEntry>()

export type CommitResult = {
  changedFrom: number
  addedCount: number
}

// parseBlockInto 把一个顶层块字符串解析后追加到 fragment，返回产生的顶层节点数。
function parseBlockInto(block: string, fragment: DocumentFragment): number {
  const tmp = document.createElement('div')
  tmp.innerHTML = block
  let count = 0
  while (tmp.firstChild) {
    fragment.appendChild(tmp.firstChild)
    count++
  }
  return count
}

// commitHtml 用新 HTML 增量更新 el。
// decorate 只在「新增的尾部片段」挂载前调用，避免每帧全树扫描。
export function commitHtml(el: HTMLElement, nextHtml: string, decorate?: (fragment: DocumentFragment) => void): CommitResult {
  const html = String(nextHtml || '')
  const prev = blockCache.get(el) || { blocks: [], nodeCounts: [] }
  const nextBlocks = splitTopLevelBlocks(html)
  const keep = commonBlockPrefix(prev.blocks, nextBlocks)

  // 保留前 keep 个块对应的节点，丢弃其余。
  let nodesToKeep = 0
  for (let i = 0; i < keep; i++) nodesToKeep += prev.nodeCounts[i] || 0
  while (el.childNodes.length > nodesToKeep) el.removeChild(el.lastChild as Node)

  // 尾部块逐块解析、按序追加，并记录每块产生的节点数。
  const fragment = document.createDocumentFragment()
  const nextCounts = prev.nodeCounts.slice(0, keep)
  for (let i = keep; i < nextBlocks.length; i++) {
    const block = nextBlocks[i]
    if (!block) {
      nextCounts.push(0)
      continue
    }
    nextCounts.push(parseBlockInto(block, fragment))
  }

  const addedCount = fragment.childNodes.length
  if (decorate && addedCount) decorate(fragment)
  el.appendChild(fragment)

  blockCache.set(el, { blocks: nextBlocks, nodeCounts: nextCounts })
  return { changedFrom: keep, addedCount }
}
