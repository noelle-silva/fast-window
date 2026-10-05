import * as React from 'react'
import { Box, IconButton, Tooltip } from '@mui/material'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'

import type { HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import { resolveFaceLabel } from '../../facePlugins'

/**
 * 笔记详情顶栏的面切换器：面标签条与逐面复制引用入口。
 * 纯展示组件：当前面、面清单与动作全部由顶栏注入。
 */
export type NoteDetailTopBarFaceSwitcherProps = {
  face: string
  faces: string[]
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  onSelectFace: (faceId: string) => void
  onCopyFaceRef: (faceId: string) => void
}

export function NoteDetailTopBarFaceSwitcher(props: NoteDetailTopBarFaceSwitcherProps): React.ReactNode {
  const { face, faces, faceManifests, onSelectFace, onCopyFaceRef } = props

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        p: 0.5,
        borderRadius: 999,
        bgcolor: 'rgba(0,0,0,.05)',
        gap: 0.5,
      }}
    >
      {faces.map(f => (
        <Box key={f} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
          <Box
            role="button"
            tabIndex={0}
            onClick={() => onSelectFace(f)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectFace(f)
              }
            }}
            sx={{
              minWidth: 56,
              px: 1.5,
              py: 0.75,
              borderRadius: 999,
              bgcolor: face === f ? '#111' : 'transparent',
              color: face === f ? '#fff' : '#374151',
              fontSize: 12,
              lineHeight: 1,
              fontWeight: 700,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            {resolveFaceLabel(f, faceManifests)}
          </Box>
          <Tooltip title="复制此面引用" placement="bottom-end">
            <IconButton
              size="small"
              aria-label={`复制 ${resolveFaceLabel(f, faceManifests)} 面引用`}
              onClick={() => onCopyFaceRef(f)}
              sx={{
                color: 'rgba(0,0,0,.48)',
                p: 0.4,
                '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
              }}
            >
              <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
    </Box>
  )
}
