import * as React from 'react'
import { Box } from '@mui/material'
import { useRenderProbe } from '../../diagnostics/renderProbe'
import { Freeze } from '../components/Freeze'
import { SessionPageStack } from '../components/SessionPageStack'

export type SessionViewportProps = {
  frozen: boolean
  visible: boolean
  chatPaneRef: React.MutableRefObject<HTMLDivElement | null>
  transparentChatBg: boolean
  switching: boolean
  activeKey: string
  visibleKey: string
  keys: string[]
  activeScrollRef: React.RefObject<HTMLDivElement | null>
  onPainted: (key: string) => void
  activePage: React.ReactNode
  emptyOverlay: React.ReactNode
  extras?: React.ReactNode
  composer?: React.ReactNode
}

// 会话视口：页面栈、切换进度、无页占位、分支树与输入区的共同容器。
//
// 本阶段只迁移「渲染容器 + 稳定节点」，会话切换状态机、滚动跟随、PAINTED、
// keep-alive 仍由 App 持有并在阶段 3 继续内聚。
export const SessionViewport = React.memo(function SessionViewport(props: SessionViewportProps) {
  useRenderProbe('sessionViewport')

  const {
    frozen,
    visible,
    chatPaneRef,
    transparentChatBg,
    switching,
    activeKey,
    visibleKey,
    keys,
    activeScrollRef,
    onPainted,
    activePage,
    emptyOverlay,
    extras,
    composer,
  } = props

  return (
    <Box
      aria-hidden={visible ? undefined : true}
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        // 常驻不卸载：离开聊天页只隐藏，避免返回时整棵聊天子树重新挂载造成卡顿。
        visibility: visible ? 'inherit' : 'hidden',
      }}
    >
      <Freeze frozen={frozen}>
        <Box
          ref={chatPaneRef}
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            bgcolor: transparentChatBg ? 'transparent' : 'var(--studio-canvas)',
          }}
        >
          {/* 切换进度只做「细进度条」：不遮挡内容区，旧页继续垫底。 */}
          {switching ? (
            <Box
              role="progressbar"
              aria-label="正在切换会话"
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 2,
                zIndex: 3,
                overflow: 'hidden',
                pointerEvents: 'none',
                bgcolor: 'var(--studio-border)',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  width: '35%',
                  bgcolor: 'var(--studio-secondary)',
                  animation: 'fw-switch-progress 900ms ease-in-out infinite',
                },
                '@keyframes fw-switch-progress': {
                  '0%': { transform: 'translateX(-100%)' },
                  '100%': { transform: 'translateX(320%)' },
                },
              }}
            />
          ) : null}

          <SessionPageStack
            activeKey={activeKey}
            visibleKey={visibleKey}
            keys={keys}
            activeScrollRef={activeScrollRef}
            onPainted={onPainted}
            activePage={activePage}
          />

          {emptyOverlay}
          {extras}
          {composer}
        </Box>
      </Freeze>
    </Box>
  )
})
