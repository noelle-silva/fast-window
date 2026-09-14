import * as React from 'react'
import { Box, Checkbox, FormControlLabel, IconButton, Tooltip, Typography } from '@mui/material'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import { labelForFaceKind, listNoteFaceAdapters } from '../noteFaces'
import { settingsSelectableSurfaceSx } from './settingsUiStyles'

type FaceSettingsPanelProps = {
  faceKindOrder: string[]
  onFaceKindOrderChange: (next: string[]) => void
  defaultFaceKinds: string[]
  onDefaultFaceKindsChange: (next: string[]) => void
}

function moveKind(order: string[], index: number, delta: number): string[] {
  const next = index + delta
  if (index < 0 || next < 0 || next >= order.length) return order
  const out = order.slice()
  const [item] = out.splice(index, 1)
  out.splice(next, 0, item)
  return out
}

export function FaceSettingsPanel(props: FaceSettingsPanelProps) {
  const { faceKindOrder, onFaceKindOrderChange, defaultFaceKinds, onDefaultFaceKindsChange } = props
  const creatableAdapters = React.useMemo(() => listNoteFaceAdapters().filter(adapter => adapter.capabilities.creatable), [])

  const toggleDefaultKind = React.useCallback(
    (kind: string) => {
      onDefaultFaceKindsChange(defaultFaceKinds.includes(kind) ? defaultFaceKinds.filter(item => item !== kind) : [...defaultFaceKinds, kind])
    },
    [defaultFaceKinds, onDefaultFaceKindsChange],
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box>
        <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>笔记面</Typography>
        <Typography sx={{ mt: 0.5, fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
          设置新建笔记时默认创建哪些面，以及各面类型的全局顺序。单篇笔记自己保存的设置（例如 HTML 面缩放）优先于这里的全局设置。
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'var(--hc-text)' }}>面排序规则</Typography>
        <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>
          新建笔记的默认面按此顺序排列；笔记没有自己的面顺序时，打开笔记也按此顺序定位第一个面。
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {faceKindOrder.map((kind, index) => (
            <Box
              key={kind}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                px: 1.25,
                py: 0.75,
                borderRadius: 2,
                bgcolor: 'var(--hc-surface-soft)',
              }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--hc-text)' }}>
                {labelForFaceKind(kind)}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <Tooltip title="上移">
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`将 ${labelForFaceKind(kind)} 上移`}
                      disabled={index === 0}
                      onClick={() => onFaceKindOrderChange(moveKind(faceKindOrder, index, -1))}
                    >
                      <ArrowUpwardRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="下移">
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`将 ${labelForFaceKind(kind)} 下移`}
                      disabled={index === faceKindOrder.length - 1}
                      onClick={() => onFaceKindOrderChange(moveKind(faceKindOrder, index, 1))}
                    >
                      <ArrowDownwardRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'var(--hc-text)' }}>新笔记默认创建的面</Typography>
        <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>
          选中后，新建笔记会自动创建这些面；一个都不选则新建无面笔记。多个默认面按上面的全局顺序排列。
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {creatableAdapters.map(adapter => {
            const checked = defaultFaceKinds.includes(adapter.kind)
            return (
              <Box
                key={adapter.kind}
                sx={{
                  borderRadius: 2,
                  ...settingsSelectableSurfaceSx(checked),
                  px: 1,
                  py: 0.5,
                }}
              >
                <FormControlLabel
                  control={<Checkbox size="small" checked={checked} onChange={() => toggleDefaultKind(adapter.kind)} />}
                  label={<Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--hc-text)' }}>{adapter.label}</Typography>}
                  sx={{ m: 0 }}
                />
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}
