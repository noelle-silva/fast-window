import * as React from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'

import type { NoteMeta, VaultScope } from '../../core'
import type { HyperCortexGateway } from '../../gateway'
import type { HyperCortexNoteManifestV1 } from '../../noteSchema'
import type { HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import { isDraftNoteId } from '../../drafts'
import {
  getFaceDeclaration,
  getFaceViewPlugin,
  resolveFaceLabel,
  type FaceViewContext,
} from '../../facePlugins'
import { resolveFaceSettingValues } from '../../facePlugins/settings'
import { resolveNoteFaceOrder } from '../../facePreferences'

/**
 * 笔记预览面：只读、独立于真实会话地加载笔记包并渲染首个面的阅读视窗。
 * 预览不写入标签页/选中态，点击引用不导航（避免破坏原主区域状态）。
 */
export function NotePreviewSurface(props: {
  gateway: HyperCortexGateway
  scope: VaultScope
  note: NoteMeta
  noteIndexMap: Record<string, { title: string; faceIds?: string[] }>
  allNotesById: Record<string, NoteMeta>
  facePluginGlobalSettings: Record<string, Record<string, unknown>>
  globalFaceKindOrder: readonly string[]
}): React.ReactNode {
  const { gateway, scope, note, noteIndexMap, allNotesById, facePluginGlobalSettings, globalFaceKindOrder } = props
  const noteId = String(note.id || '').trim()
  const dir = String(note.dir || '').trim()
  const isDraft = isDraftNoteId(noteId) || !dir

  const [loading, setLoading] = React.useState(!isDraft)
  const [error, setError] = React.useState<string | null>(null)
  const [manifest, setManifest] = React.useState<HyperCortexNoteManifestV1 | null>(null)
  const [contents, setContents] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (isDraft || !dir) {
      setLoading(false)
      setManifest(null)
      setContents({})
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const loaded = await gateway.notes.loadNoteManifest(scope, dir)
        const faceIds = Object.keys(loaded.faces || {})
        const docs = await Promise.all(
          faceIds.map(id => gateway.notes.loadNoteFace(scope, dir, id).catch(() => null)),
        )
        if (cancelled) return
        const nextContents: Record<string, string> = {}
        faceIds.forEach((id, index) => {
          nextContents[id] = docs[index]?.content ?? ''
        })
        setManifest(loaded)
        setContents(nextContents)
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e || '加载笔记失败'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dir, gateway, isDraft, noteId, scope])

  const orderedFaceIds = React.useMemo(
    () => resolveNoteFaceOrder({ faceOrder: manifest?.faceOrder, faces: manifest?.faces || null, globalKindOrder: globalFaceKindOrder }),
    [globalFaceKindOrder, manifest],
  )
  const activeFaceId = orderedFaceIds[0] || ''
  const activeFace: HyperCortexNoteFaceManifestV2 | undefined = activeFaceId ? manifest?.faces?.[activeFaceId] : undefined
  const plugin = getFaceViewPlugin(String(activeFace?.kind || ''))
  const ReadView = plugin?.ReadView || null
  const declaration = getFaceDeclaration(String(activeFace?.kind || ''))
  const effectiveSettings = React.useMemo(
    () => resolveFaceSettingValues(declaration?.settings, { noteSettings: activeFace?.settings, globalSettings: facePluginGlobalSettings[String(activeFace?.kind || '')] || {} }),
    [activeFace, declaration, facePluginGlobalSettings],
  )

  // 预览视窗的上下文：所有跳转/上传一律无副作用，保证预览不改变任何现场状态。
  const faceViewContext: FaceViewContext = React.useMemo(() => ({
    gateway,
    scope,
    noteIndexMap,
    getNoteMeta: id => allNotesById[id],
    onOpenNote: () => {},
    onPlayingChange: undefined,
    uploadFiles: async () => [],
    onResourcesAdded: () => {},
    settings: effectiveSettings,
    noteSettings: (activeFace?.settings || {}) as Record<string, unknown>,
    globalSettings: facePluginGlobalSettings[String(activeFace?.kind || '')] || {},
    updateSettings: undefined,
  }), [activeFace, allNotesById, effectiveSettings, facePluginGlobalSettings, gateway, noteIndexMap, scope])

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={22} />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Typography color="error" sx={{ fontSize: 13 }}>{error}</Typography>
      </Box>
    )
  }

  if (!activeFace || !ReadView) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Typography sx={{ fontSize: 13, color: 'var(--hc-text-muted)' }}>
          {activeFace ? '该面的类型暂不支持预览' : '这篇笔记还没有内容'}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ width: '100%', minHeight: 0, px: 3, py: 2.5, boxSizing: 'border-box' }}>
      <Typography sx={{ mb: 1.5, fontSize: 22, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>
        {manifest?.title || note.title || '未命名'}
      </Typography>
      <Typography sx={{ mb: 2, fontSize: 12, color: 'var(--hc-text-subtle)' }}>
        {resolveFaceLabel(activeFaceId, manifest?.faces)}
      </Typography>
      <ReadView content={contents[activeFaceId] ?? ''} visible viewState={{}} onViewStateChange={() => {}} context={faceViewContext} />
    </Box>
  )
}
