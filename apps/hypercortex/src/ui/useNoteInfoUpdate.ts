import * as React from 'react'
import { type HyperCortexIndexV1, type NoteMeta } from '../core'
import { isDraftNoteId } from '../drafts'
import type { HyperCortexGateway } from '../gateway'

// 笔记信息更新：草稿暂无所在目录时拒绝；真实笔记读 manifest 后经统一通道提交笔记级元数据，内容不动。
// 由中心编排的动作组合段在笔记会话之后、收藏夹动作之前接线。
export function useNoteInfoUpdate(opts: {
  gateway: HyperCortexGateway
  setNoteIndex: React.Dispatch<React.SetStateAction<HyperCortexIndexV1 | null>>
  refreshNoteCardInfo: (meta: NoteMeta) => Promise<void>
}) {
  const { gateway, setNoteIndex, refreshNoteCardInfo } = opts

  return React.useCallback(
    async (note: NoteMeta, patch: { title: string; description: string }) => {
      const dir = String(note.dir || '').trim()
      if (isDraftNoteId(note.id) || !dir) {
        void gateway.host.toast('草稿暂无所在目录（请先保存后再编辑信息）')
        return
      }
      try {
        // 笔记信息更新走统一通道：读 manifest + 提交笔记级元数据，内容不动。
        const loaded = await gateway.notes.loadNoteManifest('library', dir)
        const result = await gateway.notes.saveNoteFaces('library', {
          id: note.id,
          packageDir: dir,
          title: patch.title,
          description: patch.description,
          tags: loaded.tags,
          createdAtMs: loaded.createdAtMs,
          resources: loaded.resources,
          faceKinds: [],
          faces: [],
        })
        setNoteIndex(prev => {
          const current = prev || { version: 1, notes: {} }
          return { ...current, notes: { ...(current.notes || {}), [note.id]: result.meta } }
        })
        void refreshNoteCardInfo(result.meta).catch(() => {})
        void gateway.host.toast('笔记信息已更新')
      } catch (err: any) {
        void gateway.host.toast(`更新笔记信息失败：${String(err?.message || err || '未知错误')}`)
      }
    },
    [gateway, refreshNoteCardInfo],
  )
}
