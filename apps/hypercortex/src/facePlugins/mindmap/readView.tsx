import * as React from 'react'

import type { FaceReadViewProps } from '../protocol'
import { MindmapCanvas } from './MindmapCanvas'
import { readMindmapSettings } from './mindmapSettings'

/** 思维导图面阅读态视窗：只读导图，节点文本里的引用可点击跳转。 */
export function MindmapReadView({ content, visible, context }: FaceReadViewProps): React.ReactNode {
  const settings = readMindmapSettings(context.settings)
  const updateSettings = context.updateSettings
  const onSelectLayout = updateSettings ? (layout: string) => void updateSettings({ layout }) : undefined
  const onSelectTheme = updateSettings ? (theme: string) => void updateSettings({ theme }) : undefined
  const openRef = React.useCallback(
    (noteId: string, faceId?: string) => {
      const meta = context.getNoteMeta(noteId)
      if (meta) context.onOpenNote(meta, faceId)
    },
    [context],
  )
  const resolveRefTitle = React.useCallback(
    (noteId: string) => context.noteIndexMap[noteId]?.title || noteId,
    [context],
  )
  return (
    <MindmapCanvas
      content={content}
      readonly
      layout={settings.layout}
      theme={settings.theme}
      scale={settings.scale}
      visible={visible}
      onOpenRef={openRef}
      resolveRefTitle={resolveRefTitle}
      onSelectLayout={onSelectLayout}
      onSelectTheme={onSelectTheme}
    />
  )
}
