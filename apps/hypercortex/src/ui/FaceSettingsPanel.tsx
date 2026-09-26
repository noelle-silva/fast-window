import * as React from 'react'
import { Box, Checkbox, FormControlLabel, Typography } from '@mui/material'
import { filterCreatableFaceDeclarations, resolveFaceKindLabel, useFaceDeclarations } from '../facePlugins'
import { FaceOrderList } from './FaceOrderList'
import { settingsSelectableSurfaceSx } from './settingsUiStyles'

type FaceSettingsPanelProps = {
  faceKindOrder: string[]
  onFaceKindOrderChange: (next: string[]) => void
  defaultFaceKinds: string[]
  onDefaultFaceKindsChange: (next: string[]) => void
}

export function FaceSettingsPanel(props: FaceSettingsPanelProps) {
  const { faceKindOrder, onFaceKindOrderChange, defaultFaceKinds, onDefaultFaceKindsChange } = props
  const faceDeclarations = useFaceDeclarations()
  const creatableDeclarations = React.useMemo(
    () => filterCreatableFaceDeclarations(faceDeclarations),
    [faceDeclarations],
  )
  const labelOf = React.useCallback(
    (kind: string) => resolveFaceKindLabel(kind),
    [faceDeclarations],
  )

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
          新建笔记的默认面按此顺序排列；已有笔记的顺序以笔记自己的设置为准（在笔记设置里调整）。
        </Typography>
        <FaceOrderList
          order={faceKindOrder}
          labelOf={labelOf}
          onReorder={onFaceKindOrderChange}
        />
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'var(--hc-text)' }}>新笔记默认创建的面</Typography>
        <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>
          选中后，新建笔记会自动创建这些面；一个都不选则新建无面笔记。多个默认面按上面的全局顺序排列。
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {creatableDeclarations.map(declaration => {
            const checked = defaultFaceKinds.includes(declaration.kind)
            return (
              <Box
                key={declaration.kind}
                sx={{
                  borderRadius: 2,
                  ...settingsSelectableSurfaceSx(checked),
                  px: 1,
                  py: 0.5,
                }}
              >
                <FormControlLabel
                  control={<Checkbox size="small" checked={checked} onChange={() => toggleDefaultKind(declaration.kind)} />}
                  label={<Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--hc-text)' }}>{declaration.label}</Typography>}
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
