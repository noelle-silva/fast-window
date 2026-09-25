import * as React from 'react'
import { Box } from '@mui/material'

import { ensurePreviewClickHandlerOnce } from './ensurePreviewClickHandlerOnce'
import { MarkdownPreviewDialogs } from './MarkdownPreviewDialogs'
import { useMarkdownFaceRuntime } from './useMarkdownFaceRuntime'
import type { FaceReadViewProps } from '../protocol'

/** 文本面阅读态视窗：正文渲染、引用跳转、预览弹窗与媒体播放上报。 */
export function MarkdownReadView({ content, visible, context }: FaceReadViewProps): React.ReactNode {
  const renderRef = React.useRef<HTMLDivElement>(null)
  const { engineRef, preview } = useMarkdownFaceRuntime(context)

  const playbackCleanupRef = React.useRef<(() => void) | null>(null)
  const bindPlaybackReporter = React.useCallback(() => {
    const el = renderRef.current
    playbackCleanupRef.current?.()
    playbackCleanupRef.current = null
    if (!el || !engineRef.current) return
    playbackCleanupRef.current = engineRef.current.bindPlaybackReporter(el, playing => context.onPlayingChange?.(playing))
  }, [context])

  React.useEffect(() => {
    return () => {
      playbackCleanupRef.current?.()
      playbackCleanupRef.current = null
    }
  }, [])

  React.useLayoutEffect(() => {
    const el = renderRef.current
    if (!visible || !el || !engineRef.current) return
    // 渲染前先注入引用索引：布局副作用先于被动副作用执行，新建引擎必须在此拿到索引，
    // 否则首帧会把引用渲染成「不存在的笔记」。
    engineRef.current.noteIndex = context.noteIndexMap
    engineRef.current.renderInto(el, content || '', { onAsyncLayout: bindPlaybackReporter })
    bindPlaybackReporter()
  }, [bindPlaybackReporter, content, context.noteIndexMap, visible])

  React.useEffect(() => {
    const el = renderRef.current
    if (!visible || !el) return
    ensurePreviewClickHandlerOnce(el, { controller: preview.controller, stopPropagation: true })
  }, [content, preview.controller, visible])

  React.useEffect(() => {
    const el = renderRef.current
    if (!visible || !el) return
    const handler = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null
      const link = target?.closest?.('.hc-note-ref') as HTMLElement | null
      if (!link) return
      const targetId = String(link.getAttribute('data-note-id') || '').trim()
      if (!targetId) return
      e.preventDefault()
      const meta = context.getNoteMeta(targetId)
      if (!meta) return
      const faceId = String(link.getAttribute('data-face-id') || '').trim()
      context.onOpenNote(meta, faceId || undefined)
    }
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [content, context, visible])

  return (
    <>
      <Box ref={renderRef} className="hc-render" sx={{ width: '100%', minHeight: 120 }} />
      <MarkdownPreviewDialogs preview={preview} />
    </>
  )
}
