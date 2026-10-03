import * as React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import type { HyperCortexWorkspaceV1 } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { AssetEntry } from '../assetTypes'
import { assetRefKey, assetTabId } from '../assetTypes'
import type { TabKey } from '../tabKey'
import { deriveSidebarFields, insertTabAsUngrouped, type SidebarItem } from './sidebarModel'
import type { PageId } from './workspacePages'

// 附件索引、附件会话与附件实体操作：资产池索引状态、打开的附件标签会话、播放状态与清理、
// 附件元数据更新、附件标签打开与更新、附件实体删除确认与执行、附件恢复。
// 页面导航与工作区接线由中心文件经显式入参/回调 ref 连接。

export function assetKeyFromResource(resource: { assetId?: string; ext?: string }): string {
  const assetId = String(resource?.assetId || '').trim()
  const ext = String(resource?.ext || '').trim().toLowerCase().replace(/^\./, '')
  return assetId ? (ext ? `${assetId}.${ext}` : assetId) : ''
}

export const ASSET_UPLOAD_WAIT_INTERVAL_MS = 500

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

type Params = {
  visible: boolean
  gateway: HyperCortexGateway
  openTabKeys: TabKey[]
  activeTabKeyRef: React.MutableRefObject<TabKey>
  pageRef: React.MutableRefObject<PageId>
  setDetailSelectionSource: React.Dispatch<React.SetStateAction<'tabs' | 'favorites'>>
  setActiveTabKey: React.Dispatch<React.SetStateAction<TabKey>>
  setActiveNoteId: React.Dispatch<React.SetStateAction<string>>
  recordNewNavLocation: (entry: { page: PageId; tabKey?: string }) => void
  navigatePage: (next: PageId, opts?: { recordHistory?: boolean }) => void
  commitActiveWorkspacePatchRef: React.MutableRefObject<(patch: { activeTabKey: string }) => void>
  updateSidebarItemsRef: React.MutableRefObject<
    (
      updater: (prev: SidebarItem[]) => SidebarItem[],
      patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>,
    ) => void
  >
  closeTabKeysDirectRef: React.MutableRefObject<(tabKeys: string[]) => void>
}

