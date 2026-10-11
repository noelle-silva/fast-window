import * as React from 'react'

import type { FaceEditViewProps } from '../protocol'
import { MindmapCanvas } from './MindmapCanvas'
import { readMindmapSettings } from './mindmapSettings'

/** 思维导图面编辑态视窗：内嵌导图编辑器，工具条在画布内悬浮。 */
export function MindmapEditView({ content, visible, onChange, context }: FaceEditViewProps): React.ReactNode {
  const settings = readMindmapSettings(context.settings)
  const updateSettings = context.updateSettings
  const onSelectLayout = updateSettings ? (layout: string) => void updateSettings({ layout }) : undefined
  const onSelectTheme = updateSettings ? (theme: string) => void updateSettings({ theme }) : undefined
  return (
    <MindmapCanvas
      content={content}
      readonly={false}
      layout={settings.layout}
      theme={settings.theme}
      scale={settings.scale}
      visible={visible}
      onContentChange={onChange}
      onSelectLayout={onSelectLayout}
      onSelectTheme={onSelectTheme}
    />
  )
}
