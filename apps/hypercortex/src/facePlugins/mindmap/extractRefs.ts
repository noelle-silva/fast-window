import { extractRefsFromText, type NoteRef } from '../../noteRefs'

/** 思维导图面引用提取：骨架实现（不做代码区域遮蔽），按真实语言规则替换。 */
export function extractMindmapFaceRefs(content: string): NoteRef[] {
  return extractRefsFromText(content)
}
