import * as React from 'react'
import { Box } from '@mui/material'
import { useRenderProbe } from '../../diagnostics/renderProbe'
import { Freeze } from '../components/Freeze'

export type SettingsSurfaceProps = {
  mounted: boolean
  visible: boolean
  content: React.ReactNode
}

// 设置页表面：可见性由外层控制，内容在隐藏时由 Freeze 冻结。
// content 必须是稳定节点（App 侧 useMemo），否则父级每次重渲染都会穿透。
export const SettingsSurface = React.memo(function SettingsSurface(props: SettingsSurfaceProps) {
  useRenderProbe('settings')

  const { mounted, visible, content } = props
  if (!mounted) return null

  return (
    <Box
      aria-hidden={visible ? undefined : true}
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        // 与聊天层同理：用 inherit 而非显式 visible，避免隐藏时子级穿透父级重新显形。
        visibility: visible ? 'inherit' : 'hidden',
      }}
    >
      <Freeze frozen={!visible}>{content}</Freeze>
    </Box>
  )
})
