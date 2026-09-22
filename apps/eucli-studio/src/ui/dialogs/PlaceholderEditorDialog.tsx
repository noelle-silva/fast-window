import * as React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { placeholderSourcePluginDisabled, type PlaceholderItem } from '../../domain/placeholder'
import { systemPluginEnabledById } from '../../domain/systemPlugin'
import { PlaceholderDependencyTreePanel } from '../settings/PlaceholderDependencyTreePanel'
import { PlaceholderEditor } from '../settings/PlaceholderEditor'
import {
  computeDirtyNames,
  createPlaceholderDraft,
  planPlaceholderDelete,
  planPlaceholderSave,
  renameDraftPlaceholder,
  serverIdentityOf,
  updateDraftPlaceholder,
  type PlaceholderDraft,
} from '../settings/placeholderDraft'

type PlaceholderEditorDialogProps = {
  controller: any
  placeholders?: any
  systemPlugins?: any
  name: string
  onClose: () => void
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function PlaceholderEditorDialog(props: PlaceholderEditorDialogProps) {
  const { controller, placeholders, systemPlugins, name, onClose } = props
  const target = text(name)

  // 关闭动画期间沿用最后一次的名字：避免淡出的一瞬间内容变成空 / 未注册红字。
  const [retained, setRetained] = React.useState('')
  if (target && target !== retained) setRetained(target)
  const shown = target || retained

  const library = placeholders?.library
  const serverHasTarget = React.useMemo(() => {
    const list = library?.placeholders
    return Array.isArray(list) && list.some((entry: PlaceholderItem) => text(entry?.name) === target)
  }, [library, target])

  const [draft, setDraft] = React.useState<PlaceholderDraft | null>(null)
  const [draftIndex, setDraftIndex] = React.useState(-1)
  const [draftFor, setDraftFor] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')

  // 打开某个占位符时按当前服务端库初始化本地草稿；库晚到时会补一次初始化。
  if (target && (target !== draftFor || (draftIndex < 0 && serverHasTarget))) {
    const nextDraft = createPlaceholderDraft(library)
    setDraft(nextDraft)
    setDraftIndex(nextDraft.library.placeholders.findIndex((entry) => text(entry.name) === target))
    setDraftFor(target)
    setSaveError('')
  }
  // 关闭后再次打开时重新取数，不保留上一次未保存的编辑。
  if (!target && draftFor) setDraftFor('')

  React.useEffect(() => {
    if (!target) return
    controller.actions.loadPlaceholderDependencies?.(target)?.catch?.(() => null)
  }, [controller, target])

  const pluginEnabledById = React.useMemo(() => systemPluginEnabledById(systemPlugins), [systemPlugins])

  const draftItem = draft && draftIndex >= 0 ? draft.library.placeholders[draftIndex] || null : null
  const displayName = text(draftItem?.name) || shown
  const dirty = React.useMemo(() => {
    if (!draft || !draftItem) return false
    return computeDirtyNames(library, draft).has(text(draftItem.name))
  }, [library, draft, draftItem])

  const saveDraft = async () => {
    if (!draft || draftIndex < 0) return
    const draftName = text(draft.library.placeholders[draftIndex]?.name)
    const plan = planPlaceholderSave(library, draft, draftName)
    if (!plan.ok) {
      setSaveError(plan.error)
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const saved = await controller.actions.savePlaceholderLibrary?.(plan.library)
      const next = createPlaceholderDraft(saved || plan.library)
      setDraft(next)
      setDraftIndex(next.library.placeholders.findIndex((entry) => text(entry.name) === draftName))
      controller.actions.loadPlaceholderDependencies?.(draftName)?.catch?.(() => null)
    } catch (e: any) {
      setSaveError(String(e?.message || e || '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const deleteDraft = async () => {
    if (!draft || draftIndex < 0) return
    const draftName = text(draft.library.placeholders[draftIndex]?.name)
    const identity = serverIdentityOf(draft, draftName)
    setSaving(true)
    setSaveError('')
    try {
      await controller.actions.savePlaceholderLibrary?.(planPlaceholderDelete(library, [identity, draftName]))
      onClose()
    } catch (e: any) {
      setSaveError(String(e?.message || e || '删除失败'))
    } finally {
      setSaving(false)
    }
  }

  const copyToken = () => {
    const capabilities = controller?.capabilities
    const writeText = capabilities?.clipboard?.writeText
    if (typeof writeText !== 'function') return capabilities?.ui?.showToast?.('未授权：clipboard.writeText', { kind: 'error' })
    Promise.resolve()
      .then(() => writeText(`{{${displayName}}}`))
      .then(() => capabilities?.ui?.showToast?.('已复制占位符', { kind: 'success' }))
      .catch(() => capabilities?.ui?.showToast?.('复制失败', { kind: 'error' }))
  }

  return (
    <Dialog open={!!target} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}>
      <DialogTitle>{`{{${displayName}}}`}</DialogTitle>
      <DialogContent>
        {draftItem ? (
          <Stack spacing={1.25} sx={{ pt: 1.5 }}>
            <PlaceholderEditor
              item={draftItem}
              folders={draft?.library.folders || []}
              disabled={saving}
              saving={saving}
              sourcePluginDisabled={placeholderSourcePluginDisabled(draftItem, pluginEnabledById)}
              dirty={dirty}
              onRename={(nextName) => setDraft((current) => (current ? renameDraftPlaceholder(current, draftIndex, nextName) : current))}
              onUpdate={(patch) => setDraft((current) => (current ? updateDraftPlaceholder(current, draftIndex, patch) : current))}
              onSave={() => { void saveDraft() }}
              onDelete={() => { void deleteDraft() }}
            />
            {saveError ? <Typography variant="body2" color="error.main">{saveError}</Typography> : null}
            <PlaceholderDependencyTreePanel tree={placeholders?.dependencyTree} />
          </Stack>
        ) : (
          <Stack spacing={1.25} sx={{ pt: 1.5 }}>
            <Typography variant="body2" color="error.main">这个占位符还没有注册：提示词里的引用不会被替换。</Typography>
            <PlaceholderDependencyTreePanel tree={placeholders?.dependencyTree} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button startIcon={<ContentCopyIcon />} onClick={copyToken} disabled={!displayName}>复制占位符</Button>
        <Button variant="contained" onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
