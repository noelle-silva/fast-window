import { createTextContentStore } from '../content'
import type { FaceViewPlugin } from '../protocol'
import { MindmapContentPreview } from './contentPreview'
import { MindmapEditView } from './editView'
import { extractMindmapFaceRefs } from './extractRefs'
import { MindmapReadView } from './readView'

/** 思维导图面（mindmap）的界面半包；工具条在画布内，不占用宿主顶栏插槽。 */
export const mindmapFaceViewPlugin: FaceViewPlugin = {
  kind: 'mindmap',
  defaultViewState: {},
  stageLayout: 'fill',
  ReadView: MindmapReadView,
  EditView: MindmapEditView,
  createContentStore: ({ initialContent, savedContent }) => createTextContentStore(initialContent, savedContent ?? initialContent),
  ContentPreview: MindmapContentPreview,
  extractRefs: extractMindmapFaceRefs,
}
