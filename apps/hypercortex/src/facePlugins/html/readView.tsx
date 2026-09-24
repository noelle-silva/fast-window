import * as React from 'react'

import type { HyperCortexHtmlFaceDisplayModeV1 } from '../../core'
import { DEFAULT_HTML_FACE_DISPLAY_MODE, HTML_FACE_FIXED_SCALE } from './display'
import type { FaceReadViewProps } from '../protocol'
import { HtmlFaceFullscreenDialog } from './HtmlFaceFullscreenDialog'
import { HtmlFaceIframe } from './HtmlFaceIframe'

function readMode(settings: Record<string, unknown>): HyperCortexHtmlFaceDisplayModeV1 {
  const value = settings.displayMode
  return value === 'natural' || value === 'fit-window' || value === 'fixed-fit' ? value : DEFAULT_HTML_FACE_DISPLAY_MODE
}

function readScale(settings: Record<string, unknown>): number {
  const value = Number(settings.fixedScale)
  return Number.isFinite(value) ? value : HTML_FACE_FIXED_SCALE.default
}

function readNoteScale(noteSettings: Record<string, unknown>): number | null {
  if (noteSettings.fixedScale == null) return null
  const value = Number(noteSettings.fixedScale)
  return Number.isFinite(value) ? value : null
}

/** 网页面阅读态视窗：按生效设置渲染嵌入网页，提供全屏预览与缩放调节。 */
export function HtmlFaceReadView({ content, viewState, onViewStateChange, context }: FaceReadViewProps): React.ReactNode {
  const scaleControlsVisible = viewState.scaleControlsVisible === true
  const fullscreenOpen = viewState.fullscreenOpen === true
  const updateSettings = context.updateSettings
  const onSaveNoteFixedScale = updateSettings
    ? async (scale: number | null) => {
        try {
          await updateSettings({ fixedScale: scale })
          void context.gateway.host.toast('已保存笔记缩放比例')
        } catch (e: any) {
          void context.gateway.host.toast(String(e?.message || e || '保存缩放比例失败'))
        }
      }
    : undefined

  return (
    <>
      <HtmlFaceIframe
        html={content}
        mode={readMode(context.settings)}
        minHeightPx={240}
        fixedScale={readScale(context.settings)}
        noteFixedScale={readNoteScale(context.noteSettings)}
        onSaveNoteFixedScale={onSaveNoteFixedScale}
        scaleControlsVisible={scaleControlsVisible}
      />
      <HtmlFaceFullscreenDialog
        open={fullscreenOpen}
        html={content}
        onClose={() => onViewStateChange({ fullscreenOpen: false })}
      />
    </>
  )
}
