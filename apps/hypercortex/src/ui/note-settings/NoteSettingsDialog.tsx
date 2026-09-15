import * as React from 'react'
import { Box, Dialog, DialogContent, DialogTitle, Divider, IconButton, Typography } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'

import type { HyperCortexHtmlFaceDisplayModeV1, VaultScope } from '../../core'
import type { HyperCortexGateway } from '../../gateway'
import type { HyperCortexNoteManifestV1 } from '../../noteSchema'
import type { HtmlFacePreferencesV1 } from '../../facePreferences'
import { isHtmlFace, isKnownFaceKind, labelForFaceKind, type HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import { FaceOrderList } from '../FaceOrderList'
import { HtmlFaceNoteSettingsSection, type HtmlFaceDisplayModeChoice } from './HtmlFaceNoteSettingsSection'

type Props = {
  open: boolean
  onClose: () => void
  gateway: HyperCortexGateway
  scope: VaultScope
  packageDir: string
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  faceOrder: readonly string[]
  htmlFacePreferences: HtmlFacePreferencesV1
  globalHtmlFaceMode: HyperCortexHtmlFaceDisplayModeV1
  globalHtmlFaceScale: number
  /** 任一设置保存成功后带回最新 manifest，由会话同步到界面状态。 */
  onManifestSaved: (manifest: HyperCortexNoteManifestV1) => void
}

/** 笔记设置（Q46）：管理这篇笔记自己的 HTML 面显示方式、缩放覆盖与面顺序。 */
export function NoteSettingsDialog(props: Props): React.ReactNode {
  const {
    open,
    onClose,
    gateway,
    scope,
    packageDir,
    faceManifests,
    faceOrder,
    htmlFacePreferences,
    globalHtmlFaceMode,
    globalHtmlFaceScale,
    onManifestSaved,
  } = props

  const [busy, setBusy] = React.useState(false)

  const htmlFaceManifest = React.useMemo(
    () => Object.values(faceManifests).find(face => isHtmlFace(face)) || null,
    [faceManifests],
  )

  const runSave = React.useCallback(async (
    action: () => Promise<{ manifest: HyperCortexNoteManifestV1 }>,
    failureMessage: string,
  ): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    try {
      const result = await action()
      onManifestSaved(result.manifest)
      return true
    } catch (e: any) {
      await gateway.host.toast(String(e?.message || e || failureMessage))
      return false
    } finally {
      setBusy(false)
    }
  }, [busy, gateway.host, onManifestSaved])

  const handleModeChoiceChange = React.useCallback((choice: HtmlFaceDisplayModeChoice) => {
    if (!htmlFaceManifest) return
    void runSave(
      () => gateway.notes.saveFaceSettings(scope, packageDir, htmlFaceManifest.id, choice === 'global' ? { displayMode: null } : { displayMode: choice }),
      '保存笔记显示方式失败',
    )
  }, [gateway, htmlFaceManifest, packageDir, runSave, scope])

  const handleFixedScaleCommit = React.useCallback(
    (scale: number | null) => {
      if (!htmlFaceManifest) return Promise.resolve(false)
      return runSave(
        () => gateway.notes.saveFaceSettings(scope, packageDir, htmlFaceManifest.id, { fixedScale: scale }),
        '保存笔记缩放比例失败',
      )
    },
    [gateway, htmlFaceManifest, packageDir, runSave, scope],
  )

  const handleFaceOrderChange = React.useCallback((next: string[]) => {
    void runSave(
      () => gateway.notes.saveNoteFaceOrder(scope, packageDir, next),
      '保存面顺序失败',
    )
  }, [gateway, packageDir, runSave, scope])

  const faceLabel = React.useCallback((faceId: string) => {
    const manifest = faceManifests[String(faceId || '').trim()]
    if (!manifest) return String(faceId || '').trim() || '未知面'
    const title = String(manifest.title || '').trim() || labelForFaceKind(manifest.kind)
    return isKnownFaceKind(manifest.kind) ? title : `${title}（暂不支持）`
  }, [faceManifests])

  const modeChoice: HtmlFaceDisplayModeChoice = htmlFacePreferences.modeSource === 'note' ? htmlFacePreferences.mode : 'global'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          fontSize: 18,
          fontWeight: 900,
          color: 'var(--hc-text)',
        }}
      >
        笔记设置
        <IconButton size="small" aria-label="关闭笔记设置" onClick={onClose} disabled={busy}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ pt: 2, pb: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
          {htmlFaceManifest ? (
            <>
              <HtmlFaceNoteSettingsSection
                modeChoice={modeChoice}
                globalMode={globalHtmlFaceMode}
                fixedScale={htmlFacePreferences.fixedScale}
                hasNoteScaleOverride={htmlFacePreferences.noteFixedScale != null}
                globalScale={globalHtmlFaceScale}
                busy={busy}
                onModeChoiceChange={handleModeChoiceChange}
                onFixedScaleCommit={handleFixedScaleCommit}
              />
              <Divider />
            </>
          ) : null}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box>
              <Typography sx={{ fontSize: 16, lineHeight: 1.3, fontWeight: 900, color: 'var(--hc-text)' }}>
                面的顺序
              </Typography>
              <Typography sx={{ mt: 0.5, fontSize: 12.5, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
                调整这篇笔记中各面的显示顺序；打开笔记时按这里的顺序定位第一个面。
              </Typography>
            </Box>
            <FaceOrderList
              order={faceOrder}
              labelOf={faceLabel}
              onReorder={handleFaceOrderChange}
              disabled={busy}
            />
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  )
}
