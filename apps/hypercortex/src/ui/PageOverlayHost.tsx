import * as React from 'react'
import { Dialog } from '@mui/material'

// 页面级模态窗的通用容器：所有以浮层形态呈现的页面共用同一具身体。
// 不提供内部标题栏；遮罩点击和 Esc 都交给 Dialog 的关闭语义处理。
export function PageOverlayHost(props: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const { open, onClose, children } = props
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      aria-label="页面浮层"
      slotProps={{
        paper: {
          sx: {
            display: 'flex',
            flexDirection: 'column',
            width: 'min(1120px, 94vw)',
            height: '90vh',
            maxHeight: '90vh',
            minHeight: 0,
            p: 3,
            borderRadius: 4,
            bgcolor: 'var(--hc-surface)',
            backgroundImage: 'none',
            overflow: 'auto',
            boxShadow: '0 24px 64px rgba(15,23,42,.28)',
          },
        },
      }}
    >
      {children}
    </Dialog>
  )
}
