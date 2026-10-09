import { createTextContentStore } from '../content'
import type { FaceViewPlugin } from '../protocol'
import { MindmapContentPreview } from './contentPreview'
import { MindmapEditView } from './editView'
import { extractMindmapFaceRefs } from './extractRefs'
import { MindmapReadView } from './readView'
import { MindmapLeftToolbar, MindmapRightToolbar } from './toolbar'

/** 思维导图面（mindmap）的界面半包。 */
export const mindmapFaceViewPlugin: FaceViewPlugin = {
  kind: 'mindmap',
  defaultViewState: {},
  ReadView: MindmapReadView,
  EditView: MindmapEditView,
  createContentStore: ({ initialContent, savedContent }) => createTextContentStore(initialContent, savedContent ?? initialContent),
  Toolbars: { left: MindmapLeftToolbar, right: MindmapRightToolbar },
  ContentPreview: MindmapContentPreview,
  extractRefs: extractMindmapFaceRefs,
}