export function useAssetPoolSessions(params: Params) {
  const {
    visible,
    gateway,
    openTabKeys,
    activeTabKeyRef,
    pageRef,
    setDetailSelectionSource,
    setActiveTabKey,
    setActiveNoteId,
    recordNewNavLocation,
    navigatePage,
    commitActiveWorkspacePatchRef,
    updateSidebarItemsRef,
    closeTabKeysDirectRef,
  } = params

  const [assetPoolIndex, setAssetPoolIndex] = React.useState<Record<string, any> | null>(null)
  const [openAssetTabs, setOpenAssetTabs] = React.useState<AssetEntry[]>([])
  const [playingTabKeys, setPlayingTabKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const [assetEntityDeleteTarget, setAssetEntityDeleteTarget] = React.useState<AssetEntry | null>(null)
  const [assetEntityDeleting, setAssetEntityDeleting] = React.useState(false)

  const setTabPlaying = React.useCallback((tabKey: string, playing: boolean) => {
    const key = String(tabKey || '').trim()
    if (!key) return
    setPlayingTabKeys(prev => {
      if (prev.has(key) === playing) return prev
      const next = new Set(prev)
      if (playing) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  React.useEffect(() => {
    const openKeys = new Set(openTabKeys)
    setPlayingTabKeys(prev => {
      let changed = false
      const next = new Set<string>()
      for (const key of prev) {
        if (!openKeys.has(key)) {
          changed = true
          continue
        }
        next.add(key)
      }
      return changed ? next : prev
    })
  }, [openTabKeys])

  const handleUpdateAssetInfo = React.useCallback(
    async (asset: AssetEntry, patch: { displayName: string; remark: string }) => {
      try {
        await gateway.assets.updateAssetMetadata('library', asset.assetId, asset.ext, {
          displayName: patch.displayName,
          remark: patch.remark,
          tags: asset.tags || [],
        })
        setAssetPoolIndex(prev => {
          if (!prev || typeof prev !== 'object') return prev
          const key = asset.ext ? `${asset.assetId}.${asset.ext}` : asset.assetId
          return {
            ...(prev as any),
            assets: {
              ...((prev as any).assets || {}),
              [key]: { ...((prev as any).assets?.[key] || {}), displayName: patch.displayName, remark: patch.remark },
            },
          }
        })
        void gateway.host.toast('附件信息已更新')
      } catch (err: any) {
        void gateway.host.toast(`更新附件信息失败：${String(err?.message || err || '未知错误')}`)
      }
    },
    [gateway],
  )

  const handleOpenAssetTab = React.useCallback(
    (asset: AssetEntry, source: 'tabs' | 'favorites' = 'tabs', opts?: { recordHistory?: boolean }) => {
      setDetailSelectionSource(source)
      const sanitized: AssetEntry = { ...asset, thumbnailUrl: undefined }
      const tabKey = assetTabId(sanitized) as TabKey
      const prevActiveKey = String(activeTabKeyRef.current || '').trim()
      const recordHistory = opts?.recordHistory !== false
      if (recordHistory && (pageRef.current === 'note-detail' || pageRef.current === 'asset-detail') && prevActiveKey && prevActiveKey !== tabKey) {
        recordNewNavLocation({ page: pageRef.current, tabKey: prevActiveKey })
      }
      setOpenAssetTabs(prev => {
        const idx = prev.findIndex(a => assetTabId(a) === tabKey)
        if (idx >= 0) {
          const next = prev.slice()
          next[idx] = sanitized
          return next
        }
        return [...prev, sanitized]
      })
      setActiveTabKey(tabKey)
      setActiveNoteId('')
      // 来源为右侧收藏夹时不改动左侧列表：仅切换详情目标并持久化目标键。
      if (source === 'tabs') {
        updateSidebarItemsRef.current(prev => (deriveSidebarFields(prev).openTabKeys.includes(tabKey) ? prev : insertTabAsUngrouped(prev, tabKey, prev.length)), { activeTabKey: tabKey })
      } else {
        commitActiveWorkspacePatchRef.current({ activeTabKey: tabKey })
      }
      navigatePage('asset-detail', { recordHistory })
    },
    [commitActiveWorkspacePatchRef, navigatePage, recordNewNavLocation, updateSidebarItemsRef],
  )

  const handleAssetTabUpdated = React.useCallback((asset: AssetEntry) => {
    const tabKey = assetTabId(asset)
    setOpenAssetTabs(prev => prev.map(item => (assetTabId(item) === tabKey ? { ...asset, thumbnailUrl: item.thumbnailUrl } : item)))
    setAssetPoolIndex(prev => {
      if (!prev || typeof prev !== 'object') return prev
      const key = asset.ext ? `${asset.assetId}.${asset.ext}` : asset.assetId
      return { ...(prev as any), assets: { ...((prev as any).assets || {}), [key]: { ...asset, path: asset.relPath } } }
    })
  }, [])

  const handleDeleteAssetEntity = React.useCallback(
    async (asset: AssetEntry) => {
      const assetId = String(asset?.assetId || '').trim()
      if (!assetId) return
      try {
        await gateway.trash.moveAssetToTrash('library', assetId, asset.ext)
        const tabKey = assetTabId(asset)
        closeTabKeysDirectRef.current([tabKey])
        setAssetPoolIndex(prev => {
          if (!prev || typeof prev !== 'object') return prev
          const assets = { ...((prev as any).assets || {}) }
          delete assets[asset.ext ? `${assetId}.${asset.ext}` : assetId]
          return { ...(prev as any), assets }
        })
        void gateway.host.toast('附件已移入回收站')
      } catch (e: any) {
        void gateway.host.toast(String(e?.message || e || '删除附件失败'))
      }
    },
    [gateway],
  )

  const requestDeleteAssetEntity = React.useCallback((asset: AssetEntry) => {
    setAssetEntityDeleteTarget(asset)
  }, [])

  const closeAssetEntityDeleteDialog = React.useCallback(() => {
    if (assetEntityDeleting) return
    setAssetEntityDeleteTarget(null)
  }, [assetEntityDeleting])

  const confirmDeleteAssetEntity = React.useCallback(async () => {
    const target = assetEntityDeleteTarget
    if (!target || assetEntityDeleting) return
    setAssetEntityDeleting(true)
    try {
      await handleDeleteAssetEntity(target)
      setAssetEntityDeleteTarget(null)
    } finally {
      setAssetEntityDeleting(false)
    }
  }, [assetEntityDeleteTarget, assetEntityDeleting, handleDeleteAssetEntity])

  const handleTrashAssetRestored = React.useCallback(
    async (asset: AssetEntry) => {
      const nextAssetIndex = await gateway.assets.ensureAssetsIndex('library').catch(() => null)
      if (nextAssetIndex) setAssetPoolIndex(nextAssetIndex as any)
      void gateway.host.toast(`已恢复附件：${assetRefKey(asset)}`)
    },
    [gateway],
  )

  const assetEntityDeleteDialog = (
    <Dialog open={visible && !!assetEntityDeleteTarget} onClose={closeAssetEntityDeleteDialog} maxWidth="xs" fullWidth>
      <DialogTitle>移入回收站</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
          确定将附件「{assetEntityDeleteTarget ? assetRefKey(assetEntityDeleteTarget) : '未命名附件'}」移入回收站吗？现有页面中的相关卡片会变成失效引用卡片。
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={closeAssetEntityDeleteDialog} disabled={assetEntityDeleting}>取消</Button>
        <Button variant="contained" color="error" onClick={() => void confirmDeleteAssetEntity()} disabled={assetEntityDeleting}>
          {assetEntityDeleting ? '处理中...' : '移入回收站'}
        </Button>
      </DialogActions>
    </Dialog>
  )

  return {
    assetPoolIndex,
    setAssetPoolIndex,
    openAssetTabs,
    setOpenAssetTabs,
    playingTabKeys,
    setTabPlaying,
    handleUpdateAssetInfo,
    handleOpenAssetTab,
    handleAssetTabUpdated,
    requestDeleteAssetEntity,
    handleTrashAssetRestored,
    assetEntityDeleteDialog,
  }
}
