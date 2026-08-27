import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import {
  MODAL_CAPABLE_PAGE_IDS,
  type ModalCapablePageId,
  type PageDisplayMode,
  type PageDisplayModesV1,
} from '../pageDisplay'

const PAGE_DISPLAY_LABELS: Record<ModalCapablePageId, string> = {
  home: '主页',
  index: '收藏夹',
  attachments: '附件',
  'all-notes': '全部笔记',
  settings: '设置',
}

// 页面呈现方式设置：每个可接入页面选择「独立页面」或「模态窗」。
export function PageDisplaySettingsPanel(props: {
  modes: PageDisplayModesV1
  onChange: (pageId: ModalCapablePageId, mode: PageDisplayMode) => void
}) {
  const { modes, onChange } = props

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>页面显示方式</Typography>
      <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
        「模态窗」表示该页面以浮层打开：不影响当前所在位置，也不进入前进/后退；「独立页面」即正常切换整页。
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {MODAL_CAPABLE_PAGE_IDS.map(pageId => {
          const mode: PageDisplayMode = modes[pageId] || 'page'
          return (
            <Box
              key={pageId}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                px: 1,
                py: 0.75,
                borderRadius: 2,
                bgcolor: 'var(--hc-surface-soft)',
              }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--hc-text)' }}>{PAGE_DISPLAY_LABELS[pageId]}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Button
                  size="small"
                  variant={mode === 'page' ? 'contained' : 'text'}
                  aria-label={`将${PAGE_DISPLAY_LABELS[pageId]}设为独立页面`}
                  onClick={() => onChange(pageId, 'page')}
                >
                  独立页面
                </Button>
                <Button
                  size="small"
                  variant={mode === 'modal' ? 'contained' : 'text'}
                  aria-label={`将${PAGE_DISPLAY_LABELS[pageId]}设为模态窗`}
                  onClick={() => onChange(pageId, 'modal')}
                >
                  模态窗
                </Button>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
