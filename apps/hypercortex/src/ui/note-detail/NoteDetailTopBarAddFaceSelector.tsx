import * as React from 'react'
import { Box, IconButton, Tooltip } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'

import type { HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import type { FaceDeclaration } from '../../facePlugins'

/**
 * 笔记详情顶栏的添加面选择器：新增面入口按钮与可选面清单。
 * 纯展示组件：显隐、待选面与动作全部由顶栏注入。
 */
export type NoteDetailTopBarAddFaceSelectorProps = {
  addFaceSelectorVisible: boolean
  onToggleAddFaceSelector: () => void
  creatableFaceDeclarations: readonly FaceDeclaration[]
  pendingAddFace: string | null
  onPickAddFace: (kind: string) => void
  onConfirmAddFace: () => void
  faces: string[]
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
}

export function NoteDetailTopBarAddFaceSelector(props: NoteDetailTopBarAddFaceSelectorProps): React.ReactNode {
  const {
    addFaceSelectorVisible,
    onToggleAddFaceSelector,
    creatableFaceDeclarations,
    pendingAddFace,
    onPickAddFace,
    onConfirmAddFace,
    faces,
    faceManifests,
  } = props

  return (
    <>
      <Tooltip title="新增面" placement="bottom-end">
        <IconButton
          size="small"
          aria-label="新增面"
          onClick={onToggleAddFaceSelector}
          sx={{
            color: 'rgba(0,0,0,.58)',
            bgcolor: 'transparent',
            '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
          }}
        >
          <AddRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {addFaceSelectorVisible ? (
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
          {creatableFaceDeclarations
            .filter(declaration => !faces.some(f => faceManifests[f]?.kind === declaration.kind))
            .map(declaration => (
              <Box
                key={declaration.kind}
                role="button"
                tabIndex={0}
                onClick={() => onPickAddFace(declaration.kind)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onPickAddFace(declaration.kind)
                  }
                }}
                sx={{
                  minWidth: 56,
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 999,
                  bgcolor: pendingAddFace === declaration.kind ? '#111' : 'transparent',
                  color: pendingAddFace === declaration.kind ? '#fff' : '#374151',
                  fontSize: 12,
                  lineHeight: 1,
                  fontWeight: 700,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                {declaration.label}
              </Box>
            ))}
          <Box
            role="button"
            tabIndex={0}
            onClick={onConfirmAddFace}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onConfirmAddFace()
              }
            }}
            sx={{
              minWidth: 56,
              px: 1.5,
              py: 0.75,
              borderRadius: 999,
              bgcolor: '#fff',
              color: pendingAddFace ? '#111' : 'rgba(0,0,0,.32)',
              fontSize: 12,
              lineHeight: 1,
              fontWeight: 700,
              cursor: pendingAddFace ? 'pointer' : 'default',
              userSelect: 'none',
            }}
          >
            添加
          </Box>
        </Box>
      ) : null}
    </>
  )
}
