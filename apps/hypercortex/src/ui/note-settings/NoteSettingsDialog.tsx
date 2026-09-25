import * as React from 'react'
import { Box, Dialog, DialogContent, DialogTitle, Divider, IconButton, Typography } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'

import type { VaultScope } from '../../core'
import type { HyperCortexGateway } from '../../gateway'
import type { HyperCortexNoteManifestV1 } from '../../noteSchema'
import { getFaceDeclaration, resolveFaceLabel, useFaceDeclarations } from '../../facePlugins'
import { resolveFaceSettingValues } from '../../facePlugins/settings'
import type { HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import type { FaceDeclaration } from '../../shared/faceDeclarations'
import { FaceOrderList } from '../FaceOrderList'
import { FaceNoteSettingsSection } from '../face-settings/FaceNoteSettingsSection'

type Props = {
  open: boolean
  onClose: () => void
  gateway: HyperCortexGateway
  scope: VaultScope
  packageDir: string
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  faceOrder: readonly string[]
  facePluginGlobalSettings: Record<string, Record<string, unknown>>
  /** 任一设置保存成功后带回最新 manifest，由会话同步到界面状态。 */
  onManifestSaved: (manifest: HyperCortexNoteManifestV1) => void
}

/** 笔记设置（Q46）：管理这篇笔记各面自己的设置覆盖与面顺序。 */
export function NoteSettingsDialog(props: Props): React.ReactNode {
  const {
    open,
    onClose,
    gateway,
    scope,
    packageDir,
    faceManifests,
    faceOrder,
    facePluginGlobalSettings,
    onManifestSaved,
  } = props

  const [busy, setBusy] = React.useState(false)
  const faceDeclarations = useFaceDeclarations()

  const settingsFaces = React.useMemo(() => {
    const out: { declaration: FaceDeclaration; face: HyperCortexNoteFaceManifestV2 }[] = []
    for (const face of Object.values(faceManifests)) {
      const declaration = getFaceDeclaration(face.kind)
      if (!declaration || !declaration.settings.length) continue
      out.push({ declaration, face })
    }
    return out
  }, [faceDeclarations, faceManifests])

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

  const handleFaceSettingPatch = React.useCallback((faceId: string, patch: Record<string, unknown | null>) => {
    return runSave(
      () => gateway.notes.saveFaceSettings(scope, packageDir, faceId, patch),
      '保存笔记面设置失败',
    )
  }, [gateway, packageDir, runSave, scope])

  const handleFaceOrderChange = React.useCallback((next: string[]) => {
    void runSave(
      () => gateway.notes.saveNoteFaceOrder(scope, packageDir, next),
      '保存面顺序失败',
    )
  }, [gateway, packageDir, runSave, scope])

  const faceLabel = React.useCallback((faceId: string) => resolveFaceLabel(faceId, faceManifests), [faceManifests])

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
          {settingsFaces.map(({ declaration, face }) => {
            const noteValues = (face.settings || {}) as Record<string, unknown>
            const globalValues = facePluginGlobalSettings[declaration.kind] || {}
            const effectiveValues = resolveFaceSettingValues(declaration.settings, { noteSettings: noteValues, globalSettings: globalValues })
            return (
              <React.Fragment key={declaration.kind}>
                <FaceNoteSettingsSection
                  fields={declaration.settings}
                  noteValues={noteValues}
                  globalValues={globalValues}
                  effectiveValues={effectiveValues}
                  busy={busy}
                  onPatch={patch => handleFaceSettingPatch(face.id, patch)}
                />
                <Divider />
              </React.Fragment>
            )
          })}

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
