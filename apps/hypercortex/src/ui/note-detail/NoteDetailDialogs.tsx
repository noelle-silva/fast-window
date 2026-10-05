import * as React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'

import type { HyperCortexGateway } from '../../gateway'
import type { VaultScope } from '../../core'
import type { HyperCortexNoteManifestV1 } from '../../noteSchema'
import type { HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import type { FaceContentStore } from '../../facePlugins'
import { resolveFaceLabel } from '../../facePlugins'
import type { HyperCortexFavoritesDocV1 } from '../../favorites'
import type { NoteFaceId } from './noteDetailTools'
import type { useFavoriteTargets } from '../useFavoriteTargets'
import { FavoritesTreePickerDialog } from '../FavoritesTreePickerDialog'
import { NoteVersionHistoryDialog } from '../note-version-history/NoteVersionHistoryDialog'
import { NoteSettingsDialog } from '../note-settings/NoteSettingsDialog'
import { useWorkspaceVisible } from '../workspaceVisibility'

/**
 * 笔记详情对话框集合：删除笔记、删除面、收藏选择、版本历史与笔记设置。
 * 纯展示组件：开关状态与动作全部由会话注入。
 */
export type NoteDetailDialogsProps = {
  isDraft: boolean
  trashEnabled: boolean
  noteTitleForPrompt: string
  dirty: boolean
  deleting: 'note' | 'face' | ''
  saving: boolean
  deleteNoteConfirmOpen: boolean
  setDeleteNoteConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>
  confirmDeleteNote: () => Promise<void>
  deleteFaceTarget: NoteFaceId | null
  setDeleteFaceTarget: React.Dispatch<React.SetStateAction<NoteFaceId | null>>
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  faceStoresRef: React.MutableRefObject<Record<string, FaceContentStore>>
  confirmDeleteFace: () => Promise<void>
  favoritesDoc?: HyperCortexFavoritesDocV1 | null
  favoritesTargets: ReturnType<typeof useFavoriteTargets>
  versionHistoryOpen: boolean
  setVersionHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>
  noteSettingsOpen: boolean
  setNoteSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  gateway: HyperCortexGateway
  scope: VaultScope
  noteDir: string
  saveCurrentForVersionPublish: () => Promise<void>
  handleRestoreVersion: (versionId: string) => Promise<void>
  facePluginGlobalSettings: Record<string, Record<string, unknown>>
  faces: NoteFaceId[]
  applyNoteManifest: (manifest: HyperCortexNoteManifestV1) => void
}

export function NoteDetailDialogs(props: NoteDetailDialogsProps): React.ReactNode {
  const {
    isDraft,
    trashEnabled,
    noteTitleForPrompt,
    dirty,
    deleting,
    saving,
    deleteNoteConfirmOpen,
    setDeleteNoteConfirmOpen,
    confirmDeleteNote,
    deleteFaceTarget,
    setDeleteFaceTarget,
    faceManifests,
    faceStoresRef,
    confirmDeleteFace,
    favoritesDoc,
    favoritesTargets,
    versionHistoryOpen,
    setVersionHistoryOpen,
    noteSettingsOpen,
    setNoteSettingsOpen,
    gateway,
    scope,
    noteDir,
    saveCurrentForVersionPublish,
    handleRestoreVersion,
    facePluginGlobalSettings,
    faces,
    applyNoteManifest,
  } = props

  const workspaceVisible = useWorkspaceVisible()

  return (
    <>
      <Dialog open={workspaceVisible && deleteNoteConfirmOpen} onClose={() => setDeleteNoteConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{isDraft ? '删除草稿' : trashEnabled ? '移入回收站' : '永久删除'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
            {isDraft
              ? `确定删除草稿「${noteTitleForPrompt}」吗？这会丢弃当前内容。`
              : trashEnabled
                ? `确定将笔记「${noteTitleForPrompt}」移入回收站吗？`
                : `回收站当前未启用。确定永久删除笔记「${noteTitleForPrompt}」吗？此操作不可撤销。`}
          </Typography>
          {dirty ? (
            <Typography sx={{ mt: 1, fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.56)' }}>
              提示：当前笔记有未保存改动。
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteNoteConfirmOpen(false)} disabled={deleting === 'note'}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void confirmDeleteNote()} disabled={deleting === 'note' || saving}>
            {deleting === 'note' ? '处理中…' : isDraft ? '删除' : trashEnabled ? '移入回收站' : '永久删除'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={workspaceVisible && !!deleteFaceTarget} onClose={() => setDeleteFaceTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{trashEnabled ? '移入回收站' : '永久删除面'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
            {trashEnabled
              ? `确定将笔记的「${deleteFaceTarget ? resolveFaceLabel(deleteFaceTarget, faceManifests) : ''}」面移入回收站吗？删除后可在回收站恢复。`
              : `回收站当前未启用。确定永久删除笔记的「${deleteFaceTarget ? resolveFaceLabel(deleteFaceTarget, faceManifests) : ''}」面吗？此操作不可撤销。`}
          </Typography>
          {dirty && !!faceStoresRef.current[String(deleteFaceTarget || '').trim()]?.isDirty() ? (
            <Typography sx={{ mt: 1, fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.56)' }}>
              提示：会丢弃该面的未保存改动。
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteFaceTarget(null)} disabled={deleting === 'face'}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void confirmDeleteFace()} disabled={deleting === 'face' || saving}>
            {deleting === 'face' ? '处理中…' : trashEnabled ? '移入回收站' : '永久删除'}
          </Button>
        </DialogActions>
      </Dialog>

      {favoritesDoc && favoritesTargets.target ? (
        <FavoritesTreePickerDialog
          open={favoritesTargets.pickerOpen}
          doc={favoritesDoc}
          kind={favoritesTargets.target.kind}
          targetId={favoritesTargets.target.id}
          onClose={favoritesTargets.closePicker}
          onSave={favoritesTargets.saveResult}
        />
      ) : null}

      {!isDraft && String(noteDir || '').trim() ? (
        <NoteVersionHistoryDialog
          open={versionHistoryOpen}
          gateway={gateway}
          scope={scope}
          packageDir={noteDir}
          dirty={dirty}
          onClose={() => setVersionHistoryOpen(false)}
          onSaveCurrent={saveCurrentForVersionPublish}
          onRestoreVersion={handleRestoreVersion}
        />
      ) : null}

      {!isDraft && String(noteDir || '').trim() ? (
        <NoteSettingsDialog
          open={noteSettingsOpen}
          onClose={() => setNoteSettingsOpen(false)}
          gateway={gateway}
          scope={scope}
          packageDir={noteDir}
          faceManifests={faceManifests}
          faceOrder={faces}
          facePluginGlobalSettings={facePluginGlobalSettings}
          onManifestSaved={applyNoteManifest}
        />
      ) : null}
    </>
  )
}
