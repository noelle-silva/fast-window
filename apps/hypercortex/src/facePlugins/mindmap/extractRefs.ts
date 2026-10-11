import type { NoteRef } from '../../noteRefs'
import { extractMindmapRefs } from './mindmapContent'

/** 思维导图面引用提取：遍历节点文本识别统一占位符。 */
export function extractMindmapFaceRefs(content: string): NoteRef[] {
  return extractMindmapRefs(content)
}
