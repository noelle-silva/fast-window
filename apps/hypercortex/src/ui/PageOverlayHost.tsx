import * as React from 'react'
import { Box } from '@mui/material'

// 页面级模态窗的通用容器：所有以浮层形态呈现的页面共用同一具身体。
// 是否显示由外层条件控制；点遮罩空白处即关闭。
export function PageOverlayHost(props: { onClose: () => void; children: React.ReactNode }) {
  const { onClose, children } = props
  return (
    <Box
      data-hc-overlay="1"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(15,23,42,.32)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          width: 'min(1120px, 94vw)',
          height: '90vh',
          borderRadius: 4,
          bgcolor: 'var(--hc-surface)',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(15,23,42,.28)',
        }}
      >
        {children}
      </Box>
    </Box>
  )
}
