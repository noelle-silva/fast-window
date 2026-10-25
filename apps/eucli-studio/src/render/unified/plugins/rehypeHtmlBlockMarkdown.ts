import { visit } from 'unist-util-visit'
import { renderHtmlBlockTextMarkdown } from '../htmlBlockMarkdown'

// HTML 块内子排版插件（rehype 层）：
// 必须排在「占位符还原」之后、rehype-raw 之前——此时块内容还是 raw 字符串，
// 标签结构尚未展开，正好只加工标签之间的文本片段。
export function rehypeHtmlBlockMarkdown() {
  return (tree: any) => {
    visit(tree, 'raw', (node: any) => {
      node.value = renderHtmlBlockTextMarkdown(String(node.value || ''))
    })
  }
}
