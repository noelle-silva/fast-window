import * as React from 'react'
import { InputBase } from '@mui/material'

import { buildAssetMarkerBlock, formatAssetMarkerInsertion } from '../../assetMarker'
import { HyperCodeMirrorEditor as BlockEditor } from './HyperCodeMirrorEditor'
import { filesFromClipboardData } from '../../services/pastedAssetUpload'
import { ensureLiveEditorPreviewButton } from './ensureLiveEditorPreviewButton'
import { MarkdownPreviewDialogs } from './MarkdownPreviewDialogs'
import { useMarkdownFaceRuntime } from './useMarkdownFaceRuntime'
import type { FaceEditViewProps } from '../protocol'

/** 文本面编辑态视窗：Live / 源码两种编辑模式、粘贴附件上传与预览。 */
export function MarkdownEditView({ content, visible, onChange, viewState, context }: FaceEditViewProps): React.ReactNode {
  const [uploading, setUploading] = React.useState(false)
  const uploadingRef = React.useRef(false)

  const { engine, engineRef, preview } = useMarkdownFaceRuntime(context)

  const onPlayingChangeRef = React.useRef(context.onPlayingChange)
  React.useEffect(() => {
    onPlayingChangeRef.current = context.onPlayingChange
  }, [context.onPlayingChange])

  /** 编辑器覆盖层渲染完 block 后：等待异步媒体就绪，完成后请求重新布局 */
  const handleBlockRendered = React.useCallback((el: HTMLElement, requestUpdate: () => void) => {
    ensureLiveEditorPreviewButton(el, {
      controller: preview.controller,
      getRoot: (current) => current.closest('.cm-editor'),
    })

    const pending: { el: HTMLElement; event: string }[] = []
    el.querySelectorAll('img').forEach(img => {
      if (!img.complete) pending.push({ el: img, event: 'load' })
    })
    el.querySelectorAll('video').forEach(vid => {
      if (vid.readyState < 1) pending.push({ el: vid, event: 'loadedmetadata' })
    })
    const cleanupPlaybackReporter = engineRef.current?.bindPlaybackReporter(el, playing => onPlayingChangeRef.current?.(playing))
    if (!pending.length) return cleanupPlaybackReporter

    let remaining = pending.length
    const done = () => { if (--remaining <= 0) requestUpdate() }
    pending.forEach(({ el: m, event }) => {
      m.addEventListener(event, done, { once: true })
      m.addEventListener('error', done, { once: true })
    })
    return cleanupPlaybackReporter
  }, [preview.controller])

  const handlePasteFiles = React.useCallback(async (files: File[], insertText: (text: string) => void) => {
    if (uploadingRef.current) {
      void context.gateway.host.toast('已有附件正在上传，请稍后再粘贴')
      return
    }
    uploadingRef.current = true
    setUploading(true)
    try {
      const resources = await context.uploadFiles(files)
      const markerBlock = buildAssetMarkerBlock(resources)
      if (!markerBlock) throw new Error('附件上传成功，但没有生成可插入的引用占位符')
      context.onResourcesAdded(resources)
      insertText(markerBlock)
      void context.gateway.host.toast(resources.length > 1 ? `已上传 ${resources.length} 个附件并插入占位符` : '已上传附件并插入占位符')
    } catch (err: any) {
      void context.gateway.host.toast(`粘贴附件失败：${String(err?.message || err || '未知错误')}`)
    } finally {
      uploadingRef.current = false
      setUploading(false)
    }
  }, [context])

  const handleSourcePaste = React.useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = filesFromClipboardData(event.clipboardData)
    if (!files.length) return
    event.preventDefault()
    // 与迁移前一致：以当前输入控件的选区为准，取不到时退回到末尾插入。
    const target = event.currentTarget as unknown as HTMLTextAreaElement
    const from = target.selectionStart ?? content.length
    const to = target.selectionEnd ?? from
    const insertText = (text: string) => {
      const insert = String(text || '')
      if (!insert) return
      onChange(`${content.slice(0, from)}${formatAssetMarkerInsertion(insert, content.slice(0, from), content.slice(to))}${content.slice(to)}`)
    }
    void handlePasteFiles(files, insertText)
  }, [content, handlePasteFiles, onChange])

  const mode = viewState.mode === 'source' ? 'source' : 'live'

  const dialogs = <MarkdownPreviewDialogs preview={preview} />

  if (mode === 'source') {
    return (
      <>
        <InputBase
          value={content}
          onChange={e => onChange(e.target.value)}
          onPaste={handleSourcePaste}
          placeholder="开始编辑正文..."
          fullWidth
          multiline
          minRows={18}
          inputProps={{ 'aria-label': '编辑 Markdown 正文源码', spellCheck: false }}
          sx={{
            width: '100%',
            alignItems: 'flex-start',
            fontSize: 14,
            lineHeight: 1.7,
            color: '#1f2937',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            '& textarea': { padding: 0, resize: 'none' },
          }}
        />
        {dialogs}
      </>
    )
  }

  return (
    <>
      <BlockEditor
        value={content}
        onChange={onChange}
        placeholder={uploading ? '正在上传粘贴的附件...' : '开始编辑正文...'}
        minHeight={400}
        onBlockRendered={handleBlockRendered}
        active={visible}
        refreshToken={context.noteIndexMap}
        noteIndexMap={context.noteIndexMap}
        engine={engine}
        writeClipboardText={context.gateway.clipboard.writeText}
        showToast={context.gateway.host.toast}
        onPasteFiles={handlePasteFiles}
      />
      {dialogs}
    </>
  )
}
