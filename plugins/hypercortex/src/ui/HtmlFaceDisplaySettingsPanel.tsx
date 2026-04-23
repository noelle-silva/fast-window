import * as React from 'react'
import { Box, Typography } from '@mui/material'
import type { HyperCortexHtmlFaceDisplayModeV1 } from '../core'

// 三种模式的元数据：集中管理，避免在多处重复写
const HTML_FACE_DISPLAY_MODES: {
  id: HyperCortexHtmlFaceDisplayModeV1
  label: string
  description: string
}[] = [
  {
    id: 'natural',
    label: '自然撑开',
    description: 'iframe 高度随内容自动伸展，滚动由外层页面接管。',
  },
  {
    id: 'fit-window',
    label: '随窗口自适应',
    description: 'iframe 铺满当前可用区域，内容在 iframe 内部独立滚动。',
  },
  {
    id: 'fixed-fit',
    label: '固定视口缩放',
    description: '以 1280×900 固定视口渲染，自动缩放以确保内容完整可见，可手动调整缩放比例。',
  },
]

export function HtmlFaceDisplaySettingsPanel(props: {
  mode: HyperCortexHtmlFaceDisplayModeV1
  onChange: (mode: HyperCortexHtmlFaceDisplayModeV1) => void
}) {
  const { mode, onChange } = props

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box>
        <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>
          HTML 面显示策略
        </Typography>
        <Typography sx={{ mt: 0.5, fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.62)' }}>
          控制「HTML 面」的 iframe 在查看（非编辑）状态下的尺寸行为。
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {HTML_FACE_DISPLAY_MODES.map(item => {
          const active = mode === item.id
          return (
            <Box
              key={item.id}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => onChange(item.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onChange(item.id)
                }
              }}
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.5,
                px: 1.5,
                py: 1,
                borderRadius: 2,
                border: '1.5px solid',
                borderColor: active ? '#1976d2' : 'rgba(0,0,0,.10)',
                bgcolor: active ? 'rgba(25,118,210,.05)' : 'rgba(0,0,0,.02)',
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'border-color 120ms, background 120ms',
                '&:hover': {
                  borderColor: active ? '#1976d2' : 'rgba(0,0,0,.22)',
                  bgcolor: active ? 'rgba(25,118,210,.07)' : 'rgba(0,0,0,.04)',
                },
              }}
            >
              {/* 单选圆圈 */}
              <Box
                sx={{
                  flex: '0 0 18px',
                  width: 18,
                  height: 18,
                  mt: 0.15,
                  borderRadius: '50%',
                  border: '2px solid',
                  borderColor: active ? '#1976d2' : 'rgba(0,0,0,.26)',
                  bgcolor: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {active && (
                  <Box
                    sx={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      bgcolor: '#1976d2',
                    }}
                  />
                )}
              </Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.3 }}>
                  {item.label}
                </Typography>
                <Typography sx={{ mt: 0.35, fontSize: 12, lineHeight: 1.5, color: 'rgba(0,0,0,.55)' }}>
                  {item.description}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
