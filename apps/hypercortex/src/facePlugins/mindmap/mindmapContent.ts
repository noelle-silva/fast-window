import { extractRefsFromText, type NoteRef } from '../../noteRefs'

/** 导图节点：与前端导图库数据格式对齐（{data:{text},children:[]}）。 */
export type MindmapNode = {
  data?: { text?: string; [key: string]: unknown }
  children?: MindmapNode[]
  [key: string]: unknown
}

/** 严格解析面内容为导图数据；非法内容返回 null。 */
export function tryParseMindmap(content: string): MindmapNode | null {
  try {
    const parsed = JSON.parse(String(content || ''))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as MindmapNode
  } catch {
    return null
  }
  return null
}

/** 单个根节点的空导图。 */
export function emptyMindmap(): MindmapNode {
  return { data: { text: '中心主题' }, children: [] }
}

/** 解析面内容为可渲染的导图数据；非法内容回退为单个根节点。 */
export function parseMindmapForRender(content: string): MindmapNode {
  return tryParseMindmap(content) ?? emptyMindmap()
}

/** 序列化导图数据为面内容字符串。 */
export function serializeMindmap(data: unknown): string {
  return JSON.stringify(data)
}

/** 先根深度遍历导图节点文本。 */
export function walkMindmapTexts(node: MindmapNode | null | undefined, visit: (text: string) => void): void {
  if (!node || typeof node !== 'object') return
  const text = node.data?.text
  if (typeof text === 'string') visit(text)
  for (const child of node.children ?? []) walkMindmapTexts(child, visit)
}

/** 从导图内容提取系统引用（以节点文本为源）。 */
export function extractMindmapRefs(content: string): NoteRef[] {
  const root = tryParseMindmap(content)
  if (!root) return []
  const byKey = new Map<string, NoteRef>()
  walkMindmapTexts(root, text => {
    for (const ref of extractRefsFromText(text)) {
      byKey.set(`${ref.noteId}\u0000${ref.faceId || ''}`, ref)
    }
  })
  return Array.from(byKey.values())
}
