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
  // 已渲染内容标记：内容未变化时（如切换页面返回、引用索引更新）保留现有 DOM，
  // 避免重建导致正在播放的媒体回到初始状态、滚动位置丢失。
  const renderedContentRef = React.useRef<string | null>(null)

  const playbackCleanupRef = React.useRef<(() => void) | null>(null)
  // 播放上报经 ref 转发：宿主重渲染不重建正文 DOM，也不打断正在播放的媒体。
  const onPlayingChangeRef = React.useRef(context.onPlayingChange)
  React.useEffect(() => {
    onPlayingChangeRef.current = context.onPlayingChange
  }, [context.onPlayingChange])
  const bindPlaybackReporter = React.useCallback(() => {
    const el = renderRef.current
    playbackCleanupRef.current?.()
    playbackCleanupRef.current = null
    if (!el || !engineRef.current) return
    playbackCleanupRef.current = engineRef.current.bindPlaybackReporter(el, playing => onPlayingChangeRef.current?.(playing))
  }, [engineRef])

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
    const next = content || ''
    if (renderedContentRef.current === next) {
      // 内容未变化：仅刷新引用锚点状态，保留媒体播放与滚动位置。
      engineRef.current.refreshNoteRefs(el)
      return
    }
    renderedContentRef.current = next
    engineRef.current.renderInto(el, next, { onAsyncLayout: bindPlaybackReporter })
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
      if (!meta) {
        // 失效引用明确反馈，不静默吞掉点击。
        void context.gateway.host.toast('此笔记不存在')
        return
      }
      if (link.classList.contains('hc-note-ref--face-gone')) {
        void context.gateway.host.toast('引用的面已失效')
        return
      }
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
