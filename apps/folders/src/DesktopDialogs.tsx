import * as React from 'react'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded'
import { Box, Button, Dialog, DialogContent, Paper, Stack, TextField, Typography, alpha } from '@mui/material'
import { DESKTOP_ICON_COLORS } from './folder-grid/desktopIconTokens'
import { DesktopIconVisual } from './folder-grid/DesktopIconVisual'
import { defaultDesktopIcon, defaultIconCandidate, sameDesktopIcon } from './iconAppearanceModel'
import type { CollectionCategoryId, CollectionContainer, ContainerFormState, DesktopIcon, IconAppearanceCandidate, IconAppearanceState } from './types'

export function ContainerDialog(props: {
  busy: boolean
  editing: CollectionContainer | null
  form: ContainerFormState
  open: boolean
  onChange(form: ContainerFormState): void
  onClose(): void
  onSave(): void
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.editing ? '编辑收纳夹' : '创建收纳夹'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>收纳夹会作为桌面图标显示；内容通过拖拽放入，内部位置也会直接保存。</Typography>
          </Box>
          <TextField label="名称" value={props.form.name} onChange={event => props.onChange({ ...props.form, name: event.target.value })} placeholder="例如：AI 工具" autoFocus fullWidth />
          <Typography variant="caption" color="text.secondary">把桌面收藏项拖到收纳夹上停留即可展开并放入；打开收纳夹后也可以直接拖动内部图标排序。</Typography>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button variant="contained" onClick={props.onSave} disabled={props.busy}>{props.editing ? '保存' : '创建'}</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export function IconAppearancePanel(props: {
  assetUrl?(assetId: string): string
  busy: boolean
  icon: IconAppearanceState
  seed: string
  systemIconDisabledText?: string
  systemIconEnabled: boolean
  targetKind: CollectionCategoryId
  onChangeDraft(icon: DesktopIcon | null): void
  onFetchWebIcons?(): void
  onFetchSystemIcon(): void
  onPasteImage(): void
  onPickImage(): void
  onReset(): void
  onSelectCandidate(candidate: IconAppearanceCandidate): void
}) {
  const draftIcon = props.icon.draftIcon
  const draftDataUrl = props.icon.draftDataUrl
  const defaultSelected = !draftDataUrl && (draftIcon?.kind === 'color' || !draftIcon)
  const hasSystemIcon = props.icon.candidates.some(candidate => candidate.id.startsWith('system-icon:'))
  const hasWebIcons = props.icon.candidates.some(candidate => candidate.id.startsWith('web-icon:'))
  const iconFetchLabel = props.targetKind === 'url' ? (hasWebIcons ? '刷新网页图标' : '获取网页图标') : (hasSystemIcon ? '刷新图标' : '获取图标')
  const iconFetchEnabled = props.targetKind === 'url' ? Boolean(props.onFetchWebIcons) && props.systemIconEnabled : props.systemIconEnabled
  const iconFetchTitle = iconFetchEnabled ? undefined : props.systemIconDisabledText
  const handleFetchIcon = props.targetKind === 'url' ? props.onFetchWebIcons : props.onFetchSystemIcon

  return (
    <Paper elevation={0} sx={theme => ({ p: 2, borderRadius: 3, bgcolor: alpha(theme.palette.primary.main, 0.045), border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}` })}>
      <Stack spacing={1.75}>
        <Box>
          <Typography fontWeight={900}>图标外观</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>图标会随当前收藏项一起保存；获取失败时会直接提示真实原因。</Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '132px 1fr' }, gap: 2, alignItems: 'stretch' }}>
          <Box sx={theme => ({ borderRadius: 4, p: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.primary.main, 0.07), border: `1px solid ${alpha(theme.palette.primary.main, 0.14)}` })}>
            <IconPreview assetUrl={props.assetUrl} dataUrl={draftDataUrl} icon={draftIcon || defaultDesktopIcon} seed={props.seed || 'icon'} targetKind={props.targetKind} size={92} radius={28} />
          </Box>
          <Stack spacing={1.25}>
            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>备选图标组</Typography>
            <IconCandidateGrid
              assetUrl={props.assetUrl}
              candidates={props.icon.candidates}
              disabled={props.busy}
              selectedCandidateId={props.icon.draftCandidateId}
              selectedIcon={draftIcon}
              seed={props.seed || 'icon'}
              targetKind={props.targetKind}
              onSelect={props.onSelectCandidate}
            />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button startIcon={<TravelExploreRoundedIcon />} onClick={handleFetchIcon} disabled={props.busy || !iconFetchEnabled} title={iconFetchTitle}>{iconFetchLabel}</Button>
              <Button startIcon={<ImageRoundedIcon />} onClick={props.onPickImage} disabled={props.busy}>选择图片</Button>
              <Button startIcon={<ContentPasteRoundedIcon />} onClick={props.onPasteImage} disabled={props.busy}>粘贴图片</Button>
              <Button startIcon={<RestartAltRoundedIcon />} onClick={() => props.onChangeDraft(defaultDesktopIcon)} disabled={props.busy}>默认图标</Button>
              <Button onClick={props.onReset} disabled={props.busy}>清除自定义</Button>
            </Stack>
          </Stack>
        </Box>
        {defaultSelected ? (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 900 }}>默认图标颜色</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
              {DESKTOP_ICON_COLORS.map(color => (
                <Button key={color} aria-label={`使用颜色 ${color}`} onClick={() => props.onChangeDraft({ kind: 'color', color })} disabled={props.busy} sx={{ height: 48, borderRadius: 3, bgcolor: color, minWidth: 0, outline: draftIcon?.kind === 'color' && draftIcon.color.toUpperCase() === color ? '3px solid rgba(15, 23, 42, 0.24)' : 'none', '&:hover': { bgcolor: color } }} />
              ))}
            </Box>
          </Box>
        ) : null}
      </Stack>
    </Paper>
  )
}

function IconCandidateGrid(props: {
  assetUrl?(assetId: string): string
  candidates: IconAppearanceCandidate[]
  disabled: boolean
  selectedCandidateId?: string
  selectedIcon: DesktopIcon | null
  seed: string
  targetKind: CollectionCategoryId
  onSelect(candidate: IconAppearanceCandidate): void
}) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))', gap: 1 }}>
      {props.candidates.map(candidate => {
        const selected = props.selectedCandidateId ? props.selectedCandidateId === candidate.id : Boolean(candidate.icon && sameDesktopIcon(props.selectedIcon, candidate.icon))
        return (
          <Button
            key={candidate.id}
            aria-pressed={selected}
            aria-label={`选择${candidate.label}`}
            onClick={() => props.onSelect(candidate)}
            disabled={props.disabled}
            sx={theme => ({
              minWidth: 0,
              p: 1,
              borderRadius: 3,
              display: 'grid',
              gap: 0.75,
              justifyItems: 'center',
              textTransform: 'none',
              color: 'text.primary',
              border: `1px solid ${selected ? theme.palette.primary.main : alpha(theme.palette.divider, 0.9)}`,
              bgcolor: selected ? alpha(theme.palette.primary.main, 0.08) : alpha(theme.palette.background.paper, 0.72),
            })}
          >
            <IconPreview assetUrl={props.assetUrl} dataUrl={candidate.dataUrl} icon={candidate.icon || defaultDesktopIcon} seed={`${props.seed}-${candidate.id}`} targetKind={props.targetKind} size={54} radius={16} shadow={false} />
            <Typography variant="caption" sx={{ fontWeight: 800, lineHeight: 1.1 }}>{candidate.label}</Typography>
          </Button>
        )
      })}
    </Box>
  )
}

function IconPreview(props: {
  assetUrl?(assetId: string): string
  dataUrl?: string
  icon: DesktopIcon
  radius: number
  seed: string
  shadow?: string | false
  size: number
  targetKind: CollectionCategoryId
}) {
  if (props.dataUrl) {
    return (
      <Box
        sx={{
          width: props.size,
          height: props.size,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          overflow: 'hidden',
          borderRadius: `${props.radius}px`,
          bgcolor: '#F8FAFC',
          boxShadow: props.shadow === false ? 'none' : props.shadow,
        }}
      >
        <Box component="img" src={props.dataUrl} alt="" draggable={false} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Box>
    )
  }
  return <DesktopIconVisual assetUrl={props.assetUrl} icon={props.icon} seed={props.seed} targetKind={props.targetKind} size={props.size} radius={props.radius} shadow={props.shadow} />
}
