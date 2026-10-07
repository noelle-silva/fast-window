import * as React from 'react'
import { Box, Button, IconButton, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import CasinoRoundedIcon from '@mui/icons-material/CasinoRounded'
import type { VaultScope } from '../../core'
import type { HyperCortexGateway } from '../../gateway'
import type { HyperCortexNoteManifestV1 } from '../../noteSchema'
import { normalizeEntityIcon, type EntityIcon, type EntityIconDraft, type EntityIconTargetKind } from '../../entityIcon'
import { sanitizeSvg } from '../../htmlSanitizer'
import { EntityIcon as EntityIconView, EntityIconRuntimeProvider, invalidateEntityIconImage } from './EntityIcon'
import { AVAILABLE_LUCIDE_ICON_NAMES, getLucideIcon, pickRandomLucideIconName } from './lucideCatalog'
import { compressImageDataUrl, readFileAsDataUrl } from './imageCompression'

// 实体图标编辑器：共用组件。顶部显示当前图标并给出「图标库 / 图片文件 / SVG 代码」三选一切换，
// 底部提供「恢复默认」。三种模式各自维护草稿：先选中/粘贴/输入看预览，点「应用」才落盘。
export type EntityIconEditorProps = {
  gateway: HyperCortexGateway
  scope: VaultScope
  targetKind: EntityIconTargetKind
  /** 笔记传包目录，收藏夹传收藏夹标识，附件传 assetId。 */
  targetRef: string
  /** 附件专用：扩展名。 */
  targetExt?: string
  value?: EntityIcon
  /** 默认图标：不设自定义图标时显示。 */
  fallback: React.ReactNode
  onChanged: (payload: { icon?: EntityIcon; manifest?: HyperCortexNoteManifestV1; folder?: unknown; asset?: unknown }) => void
  disabled?: boolean
}

type EditorMode = 'library' | 'image' | 'svg'

function initialMode(value?: EntityIcon): EditorMode {
  if (value?.kind === 'image') return 'image'
  if (value?.kind === 'svg') return 'svg'
  return 'library'
}

export function EntityIconEditor(props: EntityIconEditorProps): React.ReactNode {
  const { gateway, scope, targetKind, targetRef, targetExt, value, fallback, onChanged, disabled } = props
  const [mode, setMode] = React.useState<EditorMode>(() => initialMode(value))
  const [busy, setBusy] = React.useState(false)
  const [libraryDraft, setLibraryDraft] = React.useState<string>(() => (value?.kind === 'library' ? value.name : ''))
  const [imageDraft, setImageDraft] = React.useState<string>('')
  const [svgDraft, setSvgDraft] = React.useState(() => (value?.kind === 'svg' ? value.svg : ''))
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    setMode(initialMode(value))
    setLibraryDraft(value?.kind === 'library' ? value.name : '')
    setImageDraft('')
    setSvgDraft(value?.kind === 'svg' ? value.svg : '')
  }, [value])

  const commit = React.useCallback(
    async (draft: EntityIconDraft) => {
      if (busy || disabled) return
      setBusy(true)
      try {
        let icon: EntityIcon | undefined
        let manifest: HyperCortexNoteManifestV1 | undefined
        let folder: unknown
        let asset: unknown
        if (targetKind === 'note') {
          const result = await gateway.icons.updateNote(scope, { packageDir: targetRef, icon: draft })
          manifest = result.manifest
          icon = normalizeEntityIcon(result.manifest?.icon)
        } else if (targetKind === 'folder') {
          const result = await gateway.icons.updateFolder(scope, { folderId: targetRef, icon: draft })
          folder = result.folder
          icon = normalizeEntityIcon((result.folder as any)?.icon)
        } else {
          const result = await gateway.icons.updateAsset(scope, { assetId: targetRef, ext: targetExt, icon: draft })
          asset = result.asset
          icon = normalizeEntityIcon((result.asset as any)?.icon)
        }
        invalidateEntityIconImage(scope, targetKind, targetRef)
        onChanged({ icon, manifest, folder, asset })
      } catch (e: any) {
        await gateway.host.toast(String(e?.message || e || '保存图标失败'))
      } finally {
        setBusy(false)
      }
    },
    [busy, disabled, gateway, onChanged, scope, targetExt, targetKind, targetRef],
  )

  const handlePickedImage = React.useCallback(
    async (file: File) => {
      try {
        const raw = await readFileAsDataUrl(file)
        setImageDraft(await compressImageDataUrl(raw))
      } catch (e: any) {
        await gateway.host.toast(String(e?.message || e || '读取图片失败'))
      }
    },
    [gateway.host],
  )

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items || [])
      const imageItem = items.find(item => item.kind === 'file' && item.type.startsWith('image/'))
      const file = imageItem?.getAsFile()
      if (!file) return
      event.preventDefault()
      void handlePickedImage(file)
    },
    [handlePickedImage],
  )

  const handlePickFile = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      void handlePickedImage(file)
    },
    [handlePickedImage],
  )

  const selectedLibraryName = libraryDraft || (value?.kind === 'library' ? value.name : '')
  const libraryPreviewIcon: EntityIcon | undefined = selectedLibraryName ? { kind: 'library', name: selectedLibraryName } : undefined
  const svgPreview = sanitizeSvg(svgDraft, 'baseline')

  const applyButton = mode === 'library' ? (
    <Button
      variant="contained"
      disabled={busy || disabled || !libraryDraft || (value?.kind === 'library' && value.name === libraryDraft)}
      onClick={() => void commit({ kind: 'library', name: libraryDraft })}
      sx={{ textTransform: 'none' }}
    >
      应用
    </Button>
  ) : mode === 'image' ? (
    <Button
      variant="contained"
      disabled={busy || disabled || !imageDraft}
      onClick={() => void commit({ kind: 'image', dataUrl: imageDraft })}
      sx={{ textTransform: 'none' }}
    >
      应用
    </Button>
  ) : (
    <Button
      variant="contained"
      disabled={busy || disabled || !svgDraft.trim()}
      onClick={() => void commit({ kind: 'svg', svg: svgDraft })}
      sx={{ textTransform: 'none' }}
    >
      应用
    </Button>
  )

  return (
    <EntityIconRuntimeProvider gateway={gateway} scope={scope}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 2,
              border: '1px solid var(--hc-border)',
              bgcolor: 'var(--hc-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {imageDraft ? (
              <Box component="img" src={imageDraft} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <EntityIconView icon={value} fallback={fallback} targetKind={targetKind} targetRef={targetRef} size={26} />
            )}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: 'var(--hc-text)' }}>实体图标</Typography>
            <Typography sx={{ fontSize: 11.5, color: 'var(--hc-text-muted)' }}>默认 / 图标库 / 图片 / SVG，同一实体只保留一个；改完点「应用」才生效。</Typography>
          </Box>
          <Tooltip title="恢复默认">
            <span>
              <Button
                size="small"
                variant="text"
                startIcon={<RefreshRoundedIcon fontSize="small" />}
                disabled={busy || disabled || !value}
                onClick={() => void commit({ kind: 'default' })}
                sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
              >
                恢复默认
              </Button>
            </span>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode}
            disabled={busy || disabled}
            onChange={(_e, next: EditorMode | null) => next && setMode(next)}
          >
            <ToggleButton value="library" sx={{ textTransform: 'none' }}>图标库</ToggleButton>
            <ToggleButton value="image" sx={{ textTransform: 'none' }}>图片文件</ToggleButton>
            <ToggleButton value="svg" sx={{ textTransform: 'none' }}>SVG 代码</ToggleButton>
          </ToggleButtonGroup>
          <Box sx={{ flex: 1 }} />
          {applyButton}
        </Box>

        {mode === 'library' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: 11.5, color: 'var(--hc-text-muted)' }}>点一个即选中</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: 1.5,
                    border: '1px solid var(--hc-border)',
                    bgcolor: 'var(--hc-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    color: 'var(--hc-text)',
                    flexShrink: 0,
                  }}
                >
                  <EntityIconView icon={libraryPreviewIcon} fallback={fallback} targetKind={targetKind} targetRef={targetRef} size={18} />
                </Box>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<CasinoRoundedIcon fontSize="small" />}
                  disabled={busy || disabled}
                  onClick={() => {
                    const name = pickRandomLucideIconName()
                    if (name) setLibraryDraft(name)
                  }}
                  sx={{ textTransform: 'none' }}
                >
                  随机图标
                </Button>
              </Box>
            </Box>
            <Box
              sx={{
                height: 200,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))',
                gap: 0.5,
                p: 0.75,
                border: '1px solid var(--hc-border)',
                borderRadius: 2,
                bgcolor: 'var(--hc-surface)',
              }}
            >
              {AVAILABLE_LUCIDE_ICON_NAMES.map(name => {
                const Lucide = getLucideIcon(name)
                if (!Lucide) return null
                const selected = selectedLibraryName === name
                return (
                  <IconButton
                    key={name}
                    size="small"
                    title={name}
                    disabled={busy || disabled}
                    onClick={() => setLibraryDraft(name)}
                    sx={{
                      borderRadius: 2,
                      color: selected ? 'var(--hc-primary)' : 'var(--hc-text-muted)',
                      bgcolor: selected ? 'var(--hc-primary-soft)' : 'transparent',
                      '&:hover': { bgcolor: 'var(--hc-surface-soft)' },
                    }}
                  >
                    <Lucide size={18} />
                  </IconButton>
                )
              })}
            </Box>
          </Box>
        ) : null}

        {mode === 'image' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box
              tabIndex={0}
              onPaste={handlePaste}
              sx={{
                minHeight: 120,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                p: 2,
                border: '1px dashed var(--hc-border-strong, var(--hc-border))',
                borderRadius: 2,
                bgcolor: 'var(--hc-surface)',
                outline: 'none',
                '&:focus-visible': { borderColor: 'var(--hc-primary)' },
              }}
            >
              {imageDraft ? (
                <Box component="img" src={imageDraft} alt="" sx={{ maxWidth: 160, maxHeight: 120, objectFit: 'contain' }} />
              ) : (
                <Typography sx={{ fontSize: 12.5, color: 'var(--hc-text-muted)', textAlign: 'center' }}>
                  点这里后按 Ctrl+V 粘贴图片，或
                </Typography>
              )}
              <Button
                size="small"
                variant="outlined"
                disabled={busy || disabled}
                onClick={() => fileInputRef.current?.click()}
                sx={{ textTransform: 'none' }}
              >
                选取本地图片
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePickFile} />
            </Box>
          </Box>
        ) : null}

        {mode === 'svg' ? (
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'stretch' }}>
            <TextField
              multiline
              minRows={10}
              maxRows={10}
              label="SVG 代码"
              value={svgDraft}
              disabled={busy || disabled}
              onChange={e => setSvgDraft(e.target.value)}
              sx={{ flex: 1, '& textarea': { overflowY: 'auto' } }}
              inputProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 } }}
            />
            <Box
              sx={{
                width: 120,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--hc-border)',
                borderRadius: 2,
                bgcolor: 'var(--hc-surface)',
                overflow: 'hidden',
                '& svg': { maxWidth: '100%', maxHeight: '100%' },
              }}
              dangerouslySetInnerHTML={{ __html: svgPreview }}
            />
          </Box>
        ) : null}
      </Box>
    </EntityIconRuntimeProvider>
  )
}
